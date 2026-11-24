import test from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helpers.js';
import { SCENARIOS } from '../src/scenarios.js';
import { DEFAULT_AWS, EXTERNAL_ID, GATEWAY_PRINCIPAL, LARGE_MODEL, OTHER_PRINCIPAL, VERTEX_SERVICE_ACCOUNT, permissionPolicy, trustPolicy } from '../src/data.js';

const CRED = 'MOCK-api-credential-4417';
const err = (r, status, code) => { assert.equal(r.status, status, r.text.slice(0, 200)); assert.equal(r.json.error, code); assert.ok(r.json.message); };

test('GET /api/health is demo-health/1', async () => {
  const lab = await startLab();
  try {
    const r = await lab.get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.schema, 'demo-health/1');
    assert.equal(r.json.state, 'ready');
    assert.equal(r.json.runtime, 'offline');
    assert.equal((await lab.send('POST', '/api/health', {})).status, 405);
  } finally { await lab.close(); }
});

test('GET /api/info: Mock, Real not available with a plain reason, banner and UNVERIFIED list present', async () => {
  const lab = await startLab();
  try {
    const { json } = await lab.get('/api/info');
    assert.equal(json.source, 'mock');
    assert.equal(json.realAvailable, false);
    assert.match(json.realReason, /not built yet/);
    assert.match(json.realReason, /owner-run and read-only/);
    assert.match(json.banner, /SIMULATED/);
    assert.match(json.banner, /UNVERIFIED/);
    assert.match(json.banner, /2026-11-21/);
    assert.ok(json.unverified.length >= 8);
    assert.deepEqual(json.keyModes, ['stored-credential', 'assumed-role']);
    assert.equal(json.tier, 'Demo');
  } finally { await lab.close(); }
});

test('POST /api/mode: mock ok, real refused 409 with a plain message, anything else 400', async () => {
  const lab = await startLab();
  try {
    assert.deepEqual((await lab.send('POST', '/api/mode', { source: 'mock' })).json, { source: 'mock' });
    const real = await lab.send('POST', '/api/mode', { source: 'real' });
    assert.equal(real.status, 409);
    assert.equal(real.json.error, 'real_unavailable');
    assert.match(real.json.message, /not built yet/);
    assert.equal(real.json.source, 'mock');
    err(await lab.send('POST', '/api/mode', { source: 'live' }), 400, 'bad_source');
    err(await lab.send('POST', '/api/mode', { source: 'mock', extra: 1 }), 400, 'unknown_field');
    err(await lab.send('POST', '/api/mode', {}), 400, 'bad_source');
    assert.equal((await lab.get('/api/mode')).json.source, 'mock');
  } finally { await lab.close(); }
});

test('GET /api/state: the default key is assumed-role with no credential field anywhere', async () => {
  const lab = await startLab();
  try {
    const s = (await lab.get('/api/state')).json;
    assert.equal(s.key.mode, 'assumed-role');
    assert.equal(Object.hasOwn(s.key, 'credential'), false);
    assert.doesNotMatch(lab.base + JSON.stringify(s), /credential|secret|apiKey|accessKey|sessionToken/i);
    assert.equal(s.key.externalIdSet, true);
    assert.doesNotMatch(JSON.stringify(s.key), new RegExp(EXTERNAL_ID));
    assert.deepEqual(s.aws, DEFAULT_AWS());
    assert.equal(s.clockMs, 0);
  } finally { await lab.close(); }
});

