import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/model-gateway-sim/labClock.js';
import { createKeyObject, keyView, setCredential, hasStoredCredential, hasExternalId, externalIdFor, MASK } from '../src/keyModes.js';
import { createLab, DEFAULT_KEY_SPEC } from '../src/lab.js';
import { credentialLikeKeys } from '../src/scenarios.js';
import { EXTERNAL_ID, DEFAULT_PROMPT } from '../src/data.js';

const CRED = 'MOCK-test-credential-7731';
const stored = (over = {}) => ({ mode: 'stored-credential', credential: CRED, ...over });
const assumed = (over = {}) => ({ ...DEFAULT_KEY_SPEC(), ...over });
const refuses = (fn, code) => { try { fn(); } catch (e) { assert.equal(e.code, code); return; } assert.fail(`expected ${code}`); };

test('assumed-role key: NO credential field at all, on the key or in its view, at any depth', () => {
  const k = createKeyObject(assumed(), createClock(0));
  const view = keyView(k);
  assert.equal(Object.hasOwn(k, 'credential'), false);
  assert.equal(Object.hasOwn(view, 'credential'), false);
  assert.deepEqual(credentialLikeKeys(k), []);
  assert.deepEqual(credentialLikeKeys(view), []);
  assert.equal(view.mode, 'assumed-role');
  assert.equal(view.roleArn, DEFAULT_KEY_SPEC().roleArn);
  assert.equal(hasStoredCredential(k), false);
});

test('assumed-role key: a credential cannot be set at creation or later, under any name', () => {
  refuses(() => createKeyObject(assumed({ credential: CRED }), createClock(0)), 'credential_not_allowed');
  refuses(() => createKeyObject(assumed({ credential: '' }), createClock(0)), 'credential_not_allowed');
  refuses(() => createKeyObject(assumed({ credential: undefined }), createClock(0)), 'credential_not_allowed');
  for (const name of ['apiKey', 'secret', 'accessKeyId', 'secretAccessKey', 'sessionToken', 'password', 'token']) {
    refuses(() => createKeyObject(assumed({ [name]: 'x' }), createClock(0)), 'unknown_field');
  }
  refuses(() => setCredential(createKeyObject(assumed(), createClock(0)), CRED), 'credential_not_allowed');
});

test('assumed-role key: the external ID is write-only (set flag in the view, never the value) and only the evaluator reads it', () => {
  const k = createKeyObject(assumed(), createClock(0));
  const view = keyView(k);
  assert.equal(view.externalIdSet, true);
  assert.doesNotMatch(JSON.stringify([k, view]), new RegExp(EXTERNAL_ID));
  assert.equal(externalIdFor(k), EXTERNAL_ID);
  const none = createKeyObject(assumed({ externalId: undefined }), createClock(0));
  assert.equal(keyView(none).externalIdSet, false);
  assert.equal(hasExternalId(none), false);
  assert.equal(externalIdFor(none), null);
  assert.equal(hasExternalId(createKeyObject(assumed({ externalId: '' }), createClock(0))), false, 'an empty external ID is none');
});

test('stored-credential key: a credential field, shown only as a mask; the value is never on the key, in a view, JSON or a log', () => {
  const logged = [];
  const orig = {}; for (const m of ['log', 'info', 'warn', 'error', 'debug']) { orig[m] = console[m]; console[m] = (...a) => logged.push(a.join(' ')); }
  const out = [];
  const writeOrig = process.stdout.write; process.stdout.write = (c, ...r) => { out.push(String(c)); return writeOrig.call(process.stdout, c, ...r); };
  let produced;
  try {
    const lab = createLab({ key: stored() });
    const k = lab.key();
    const view = keyView(k);
    assert.deepEqual(view.credential, { stored: true, masked: MASK });
    assert.equal(MASK, '********');
    assert.equal(Object.hasOwn(k, 'credential'), false, 'not even the stored-mode key object carries the value');
    assert.equal(hasStoredCredential(k), true);
    const r = lab.call(DEFAULT_PROMPT);
    assert.equal(r.ok, true);
    assert.equal(r.hops.find((h) => h.id === 'provider-auth').method, 'stored-credential');
    produced = JSON.stringify([k, view, r, lab.view(), lab.audit().list()]);
    setCredential(k, 'MOCK-rotated-credential-0002');
    produced += JSON.stringify([k, keyView(k)]);
  } finally { for (const m of Object.keys(orig)) console[m] = orig[m]; process.stdout.write = writeOrig; }
  assert.doesNotMatch(produced, /MOCK-test-credential|MOCK-rotated/);
  assert.deepEqual(logged.filter((l) => /MOCK-/.test(l)), []);
  assert.deepEqual(out.filter((l) => /MOCK-/.test(l)), []);
});

