import test from 'node:test';
import assert from 'node:assert/strict';
import { startLab } from './helpers.js';
import { credentialLikeKeys, SCENARIOS } from '../src/scenarios.js';
import { verdictFor } from '../src/verdicts.js';
import { RESULTS } from '../src/iamEvaluator.js';
import { VERTEX_RESULTS } from '../src/vertexEvaluator.js';
import { IAM_SNIPPETS, SOURCED, LAB_MODEL, NOT_CLAIMED, UNVERIFIED } from '../src/data.js';

const err = (r, status, code) => { assert.equal(r.status, status, r.text.slice(0, 200)); assert.equal(r.json.error, code); assert.ok(r.json.message); };

test('GET /api/info carries what the page draws: the limits lists, snippets, the default key and policies, and no credential value', async () => {
  const lab = await startLab();
  try {
    const { json: i } = await lab.get('/api/info');
    assert.deepEqual(i.sourced, [...SOURCED]); assert.deepEqual(i.labModel, [...LAB_MODEL]); assert.deepEqual(i.notClaimed, [...NOT_CLAIMED]); assert.deepEqual(i.unverified, [...UNVERIFIED]);
    assert.equal(i.workspace, 'default');
    assert.deepEqual(i.snippets.map((s) => s.id), ['trust', 'permission', 'cli', 'vertex']);
    assert.equal(i.defaultKey.mode, 'assumed-role'); assert.equal(Object.hasOwn(i.defaultKey, 'credential'), false);
    assert.deepEqual(Object.keys(i.defaultAws), ['trust', 'permission']);
    assert.deepEqual(credentialLikeKeys({ k: i.defaultKey }), []);
  } finally { await lab.close(); }
});

test('IAM snippets use placeholder ids only: made-up account ids, example names, .example hosts', () => {
  const text = IAM_SNIPPETS.map((s) => s.text).join('\n');
  for (const m of text.matchAll(/::(\d{12})\b/g)) assert.ok(['111122223333', '444455556666', '999900001111'].includes(m[1]), m[1]);
  assert.match(text, /example-bedrock-invoke-role/);
  assert.doesNotMatch(text, /AKIA|MOCK-|sk-/);
  for (const m of text.matchAll(/@([\w.-]+)/g)) assert.match(m[1], /\.example$/);
  for (const s of IAM_SNIPPETS.filter((x) => x.language === 'json')) assert.doesNotThrow(() => JSON.parse(s.text), s.id);
});

test('GET /api/key-shapes: the stored key has a masked credential, the assumed-role key has none at any depth, and the value never appears', async () => {
  const lab = await startLab();
  try {
    const r = await lab.get('/api/key-shapes');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.stored.credential, { stored: true, masked: '********' });
    assert.equal(Object.hasOwn(r.json.assumed, 'credential'), false);
    assert.deepEqual(credentialLikeKeys(r.json.assumed), []);
    assert.doesNotMatch(r.text, /MOCK-example-credential/);
    assert.equal((await lab.send('POST', '/api/key-shapes', {})).status, 405);
  } finally { await lab.close(); }
});

test('PUT /api/key replaces the live key: a stored key is write-only, an assumed-role key refuses a credential, a bad body is a 400 and changes nothing', async () => {
  const lab = await startLab();
  try {
    const stored = await lab.send('PUT', '/api/key', { mode: 'stored-credential', credential: 'MOCK-put-credential-77' });
    assert.equal(stored.status, 200); assert.deepEqual(stored.json.key.credential, { stored: true, masked: '********' });
    assert.doesNotMatch(stored.text, /MOCK-put-credential-77/);
    const call = (await lab.send('POST', '/api/call', { prompt: 'hello there' })).json;
    assert.deepEqual(call.hops.map((h) => `${h.id}:${h.status}`), ['key:done', 'ai-guard:done', 'provider-auth:done', 'bedrock-invoke:done', 'metering:done', 'audit:done']);
    assert.doesNotMatch(JSON.stringify(call), /MOCK-put-credential-77/);
    err(await lab.send('PUT', '/api/key', { mode: 'assumed-role', credential: 'MOCK-x-credential-1' }), 400, 'credential_not_allowed');
    err(await lab.send('PUT', '/api/key', { mode: 'stored-credential', credential: ['s', 'k-real-looking-value'].join('') }), 400, 'credential_not_mock');
    err(await lab.send('PUT', '/api/key', {}), 400, 'bad_mode');
    err(await lab.send('PUT', '/api/key', '[1]'), 400, 'bad_body');
    assert.equal((await lab.get('/api/state')).json.key.mode, 'stored-credential', 'a refused key changed nothing');
    assert.equal((await lab.send('PUT', '/api/key', { mode: 'assumed-role', roleArn: 'arn:aws:iam::111122223333:role/example-bedrock-invoke-role', externalId: 'example-external-id-0001' })).status, 200);
    assert.equal((await lab.get('/api/state')).json.key.mode, 'assumed-role');
    assert.equal((await lab.send('GET', '/api/key')).status, 405);
  } finally { await lab.close(); }
});

