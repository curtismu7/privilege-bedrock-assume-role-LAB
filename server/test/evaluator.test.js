import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULTS, evaluate, evaluateWithRefresh } from '../src/iamEvaluator.js';
import { MODEL_CATALOG, EXTERNAL_ID, GATEWAY_PRINCIPAL, LARGE_MODEL, OTHER_PRINCIPAL, SMALL_MODEL, permissionPolicy, trustPolicy } from '../src/data.js';

const base = () => ({
  trust: trustPolicy(), permission: permissionPolicy(), callerPrincipal: GATEWAY_PRINCIPAL, externalId: EXTERNAL_ID,
  modelId: LARGE_MODEL, region: 'us-east-1', now: 1000, session: null,
});
const withTrust = (statements) => ({ Version: '2012-10-17', Statement: statements });
const allow = (principal, extra = {}) => ({ Effect: 'Allow', Principal: principal, Action: 'sts:AssumeRole', ...extra });
const ext = (v) => ({ Condition: { StringEquals: { 'sts:ExternalId': v } } });
const withPerm = (statements) => ({ Version: '2012-10-17', Statement: statements });
const ARN = (m, r = 'us-east-1') => `arn:aws:bedrock:${r}::foundation-model/${m}`;

// [name, overrides to the base input, expected code, extra checks]
const TABLE = [
  ['success: trust names the gateway and the external ID matches', {}, 'success'],
  ['success: trust asks for no external ID and none is sent', { trust: withTrust([allow({ AWS: GATEWAY_PRINCIPAL })]), externalId: null }, 'success'],
  ['success: trust asks for no external ID and one is sent (it is ignored)', { trust: withTrust([allow({ AWS: GATEWAY_PRINCIPAL })]) }, 'success'],
  ['success: the caller is one of several principals', { trust: withTrust([allow({ AWS: [OTHER_PRINCIPAL, GATEWAY_PRINCIPAL] }, ext(EXTERNAL_ID))]) }, 'success'],
  ['wrong trust principal', { trust: trustPolicy({ principal: OTHER_PRINCIPAL }) }, 'trust_principal_mismatch'],
  ['wrong trust principal: same account, different role name', { trust: trustPolicy({ principal: 'arn:aws:iam::444455556666:role/example-other-role' }) }, 'trust_principal_mismatch'],
  ['wrong trust principal: trust action is not AssumeRole', { trust: withTrust([{ Effect: 'Allow', Principal: { AWS: GATEWAY_PRINCIPAL }, Action: 'sts:TagSession', ...ext(EXTERNAL_ID) }]) }, 'trust_principal_mismatch'],
  ['success: trust action sts:* covers AssumeRole', { trust: withTrust([{ Effect: 'Allow', Principal: { AWS: GATEWAY_PRINCIPAL }, Action: 'sts:*', ...ext(EXTERNAL_ID) }]) }, 'success'],
  ['wildcard principal "*" is allowed with the external ID, and warns', { trust: withTrust([allow('*', ext(EXTERNAL_ID))]) }, 'success', (r) => assert.equal(r.warnings[0].code, 'wildcard_principal')],
  ['wildcard {AWS:"*"} is allowed, and warns', { trust: withTrust([allow({ AWS: '*' }, ext(EXTERNAL_ID))]) }, 'success', (r) => assert.equal(r.warnings[0].code, 'wildcard_principal')],
  ['wildcard principal with the wrong external ID is still refused', { trust: withTrust([allow('*', ext(EXTERNAL_ID))]), externalId: 'something-else' }, 'external_id_mismatch'],
  ['wildcard principal with no external ID is refused as missing', { trust: withTrust([allow('*', ext(EXTERNAL_ID))]), externalId: null }, 'external_id_missing'],
  ['glob principal that matches the caller', { trust: withTrust([allow({ AWS: 'arn:aws:iam::444455556666:role/example-gateway-*' }, ext(EXTERNAL_ID))]) }, 'success', (r) => assert.equal(r.warnings.length, 1)],
  ['glob principal that does not match the caller', { trust: withTrust([allow({ AWS: 'arn:aws:iam::444455556666:role/other-*' }, ext(EXTERNAL_ID))]) }, 'trust_principal_mismatch'],
  ['glob principal in another account does not match', { trust: withTrust([allow({ AWS: 'arn:aws:iam::999900001111:role/*' }, ext(EXTERNAL_ID))]) }, 'trust_principal_mismatch'],
  ['account root of the caller\'s account trusts the whole account', { trust: withTrust([allow({ AWS: 'arn:aws:iam::444455556666:root' }, ext(EXTERNAL_ID))]) }, 'success'],
  ['bare account id of the caller\'s account', { trust: withTrust([allow({ AWS: '444455556666' }, ext(EXTERNAL_ID))]) }, 'success'],
  ['account root of another account', { trust: withTrust([allow({ AWS: 'arn:aws:iam::999900001111:root' }, ext(EXTERNAL_ID))]) }, 'trust_principal_mismatch'],
  ['external ID mismatch', { externalId: 'example-external-id-0002' }, 'external_id_mismatch'],
  ['external ID is case-sensitive', { externalId: EXTERNAL_ID.toUpperCase() }, 'external_id_mismatch'],
  ['external ID: a prefix of the right value is not the value', { externalId: EXTERNAL_ID.slice(0, -1) }, 'external_id_mismatch'],
  ['external ID missing (not sent)', { externalId: undefined }, 'external_id_missing'],
  ['external ID missing (null)', { externalId: null }, 'external_id_missing'],
  ['external ID missing (empty string counts as none)', { externalId: '' }, 'external_id_missing'],
  ['external ID: either of two accepted values works', { trust: withTrust([allow({ AWS: GATEWAY_PRINCIPAL }, ext(['example-external-id-0009', EXTERNAL_ID]))]) }, 'success'],
  ['trust explicit deny beats an allow', { trust: withTrust([allow({ AWS: GATEWAY_PRINCIPAL }, ext(EXTERNAL_ID)), { Effect: 'Deny', Principal: '*', Action: 'sts:AssumeRole' }]) }, 'trust_explicit_deny'],
  ['a deny for a different principal changes nothing', { trust: withTrust([allow({ AWS: GATEWAY_PRINCIPAL }, ext(EXTERNAL_ID)), { Effect: 'Deny', Principal: { AWS: OTHER_PRINCIPAL }, Action: 'sts:AssumeRole' }]) }, 'success'],
  ['missing invoke permission: the role may only list models', { permission: permissionPolicy({ action: 'bedrock:ListFoundationModels' }) }, 'permission_missing_invoke', (r) => assert.ok(r.session, 'the role was assumed first')],
  ['missing invoke permission: the Allow is for another model', { permission: permissionPolicy({ resource: ARN(SMALL_MODEL) }) }, 'permission_missing_invoke'],
  ['missing invoke permission: an Allow for an unrelated action', { permission: withPerm([{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }]) }, 'permission_missing_invoke'],
  ['permission explicit deny beats an allow', { permission: withPerm([{ Effect: 'Allow', Action: 'bedrock:*', Resource: '*' }, { Effect: 'Deny', Action: 'bedrock:InvokeModel', Resource: ARN(LARGE_MODEL) }]) }, 'permission_explicit_deny'],
  ['permission: bedrock:* and a * resource', { permission: withPerm([{ Effect: 'Allow', Action: 'bedrock:*', Resource: '*' }]) }, 'success'],
  ['permission: action names are case-insensitive', { permission: permissionPolicy({ action: 'BEDROCK:invokemodel' }) }, 'success'],
  ['permission: the exact model ARN', { permission: permissionPolicy({ resource: ARN(LARGE_MODEL) }) }, 'success'],
  ['permission: resource names are case-sensitive', { permission: permissionPolicy({ resource: ARN(LARGE_MODEL).toUpperCase() }) }, 'permission_missing_invoke'],
  ['model not enabled in the region', { region: 'ap-southeast-2' }, 'model_not_enabled_in_region', (r) => assert.ok(r.session)],
  ['model not enabled: a model the catalog does not know', { modelId: 'example.chat-unknown-v1:0' }, 'model_not_enabled_in_region'],
  ['model not enabled: an Object.prototype name is not a catalog entry', { modelId: 'constructor', permission: withPerm([{ Effect: 'Allow', Action: 'bedrock:InvokeModel', Resource: '*' }]) }, 'model_not_enabled_in_region'],
  ['the small model is enabled in ap-southeast-2', { modelId: SMALL_MODEL, region: 'ap-southeast-2' }, 'success'],
  ['a valid session is reused and the trust policy is not consulted again', { session: { assumedAt: 0, expiresAt: 5000 }, trust: trustPolicy({ principal: OTHER_PRINCIPAL }) }, 'success', (r) => assert.equal(r.sessionAction, 'reused')],
  ['session valid one millisecond before expiry', { now: 4999, session: { assumedAt: 0, expiresAt: 5000 } }, 'success'],
  ['session expired exactly at its expiry', { now: 5000, session: { assumedAt: 0, expiresAt: 5000 } }, 'session_expired'],
  ['session expired long ago', { now: 99_999, session: { assumedAt: 0, expiresAt: 5000 } }, 'session_expired'],
  ['a new session lasts the default 3600000 ms from now', {}, 'success', (r) => assert.deepEqual(r.session, { assumedAt: 1000, expiresAt: 3_601_000 })],
  ['a custom session length is used', { sessionMs: 900_000 }, 'success', (r) => assert.equal(r.session.expiresAt, 901_000)],
  ['trust policy that is not JSON', { trust: '{nope' }, 'trust_policy_invalid', (r) => assert.equal(r.policyError.code, 'policy_not_json')],
  ['trust policy missing', { trust: undefined }, 'trust_policy_invalid', (r) => assert.equal(r.policyError.code, 'policy_missing')],
  ['trust policy over the size limit', { trust: 'x'.repeat(10_001) }, 'trust_policy_invalid', (r) => assert.equal(r.policyError.code, 'policy_too_large')],
  ['trust policy as JSON text works like an object', { trust: JSON.stringify(trustPolicy()) }, 'success'],
  ['permission policy missing is refused after the role is assumed', { permission: undefined }, 'permission_policy_invalid', (r) => assert.ok(r.session)],
  ['permission policy with an unsupported Condition is refused, never ignored', { permission: withPerm([{ Effect: 'Allow', Action: 'bedrock:InvokeModel', Resource: '*', Condition: { StringEquals: { 'aws:RequestedRegion': 'us-east-1' } } }]) }, 'permission_policy_invalid', (r) => assert.equal(r.policyError.code, 'policy_unsupported')],
  ['bad input: caller principal', { callerPrincipal: 'not-an-arn' }, 'bad_input', (r) => assert.equal(r.field, 'callerPrincipal')],
  ['bad input: region', { region: 'mars-1' }, 'bad_input', (r) => assert.equal(r.field, 'region')],
  ['bad input: model id', { modelId: '../x' }, 'bad_input', (r) => assert.equal(r.field, 'modelId')],
  ['bad input: now is negative', { now: -1 }, 'bad_input', (r) => assert.equal(r.field, 'now')],
  ['bad input: now is NaN', { now: Number.NaN }, 'bad_input', (r) => assert.equal(r.field, 'now')],
  ['bad input: external ID is not a string', { externalId: 5 }, 'bad_input', (r) => assert.equal(r.field, 'externalId')],
  ['bad input: session expires before it starts', { session: { assumedAt: 10, expiresAt: 5 } }, 'bad_input', (r) => assert.equal(r.field, 'session')],
  ['bad input: session starts in the future of the lab clock', { now: 5, session: { assumedAt: 10, expiresAt: 50 } }, 'bad_input', (r) => assert.equal(r.field, 'session')],
  ['bad input: session length out of range', { sessionMs: 1 }, 'bad_input', (r) => assert.equal(r.field, 'sessionMs')],
];

