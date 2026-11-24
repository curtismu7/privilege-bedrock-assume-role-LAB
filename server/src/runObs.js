// Rule 27: this lab's side of the shared run-observability panel. Pure functions around the vendored collector (runObservability.js, never
// edited here): the events one run leaves behind, the one stdout line each decision writes, and the record builder.
//
// Mock only: every row is `simulated` and is an event this lab's own mock computed on this run (nothing is invented; a layer the mock never
// touched says so). The lab reads no logs, so only the collector core is vendored (no readers file). Time = when the lab computed it: the
// run's wall-clock start plus the time the calls themselves took on the lab clock (idle time the lab clock was advanced by is NOT added, so no
// row is dated in the future); the lab clock's own reading is in each row's detail.
import { createRunObservability, LAYERS } from './runObservability.js';
import { verdictFor } from './verdicts.js';

export const SERVICE = 'privilege-bedrock-assume-role-lab';
export const MAX_RUNS = 20;
const ID = /[^A-Za-z0-9._:/@-]/g;
const idText = (v) => String(v == null || v === '' ? '-' : v).replace(ID, '_').slice(0, 64);

// One timestamped line per decision: actor and outcome, never a prompt, an external ID or a credential. Words a shared matcher reads as a decision
// are avoided on purpose (the result is passed / stopped / unclear, the step is a short id).
const RESULT = { allowed: 'passed', refused: 'stopped', blocked: 'stopped', info: 'unclear' };
export const decisionLine = (e, runId) => `${e.at} ${SERVICE} decision step=${idText(e.step)} actor=${idText(e.actor)} result=${RESULT[e.outcome] || 'unclear'} run=${idText(runId)}`;

const iso = (ms) => new Date(ms).toISOString();
const hopOf = (call, id) => call.hops.find((h) => h.id === id);

// What a run is, for the trace and the record: a list of items. kind 'call' (a full call result, with the key's label), 'provider' (a plain
// provider attempt that failed before an assumed-role key was tried), 'vertex' (a Vertex evaluation).
export function itemsFor(kind, detail) {
  switch (kind) {
    case 'call': return detail.calls.map((call) => ({ type: 'call', call }));
    case 'key-shape': return [{ type: 'call', call: detail.storedCall }, { type: 'call', call: detail.assumedCall }];
    case 'fallback-target': return [{ type: 'provider', primary: detail.primary }, ...(detail.targetCall ? [{ type: 'call', call: detail.targetCall }] : [])];
    case 'vertex': return [{ type: 'vertex', evaluation: detail.evaluation }];
    default: return [];
  }
}