test('POST /api/call: a served call shows the six hops; metering, guard and audit are in the response and in state', async () => {
  const lab = await startLab();
  try {
    const r = await lab.send('POST', '/api/call', { prompt: 'one two three' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.hops.map((h) => `${h.id}:${h.status}`), ['key:done', 'ai-guard:done', 'provider-auth:done', 'bedrock-invoke:done', 'metering:done', 'audit:done']);
    assert.equal(r.json.usage.requests, 1);
    assert.equal(r.json.ledger.spent, 123);
    assert.equal(r.json.state.key.usage.requests, 1);
    assert.equal(r.json.state.audit.length, 1);
    assert.equal(r.json.clock.endedAt, 400);
    assert.equal((await lab.get('/api/state')).json.auditSize, 1);
  } finally { await lab.close(); }
});

test('POST /api/call: swapping the key and the AWS side; every refusal is a named 200 result', async () => {
  const lab = await startLab();
  try {
    const wrongTrust = await lab.send('POST', '/api/call', { prompt: 'hello', aws: { trust: trustPolicy({ principal: OTHER_PRINCIPAL }) } });
    assert.equal(wrongTrust.status, 200);
    assert.deepEqual([wrongTrust.json.ok, wrongTrust.json.code, wrongTrust.json.failedAt], [false, 'trust_principal_mismatch', 'provider-auth']);
    assert.equal(wrongTrust.json.evaluation.fix.length > 0, true);
    // the policy change stuck: the next call fails the same way until it is fixed
    assert.equal((await lab.send('POST', '/api/call', { prompt: 'hello' })).json.code, 'trust_principal_mismatch');
    assert.equal((await lab.send('POST', '/api/call', { prompt: 'hello', aws: { trust: trustPolicy() } })).json.code, 'success');
    // advance the clock past the session, then the refresh evaluates trust again
    const refreshed = await lab.send('POST', '/api/call', { prompt: 'hello', advanceMs: 3_600_000 });
    assert.equal(refreshed.json.code, 'session_refreshed');
    assert.equal(refreshed.json.state.clockMs, 3_600_800);
    const stored = await lab.send('POST', '/api/call', { prompt: 'hello', key: { mode: 'stored-credential', credential: CRED } });
    assert.equal(stored.json.ok, true);
    assert.equal(stored.json.hops[2].method, 'stored-credential');
    assert.deepEqual(stored.json.state.key.credential, { stored: true, masked: '********' });
    const text = stored.text + (await lab.get('/api/state')).text;
    assert.doesNotMatch(text, /MOCK-api-credential/, 'the credential is write-only: never returned');
    // a model not enabled in the region
    const region = await lab.send('POST', '/api/call', { prompt: 'hello', key: { mode: 'assumed-role', modelId: LARGE_MODEL, region: 'ap-southeast-2', externalId: EXTERNAL_ID } });
    assert.equal(region.json.code, 'model_not_enabled_in_region');
    assert.equal(region.json.failedAt, 'bedrock-invoke');
    const guard = await lab.send('POST', '/api/call', { prompt: 'x [[guard-block]]' });
    assert.equal(guard.json.code, 'guard_blocked');
    const down = await lab.send('POST', '/api/call', { prompt: 'hello', providerState: 'timeout', key: { mode: 'assumed-role', externalId: EXTERNAL_ID } });
    assert.equal(down.json.code, 'provider_timeout');
  } finally { await lab.close(); }
});

test('POST /api/call: a refused key config changes nothing (validated before it is applied)', async () => {
  const lab = await startLab();
  try {
    await lab.send('POST', '/api/call', { prompt: 'hello' });
    const before = (await lab.get('/api/state')).json;
    err(await lab.send('POST', '/api/call', { prompt: 'hello', key: { mode: 'assumed-role', credential: CRED }, advanceMs: 5000 }), 400, 'credential_not_allowed');
    err(await lab.send('POST', '/api/call', { prompt: 'hello', key: { mode: 'stored-credential', credential: ['AKIA', 'EXAMPLEEXAMPLE00'].join('') } }), 400, 'credential_not_mock');
    err(await lab.send('POST', '/api/call', { prompt: 'hello', aws: { unknown: 1 }, advanceMs: 5000 }), 400, 'unknown_field');
    assert.deepEqual((await lab.get('/api/state')).json, before);
  } finally { await lab.close(); }
});

test('POST /api/evaluate: bedrock, with defaults, each named outcome, a bad policy as a named 200, and a bad field as a 400', async () => {
  const lab = await startLab();
  try {
    const ev = (b) => lab.send('POST', '/api/evaluate', b);
    const ok = await ev({ trust: trustPolicy(), permission: permissionPolicy(), externalId: EXTERNAL_ID });
    assert.deepEqual([ok.status, ok.json.ok, ok.json.code], [200, true, 'success']);
    assert.equal((await ev({ trust: trustPolicy(), permission: permissionPolicy() })).json.code, 'external_id_missing');
    assert.equal((await ev({ trust: trustPolicy(), permission: permissionPolicy(), externalId: 'other-0002' })).json.code, 'external_id_mismatch');
    assert.equal((await ev({ trust: trustPolicy({ principal: OTHER_PRINCIPAL }), permission: permissionPolicy(), externalId: EXTERNAL_ID })).json.code, 'trust_principal_mismatch');
    assert.equal((await ev({ trust: trustPolicy(), permission: permissionPolicy({ action: 'bedrock:ListFoundationModels' }), externalId: EXTERNAL_ID })).json.code, 'permission_missing_invoke');
    assert.equal((await ev({ trust: trustPolicy(), permission: permissionPolicy(), externalId: EXTERNAL_ID, region: 'ap-southeast-2' })).json.code, 'model_not_enabled_in_region');
    assert.equal((await ev({ trust: trustPolicy(), permission: permissionPolicy(), externalId: EXTERNAL_ID, now: 5000, session: { assumedAt: 0, expiresAt: 5000 } })).json.code, 'session_expired');
    const refreshed = await ev({ trust: trustPolicy(), permission: permissionPolicy(), externalId: EXTERNAL_ID, now: 5000, session: { assumedAt: 0, expiresAt: 5000 }, refresh: true });
    assert.deepEqual([refreshed.json.code, refreshed.json.session.expiresAt], ['session_refreshed', 3_605_000]);
    // policies as JSON text
    assert.equal((await ev({ trust: JSON.stringify(trustPolicy()), permission: JSON.stringify(permissionPolicy()), externalId: EXTERNAL_ID })).json.code, 'success');
    // malformed, oversized, hostile, missing: named 200 results, never a pass
    for (const [trust, code] of [['{oops', 'policy_not_json'], ['x'.repeat(50_000), 'policy_too_large'], ['{"__proto__":{}}', 'policy_forbidden_key'], [undefined, 'policy_missing'], [5, 'policy_not_object'], [JSON.parse(`${'['.repeat(40)}${']'.repeat(40)}`), 'policy_too_deep']]) {
      const r = await ev({ trust, permission: permissionPolicy(), externalId: EXTERNAL_ID });
      assert.equal(r.status, 200);
      assert.deepEqual([r.json.ok, r.json.code, r.json.policyError.code], [false, 'trust_policy_invalid', code]);
    }
    const noPerm = await ev({ trust: trustPolicy(), externalId: EXTERNAL_ID });
    assert.equal(noPerm.json.code, 'permission_policy_invalid');
    // wildcard principal
    const wild = await ev({ trust: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 'sts:AssumeRole' }] }, permission: permissionPolicy() });
    assert.deepEqual([wild.json.code, wild.json.warnings[0].code], ['success', 'wildcard_principal']);
    // bad fields are a 400 and the message names the field, not the value
    err(await ev({ trust: trustPolicy(), permission: permissionPolicy(), callerPrincipal: 'zz-marker-8812' }), 400, 'bad_input');
    err(await ev({ trust: trustPolicy(), permission: permissionPolicy(), region: 'zz-marker-8812' }), 400, 'bad_input');
    err(await ev({ trust: trustPolicy(), permission: permissionPolicy(), now: -5 }), 400, 'bad_input');
    err(await ev({ trust: trustPolicy(), permission: permissionPolicy(), refresh: 'yes' }), 400, 'bad_refresh');
    err(await ev({ trust: trustPolicy(), permission: permissionPolicy(), catalog: {} }), 400, 'unknown_field');
    err(await ev({ target: 'azure' }), 400, 'bad_target');
    err(await ev({ target: 'vertex', trust: {} }), 400, 'unknown_field');
    assert.equal((await lab.get('/api/state')).json.key.usage.requests, 0, 'evaluate never touches the live lab');
    assert.doesNotMatch((await ev({ trust: trustPolicy(), permission: permissionPolicy(), region: 'zz-marker-8812' })).text, /zz-marker/);
  } finally { await lab.close(); }
});

