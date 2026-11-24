// The "What Privilege did" trace for one run (rule 25), built from the engine's results with the vendored gatewayTrace.js (mockTrace).
// For a call: step 1 is the app's call to the lab's mock gateway, whose decisions are the SIX HOPS (key, ai-guard, provider-auth, bedrock-invoke,
// metering, audit), each pass, fail or skipped; then one step per call the gateway really made (the role service when it assumed the role, the mock
// Bedrock when it invoked). The lab's gateway computed every decision, so every basis is `checked`.
// Hosts are .example. Nothing shown is a credential: the key and the session credentials are labelled lab mocks and are never printed, and the
// external ID is never shown (only whether one was sent). HTTP statuses for a refusal by the role service are the lab's own and UNVERIFIED.
import { mockTrace } from './gatewayTrace.js';
import { verdictFor } from './verdicts.js';

const GATEWAY_URL = 'https://gateway.lab.example/v1/chat';
const STS_URL = 'https://sts.lab.example/';
const bedrockUrl = (region, model) => `https://bedrock-runtime.${region}.lab.example/model/${model}/invoke`;
const OUTCOME = { done: 'pass', failed: 'fail', skipped: 'skipped' };
const LABEL = { key: 'The LLM key', 'ai-guard': 'AI Guard (lab stub)', 'provider-auth': 'Provider authentication', 'bedrock-invoke': 'Bedrock invoke', metering: 'Metering', audit: 'Audit' };
const hopOf = (c, id) => c.hops.find((h) => h.id === id);

function evidence(c, h) {
  const key = hopOf(c, 'key');
  switch (h.id) {
    case 'key': return key.mode === 'assumed-role' ? `${key.keyId}: an assumed-role key. It stores no credential field of any kind.` : `${key.keyId}: a stored-credential key. Its credential is write-only and shown as a mask.`;
    case 'ai-guard': return h.status === 'failed' ? 'Blocked the prompt (the stub blocks one marker string) before any role was assumed.' : 'Allowed the prompt (a lab stub; it says nothing about any product\'s detection).';
    case 'provider-auth':
      if (h.status === 'skipped') return 'Not reached: the call stopped before this step.';
      if (h.method === 'stored-credential') return 'Used the key\'s stored credential (masked; the value is never shown or logged).';
      return h.status === 'failed' ? `Role not assumed: ${verdictFor(h.result).title}.` : `Role ${h.sessionAction === 'reused' ? 'session reused' : h.sessionAction === 'refreshed' ? 'assumed again after the session expired' : 'assumed'}${h.session ? `; the session expires at lab time ${h.session.expiresAt} ms` : ''}.`;
    case 'bedrock-invoke':
      if (h.status === 'skipped') return 'Not reached: the call stopped before this step.';
      if (h.status === 'done') return `Bedrock answered HTTP ${h.httpStatus} after ${h.latencyMs} ms.`;
      return h.httpStatus ? `Bedrock answered HTTP ${h.httpStatus} (${h.result}) after ${h.latencyMs} ms.` : `Refused before the model ran: ${verdictFor(h.result).title}.`;
    case 'metering': return h.status === 'done' ? `${h.tokens} tokens charged to the key's own budget; ${h.remaining} left; Usage counts the request.` : h.status === 'failed' ? `${verdictFor(h.why).title}.` : 'Not charged: no model call was made.';
    case 'audit': return `Entry ${c.audit.seq} written: ${c.audit.outcome}, ${c.code}. Ids and outcome only; never the prompt, the external ID or a credential.`;
    default: return '';
  }
}

