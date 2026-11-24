// One Express app. /api = health, info, mode, state, call, evaluate, scenarios, scenario, reset.
// One in-memory lab per process: a key, the AWS side's policies, a lab clock and an audit log. Scenarios and /api/evaluate never touch it.
// Mock only: there is no Real mode yet, so the toggle's Real side answers 409 with a plain reason (rule 19).
// A refused call is a normal result ({ok:false, code}) with HTTP 200: the product's real refusal status is UNVERIFIED, so none is imitated.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostCheck, sameOriginWrites, DEFAULT_PORT } from './safety.js';
import { createHealth } from './health.js';
import { runChecks, allPassed } from './doctor.js';
import { PROVIDER_STATES } from './model-gateway-sim/providerStub.js';
import { createLab, DEFAULT_KEY_SPEC } from './lab.js';
import { createClock } from './model-gateway-sim/labClock.js';
import { KEY_MODES, createKeyObject, keyView } from './keyModes.js';
import { evaluate, evaluateWithRefresh } from './iamEvaluator.js';
import { evaluateVertex } from './vertexEvaluator.js';
import { SCENARIOS, runScenarioDetailed, scenarioById } from './scenarios.js';
import { LIMITS, onlyKeys, validateAdvance, validateAws, validatePrompt, validateProviderState } from './validate.js';
import {
  BANNER, DEFAULT_AWS, DEFAULT_PROMPT, DEFAULT_REGION, GATEWAY_PRINCIPAL, IAM_SNIPPETS, LAB_MODEL, LARGE_MODEL, GUARD_BLOCK_MARKER, LAB_ID, LAB_NAME, MODEL_CATALOG, NOT_CLAIMED, REAL_UNAVAILABLE,
  SOURCED, UNVERIFIED, VERTEX_SERVICE_ACCOUNT,
} from './data.js';
import { InputError, refuse } from './errors.js';
import { verdictFor } from './verdicts.js';
import { createWorkspaces, workspaceFrom, WorkspaceError } from './workspaces.js';
import { castForVertical, loadCustomerConfig, publicConfig } from './customer.js';
import { buildStories } from './stories.js';
import { TALK_SECTIONS, buildTalkTrack } from './talkTrack.js';
import { DIAGRAM_NAMES, buildDiagram, hasDiagram } from './diagramData.js';
import { MAX_RUNS, STREAMS, buildRunRecord, decisionLine, durationMs, eventsFor, itemsFor } from './runObs.js';
import { exchangesFor } from './runTrace.js';
import { RunObsError } from './runObservability.js';
import pkg from '../package.json' with { type: 'json' };

export const ROUTES = {
  '/api/info': ['GET'],
  '/api/mode': ['GET', 'POST'],
  '/api/state': ['GET'],
  '/api/key': ['PUT'],
  '/api/key-shapes': ['GET'],
  '/api/call': ['POST'],
  '/api/evaluate': ['POST'],
  '/api/scenarios': ['GET'],
  '/api/scenario/:id': ['POST'],
  '/api/reset': ['POST'],
  '/api/story': ['GET'],
  '/api/diagram': ['GET'],
  '/api/log': ['GET'],
  '/api/run-observability': ['GET'],
};
// /api/health has its own router (GET only, 405 otherwise).
const ROUTE_TABLE = Object.entries(ROUTES).map(([pattern, methods]) => [new RegExp(`^${pattern.replace(/:[a-z]+/g, '[^/]+')}$`), methods]);

const BEDROCK_FIELDS = ['target', 'trust', 'permission', 'callerPrincipal', 'externalId', 'modelId', 'region', 'now', 'session', 'sessionMs', 'refresh'];
const VERTEX_FIELDS = ['target', 'policy', 'serviceAccount'];
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const sayLine = (line) => process.stdout.write(`${line}\n`);

// One workspace's state (rule 13). `lastRun` is the run the observability panel shows (a live call or a scenario run); `log` is a short summary list.
function createLabState() {
  let seq = 0;
  return { lab: createLab(), nextRunId: () => `run-${++seq}`, lastRun: null, log: [] };
}