test('POST /api/evaluate: the Vertex tab, with and without the role', async () => {
  const lab = await startLab();
  try {
    const ev = (b) => lab.send('POST', '/api/evaluate', { target: 'vertex', ...b });
    const withRole = await ev({ policy: { bindings: [{ role: 'roles/aiplatform.user', members: [`serviceAccount:${VERTEX_SERVICE_ACCOUNT}`] }] } });
    assert.deepEqual([withRole.json.ok, withRole.json.code], [true, 'success']);
    const without = await ev({ policy: { bindings: [{ role: 'roles/aiplatform.user', members: ['serviceAccount:someone-else@example-project-0001.iam.example'] }] } });
    assert.deepEqual([without.json.ok, without.json.code], [false, 'vertex_role_missing']);
    assert.equal((await ev({ policy: '{bad' })).json.code, 'vertex_policy_invalid');
    err(await ev({ policy: { bindings: [] }, serviceAccount: 'real.person@gmail.com' }), 400, 'bad_input');
  } finally { await lab.close(); }
});

test('GET /api/scenarios lists them; POST /api/scenario/:id runs each and matches its expectation (not touching live state)', async () => {
  const lab = await startLab();
  try {
    const list = (await lab.get('/api/scenarios')).json.scenarios;
    assert.deepEqual(list.map((s) => s.id), SCENARIOS.map((s) => s.id));
    for (const s of list) assert.ok(s.expect && s.title && s.summary && s.kind);
    for (const s of list) {
      const r = await lab.send('POST', `/api/scenario/${s.id}`, {});
      assert.equal(r.status, 200, s.id);
      assert.equal(r.json.pass, true, `${s.id}: ${r.json.mismatches}`);
    }
    const state = (await lab.get('/api/state')).json;
    assert.deepEqual([state.key.usage.requests, state.auditSize, state.clockMs], [0, 0, 0]);
    err(await lab.send('POST', '/api/scenario/nope', {}), 404, 'unknown_scenario');
    err(await lab.send('POST', '/api/scenario/__proto__', {}), 404, 'unknown_scenario');
    assert.doesNotMatch(JSON.stringify(list), /MOCK-/, 'no stored credential value in the scenario list');
  } finally { await lab.close(); }
});

