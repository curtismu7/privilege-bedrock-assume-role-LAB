// One call through a key, as hops. The point of the lab: an assumed-role key changes HOW the gateway authenticates to Bedrock and nothing else,
// so the same six hops run for both key modes and metering, the AI Guard step and the audit entry STILL happen on the call.
//   key -> ai-guard -> provider-auth -> bedrock-invoke -> metering -> audit
// Every hop is always listed, with status done | failed | skipped, so a failure shows exactly where the call stopped and what did not run.
// Deterministic: no network, no randomness, time only from the lab clock. The ORDER of the hops and the refused-call audit are this lab's model (UNVERIFIED).
import { evaluateWithRefresh } from './iamEvaluator.js';
import { externalIdFor, hasExternalId, hasStoredCredential } from './keyModes.js';
import { GATEWAY_PRINCIPAL, GUARD_BLOCK_MARKER } from './data.js';

export const HOP_IDS = Object.freeze(['key', 'ai-guard', 'provider-auth', 'bedrock-invoke', 'metering', 'audit']);
export const REPLY_TOKENS = 120;
const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
export const estimateTokens = (prompt) => wordCount(prompt) + REPLY_TOKENS;

// The guard is a labelled STUB: it blocks one marker string and says nothing about any product's detection.
export function stubGuard(prompt) {
  return prompt.includes(GUARD_BLOCK_MARKER) ? { decision: 'block', rule: 'lab-stub-marker' } : { decision: 'allow', rule: null };
}

// A bounded in-memory audit log. Entries hold ids, outcomes and times; never a credential, an external ID, a session value or the prompt text.
export function createAuditLog(max = 200) {
  const entries = [];
  let seq = 0;
  return {
    append(entry) { entries.push(Object.freeze({ seq: ++seq, ...entry })); if (entries.length > max) entries.shift(); return entries[entries.length - 1]; },
    list: () => entries.map((e) => ({ ...e })),
    size: () => entries.length,
    clear() { entries.length = 0; seq = 0; },
  };
}

// id and status always win over a detail field of the same name (an HTTP status goes in `httpStatus`).
const hop = (id, status, detail = {}) => ({ ...detail, id, status });

// The stage a failed evaluation belongs to decides which hops it stops: assume-role/session stop provider-auth; invoke-permission/model-access stop the invoke.
const AUTH_STAGES = new Set(['assume-role', 'session', 'input']);

