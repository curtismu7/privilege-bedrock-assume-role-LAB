import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_LIMITS, PolicyError, parseBindings, parsePolicy } from '../src/policy.js';
import { globMatch } from '../src/glob.js';
import { evaluate } from '../src/iamEvaluator.js';
import { EXTERNAL_ID, GATEWAY_PRINCIPAL, LARGE_MODEL, permissionPolicy, trustPolicy } from '../src/data.js';

const codeOf = (fn) => { try { fn(); return 'NO ERROR'; } catch (e) { assert.ok(e instanceof PolicyError, `a PolicyError, got ${e}`); return e.code; } };
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)); // an undefined value is not JSON: keep these cases about the policy's meaning
const stmt = (extra = {}) => drop({ Effect: 'Allow', Principal: { AWS: GATEWAY_PRINCIPAL }, Action: 'sts:AssumeRole', ...extra });
const pol = (...statements) => ({ Version: '2012-10-17', Statement: statements });

test('hostile input to the policy reader: each is a named error, never a pass', () => {
  const nested = (n) => { let v = {}; for (let i = 0; i < n; i++) v = { a: v }; return v; };
  const cases = [
    ['not JSON', 'this is not json', 'policy_not_json'],
    ['trailing comma', '{"Version":"2012-10-17",}', 'policy_not_json'],
    ['the word undefined', 'undefined', 'policy_not_json'],
    ['a JSON number as text', '5', 'policy_not_object'],
    ['a JSON array as text', '[]', 'policy_not_object'],
    ['JSON null as text', 'null', 'policy_not_object'],
    ['empty text', '', 'policy_missing'],
    ['blank text', '  \n ', 'policy_missing'],
    ['undefined', undefined, 'policy_missing'],
    ['null', null, 'policy_missing'],
    ['a number', 5, 'policy_not_object'],
    ['huge text', 'x'.repeat(1_000_000), 'policy_too_large'],
    ['text one over the limit', `{"a":"${'x'.repeat(POLICY_LIMITS.maxChars)}"}`, 'policy_too_large'],
    ['deep nesting as text (arrays)', '['.repeat(4_900) + ']'.repeat(4_900), 'policy_too_deep'],
    ['deep nesting as text (objects)', '{"a":'.repeat(1_500) + '1' + '}'.repeat(1_500), 'policy_too_deep'],
    ['deep nesting as an object, 200000 levels built in a loop', nested(200_000), 'policy_too_deep'],
    ['a cycle', (() => { const o = { Version: '2012-10-17' }; o.Statement = o; return o; })(), 'policy_too_deep'],
    ['too many values in one array', pol(stmt({ Action: Array.from({ length: 700 }, () => 'sts:AssumeRole') })), 'policy_too_many_nodes'],
    ['too many keys in one object', Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`k${i}`, 1])), 'policy_too_many_nodes'],
    ['too many statements', { Version: '2012-10-17', Statement: Array.from({ length: 21 }, () => stmt()) }, 'policy_too_many_statements'],
    ['a string over 512 characters', pol(stmt({ Sid: 'x'.repeat(513) })), 'policy_string_too_long'],
    ['a key over 512 characters', { ['k'.repeat(513)]: 1 }, 'policy_string_too_long'],
    ['__proto__ key (text)', '{"Version":"2012-10-17","Statement":[],"__proto__":{"polluted":true}}', 'policy_forbidden_key'],
    ['__proto__ key nested in a statement', `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":"sts:AssumeRole","__proto__":{"x":1}}]}`, 'policy_forbidden_key'],
    ['constructor key', '{"Version":"2012-10-17","constructor":{"prototype":{"x":1}},"Statement":[]}', 'policy_forbidden_key'],
    ['prototype key', '{"prototype":1}', 'policy_forbidden_key'],
    ['a class instance', new (class Policy { constructor() { this.Version = '2012-10-17'; } })(), 'policy_bad_value'],
    ['a Map', new Map(), 'policy_bad_value'],
    ['a function value', { Version: '2012-10-17', Statement: () => 1 }, 'policy_bad_value'],
    ['a bigint value', { Version: '2012-10-17', Statement: 5n }, 'policy_bad_value'],
    ['an infinite number', { Version: '2012-10-17', Statement: [Infinity] }, 'policy_bad_value'],
    ['wrong Version', { Version: '2008-10-17', Statement: [stmt()] }, 'policy_bad_version'],
    ['missing Version', { Statement: [stmt()] }, 'policy_bad_version'],
    ['no Statement', { Version: '2012-10-17' }, 'policy_bad_statement'],
    ['empty Statement list', { Version: '2012-10-17', Statement: [] }, 'policy_bad_statement'],
    ['a top-level field this lab does not read', { Version: '2012-10-17', Statement: [stmt()], Extra: 1 }, 'policy_bad_statement'],
    ['a statement that is not an object', pol('Allow'), 'policy_bad_statement'],
    ['a statement with an unknown field', pol(stmt({ Unknown: 1 })), 'policy_bad_statement'],
    ['Effect other than Allow or Deny', pol(stmt({ Effect: 'allow' })), 'policy_bad_effect'],
    ['no Principal', pol({ Effect: 'Allow', Action: 'sts:AssumeRole' }), 'policy_bad_statement'],
    ['no Action', pol({ Effect: 'Allow', Principal: '*' }), 'policy_bad_statement'],
    ['an Action that looks like code', pol(stmt({ Action: 'process.exit(1)' })), 'policy_bad_statement'],
    ['an Action with a template', pol(stmt({ Action: '${1+1}' })), 'policy_bad_statement'],
    ['a principal that is not an ARN', pol(stmt({ Principal: { AWS: 'constructor.constructor("return 1")()' } })), 'policy_bad_statement'],
    ['an empty principal', pol(stmt({ Principal: { AWS: '' } })), 'policy_bad_statement'],
    ['an empty principal list', pol(stmt({ Principal: { AWS: [] } })), 'policy_bad_statement'],
    ['a principal that is a number', pol(stmt({ Principal: { AWS: 5 } })), 'policy_bad_statement'],
    ['Principal as a list', pol(stmt({ Principal: ['*'] })), 'policy_bad_statement'],
    ['NotPrincipal', pol({ Effect: 'Deny', NotPrincipal: { AWS: GATEWAY_PRINCIPAL }, Action: 'sts:AssumeRole' }), 'policy_unsupported'],
    ['NotAction', pol(stmt({ Action: undefined, NotAction: 'sts:AssumeRole' })), 'policy_unsupported'],
    ['a Service principal', pol(stmt({ Principal: { Service: 'example.invalid' } })), 'policy_unsupported'],
    ['a Federated principal', pol(stmt({ Principal: { Federated: 'example.invalid' } })), 'policy_unsupported'],
    ['another condition operator', pol(stmt({ Condition: { StringLike: { 'sts:ExternalId': '*' } } })), 'policy_unsupported'],
    ['two condition operators', pol(stmt({ Condition: { StringEquals: { 'sts:ExternalId': 'a' }, Bool: { x: 'true' } } })), 'policy_unsupported'],
    ['another condition key', pol(stmt({ Condition: { StringEquals: { 'aws:SourceIp': '10.0.0.1' } } })), 'policy_unsupported'],
    ['an empty external ID value in the condition', pol(stmt({ Condition: { StringEquals: { 'sts:ExternalId': '' } } })), 'policy_bad_statement'],
    ['Resource in a trust policy', pol(stmt({ Resource: '*' })), 'policy_unsupported'],
  ];
  for (const [name, input, code] of cases) assert.equal(codeOf(() => parsePolicy(input, 'trust')), code, name);
  assert.equal(({}).polluted, undefined, 'Object.prototype was not polluted');
  assert.equal(Object.prototype.polluted, undefined);
});