test('the evaluator table has at least 25 cases', () => { assert.ok(TABLE.length >= 25, String(TABLE.length)); });

for (const [name, over, code, extra] of TABLE) {
  test(`evaluate: ${name}`, () => {
    const r = evaluate({ ...base(), ...over });
    assert.equal(r.code, code, JSON.stringify(r.steps));
    assert.equal(r.ok, RESULTS[code].ok);
    assert.equal(r.stage, RESULTS[code].stage);
    if (!r.ok) assert.ok(r.title && r.message && r.fix, 'every refusal carries a title, a message and a fix');
    assert.equal(r.labText, true, 'the texts are labelled as the lab\'s own wording');
    extra?.(r);
  });
}

test('every result code has an entry, and the table covers each outcome the spec names', () => {
  for (const c of ['success', 'trust_principal_mismatch', 'external_id_mismatch', 'external_id_missing', 'permission_missing_invoke', 'model_not_enabled_in_region', 'session_expired', 'session_refreshed']) assert.ok(RESULTS[c], c);
  const seen = new Set(TABLE.map((t) => t[2]));
  for (const c of ['success', 'trust_principal_mismatch', 'external_id_mismatch', 'external_id_missing', 'permission_missing_invoke', 'model_not_enabled_in_region', 'session_expired', 'trust_policy_invalid', 'bad_input']) assert.ok(seen.has(c), c);
});