export function callExchanges(c, { prompt, startStep = 1, label = null }) {
  const key = hopOf(c, 'key');
  const auth = hopOf(c, 'provider-auth');
  const invoke = hopOf(c, 'bedrock-invoke');
  const v = verdictFor(c.code);
  const assumed = key.mode === 'assumed-role';
  const decisions = c.hops.map((h) => ({ id: h.id, label: LABEL[h.id], outcome: OUTCOME[h.status], evidence: evidence(c, h) }));
  const body = c.ok
    ? { ok: true, code: c.code, servedBy: c.servedBy, answer: c.answer, tokensCharged: c.tokensCharged, note: 'Lab model: how the real response looks is UNVERIFIED.' }
    : { ok: false, code: c.code, title: v.title, fix: v.fix, note: 'Lab model: the real refusal wording and status are UNVERIFIED; this lab returns a normal result.' };
  const out = [{
    step: startStep, title: `${label ? `${label}: ` : ''}App to gateway: ${c.ok ? `served (${c.code})` : `refused (${c.code})`}`, status: 200,
    trace: mockTrace({ url: GATEWAY_URL, authorization: `Bearer MOCK-${key.keyId} (a lab mock value, not a credential)`, rpc: { messages: [{ role: 'user', content: prompt }] }, status: 200, body, requestHeaders: { accept: null }, decisions }),
  }];
  let n = startStep + 1;
  if (assumed && auth.status !== 'skipped' && auth.sessionAction !== 'reused') {
    const ok = auth.status === 'done';
    out.push({
      step: n++, title: `Gateway to the role service: ${ok ? 'role assumed' : `refused (${auth.result})`}`, status: ok ? 200 : 403,
      trace: mockTrace({
        url: STS_URL, authorization: 'Gateway identity (a lab mock value, not a credential)', requestHeaders: { accept: null },
        rpc: { Action: 'AssumeRole', RoleArn: auth.roleArn, RoleSessionName: 'example-gateway-session', ExternalId: auth.externalIdSent ? 'sent by the key (value not shown)' : 'none sent' }, status: ok ? 200 : 403,
        body: ok ? { Session: { assumedAt: auth.session.assumedAt, expiresAt: auth.session.expiresAt }, Credentials: '(short-lived lab mock values, never shown)', note: 'Lab model: the session length is UNVERIFIED.' }
          : { error: 'AccessDenied', result: auth.result, note: 'Lab model: the real status and wording are UNVERIFIED.' },
        decisions: [{ id: 'assume-role', label: ok ? 'The role was assumed' : 'The role was not assumed', outcome: ok ? 'pass' : 'fail', evidence: ok ? `Action ${auth.sessionAction}; trust policy, external ID and session checked by the lab's mock IAM.` : `${verdictFor(auth.result).title}: ${verdictFor(auth.result).message}` }],
      }),
    });
  }
  if (invoke.status !== 'skipped') {
    const model = invoke.modelId || key.modelId;
    const region = invoke.region || key.region;
    const ok = invoke.status === 'done';
    const status = ok ? invoke.httpStatus : invoke.httpStatus ?? 403;
    out.push({
      step: n++, title: `Gateway to Bedrock: ${ok ? 'answered' : `refused (${invoke.result})`}`, status,
      trace: mockTrace({
        url: bedrockUrl(region, model), authorization: assumed ? 'AWS4-HMAC-SHA256 (the role\'s short-lived lab mock session; not shown)' : 'AWS4-HMAC-SHA256 (the key\'s stored lab mock credential; not shown)', requestHeaders: { accept: null },
        rpc: { modelId: model, messages: [{ role: 'user', content: prompt }] }, status,
        body: ok ? { text: c.answer, usage: { note: 'lab mock', tokens: c.tokensCharged } } : { error: invoke.result, note: invoke.httpStatus ? undefined : 'Lab model: the real status and wording are UNVERIFIED.' },
        decisions: [{ id: 'invoke', label: ok ? 'Bedrock answered' : 'The invoke did not go through', outcome: ok ? 'pass' : 'fail', evidence: ok ? `HTTP ${status} after ${invoke.latencyMs} ms (lab mock Bedrock).` : `${verdictFor(invoke.result).title}.` }],
      }),
    });
  }
  return out;
}

export function exchangesFor(items, { prompt }) {
  const out = [];
  for (const item of items) {
    if (item.type === 'call') out.push(...callExchanges(item.call, { prompt, startStep: out.length + 1, label: items.length > 1 ? (hopOf(item.call, 'key').mode === 'assumed-role' ? 'Assumed-role key' : 'Stored-credential key') : null }));
    else if (item.type === 'provider') {
      const p = item.primary;
      out.push({
        step: out.length + 1, title: `Gateway to ${p.provider}: could not answer (HTTP ${p.status})`, status: p.status,
        trace: mockTrace({ url: `https://${p.provider}.lab.example/v1/chat`, authorization: 'Bearer MOCK-provider-credential (a lab mock value, not a credential)', requestHeaders: { accept: null }, rpc: { model: p.model, messages: [{ role: 'user', content: prompt }] }, status: p.status, body: { error: p.error }, decisions: [{ id: 'reply', label: 'The provider could not answer', outcome: 'fail', evidence: `HTTP ${p.status} after ${p.latencyMs} ms (lab mock provider). The assumed-role key is tried next.` }] }),
      });
    } else if (item.type === 'vertex') {
      const e = item.evaluation;
      out.push({
        step: out.length + 1, title: `Gateway to Vertex AI: ${e.ok ? 'allowed' : `refused (${e.code})`}`, status: e.ok ? 200 : 403,
        trace: mockTrace({
          url: 'https://vertex.lab.example/v1/endpoints/example:predict', authorization: 'The gateway\'s own service account (a lab mock value; no role is assumed)', requestHeaders: { accept: null },
          rpc: { instances: [{ content: prompt }] }, status: e.ok ? 200 : 403, body: e.ok ? { predictions: ['(lab mock answer)'] } : { error: e.code, note: 'Lab model: the real status and wording are UNVERIFIED.' },
          decisions: (e.steps.length ? e.steps : [{ id: 'policy', ok: e.ok, detail: e.title }]).map((s) => ({ id: s.id, label: s.id === 'binding' ? 'A binding names the service account' : s.id === 'role-grants-predict' ? 'The role grants aiplatform.endpoints.predict' : 'The policy was read', outcome: s.ok ? 'pass' : 'fail', evidence: s.detail })),
        }),
      });
    }
  }
  return out;
}