test('hostile permission policies: unsupported or malformed parts are named errors', () => {
  const p = (extra) => ({ Version: '2012-10-17', Statement: [drop({ Effect: 'Allow', Action: 'bedrock:InvokeModel', Resource: '*', ...extra })] });
  assert.equal(codeOf(() => parsePolicy(p({ Condition: { Bool: { x: 'true' } } }), 'permission')), 'policy_unsupported');
  assert.equal(codeOf(() => parsePolicy(p({ NotResource: '*', Resource: undefined }), 'permission')), 'policy_unsupported');
  assert.equal(codeOf(() => parsePolicy(p({ Principal: '*' }), 'permission')), 'policy_bad_statement');
  assert.equal(codeOf(() => parsePolicy(p({ Resource: undefined }), 'permission')), 'policy_bad_statement');
  assert.equal(codeOf(() => parsePolicy(p({ Resource: 'a b' }), 'permission')), 'policy_bad_statement');
  assert.equal(codeOf(() => parsePolicy(p({ Resource: '<script>' }), 'permission')), 'policy_bad_statement');
  assert.deepEqual(parsePolicy(p({}), 'permission').statements[0].resources, ['*']);
  assert.equal(parsePolicy({ Version: '2012-10-17', Statement: p().Statement[0] }, 'permission').statements.length, 1, 'a single statement object is accepted');
});

test('a hostile policy never turns into a pass at the evaluator, and no code runs', () => {
  globalThis.__pwned = undefined;
  const payloads = [
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:ExternalId":"x\\u0027);globalThis.__pwned=1;(\\u0027"}}}]}',
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"globalThis.__pwned=1"}]}',
    '{"__proto__":{"Statement":[{"Effect":"Allow","Principal":"*","Action":"sts:AssumeRole"}]},"Version":"2012-10-17"}',
    '['.repeat(9_000), '{"a":'.repeat(2_000), 'x'.repeat(500_000),
  ];
  for (const trust of payloads) {
    const r = evaluate({ trust, permission: permissionPolicy(), callerPrincipal: GATEWAY_PRINCIPAL, externalId: EXTERNAL_ID, modelId: LARGE_MODEL, region: 'us-east-1', now: 0 });
    assert.equal(r.ok, false);
    assert.notEqual(r.code, 'success');
  }
  assert.equal(globalThis.__pwned, undefined);
});

