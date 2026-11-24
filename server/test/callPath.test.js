import test from 'node:test';
import assert from 'node:assert/strict';
import { createLab, DEFAULT_KEY_SPEC } from '../src/lab.js';
import { HOP_IDS, createAuditLog, estimateTokens, serveAsFallbackTarget, stubGuard } from '../src/callPath.js';
import { DEFAULT_AWS, DEFAULT_PROMPT, EXTERNAL_ID, GUARD_BLOCK_MARKER, OTHER_PRINCIPAL, permissionPolicy, trustPolicy } from '../src/data.js';

const STORED = { mode: 'stored-credential', credential: 'MOCK-callpath-credential-0001', budgetTokens: 2000 };
const statuses = (r) => r.hops.map((h) => `${h.id}:${h.status}`);
const DONE = HOP_IDS.map((id) => `${id}:done`);

test('assumed-role call: metering, AI Guard and audit all still happen on the same call', () => {
  const lab = createLab();
  const r = lab.call(DEFAULT_PROMPT);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'success');
  assert.deepEqual(r.hops.map((h) => h.id), HOP_IDS);
  assert.deepEqual(statuses(r), DONE);
  // metering: usage recorded, ledger charged
  assert.deepEqual(r.usage, { requests: 1, fromCache: 0, savedTokens: 0 });
  assert.equal(r.ledger.spent, estimateTokens(DEFAULT_PROMPT));
  assert.equal(r.ledger.spent, 128);
  assert.equal(r.hops.find((h) => h.id === 'metering').tokens, 128);
  // AI Guard: the stub ran and allowed
  assert.deepEqual(r.hops.find((h) => h.id === 'ai-guard').decision, 'allow');
  assert.equal(r.hops.find((h) => h.id === 'ai-guard').stub, true);
  // audit: an entry exists in the log and in the result
  assert.equal(lab.audit().size(), 1);
  assert.deepEqual(lab.audit().list()[0], r.audit);
  assert.equal(r.audit.outcome, 'served');
  assert.equal(r.audit.mode, 'assumed-role');
  assert.equal(r.audit.sessionExpiresAt, 3_600_000);
  assert.equal(r.servedBy.provider, 'bedrock-assumed-role');
  assert.match(r.answer, /answer to: Summarise/);
  assert.deepEqual(r.session, { assumedAt: 0, expiresAt: 3_600_000 });
});

test('a stored-credential call runs the same six hops; only provider-auth differs', () => {
  const a = createLab().call(DEFAULT_PROMPT);
  const s = createLab({ key: STORED }).call(DEFAULT_PROMPT);
  assert.deepEqual(statuses(s), statuses(a));
  assert.equal(s.hops.find((h) => h.id === 'provider-auth').method, 'stored-credential');
  assert.equal(a.hops.find((h) => h.id === 'provider-auth').method, 'assume-role');
  assert.equal(s.ledger.spent, a.ledger.spent);
  assert.equal(s.session, null);
  assert.equal(s.evaluation, null);
  assert.equal(s.servedBy.provider, 'bedrock-stored-credential');
});

test('AI Guard still applies on an assumed-role key: a blocked prompt never assumes the role, is not metered, and is audited', () => {
  for (const spec of [DEFAULT_KEY_SPEC(), STORED]) {
    const lab = createLab({ key: spec });
    const r = lab.call(`do it ${GUARD_BLOCK_MARKER}`);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'guard_blocked');
    assert.equal(r.failedAt, 'ai-guard');
    assert.deepEqual(statuses(r), ['key:done', 'ai-guard:failed', 'provider-auth:skipped', 'bedrock-invoke:skipped', 'metering:skipped', 'audit:done']);
    assert.equal(r.usage.requests, 0);
    assert.equal(r.ledger.spent, 0);
    assert.equal(r.session, null);
    assert.equal(lab.audit().list()[0].outcome, 'refused');
  }
  assert.deepEqual(stubGuard('hello'), { decision: 'allow', rule: null });
});