test('POST /api/reset restores the default key and policies, an empty ledger and audit log, no session and a fresh clock', async () => {
  const lab = await startLab();
  try {
    await lab.send('POST', '/api/call', { prompt: 'hello', key: { mode: 'stored-credential', credential: CRED }, aws: { trust: trustPolicy({ principal: OTHER_PRINCIPAL }) } });
    const r = (await lab.send('POST', '/api/reset', {})).json;
    assert.equal(r.reset, true);
    assert.deepEqual([r.clockMs, r.auditSize, r.key.mode, r.key.session, r.key.usage.requests, r.key.budget.spent], [0, 0, 'assumed-role', null, 0, 0]);
    assert.deepEqual(r.aws, DEFAULT_AWS());
    assert.equal((await lab.send('POST', '/api/reset')).status, 200, 'reset with no body');
    assert.equal(GATEWAY_PRINCIPAL.startsWith('arn:'), true);
  } finally { await lab.close(); }
});

test('hostile input: prompt, advance, provider state, key and unknown fields get a 4xx and a JSON error', async () => {
  const lab = await startLab();
  try {
    const call = (b) => lab.send('POST', '/api/call', b);
    err(await call({ prompt: 'x'.repeat(20001) }), 400, 'prompt_too_long');
    assert.equal((await call({ prompt: 'x'.repeat(20000) })).status, 200);
    err(await call({ prompt: '' }), 400, 'empty_prompt');
    err(await call({ prompt: '   ' }), 400, 'empty_prompt');
    err(await call({}), 400, 'bad_prompt');
    err(await call({ prompt: 5 }), 400, 'bad_prompt');
    for (const ms of [-1, 1.5, '5', null, 1e12, Infinity]) err(await call({ prompt: 'hi', advanceMs: ms }), 400, 'bad_advance');
    err(await call({ prompt: 'hi', providerState: 'exploded' }), 400, 'unknown_provider_state');
    err(await call({ prompt: 'hi', providerState: 5 }), 400, 'unknown_provider_state');
    err(await call({ prompt: 'hi', apiKey: 'sk-abc' }), 400, 'unknown_field');
    err(await call('{"prompt":"hi","__proto__":{"x":1}}'), 400, 'unknown_field');
    err(await call({ prompt: 'hi', aws: [] }), 400, 'bad_body');
    err(await call({ prompt: 'hi', aws: { __proto__x: 1 } }), 400, 'unknown_field');
    err(await call({ prompt: 'hi', aws: JSON.parse('{"__proto__":{"polluted":1}}') }), 400, 'unknown_field');
    err(await call({ prompt: 'hi', key: null }), 400, 'bad_body');
    err(await call({ prompt: 'hi', key: [] }), 400, 'bad_body');
    err(await call({ prompt: 'hi', key: { mode: 'oauth' } }), 400, 'bad_mode');
    for (const name of ['credential', 'apiKey', 'secret', 'accessKeyId', 'secretAccessKey', 'sessionToken']) {
      assert.equal((await call({ prompt: 'hi', key: { mode: 'assumed-role', [name]: CRED } })).status, 400, name);
    }
    err(await call({ prompt: 'hi', key: { mode: 'stored-credential', credential: CRED, roleArn: 'arn:aws:iam::111122223333:role/x' } }), 400, 'role_not_allowed');
    assert.equal(({}).polluted, undefined);
  } finally { await lab.close(); }
});