test('wildcard handling: glob matching is exact, linear and never a regex', () => {
  assert.equal(globMatch('*', ''), true);
  assert.equal(globMatch('*', 'anything'), true);
  assert.equal(globMatch('a*c', 'abbbc'), true);
  assert.equal(globMatch('a*c', 'abbbd'), false);
  assert.equal(globMatch('a*c', 'ac'), true);
  assert.equal(globMatch('**a**', 'xax'), true);
  assert.equal(globMatch('abc', 'abcd'), false);
  assert.equal(globMatch('abc*', 'abc'), true);
  assert.equal(globMatch('*abc', 'xxabc'), true);
  assert.equal(globMatch('a.c', 'abc'), false, 'a dot is a dot, not a regex wildcard');
  assert.equal(globMatch('a?c', 'abc'), false, 'only * is a wildcard');
  assert.equal(globMatch('BEDROCK:*', 'bedrock:InvokeModel', true), true);
  assert.equal(globMatch('BEDROCK:*', 'bedrock:InvokeModel', false), false);
  assert.equal(globMatch('*', '*'), true);
  // The classic exponential-backtracking shape stays fast.
  const t0 = performance.now();
  assert.equal(globMatch('a*'.repeat(200) + 'b', 'a'.repeat(500)), false);
  assert.equal(globMatch('*a*a*a*a*a*a*a*a*a*a*a*a*b', 'a'.repeat(512)), false);
  assert.ok(performance.now() - t0 < 500, 'worst-case glob finished quickly');
});

test('wildcard principals through the evaluator: only what the pattern matches, and a warning is raised', () => {
  const run = (principal, caller = GATEWAY_PRINCIPAL) => evaluate({
    trust: pol(stmt({ Principal: principal })), permission: permissionPolicy(), callerPrincipal: caller, externalId: null, modelId: LARGE_MODEL, region: 'us-east-1', now: 0,
  });
  for (const caller of [GATEWAY_PRINCIPAL, 'arn:aws:iam::999900001111:user/example-person', 'arn:aws:iam::555566667777:root']) {
    const r = run('*', caller);
    assert.equal(r.code, 'success', caller);
    assert.equal(r.warnings[0].code, 'wildcard_principal');
  }
  assert.equal(run({ AWS: 'arn:aws:iam::*:role/example-gateway-principal' }).code, 'success');
  assert.equal(run({ AWS: 'arn:aws:iam::*:role/example-gateway-principal' }, 'arn:aws:iam::999900001111:role/example-gateway-principal').code, 'success');
  assert.equal(run({ AWS: 'arn:aws:iam::*:role/example-gateway-principal' }, 'arn:aws:iam::999900001111:role/example-gateway-principal-2').code, 'trust_principal_mismatch');
  assert.equal(run({ AWS: GATEWAY_PRINCIPAL }).warnings.length, 0, 'an exact principal raises no wildcard warning');
  assert.equal(run('*', 'arn:aws:iam::999900001111:role/x').code, 'success');
});

test('Vertex bindings reader: bounded and named', () => {
  assert.equal(codeOf(() => parseBindings('nope')), 'policy_not_json');
  assert.equal(codeOf(() => parseBindings({})), 'policy_bad_statement');
  assert.equal(codeOf(() => parseBindings({ bindings: [] })), 'policy_bad_statement');
  assert.equal(codeOf(() => parseBindings({ bindings: [{ role: 'viewer', members: ['allUsers'] }] })), 'policy_bad_statement');
  assert.equal(codeOf(() => parseBindings({ bindings: [{ role: 'roles/viewer', members: ['serviceAccount:a b'] }] })), 'policy_bad_statement');
  assert.equal(codeOf(() => parseBindings({ bindings: [{ role: 'roles/viewer', members: ['allUsers'], condition: {} }] })), 'policy_unsupported');
  assert.equal(codeOf(() => parseBindings('{"bindings":[{"role":"roles/viewer","members":["allUsers"],"__proto__":{}}]}')), 'policy_forbidden_key');
  assert.equal(codeOf(() => parseBindings({ bindings: Array.from({ length: 21 }, () => ({ role: 'roles/viewer', members: ['allUsers'] })) })), 'policy_too_many_statements');
  assert.equal(parseBindings({ bindings: [{ role: 'roles/viewer', members: 'allUsers' }] })[0].members[0], 'allUsers');
  assert.ok(trustPolicy());
});