test('every refusal is audited, names where the call stopped, and charges nothing', () => {
  const cases = [
    ['trust_principal_mismatch', { trust: trustPolicy({ principal: OTHER_PRINCIPAL }) }, 'provider-auth'],
    ['permission_missing_invoke', { permission: permissionPolicy({ action: 'bedrock:ListFoundationModels' }) }, 'bedrock-invoke'],
  ];
  for (const [code, aws, failedAt] of cases) {
    const lab = createLab({ aws: { ...DEFAULT_AWS(), ...aws } });
    const r = lab.call(DEFAULT_PROMPT);
    assert.equal(r.code, code);
    assert.equal(r.failedAt, failedAt);
    assert.equal(r.ledger.spent, 0);
    assert.equal(r.usage.requests, 0);
    assert.equal(lab.audit().size(), 1);
    assert.equal(r.audit.code, code);
    assert.equal(r.hops.find((h) => h.id === 'metering').status, 'skipped');
  }
});

test('out of budget stops before any role is assumed or provider is called', () => {
  const lab = createLab({ key: { ...DEFAULT_KEY_SPEC(), budgetTokens: 100 } });
  const r = lab.call(DEFAULT_PROMPT);
  assert.equal(r.code, 'out_of_budget');
  assert.equal(r.failedAt, 'metering');
  assert.equal(r.hops.find((h) => h.id === 'provider-auth').status, 'skipped');
  assert.equal(lab.clock().now(), 0, 'no provider latency was spent');
  assert.equal(r.session, null);
  assert.equal(createLab({ key: { ...DEFAULT_KEY_SPEC(), budgetTokens: 0 } }).call('hi').code, 'out_of_budget', 'a zero budget is out of budget');
  const exact = createLab({ key: { ...DEFAULT_KEY_SPEC(), budgetTokens: 128 } });
  assert.equal(exact.call(DEFAULT_PROMPT).ok, true, 'a budget equal to the cost is enough');
  assert.equal(exact.call(DEFAULT_PROMPT).code, 'out_of_budget', 'and then it is spent');
});

test('a provider failure on an assumed-role key: the role was assumed, the invoke failed, nothing is metered', () => {
  const lab = createLab();
  const r = lab.call(DEFAULT_PROMPT, { providerState: 'down' });
  assert.equal(r.code, 'provider_unavailable');
  assert.deepEqual(statuses(r), ['key:done', 'ai-guard:done', 'provider-auth:done', 'bedrock-invoke:failed', 'metering:skipped', 'audit:done']);
  assert.equal(r.hops.find((h) => h.id === 'bedrock-invoke').httpStatus, 503);
  assert.equal(r.ledger.spent, 0);
  assert.deepEqual(r.session, { assumedAt: 0, expiresAt: 3_600_000 }, 'the session is kept');
  assert.equal(lab.call(DEFAULT_PROMPT, { providerState: 'healthy' }).hops.find((h) => h.id === 'provider-auth').sessionAction, 'reused');
});

test('a session is reused until it expires, and the trust policy is not consulted while it is valid', () => {
  const lab = createLab();
  assert.equal(lab.call(DEFAULT_PROMPT).hops[2].sessionAction, 'assumed');
  lab.setAws({ ...DEFAULT_AWS(), trust: trustPolicy({ principal: OTHER_PRINCIPAL }) });
  const second = lab.call(DEFAULT_PROMPT);
  assert.equal(second.ok, true, 'the earlier session is still valid');
  assert.equal(second.hops[2].sessionAction, 'reused');
  lab.advance(3_600_000); // past the expiry
  const third = lab.call(DEFAULT_PROMPT);
  assert.equal(third.ok, false);
  assert.equal(third.code, 'trust_principal_mismatch', 'the refresh evaluated the changed trust policy');
  assert.equal(third.session, null, 'the expired session was dropped');
  lab.setAws(DEFAULT_AWS());
  assert.equal(lab.call(DEFAULT_PROMPT).hops[2].sessionAction, 'assumed', 'a fresh role assumption after the policy was fixed');
});