test('a refusal never carries the external ID or the policy text', () => {
  const secretish = 'example-external-id-ZZ-7731';
  const r = evaluate({ ...base(), externalId: secretish });
  assert.equal(r.code, 'external_id_mismatch');
  assert.doesNotMatch(JSON.stringify(r), /ZZ-7731/);
  const bad = evaluate({ ...base(), trust: 'zz-policy-marker-4411' });
  assert.doesNotMatch(JSON.stringify(bad), /zz-policy-marker/);
});

test('purity: the same input gives the same result, and the input is not changed (a deeply frozen input works)', () => {
  const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
  const input = freeze(base());
  const snapshot = JSON.stringify(input);
  const a = evaluate(input);
  const b = evaluate(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(a.session, b.session, 'a fresh session object each time');
  assert.deepEqual(Object.keys(MODEL_CATALOG), [LARGE_MODEL, SMALL_MODEL]);
});

test('the evaluator is total: hostile or odd inputs give a named refusal, never an exception and never a pass', () => {
  const throwing = { get callerPrincipal() { throw new Error('boom'); } };
  const cyclic = { Version: '2012-10-17' }; cyclic.Statement = cyclic;
  const throwingPolicy = { Version: '2012-10-17', get Statement() { throw new Error('boom'); } };
  const odd = [undefined, null, 0, 1, 'x', [], {}, () => 1, throwing, Symbol('s')];
  for (const o of odd) { const r = evaluate(o); assert.equal(r.ok, false); assert.equal(r.code, 'bad_input'); }
  for (const trust of [cyclic, throwingPolicy, new Map(), Object.create({ Version: '2012-10-17' }), 5, true, [], [[]]]) {
    const r = evaluate({ ...base(), trust });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'trust_policy_invalid');
  }
  for (const catalog of [null, [], 'x']) assert.equal(evaluate({ ...base(), catalog }).code, 'bad_input');
  assert.equal(evaluate({ ...base(), catalog: { [LARGE_MODEL]: 'us-east-1' } }).code, 'model_not_enabled_in_region');
});