test('POST /api/scenario/:id carries a verdict and the detail the page draws; the verdict equals the hand-written expectation for every scenario', async () => {
  const lab = await startLab();
  try {
    for (const s of SCENARIOS) {
      const r = (await lab.send('POST', `/api/scenario/${s.id}`, {})).json;
      assert.equal(r.pass, true, s.id);
      assert.ok(r.detail && r.runId && r.trace.exchanges.length >= 1, s.id);
      if (s.kind === 'call') { assert.equal(r.verdict.code, s.expect.calls.at(-1).code, s.id); assert.equal(r.detail.calls.length, s.calls.length); }
      if (s.kind === 'vertex') assert.equal(r.verdict.code, s.expect.code, s.id);
      if (s.kind === 'key-shape') { assert.equal(r.verdict, null); assert.equal(Object.hasOwn(r.detail.assumedView, 'credential'), false); assert.doesNotMatch(JSON.stringify(r), /MOCK-scenario-credential-0001/); }
      if (s.kind === 'fallback-target') { assert.equal(r.detail.primary.status, 503); assert.equal(r.detail.target.ok, true); assert.equal(r.detail.targetCall.code, 'success'); }
    }
    assert.equal((await lab.get('/api/state')).json.auditSize, 0, 'scenarios never touch the live lab');
  } finally { await lab.close(); }
});

test('verdicts: every evaluator code has its wording, the codes the call path adds have theirs, an unknown code is named never blank', () => {
  for (const code of [...Object.keys(RESULTS), ...Object.keys(VERTEX_RESULTS), 'guard_blocked', 'out_of_budget', 'budget_exceeded_after_call', 'provider_unavailable', 'provider_overloaded', 'provider_timeout']) {
    const v = verdictFor(code);
    assert.equal(v.code, code); assert.ok(v.title && v.message, code); assert.equal(v.labText, true);
    if (!v.ok) assert.ok(v.fix, `${code} has a fix`);
  }
  assert.equal(verdictFor('__proto__').code, 'unknown'); assert.equal(verdictFor(undefined).code, 'unknown');
});

test('a policy at the size limit is read; one character more is a named result; a bad field is a plain 400 and the body limit is 413', async () => {
  const lab = await startLab();
  try {
    const base = { trust: JSON.stringify({ Version: '2012-10-17', Statement: [] }), permission: '{}' };
    const head = '{"Version":"2012-10-17","Statement":[]';
    const big = (n) => `${head}${' '.repeat(n - head.length - 1)}}`; // valid JSON of exactly n characters
    const atLimit = (await lab.send('POST', '/api/evaluate', { ...base, trust: big(10000) })).json;
    assert.notEqual(atLimit.policyError?.code, 'policy_too_large', 'exactly 10000 characters is within the limit (it may fail later, for another reason)');
    const over = (await lab.send('POST', '/api/evaluate', { ...base, trust: big(10001) })).json;
    assert.equal(over.code, 'trust_policy_invalid'); assert.equal(over.policyError.code, 'policy_too_large');
    err(await lab.send('POST', '/api/evaluate', { ...base, region: 'nowhere' }), 400, 'bad_input');
    assert.equal((await lab.send('POST', '/api/evaluate', { ...base, trust: 'x'.repeat(300_000) })).status, 413);
  } finally { await lab.close(); }
});