test('setting a new key starts with no session and an empty ledger; the clock and audit log are kept', () => {
  const lab = createLab();
  lab.call(DEFAULT_PROMPT);
  lab.setKey(DEFAULT_KEY_SPEC());
  assert.equal(lab.view().key.session, null);
  assert.equal(lab.view().key.budget.spent, 0);
  assert.equal(lab.clock().now(), 400);
  assert.equal(lab.audit().size(), 1);
});

test('audit entries hold ids and outcomes, never a prompt, an external ID or a credential, and the log is bounded', () => {
  const lab = createLab({ key: { ...DEFAULT_KEY_SPEC(), externalId: EXTERNAL_ID } });
  lab.call('a prompt with zz-prompt-marker-5521 inside');
  const text = JSON.stringify(lab.audit().list());
  assert.doesNotMatch(text, /zz-prompt-marker|example-external-id/);
  const entry = lab.audit().list()[0];
  assert.deepEqual(Object.keys(entry).sort(), ['at', 'code', 'keyId', 'mode', 'modelId', 'outcome', 'promptChars', 'region', 'seq', 'sessionExpiresAt']);
  const log = createAuditLog(3);
  for (let i = 0; i < 10; i++) log.append({ i });
  assert.deepEqual(log.list().map((e) => e.i), [7, 8, 9]);
  assert.deepEqual(log.list().map((e) => e.seq), [8, 9, 10]);
  assert.equal(Object.isFrozen(log.append({ x: 1 })), true, 'an entry cannot be edited once written');
});

test('fallback target: serveAsFallbackTarget answers in a provider-shaped result and names who refused', () => {
  const first = createLab();
  const ok = serveAsFallbackTarget(first.key(), { prompt: DEFAULT_PROMPT, clock: first.clock(), aws: first.aws(), audit: first.audit() });
  assert.deepEqual([ok.ok, ok.status, ok.error, ok.origin, ok.latencyMs], [true, 200, null, null, 400]);
  assert.deepEqual(ok.usage, { inputTokens: 8, outputTokens: 120 });
  assert.equal(ok.provider, 'bedrock-assumed-role');
  assert.ok(ok.hops.every((h) => h.status === 'done'));

  const run = (lab, over = {}) => serveAsFallbackTarget(lab.key(), { prompt: DEFAULT_PROMPT, clock: lab.clock(), aws: lab.aws(), audit: lab.audit(), ...over });
  const trust = run(createLab({ aws: { ...DEFAULT_AWS(), trust: trustPolicy({ principal: OTHER_PRINCIPAL }) } }));
  assert.deepEqual([trust.ok, trust.status, trust.error, trust.origin], [false, null, 'trust_principal_mismatch', 'assume-role']);
  const perm = run(createLab({ aws: { ...DEFAULT_AWS(), permission: permissionPolicy({ action: 'bedrock:ListFoundationModels' }) } }));
  assert.deepEqual([perm.error, perm.origin], ['permission_missing_invoke', 'invoke-access']);
  const region = run(createLab({ key: { ...DEFAULT_KEY_SPEC(), region: 'ap-southeast-2' } }));
  assert.deepEqual([region.error, region.origin], ['model_not_enabled_in_region', 'invoke-access']);
  const guard = run(createLab(), { prompt: GUARD_BLOCK_MARKER });
  assert.deepEqual([guard.error, guard.origin], ['guard_blocked', 'guard']);
  const budget = run(createLab({ key: { ...DEFAULT_KEY_SPEC(), budgetTokens: 1 } }));
  assert.deepEqual([budget.error, budget.origin], ['out_of_budget', 'key-budget']);
  const down = run(createLab(), { providerState: 'overloaded' });
  assert.deepEqual([down.error, down.origin, down.status], ['provider_overloaded', 'provider', 429]);
});

test('the call is deterministic: the same lab steps give the same trace', () => {
  const steps = () => { const lab = createLab(); const a = lab.call(DEFAULT_PROMPT); lab.advance(3_599_600); const b = lab.call(DEFAULT_PROMPT); return [a, b, lab.audit().list()]; };
  assert.deepEqual(steps(), steps());
});