test('stored-credential key: only a MOCK- placeholder is accepted, and a refusal never echoes what was sent', () => {
  for (const bad of [undefined, null, '', 5, ['AKIA', 'EXAMPLEEXAMPLE00'].join(''), ['sk-', 'live-abcdef123456'].join(''), 'mock-lowercase-1234', 'MOCK-', 'MOCK-x', `MOCK-${'a'.repeat(65)}`, 'MOCK-has space', ['MOCK-test-credential-7731']]) {
    try { createKeyObject(stored({ credential: bad }), createClock(0)); assert.fail('accepted'); } catch (e) {
      assert.equal(e.code, 'credential_not_mock');
      assert.doesNotMatch(e.message, /AKIA|sk-live|mock-lowercase/);
    }
  }
  refuses(() => createKeyObject({ mode: 'stored-credential' }, createClock(0)), 'credential_not_mock');
  refuses(() => setCredential(createKeyObject(stored(), createClock(0)), 'real-looking'), 'credential_not_mock');
  refuses(() => createKeyObject(stored({ roleArn: DEFAULT_KEY_SPEC().roleArn }), createClock(0)), 'role_not_allowed');
  refuses(() => createKeyObject(stored({ externalId: 'x' }), createClock(0)), 'role_not_allowed');
});

test('both modes are built on the kit key: the same ledger and Usage counter, and nothing else on the kit part', () => {
  for (const spec of [stored(), assumed()]) {
    const k = createKeyObject(spec, createClock(0));
    assert.deepEqual(Object.keys(k.llm).sort(), ['id', 'ledger', 'usage']);
    assert.equal(k.llm.ledger.limit, 2000);
    assert.deepEqual(k.llm.usage.snapshot(), { requests: 0, fromCache: 0, savedTokens: 0 });
  }
});

test('key config validation: bad mode, id, model, region, budget, role ARN and external ID are named refusals', () => {
  const c = () => createClock(0);
  refuses(() => createKeyObject(null, c()), 'bad_body');
  refuses(() => createKeyObject([], c()), 'bad_body');
  refuses(() => createKeyObject({ mode: 'oauth' }, c()), 'bad_mode');
  refuses(() => createKeyObject({}, c()), 'bad_mode');
  refuses(() => createKeyObject(assumed({ id: '../x' }), c()), 'bad_key_id');
  refuses(() => createKeyObject(assumed({ modelId: 'a b' }), c()), 'bad_model');
  refuses(() => createKeyObject(assumed({ region: 'mars' }), c()), 'bad_region');
  for (const b of [-1, 1.5, '5', null, NaN, 1_000_001]) refuses(() => createKeyObject(assumed({ budgetTokens: b }), c()), 'bad_budget');
  assert.equal(createKeyObject(assumed({ budgetTokens: 0 }), c()).llm.ledger.limit, 0);
  refuses(() => createKeyObject(assumed({ roleArn: 'arn:aws:iam::123:role/x' }), c()), 'bad_role_arn');
  refuses(() => createKeyObject(assumed({ roleArn: 'arn:aws:iam::111122223333:user/x' }), c()), 'bad_role_arn');
  refuses(() => createKeyObject(assumed({ externalId: 'has space' }), c()), 'bad_external_id');
  refuses(() => createKeyObject(assumed({ externalId: 5 }), c()), 'bad_external_id');
  refuses(() => createKeyObject(assumed({ unknown: 1 }), c()), 'unknown_field');
  refuses(() => createKeyObject(JSON.parse('{"mode":"assumed-role","__proto__":{"x":1}}'), c()), 'unknown_field');
});
