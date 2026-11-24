// One Express app. /api = health, info, mode, state, call, evaluate, scenarios, scenario, reset.
// One in-memory lab per process: a key, the AWS side's policies, a lab clock and an audit log. Scenarios and /api/evaluate never touch it.
// Mock only: there is no Real mode yet, so the toggle's Real side answers 409 with a plain reason (rule 19).
// A refused call is a normal result ({ok:false, code}) with HTTP 200: the product's real refusal status is UNVERIFIED, so none is imitated.
import express from 'express';
import { hostCheck, sameOriginWrites, DEFAULT_PORT } from './safety.js';
import { createHealth } from './health.js';
import { runChecks, allPassed } from './doctor.js';
import { PROVIDER_STATES } from './model-gateway-sim/providerStub.js';
import { createLab } from './lab.js';
import { KEY_MODES } from './keyModes.js';
import { evaluate, evaluateWithRefresh } from './iamEvaluator.js';
import { evaluateVertex } from './vertexEvaluator.js';
import { SCENARIOS, runScenario, scenarioById } from './scenarios.js';
import { LIMITS, onlyKeys, validateAdvance, validateAws, validatePrompt, validateProviderState } from './validate.js';
import {
  BANNER, DEFAULT_PROMPT, DEFAULT_REGION, GATEWAY_PRINCIPAL, LARGE_MODEL, GUARD_BLOCK_MARKER, LAB_ID, LAB_NAME, MODEL_CATALOG, REAL_UNAVAILABLE, UNVERIFIED, VERTEX_SERVICE_ACCOUNT,
} from './data.js';
import { InputError, refuse } from './errors.js';
import pkg from '../package.json' with { type: 'json' };

export const ROUTES = {
  '/api/info': ['GET'],
  '/api/mode': ['GET', 'POST'],
  '/api/state': ['GET'],
  '/api/call': ['POST'],
  '/api/evaluate': ['POST'],
  '/api/scenarios': ['GET'],
  '/api/scenario/:id': ['POST'],
  '/api/reset': ['POST'],
};
// /api/health has its own router (GET only, 405 otherwise).
const ROUTE_TABLE = Object.entries(ROUTES).map(([pattern, methods]) => [new RegExp(`^${pattern.replace(/:[a-z]+/g, '[^/]+')}$`), methods]);

const BEDROCK_FIELDS = ['target', 'trust', 'permission', 'callerPrincipal', 'externalId', 'modelId', 'region', 'now', 'session', 'sessionMs', 'refresh'];
const VERTEX_FIELDS = ['target', 'policy', 'serviceAccount'];

export function createApp({ health = createHealth({ demoId: LAB_ID, demoName: LAB_NAME, version: pkg.version, runChecks, allPassed }), env = process.env } = {}) {
  void env;
  const lab = createLab();
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Cache-Control', 'no-store'); next(); });

  const api = express.Router();
  api.use('/health', health.router);
  api.use(express.json({ limit: '256kb' }));
  // Wrong method on a known path: 405 with Allow.
  api.use((req, res, next) => {
    for (const [re, methods] of ROUTE_TABLE) {
      if (re.test(`/api${req.path}`) && !methods.includes(req.method)) return res.set('Allow', methods.join(', ')).status(405).json({ error: 'method_not_allowed', message: `Use ${methods.join(' or ')} here` });
    }
    next();
  });

  api.get('/info', (_req, res) => res.json({
    lab: LAB_NAME, id: LAB_ID, version: pkg.version, tier: 'Demo', source: 'mock', realAvailable: false, realReason: REAL_UNAVAILABLE,
    banner: BANNER, unverified: UNVERIFIED, defaultPrompt: DEFAULT_PROMPT, guardMarker: GUARD_BLOCK_MARKER, limits: LIMITS,
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

  api.get('/state', (_req, res) => res.json(lab.view()));

  // A call through the live key. Optional `key` replaces the key (fresh ledger and no session), `aws` replaces the named policies,
  // `advanceMs` moves the lab clock forward first. Everything is validated before anything changes.
  api.post('/call', (req, res) => {
    onlyKeys(req.body, ['prompt', 'advanceMs', 'key', 'aws', 'providerState'], 'the call request');
    const { prompt, key, aws } = req.body;
    validatePrompt(prompt);
    const advanceMs = validateAdvance(req.body.advanceMs);
    const providerState = validateProviderState(req.body.providerState);
    if (aws !== undefined) validateAws(aws);
    if (key !== undefined) lab.setKey(key); // createKeyObject throws a 4xx before the lab changes
    if (aws !== undefined) lab.setAws({ ...lab.aws(), ...aws });
    if (advanceMs) lab.advance(advanceMs);
    res.json({ ...lab.call(prompt, { providerState }), state: lab.view() });
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
    if (!scenarioById(req.params.id)) throw refuse('unknown_scenario', 'no scenario with that id', 404);
    res.json(runScenario(req.params.id));
  });

  api.post('/reset', (_req, res) => { lab.reset(); res.json({ reset: true, ...lab.view() }); });

  api.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found' }));
  app.use('/api', api);
  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found. The web page is built in a later step; use /api/info.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof InputError) return res.status(err.status).json({ error: err.code, message: err.message });
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