export function createApp({
  health = createHealth({ demoId: LAB_ID, demoName: LAB_NAME, version: pkg.version, runChecks, allPassed }),
  env = process.env, customer = loadCustomerConfig({ env }), log = sayLine, now = Date.now, distDir = DIST,
} = {}) {
  const workspaces = createWorkspaces({ build: () => createLabState() });
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-store');
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    next();
  });

  const api = express.Router();
  api.use('/health', health.router);
  api.use(express.json({ limit: '256kb' }));
  // Wrong method on a known path: 405 with Allow.
  api.use((req, res, next) => {
    for (const [re, methods] of ROUTE_TABLE) {
      if (re.test(`/api${req.path}`) && !methods.includes(req.method) && !(req.method === 'HEAD' && methods.includes('GET'))) return res.set('Allow', [...methods, ...(methods.includes('GET') ? ['HEAD'] : [])].join(', ')).status(405).json({ error: 'method_not_allowed', message: `Use ${methods.join(' or ')} here` });
    }
    next();
  });
  // The workspace of a request (rule 13): a bad X-Workspace is a 400 with a message, never silently the default.
  // Every route that uses a workspace answers X-Workspace-Fresh: 1 when this request created it (0 otherwise): a tab that already used this id and gets 1 was forgotten.
  const wsOf = (req, res) => {
    const { ws, created } = workspaces.touch(workspaceFrom(req));
    res.set('X-Workspace-Fresh', created ? '1' : '0');
    return ws;
  };

  // Every run, live or scenario, leaves the same things behind: one stdout line per decision, the last-run record for the panel and a log line.
  function recordRun(ws, { kind, scenarioId = null, prompt, items, ok, code }) {
    const runId = ws.nextRunId();
    const baseMs = now();
    const events = eventsFor(items, { baseMs });
    for (const e of events) log(decisionLine(e, runId));
    ws.lastRun = { id: runId, startedAt: new Date(baseMs).toISOString(), endedAt: new Date(baseMs + durationMs(items)).toISOString(), events, kind, scenarioId };
    ws.log = [{ runId, at: ws.lastRun.startedAt, kind, scenarioId, ok, code }, ...ws.log].slice(0, MAX_RUNS);
    return { runId, trace: { exchanges: exchangesFor(items, { prompt }) } };
  }

  api.get('/info', (req, res) => res.json({
    lab: LAB_NAME, id: LAB_ID, version: pkg.version, tier: 'Demo', source: 'mock', realAvailable: false, realReason: REAL_UNAVAILABLE,
    banner: BANNER, sourced: SOURCED, labModel: LAB_MODEL, unverified: UNVERIFIED, notClaimed: NOT_CLAIMED, workspace: workspaceFrom(req), name: customer.config.name,
    snippets: IAM_SNIPPETS, defaultKey: DEFAULT_KEY_SPEC(), defaultAws: DEFAULT_AWS(), defaultPrompt: DEFAULT_PROMPT, guardMarker: GUARD_BLOCK_MARKER, limits: LIMITS,
    keyModes: KEY_MODES, providerStates: PROVIDER_STATES, modelCatalog: MODEL_CATALOG,
    placeholders: { gatewayPrincipal: GATEWAY_PRINCIPAL, vertexServiceAccount: VERTEX_SERVICE_ACCOUNT },
  }));

  api.get('/mode', (_req, res) => res.json({ source: 'mock', realAvailable: false, realReason: REAL_UNAVAILABLE }));
  api.post('/mode', (req, res) => {
    onlyKeys(req.body, ['source'], 'the mode request');
    if (req.body.source === 'mock') return res.json({ source: 'mock' });
    if (req.body.source === 'real') return res.status(409).json({ error: 'real_unavailable', message: REAL_UNAVAILABLE, source: 'mock' });
    throw refuse('bad_source', 'source must be "mock" or "real"');
  });

  api.get('/state', (req, res) => res.json(wsOf(req, res).lab.view()));

  // Replace the live key (a fresh ledger and no session; the clock and the audit log are kept). The credential of a stored key is write-only: it is
  // never in the answer. createKeyObject throws a 4xx before anything changes.
  api.put('/key', (req, res) => {
    const { lab } = wsOf(req, res);
    lab.setKey(req.body);
    res.json(lab.view());
  });

  // The two key modes side by side (illustrative keys on their own clock: the live lab is never touched). The stored key's value is a MOCK- placeholder
  // and is never returned: its view holds only a mask. The assumed-role key has no credential field at all.
  api.get('/key-shapes', (_req, res) => {
    const clock = createClock(0);
    const assumed = createKeyObject(DEFAULT_KEY_SPEC(), clock);
    const stored = createKeyObject({ mode: 'stored-credential', modelId: LARGE_MODEL, region: DEFAULT_REGION, budgetTokens: 2000, credential: 'MOCK-example-credential-0001' }, clock);
    res.json({ stored: keyView(stored), assumed: keyView(assumed) });
  });

  // A call through the live key. Optional `key` replaces the key (fresh ledger and no session), `aws` replaces the named policies,
  // `advanceMs` moves the lab clock forward first. Everything is validated before anything changes.
  api.post('/call', (req, res) => {
    const ws = wsOf(req, res);
    const { lab } = ws;
    onlyKeys(req.body, ['prompt', 'advanceMs', 'key', 'aws', 'providerState'], 'the call request');
    const { prompt, key, aws } = req.body;
    validatePrompt(prompt);
    const advanceMs = validateAdvance(req.body.advanceMs);
    const providerState = validateProviderState(req.body.providerState);
    if (aws !== undefined) validateAws(aws);
    if (key !== undefined) lab.setKey(key); // createKeyObject throws a 4xx before the lab changes
    if (aws !== undefined) lab.setAws({ ...lab.aws(), ...aws });
    if (advanceMs) lab.advance(advanceMs);
    const result = lab.call(prompt, { providerState });
    const items = itemsFor('call', { calls: [result] });
    res.json({ ...result, verdict: verdictFor(result.code), state: lab.view(), ...recordRun(ws, { kind: 'live', prompt, items, ok: result.ok, code: result.code }) });
  });

  // The pure evaluators over what the caller sends. Never touches the live lab. A bad policy is a named 200 result; a bad field is a 400.
  api.post('/evaluate', (req, res) => {
    const target = req.body?.target ?? 'bedrock';
    if (target !== 'bedrock' && target !== 'vertex') throw refuse('bad_target', 'target must be "bedrock" or "vertex"');
    onlyKeys(req.body, target === 'vertex' ? VERTEX_FIELDS : BEDROCK_FIELDS, 'the evaluate request');
    let result;
    if (target === 'vertex') {
      result = evaluateVertex({ policy: req.body.policy, serviceAccount: req.body.serviceAccount ?? VERTEX_SERVICE_ACCOUNT });
    } else {
      const b = req.body;
      const input = {
        trust: b.trust, permission: b.permission, callerPrincipal: b.callerPrincipal ?? GATEWAY_PRINCIPAL, externalId: b.externalId,
        modelId: b.modelId ?? LARGE_MODEL, region: b.region ?? DEFAULT_REGION, now: b.now ?? 0, session: b.session, sessionMs: b.sessionMs,
      };
      if (b.refresh !== undefined && typeof b.refresh !== 'boolean') throw refuse('bad_refresh', 'refresh must be true or false');
      result = (b.refresh ? evaluateWithRefresh : evaluate)(input);
    }
    if (result.code === 'bad_input') throw refuse('bad_input', `the field "${result.field}" is not valid`);
    res.json(result);
  });

  api.get('/scenarios', (_req, res) => res.json({ scenarios: SCENARIOS.map(({ id, kind, title, summary, expect }) => ({ id, kind, title, summary, expect })) }));
  api.post('/scenario/:id', (req, res) => {
    const ws = wsOf(req, res);
    const sc = scenarioById(req.params.id);
    if (!sc) throw refuse('unknown_scenario', 'no scenario with that id', 404);
    const out = runScenarioDetailed(sc.id);
    const items = itemsFor(sc.kind, out.detail);
    const last = sc.kind === 'call' ? out.result.calls.at(-1) : null;
    const code = sc.kind === 'call' ? last.code : sc.kind === 'vertex' ? out.result.code : sc.kind === 'fallback-target' ? (out.result.ok ? 'success' : 'target_failed') : 'key_shape';
    const verdict = sc.kind === 'key-shape' || sc.kind === 'fallback-target' ? null : verdictFor(code);
    const prompt = sc.prompt ?? sc.calls?.[0]?.prompt ?? DEFAULT_PROMPT;
    res.json({ ...out, verdict, ...recordRun(ws, { kind: 'scenario', scenarioId: sc.id, prompt, items, ok: out.pass, code }) });
  });

  // The vertical packs and customer.config (rules 10 and 12): stories and the talk track with the cast filled in. ?vertical= picks a pack.
  api.get('/story', (req, res) => {
    const pick = castForVertical(customer, req.query.vertical);
    if (!pick) throw refuse('unknown_vertical', 'no such vertical', 400);
    const sections = TALK_SECTIONS;
    res.json({ ...publicConfig(customer), vertical: pick.vertical, cast: pick.cast, talkTrackProblem: sections.length === 0 ? 'docs/talk-track.md is missing or empty, so there is no talk track to show' : null, stories: buildStories(pick.cast).map((st) => ({ ...st, page: scenarioById(st.scenario)?.kind === 'vertex' ? 'vertex' : 'assumed-role' })), talkTrack: buildTalkTrack(pick.cast, sections), banner: BANNER, unverified: UNVERIFIED });
  });

  // Rule 17: the diagram by name, from diagram-studio data.
  api.get('/diagram', (req, res) => {
    const name = req.query.name === undefined ? DIAGRAM_NAMES[0] : req.query.name;
    if (!hasDiagram(name)) throw refuse('unknown_diagram', `no diagram with that name; the lab has: ${DIAGRAM_NAMES.join(', ')}`, 404);
    const pick = castForVertical(customer, req.query.vertical);
    if (!pick) throw refuse('unknown_vertical', 'no such vertical', 400);
    res.json(buildDiagram(pick.cast, name));
  });

  // Rule 27: what the last run of this workspace left behind. null before any run.
  api.get('/run-observability', async (req, res, next) => {
    try { const ws = wsOf(req, res); res.json({ record: await buildRunRecord(ws.lastRun, { clock: now }), run: ws.lastRun ? { id: ws.lastRun.id, kind: ws.lastRun.kind, scenarioId: ws.lastRun.scenarioId } : null, streams: STREAMS }); }
    catch (e) { next(e); }
  });
  api.get('/log', (req, res) => res.json({ runs: wsOf(req, res).log }));

  // Reset clears this workspace only (its key, policies, clock, audit log, last run and log) and gives its slot back.
  api.post('/reset', (req, res) => {
    const id = workspaceFrom(req);
    workspaces.reset(id);
    res.json({ reset: true, workspace: id, ...createLabState().lab.view() }); // the defaults, without taking the workspace's slot again
  });

  api.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found' }));
  app.use('/api', api);

  // The built web page (web/dist), when there is one: tests and the doctor run without it. Any other GET gets index.html (hash routing needs only /).
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(distDir, { index: false, fallthrough: true }));
    app.get(/^\/(?!api(\/|$)|assets\/).*/, (_req, res) => res.sendFile(indexHtml)); // a missing /assets file is a 404, never the page
  }
  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found. The web page is not built here (npm run build); the API is under /api.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof InputError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof WorkspaceError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof RunObsError) return res.status(err.status || 400).json({ error: err.code, message: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'The body is not valid JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'The body is too large' });
    if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported') return res.status(415).json({ error: 'unsupported_encoding', message: 'Send the body as utf-8 JSON' });
    return res.status(500).json({ error: 'internal', message: 'The lab hit an internal error' });
  });
  app._health = health; // for tests and the doctor to stop the background timer
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}

export { DEFAULT_PORT };