// ctx: { prompt, clock, aws: { trust, permission }, audit, gatewayPrincipal?, providerState? }. The prompt is validated by the caller (validate.js).
export function callThroughKey(key, ctx) {
  const { prompt, clock, aws, audit } = ctx;
  const gatewayPrincipal = ctx.gatewayPrincipal ?? GATEWAY_PRINCIPAL;
  if (ctx.providerState !== undefined) key.stub.setState(ctx.providerState);
  const startedAt = clock.now();
  const hops = [hop('key', 'done', { mode: key.mode, keyId: key.id, modelId: key.modelId, region: key.region })];
  const finish = (ok, code, extra = {}) => {
    const entry = audit.append({
      at: clock.now(), keyId: key.id, mode: key.mode, modelId: key.modelId, region: key.region,
      outcome: ok ? 'served' : 'refused', code, promptChars: prompt.length,
      ...(key.session ? { sessionExpiresAt: key.session.expiresAt } : {}),
    });
    const filled = HOP_IDS.map((id) => hops.find((h) => h.id === id) ?? hop(id, 'skipped', { why: 'the call stopped before this step' }));
    filled[filled.length - 1] = hop('audit', 'done', { entry });
    const ledger = key.llm.ledger;
    return {
      ok, code, hops: filled, audit: entry,
      servedBy: ok ? { provider: key.stub.id, model: key.modelId, region: key.region } : null,
      answer: extra.answer ?? null, tokensCharged: extra.tokensCharged ?? 0, evaluation: extra.evaluation ?? null,
      failedAt: ok ? null : (filled.find((h) => h.status === 'failed')?.id ?? null),
      usage: key.llm.usage.snapshot(), ledger: { limit: ledger.limit, spent: ledger.spent(), remaining: ledger.remaining() },
      session: key.mode === 'assumed-role' && key.session ? { ...key.session } : null,
      clock: { startedAt, endedAt: clock.now() },
    };
  };

  // 1. AI Guard (a stub). It runs on every key mode: assuming a role does not bypass it.
  const g = stubGuard(prompt);
  if (g.decision === 'block') {
    hops.push(hop('ai-guard', 'failed', { decision: 'block', rule: g.rule, stub: true }));
    return finish(false, 'guard_blocked');
  }
  hops.push(hop('ai-guard', 'done', { decision: 'allow', stub: true }));

  // Out of budget is decided before any provider call (the kit's zero-token spend always succeeds, so remaining() is checked here).
  const needed = estimateTokens(prompt);
  const ledger = key.llm.ledger;
  if (ledger.remaining() <= 0 || !ledger.canSpend(needed)) {
    hops.push(hop('metering', 'failed', { why: 'out_of_budget', remaining: ledger.remaining(), neededTokens: needed }));
    return finish(false, 'out_of_budget');
  }

  // 2. Provider authentication: the one hop that differs by mode.
  let evaluation = null;
  if (key.mode === 'assumed-role') {
    evaluation = evaluateWithRefresh({
      trust: aws.trust, permission: aws.permission, callerPrincipal: gatewayPrincipal, externalId: externalIdFor(key),
      modelId: key.modelId, region: key.region, now: clock.now(), session: key.session,
    });
    // The session is kept whenever the role was assumed, even if a later step refused; it is dropped when a refresh failed.
    if (evaluation.session && !evaluation.session.expired) key.session = { assumedAt: evaluation.session.assumedAt, expiresAt: evaluation.session.expiresAt };
    else if (evaluation.afterExpiry || evaluation.code === 'session_expired') key.session = null;
    const authFailed = !evaluation.ok && AUTH_STAGES.has(evaluation.stage);
    hops.push(hop('provider-auth', authFailed ? 'failed' : 'done', {
      method: 'assume-role', roleArn: key.roleArn, externalIdSent: hasExternalId(key), sessionAction: evaluation.sessionAction, session: key.session ? { ...key.session } : null,
      result: authFailed ? evaluation.code : 'assumed',
    }));
    if (authFailed) return finish(false, evaluation.code, { evaluation });
    if (!evaluation.ok) {
      hops.push(hop('bedrock-invoke', 'failed', { result: evaluation.code, stage: evaluation.stage }));
      return finish(false, evaluation.code, { evaluation });
    }
  } else {
    hops.push(hop('provider-auth', 'done', { method: 'stored-credential', present: hasStoredCredential(key), valueShown: false }));
  }

  // 3. The model call (mock Bedrock).
  const r = key.stub.call({ prompt });
  if (!r.ok) {
    hops.push(hop('bedrock-invoke', 'failed', { result: r.error, httpStatus: r.status, origin: r.origin, latencyMs: r.latencyMs }));
    return finish(false, r.error, { evaluation });
  }
  hops.push(hop('bedrock-invoke', 'done', { httpStatus: r.status, latencyMs: r.latencyMs, modelId: key.modelId, region: key.region }));

  // 4. Metering: the same ledger and Usage counter as a stored key.
  const tokens = r.usage.inputTokens + r.usage.outputTokens;
  if (!ledger.spend(tokens)) {
    hops.push(hop('metering', 'failed', { why: 'budget_exceeded_after_call' }));
    return finish(false, 'budget_exceeded_after_call', { evaluation });
  }
  key.llm.usage.record();
  hops.push(hop('metering', 'done', { tokens, usage: key.llm.usage.snapshot(), spent: ledger.spent(), remaining: ledger.remaining() }));
  return finish(true, evaluation?.code ?? 'success', { answer: r.text, tokensCharged: tokens, evaluation });
}

// The same call, shaped like a provider stub's answer, so the fallback lab can use an assumed-role key as a fallback target
// (this repo never imports that lab, and that lab never imports this one: it copies or calls over HTTP).
// origin says who refused, as the stub does: 'provider' (the mock Bedrock), 'key-budget', 'guard', 'assume-role' or 'invoke-access'.
const ORIGIN_BY_STAGE = { 'assume-role': 'assume-role', session: 'assume-role', input: 'assume-role', 'invoke-permission': 'invoke-access', 'model-access': 'invoke-access' };
export function serveAsFallbackTarget(key, ctx) {
  const r = callThroughKey(key, ctx);
  const invoke = r.hops.find((h) => h.id === 'bedrock-invoke');
  let origin = null;
  if (!r.ok) {
    if (r.code === 'guard_blocked') origin = 'guard';
    else if (r.code === 'out_of_budget' || r.code === 'budget_exceeded_after_call') origin = 'key-budget';
    else origin = r.evaluation && !r.evaluation.ok ? ORIGIN_BY_STAGE[r.evaluation.stage] ?? 'assume-role' : 'provider';
  }
  return {
    provider: key.stub.id, model: key.modelId, ok: r.ok, status: r.ok ? 200 : (origin === 'provider' ? invoke.httpStatus : null),
    error: r.ok ? null : r.code, origin, latencyMs: r.clock.endedAt - r.clock.startedAt,
    text: r.answer, usage: { inputTokens: r.ok ? r.tokensCharged - REPLY_TOKENS : 0, outputTokens: r.ok ? REPLY_TOKENS : 0 },
    hops: r.hops, audit: r.audit, result: r,
  };
}