// items: itemsFor(...); baseMs: wall-clock ms at the start of the run.
export function eventsFor(items, { baseMs }) {
  const ev = [];
  let offset = 0;
  const push = (e) => ev.push({ ...e, at: iso(baseMs + offset) });
  for (const item of items) {
    if (item.type === 'provider') {
      const p = item.primary;
      push({ layer: 'agent', step: 'request', actor: 'app', outcome: 'info', message: 'The app called the gateway; its first model is a plain provider, not an assumed-role key.', detail: { provider: p.provider, model: p.model } });
      offset += p.latencyMs || 0;
      push({ layer: 'resource', step: 'provider-reply', actor: p.provider, outcome: 'info', message: p.ok ? `${p.model} replied HTTP ${p.status} after ${p.latencyMs} ms.` : `${p.model} replied HTTP ${p.status} (${p.error}) after ${p.latencyMs} ms; the assumed-role key is tried next.`, detail: { status: p.status, error: p.error, latencyMs: p.latencyMs } });
      continue;
    }
    if (item.type === 'vertex') {
      const v = item.evaluation;
      push({ layer: 'agent', step: 'request', actor: 'app', outcome: 'info', message: 'The app called the gateway with a key for Vertex AI. The lab holds no credential for it.', detail: { target: 'vertex' } });
      push({ layer: 'privilege', step: 'service-account', actor: 'gateway', outcome: 'info', message: 'The gateway presents its own service account; no role is assumed and no external ID is used.', detail: {} });
      push({ layer: 'authorize', step: 'vertex-binding', actor: 'lab-mock-iam', outcome: v.ok ? 'allowed' : 'refused', message: `${v.title}: ${v.ok ? 'a bound role grants aiplatform.endpoints.predict.' : v.message}`, detail: { code: v.code, roles: v.roles ?? [] } });
      continue;
    }
    const c = item.call;
    const assumed = c.hops.find((h) => h.id === 'key')?.mode === 'assumed-role';
    push({ layer: 'agent', step: 'request', actor: 'app', outcome: 'info', message: assumed ? `The app called the gateway with its LLM key (${c.hops[0].keyId}, assumed-role). The key stores no credential.` : `The app called the gateway with its LLM key (${c.hops[0].keyId}, stored credential; the value is write-only and never shown).`, detail: { keyId: c.hops[0].keyId, mode: c.hops[0].mode, labClockMs: c.clock.startedAt } });
    const guard = hopOf(c, 'ai-guard');
    push({ layer: 'privilege', step: 'ai-guard', actor: 'gateway', outcome: guard.status === 'failed' ? 'blocked' : 'allowed', message: guard.status === 'failed' ? 'AI Guard (a lab stub) blocked the prompt before any role was assumed.' : 'AI Guard (a lab stub) allowed the prompt.', detail: { decision: guard.decision, stub: true } });
    const auth = hopOf(c, 'provider-auth');
    const invoke = hopOf(c, 'bedrock-invoke');
    if (auth.status !== 'skipped') {
      if (assumed) {
        push({ layer: 'authorize', step: 'assume-role', actor: 'lab-mock-iam', outcome: auth.status === 'failed' ? 'refused' : 'allowed', message: auth.status === 'failed' ? `Assume role refused: ${verdictFor(auth.result).title}.` : `Role ${auth.sessionAction === 'reused' ? 'session reused (still valid)' : auth.sessionAction === 'refreshed' ? 'assumed again (the old session had expired)' : 'assumed'}.`, detail: { sessionAction: auth.sessionAction, result: auth.result, sessionExpiresAt: auth.session?.expiresAt ?? null, labClockMs: c.clock.startedAt } });
      } else {
        push({ layer: 'privilege', step: 'provider-auth', actor: 'gateway', outcome: 'info', message: 'The gateway authenticated to the provider with the key\'s stored credential (masked; never shown or logged).', detail: { method: 'stored-credential' } });
      }
    }
    if (invoke.status !== 'skipped') {
      if (invoke.stage === 'invoke-permission' || invoke.stage === 'model-access') {
        push({ layer: 'authorize', step: invoke.stage, actor: 'lab-mock-iam', outcome: 'refused', message: `Invoke refused: ${verdictFor(invoke.result).title}.`, detail: { result: invoke.result, stage: invoke.stage } });
      } else {
        if (assumed) push({ layer: 'authorize', step: 'invoke-permission', actor: 'lab-mock-iam', outcome: 'allowed', message: 'The role may invoke the model and the model is enabled in the region.', detail: { modelId: c.hops[0].modelId, region: c.hops[0].region } });
        offset += invoke.latencyMs || 0;
        push({ layer: 'resource', step: 'provider-reply', actor: 'lab-mock-bedrock', outcome: 'info', message: invoke.status === 'done' ? `The mock Bedrock replied HTTP ${invoke.httpStatus} after ${invoke.latencyMs} ms.` : `The mock Bedrock replied HTTP ${invoke.httpStatus} (${invoke.result}) after ${invoke.latencyMs} ms.`, detail: { status: invoke.httpStatus, latencyMs: invoke.latencyMs } });
      }
    }
    const metering = hopOf(c, 'metering');
    if (metering.status === 'done') push({ layer: 'privilege', step: 'metering', actor: 'gateway', outcome: 'allowed', message: `Metering: ${metering.tokens} tokens charged to the key's own budget (${metering.remaining} left); Usage counts the request.`, detail: { tokens: metering.tokens, remaining: metering.remaining } });
    else if (metering.status === 'failed') push({ layer: 'privilege', step: 'metering', actor: 'gateway', outcome: 'refused', message: `Metering: ${verdictFor(metering.why).title}.`, detail: { why: metering.why, remaining: metering.remaining ?? null } });
    push({ layer: 'privilege', step: 'audit', actor: 'gateway', outcome: 'info', message: `Audit entry ${c.audit.seq} written (${c.audit.outcome}, ${c.code}); it holds ids, the outcome and the lab time, never the prompt, an external ID or a credential.`, detail: { seq: c.audit.seq, outcome: c.audit.outcome, code: c.code } });
  }
  return ev;
}

const WHY = {
  person: 'This lab has no signed-in person: the key belongs to an app.',
  gateway: 'This lab has no separate agent gateway hop. The lab model of the LLM gateway is shown under Privilege.',
  agent: 'No call was made.', privilege: 'No call was made.', authorize: 'No role or service account was checked in this run (a stored-credential key assumes no role).',
  resource: 'No model was called in this run (the call stopped before the mock Bedrock).',
};
const PRODUCT = { agent: 'lab mock app', privilege: 'lab mock LLM gateway', authorize: 'lab mock IAM', resource: 'lab mock Bedrock' };

export function mockLayers(events) {
  return LAYERS.map((layer) => ({
    layer, products: [], reason: WHY[layer],
    simulated: events.filter((e) => e.layer === layer).map((e) => ({ at: e.at, product: PRODUCT[layer], outcome: e.outcome, message: e.message, detail: e.detail })),
  }));
}

// run: { id, startedAt (ISO), endedAt (ISO), events }.
export async function buildRunRecord(run, { clock = Date.now } = {}) {
  if (!run) return null;
  return createRunObservability({ clock }).collectRun({ runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt, source: 'mock', layers: mockLayers(run.events) });
}

// Where a run leaves logs and where they could stream (rule 27: the README says the same). The lab reads no log and claims no product logged anything.
export const STREAMS = Object.freeze([
  { product: 'This lab (stdout)', lives: 'one line per decision on the lab\'s standard output (docker logs)', streams: 'a collector could ship it to a log index; this lab does not' },
  { product: 'The Privilege gateway', lives: 'not read by this lab (no Real mode yet)', streams: 'the Privilege SIEM export; whether the product logs an assumed-role call is UNVERIFIED' },
]);

export const durationMs = (items) => items.reduce((n, i) => n + (i.type === 'call' ? i.call.clock.endedAt - i.call.clock.startedAt : i.type === 'provider' ? i.primary.latencyMs || 0 : 0), 0);