test('refresh: an expired session is refreshed by assuming the role again at now', () => {
  const input = { ...base(), now: 5000, session: { assumedAt: 0, expiresAt: 5000 } };
  assert.equal(evaluate(input).code, 'session_expired');
  const r = evaluateWithRefresh(input);
  assert.equal(r.code, 'session_refreshed');
  assert.equal(r.ok, true);
  assert.equal(r.sessionAction, 'refreshed');
  assert.deepEqual(r.session, { assumedAt: 5000, expiresAt: 5000 + 3_600_000 });
  assert.deepEqual(r.refreshedFrom, { expiredAt: 5000 });
  assert.equal(r.steps[0].id, 'session');
  assert.equal(r.steps[0].ok, false);
  assert.equal(evaluateWithRefresh({ ...input, now: 4999 }).code, 'success', 'a valid session needs no refresh');
});

test('refresh can fail: trust is evaluated afresh, so a changed trust policy refuses the refresh', () => {
  const input = { ...base(), now: 5000, session: { assumedAt: 0, expiresAt: 5000 }, trust: trustPolicy({ principal: OTHER_PRINCIPAL }) };
  const r = evaluateWithRefresh(input);
  assert.equal(r.code, 'trust_principal_mismatch');
  assert.equal(r.afterExpiry, true);
  assert.equal(r.ok, false);
  assert.equal(evaluateWithRefresh({ ...input, trust: trustPolicy(), externalId: 'nope' }).code, 'external_id_mismatch');
  assert.equal(evaluateWithRefresh({ ...input, trust: trustPolicy(), permission: permissionPolicy({ action: 'bedrock:ListFoundationModels' }) }).code, 'permission_missing_invoke');
});
