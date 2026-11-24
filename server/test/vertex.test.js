import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTEX_RESULTS, evaluateVertex, SERVICE_ACCOUNT_FORMAT } from '../src/vertexEvaluator.js';
import { VERTEX_OTHER_ACCOUNT, VERTEX_SERVICE_ACCOUNT } from '../src/data.js';

const bind = (role, ...members) => ({ role, members: members.map((m) => (m.includes(':') || m.startsWith('all') ? m : `serviceAccount:${m}`)) });
const policy = (...bindings) => ({ bindings });
const SA = VERTEX_SERVICE_ACCOUNT;

// [name, policy, expected code, extra check]
const TABLE = [
  ['with the user role', policy(bind('roles/aiplatform.user', SA)), 'success'],
  ['with the admin role', policy(bind('roles/aiplatform.admin', SA)), 'success'],
  ['one of several roles grants the call', policy(bind('roles/viewer', SA), bind('roles/aiplatform.user', SA)), 'success'],
  ['one of several members on the binding', policy(bind('roles/aiplatform.user', VERTEX_OTHER_ACCOUNT, SA)), 'success'],
  ['without the role: a binding names only another service account', policy(bind('roles/aiplatform.user', VERTEX_OTHER_ACCOUNT)), 'vertex_role_missing'],
  ['without the role: the policy has only unrelated members', policy(bind('roles/aiplatform.user', 'user:someone@example.invalid')), 'vertex_role_missing'],
  ['bound but only to a viewer role', policy(bind('roles/viewer', SA)), 'vertex_role_insufficient', (r) => assert.deepEqual(r.roles, ['roles/viewer'])],
  ['bound to a role the lab does not know grants nothing', policy(bind('roles/example.custom', SA)), 'vertex_role_insufficient'],
  ['allAuthenticatedUsers is a wildcard member and warns', policy(bind('roles/aiplatform.user', 'allAuthenticatedUsers')), 'success', (r) => assert.equal(r.warnings[0].code, 'wildcard_member')],
  ['allUsers with a role that does not grant', policy(bind('roles/viewer', 'allUsers')), 'vertex_role_insufficient'],
  ['__proto__ is not a role', policy(bind('roles/__proto__', SA)), 'vertex_role_insufficient'],
  ['policy as JSON text', JSON.stringify(policy(bind('roles/aiplatform.user', SA))), 'success'],
  ['malformed policy text', '{nope', 'vertex_policy_invalid', (r) => assert.equal(r.policyError.code, 'policy_not_json')],
  ['missing policy', undefined, 'vertex_policy_invalid', (r) => assert.equal(r.policyError.code, 'policy_missing')],
  ['oversized policy', 'x'.repeat(10_001), 'vertex_policy_invalid', (r) => assert.equal(r.policyError.code, 'policy_too_large')],
  ['empty bindings', { bindings: [] }, 'vertex_policy_invalid'],
  ['a binding condition is refused, never ignored', { bindings: [{ role: 'roles/aiplatform.user', members: [`serviceAccount:${SA}`], condition: { title: 'x' } }] }, 'vertex_policy_invalid', (r) => assert.equal(r.policyError.code, 'policy_unsupported')],
  ['deeply nested policy', JSON.parse(`${'{"a":'.repeat(30)}1${'}'.repeat(30)}`), 'vertex_policy_invalid'],
];

for (const [name, p, code, extra] of TABLE) {
  test(`vertex: ${name}`, () => {
    const r = evaluateVertex({ policy: p, serviceAccount: SA });
    assert.equal(r.code, code, JSON.stringify(r.steps));
    assert.equal(r.ok, VERTEX_RESULTS[code].ok);
    assert.equal(r.labText, true);
    if (!r.ok) assert.ok(r.title && r.message && r.fix);
    extra?.(r);
  });
}

test('vertex: no role is assumed, so the result has no session and no external ID step', () => {
  const r = evaluateVertex({ policy: policy(bind('roles/aiplatform.user', SA)), serviceAccount: SA });
  assert.equal(r.session, undefined);
  assert.deepEqual(r.steps.map((s) => s.id), ['binding', 'role-grants-predict']);
});

test('vertex: only placeholder service accounts are accepted, and a bad one is a bad_input that never echoes it', () => {
  for (const sa of [undefined, null, 5, '', 'a@b.com', 'real-person@gmail.com', 'gateway-vertex@example-project-0001.iam.gserviceaccount.com', 'x@y.example', `${'a'.repeat(300)}@x.example`, 'gate way@proj-0001.example']) {
    const r = evaluateVertex({ policy: policy(), serviceAccount: sa });
    assert.equal(r.code, 'bad_input');
    assert.equal(r.field, 'serviceAccount');
    assert.equal(r.ok, false);
  }
  for (const input of [null, undefined, 5, []]) assert.equal(evaluateVertex(input).code, 'bad_input');
  assert.match(VERTEX_SERVICE_ACCOUNT, SERVICE_ACCOUNT_FORMAT);
  assert.match(VERTEX_OTHER_ACCOUNT, SERVICE_ACCOUNT_FORMAT);
});

test('vertex: the evaluator is total on odd policies', () => {
  const cyclic = { bindings: [] }; cyclic.bindings.push(cyclic);
  for (const p of [cyclic, new Map(), 5, [], { get bindings() { throw new Error('boom'); } }]) {
    const r = evaluateVertex({ policy: p, serviceAccount: SA });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'vertex_policy_invalid');
  }
});
