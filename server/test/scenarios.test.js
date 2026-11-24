import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, checkExpectation, credentialLikeKeys, runScenario, scenarioById } from '../src/scenarios.js';

const IDS = [
  'success', 'wrong-trust-principal', 'external-id-mismatch', 'external-id-missing', 'missing-invoke-permission', 'model-not-enabled-in-region',
  'expired-session-refreshed', 'guard-still-applies', 'stored-vs-assumed-key-shape', 'assumed-role-as-fallback-target',
  'vertex-with-role', 'vertex-without-role', 'vertex-role-insufficient',
];

test('the scenario table has the thirteen scenarios, unique ids, every one with an expected result written as data', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), IDS);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  for (const s of SCENARIOS) assert.ok(s.expect && s.title && s.summary && s.kind, s.id);
  assert.throws(() => { SCENARIOS.push({}); }, TypeError, 'the table is frozen');
});

// One test per scenario: the engine gives the hand-written expectation.
for (const s of SCENARIOS) {
  test(`scenario ${s.id}: ${s.title}`, () => {
    const r = runScenario(s.id);
    assert.deepEqual(r.mismatches, []);
    assert.equal(r.pass, true);
  });
}

test('scenario specifics a reader would check', () => {
  const success = runScenario('success').result.calls[0];
  assert.deepEqual(success.hops.map((h) => h.split(':')[0]), ['key', 'ai-guard', 'provider-auth', 'bedrock-invoke', 'metering', 'audit']);
  assert.ok(success.hops.every((h) => h.endsWith(':done')), 'metering, guard and audit all ran on the assumed-role call');
  const perm = runScenario('missing-invoke-permission').result.calls[0];
  assert.deepEqual([perm.hops[2], perm.hops[3]], ['provider-auth:done', 'bedrock-invoke:failed'], 'the role was assumed; the invoke was refused');
  const refreshed = runScenario('expired-session-refreshed').result.calls;
  assert.deepEqual(refreshed.map((c) => c.sessionAction), ['assumed', 'refreshed']);
  assert.ok(refreshed[1].sessionExpiresAt > refreshed[0].sessionExpiresAt);
  const shape = runScenario('stored-vs-assumed-key-shape').result;
  assert.equal(shape.storedHasCredentialField, true);
  assert.equal(shape.assumedHasCredentialField, false);
  assert.deepEqual(shape.assumedCredentialLikeKeys, []);
  assert.equal(shape.storedValueLeaked, false);
  assert.equal(runScenario('assumed-role-as-fallback-target').result.servedPosition, 1);
});

test('a scenario starts clean every time and does not leak state between runs', () => {
  const a = runScenario('expired-session-refreshed').result;
  const b = runScenario('expired-session-refreshed').result;
  assert.deepEqual(a, b);
  assert.equal(runScenario('success').result.calls[0].requests, 1);
  assert.equal(runScenario('success').result.calls[0].requests, 1);
});

test('the expectation checker catches a wrong expectation, a missing field and an uncovered field', () => {
  const s = scenarioById('wrong-trust-principal');
  const r = runScenario(s.id).result;
  const wrongCode = { ...s.expect, calls: [{ ...s.expect.calls[0], code: 'success' }] };
  assert.notDeepEqual(checkExpectation(r, wrongCode), []);
  assert.notDeepEqual(checkExpectation(r, { ...s.expect, auditCodes: [] }), []);
  assert.match(checkExpectation({ ...r, extra: 1 }, s.expect).join(), /does not cover/);
  assert.notDeepEqual(checkExpectation({}, s.expect), []);
  assert.equal(runScenario('nope'), null);
  assert.equal(scenarioById('__proto__'), null);
  assert.equal(scenarioById({}), null);
});

test('credentialLikeKeys finds credential-looking names at any depth, iteratively', () => {
  assert.deepEqual(credentialLikeKeys({ a: { b: [{ apiKey: 1 }], Credential: 2 }, ok: 3 }), ['.a.Credential', '.a.b.0.apiKey']);
  let deep = { secret: 1 };
  for (let i = 0; i < 50_000; i++) deep = { x: deep };
  assert.equal(credentialLikeKeys(deep).length, 1, 'a very deep object does not overflow the stack');
});