test('hostile input: bad JSON, huge body, unknown route and method answer JSON, never a stack or HTML', async () => {
  const lab = await startLab();
  try {
    const bad = await lab.send('POST', '/api/call', '{not json');
    assert.deepEqual([bad.status, bad.json.error], [400, 'bad_json']);
    const big = await lab.send('POST', '/api/evaluate', JSON.stringify({ trust: 'x'.repeat(300_000) }));
    assert.deepEqual([big.status, big.json.error], [413, 'too_large']);
    const unknown = await lab.get('/api/nope');
    assert.deepEqual([unknown.status, unknown.json.error], [404, 'not_found']);
    const method = await lab.send('DELETE', '/api/state');
    assert.equal(method.status, 405);
    assert.match(method.headers.get('allow'), /GET/);
    assert.equal((await lab.get('/api/call')).status, 405);
    assert.equal((await lab.get('/')).status, 404);
    assert.doesNotMatch(bad.text + big.text + unknown.text, /at .*\.js:\d+|<html/i);
    assert.equal((await lab.send('POST', '/api/call', { prompt: 'hi' }, { 'content-type': 'text/plain' })).status, 400, 'a non-JSON content type is not parsed, so the prompt is missing');
  } finally { await lab.close(); }
});

test('hostile input: a deeply nested, wide or huge policy sent over HTTP is a named result, the server stays up', async () => {
  const lab = await startLab();
  try {
    const nested = `${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}`;
    const r1 = await lab.send('POST', '/api/evaluate', `{"trust":${nested},"permission":{}}`);
    assert.equal(r1.status, 200);
    assert.equal(r1.json.policyError.code, 'policy_too_deep');
    const wide = JSON.stringify({ trust: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i])), permission: {} });
    assert.equal((await lab.send('POST', '/api/evaluate', wide)).json.policyError.code, 'policy_too_many_nodes');
    const huge = await lab.send('POST', '/api/evaluate', { trust: 'x'.repeat(200_000), permission: 'y' });
    assert.equal(huge.json.policyError.code, 'policy_too_large');
    const proto = await lab.send('POST', '/api/evaluate', '{"trust":{"__proto__":{"a":1}},"permission":{}}');
    assert.equal(proto.json.policyError.code, 'policy_forbidden_key');
    assert.equal((await lab.get('/api/health')).status, 200);
    assert.equal(({}).a, undefined);
  } finally { await lab.close(); }
});

test('error messages never echo the caller\'s text', async () => {
  const lab = await startLab();
  try {
    const marker = 'zz-secret-marker-9981';
    const r = await lab.send('POST', '/api/call', { prompt: 'hi', key: { mode: marker } });
    assert.doesNotMatch(r.text, /zz-secret-marker/);
    const r2 = await lab.send('POST', '/api/call', { prompt: 'hi', providerState: marker });
    assert.doesNotMatch(r2.text, /zz-secret-marker/);
    const r3 = await lab.send('POST', '/api/mode', { source: marker });
    assert.doesNotMatch(r3.text, /zz-secret-marker/);
    const r4 = await lab.send('POST', '/api/call', { prompt: 'hi', key: { mode: 'stored-credential', credential: marker } });
    assert.doesNotMatch(r4.text, /zz-secret-marker/);
    const r5 = await lab.send('POST', '/api/call', { prompt: 'hi', key: { mode: 'assumed-role', roleArn: marker } });
    assert.doesNotMatch(r5.text, /zz-secret-marker/);
    const r6 = await lab.send('POST', '/api/evaluate', { trust: marker, permission: marker, externalId: marker });
    assert.doesNotMatch(r6.text, /zz-secret-marker/);
    const r7 = await lab.send('POST', '/api/call', { prompt: 'hi', key: { mode: 'assumed-role', [marker]: 1 } });
    assert.doesNotMatch(r7.text, /zz-secret-marker/);
  } finally { await lab.close(); }
});

test('HEAD is allowed wherever GET is (and is named in Allow); a write route still refuses it', async () => {
  const lab = await startLab();
  try {
    for (const p of ['/api/info', '/api/state', '/api/scenarios', '/api/mode', '/api/key-shapes', '/api/story', '/api/diagram', '/api/log']) assert.equal((await lab.send('HEAD', p)).status, 200, p);
    const wrong = await lab.send('POST', '/api/info', {});
    assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('allow'), 'GET, HEAD');
    assert.equal((await lab.send('HEAD', '/api/call')).status, 405);
    assert.equal((await lab.send('HEAD', '/api/call')).headers.get('allow'), 'POST');
  } finally { await lab.close(); }
});
