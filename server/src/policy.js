// Policy JSON is DATA ONLY: parsed with JSON.parse (or taken as an object), walked iteratively, bounded, never evaluated.
// No eval, no Function, no vm, no regex built from policy text. Any problem is a PolicyError with a named code: never a pass.
// The lab reads a SMALL SUBSET of IAM (UNVERIFIED as a model of the cloud): Allow/Deny statements, `*` wildcards, and one trust condition
// (StringEquals on sts:ExternalId). Anything else (NotPrincipal, NotAction, other conditions, other principal kinds) is refused as unsupported,
// never silently ignored.
export const POLICY_LIMITS = Object.freeze({ maxChars: 10_000, maxDepth: 8, maxNodes: 600, maxStatements: 20, maxValues: 20, maxString: 512 });

export class PolicyError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const bad = (code, message) => new PolicyError(code, message);

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

// Iterative walk (an explicit stack, never recursion): counts nodes and depth, refuses forbidden keys, long strings and non-JSON values.
export function inspect(root) {
  const stack = [[root, 1]];
  let nodes = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++nodes > POLICY_LIMITS.maxNodes) throw bad('policy_too_many_nodes', `the policy has more than ${POLICY_LIMITS.maxNodes} values`);
    if (v === null || typeof v === 'boolean') continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw bad('policy_bad_value', 'the policy has a number that is not finite'); continue; }
    if (typeof v === 'string') { if (v.length > POLICY_LIMITS.maxString) throw bad('policy_string_too_long', `a string in the policy is over ${POLICY_LIMITS.maxString} characters`); continue; }
    if (Array.isArray(v)) {
      if (depth > POLICY_LIMITS.maxDepth) throw bad('policy_too_deep', `the policy is nested deeper than ${POLICY_LIMITS.maxDepth} levels`);
      if (v.length > POLICY_LIMITS.maxNodes) throw bad('policy_too_many_nodes', `the policy has more than ${POLICY_LIMITS.maxNodes} values`);
      for (const c of v) stack.push([c, depth + 1]);
      continue;
    }
    if (isPlain(v)) {
      if (depth > POLICY_LIMITS.maxDepth) throw bad('policy_too_deep', `the policy is nested deeper than ${POLICY_LIMITS.maxDepth} levels`);
      const keys = Object.keys(v);
      if (keys.length > POLICY_LIMITS.maxNodes) throw bad('policy_too_many_nodes', `the policy has more than ${POLICY_LIMITS.maxNodes} values`);
      for (const k of keys) {
        if (FORBIDDEN_KEYS.has(k)) throw bad('policy_forbidden_key', 'the policy has a key this lab never reads (__proto__, constructor or prototype)');
        if (k.length > POLICY_LIMITS.maxString) throw bad('policy_string_too_long', `a key in the policy is over ${POLICY_LIMITS.maxString} characters`);
        stack.push([v[k], depth + 1]);
      }
      continue;
    }
    throw bad('policy_bad_value', 'the policy has a value that is not plain JSON data');
  }
}

// text or object -> a bounded plain object. The size check on text comes BEFORE JSON.parse.
export function readBounded(input) {
  if (input === undefined || input === null) throw bad('policy_missing', 'no policy was given');
  let obj;
  if (typeof input === 'string') {
    if (!input.trim()) throw bad('policy_missing', 'the policy is empty');
    if (input.length > POLICY_LIMITS.maxChars) throw bad('policy_too_large', `the policy text is over ${POLICY_LIMITS.maxChars} characters`);
    try { obj = JSON.parse(input); } catch (e) {
      if (e instanceof RangeError) throw bad('policy_too_deep', 'the policy is nested too deeply to read');
      throw bad('policy_not_json', 'the policy is not valid JSON');
    }
  } else obj = input;
  inspect(obj);
  if (!isPlain(obj)) throw bad('policy_not_object', 'the policy must be a JSON object');
  return obj;
}

const textList = (v, what, charset) => {
  const list = typeof v === 'string' ? [v] : v;
  if (!Array.isArray(list) || list.length === 0 || list.length > POLICY_LIMITS.maxValues) throw bad('policy_bad_statement', `${what} must be a string or a list of 1 to ${POLICY_LIMITS.maxValues} strings`);
  for (const s of list) if (typeof s !== 'string' || !s || !charset.test(s)) throw bad('policy_bad_statement', `${what} has a value that is empty or has characters this lab does not read`);
  return [...list];
};
const ACTION = /^[A-Za-z0-9*:_-]{1,128}$/;
const RESOURCE = /^[A-Za-z0-9*:/._+=@,-]{1,512}$/;
const PRINCIPAL = /^(\*|arn:aws:iam::(\d{12}|\*):[A-Za-z0-9+=,.@_/*-]{1,200}|\d{12})$/;
const UNSUPPORTED = new Set(['NotPrincipal', 'NotAction', 'NotResource']);

function statementList(obj) {
  for (const k of Object.keys(obj)) if (!['Version', 'Id', 'Statement'].includes(k)) throw bad('policy_bad_statement', 'the policy has a top-level field this lab does not read');
  if (obj.Version !== '2012-10-17') throw bad('policy_bad_version', 'Version must be "2012-10-17"');
  const list = Array.isArray(obj.Statement) ? obj.Statement : (obj.Statement === undefined ? null : [obj.Statement]);
  if (!list || list.length === 0) throw bad('policy_bad_statement', 'the policy has no Statement');
  if (list.length > POLICY_LIMITS.maxStatements) throw bad('policy_too_many_statements', `the policy has more than ${POLICY_LIMITS.maxStatements} statements`);
  return list;
}

function normalizeStatement(st, kind) {
  if (!isPlain(st)) throw bad('policy_bad_statement', 'a statement must be an object');
  const allowed = kind === 'trust' ? ['Sid', 'Effect', 'Principal', 'Action', 'Condition'] : ['Sid', 'Effect', 'Action', 'Resource'];
  for (const k of Object.keys(st)) {
    if (UNSUPPORTED.has(k) || (kind === 'trust' && k === 'Resource') || (kind === 'permission' && k === 'Condition')) throw bad('policy_unsupported', `${k} is not read by this lab (it never ignores an element it cannot evaluate)`);
    if (!allowed.includes(k)) throw bad('policy_bad_statement', 'a statement has a field this lab does not read');
  }
  if (st.Sid !== undefined && typeof st.Sid !== 'string') throw bad('policy_bad_statement', 'Sid must be a string');
  if (st.Effect !== 'Allow' && st.Effect !== 'Deny') throw bad('policy_bad_effect', 'Effect must be "Allow" or "Deny"');
  if (st.Action === undefined) throw bad('policy_bad_statement', 'a statement needs an Action');
  const out = { effect: st.Effect, actions: textList(st.Action, 'Action', ACTION) };
  if (kind === 'permission') {
    if (st.Resource === undefined) throw bad('policy_bad_statement', 'a statement needs a Resource');
    out.resources = textList(st.Resource, 'Resource', RESOURCE);
    return out;
  }
  if (st.Principal === undefined) throw bad('policy_bad_statement', 'a trust statement needs a Principal');
  let principals;
  if (st.Principal === '*') principals = ['*'];
  else if (isPlain(st.Principal)) {
    for (const k of Object.keys(st.Principal)) if (k !== 'AWS') throw bad('policy_unsupported', `Principal.${k === 'Service' || k === 'Federated' || k === 'CanonicalUser' ? k : 'other'} is not read by this lab (only Principal.AWS)`);
    if (st.Principal.AWS === undefined) throw bad('policy_bad_statement', 'Principal needs an AWS entry');
    principals = textList(st.Principal.AWS, 'Principal.AWS', PRINCIPAL);
  } else throw bad('policy_bad_statement', 'Principal must be "*" or an object with an AWS entry');
  out.principals = principals;
  out.externalIds = null;
  if (st.Condition !== undefined) {
    if (!isPlain(st.Condition)) throw bad('policy_bad_statement', 'Condition must be an object');
    const ops = Object.keys(st.Condition);
    if (ops.length !== 1 || ops[0] !== 'StringEquals') throw bad('policy_unsupported', 'only the StringEquals condition operator is read by this lab');
    const keys = Object.keys(st.Condition.StringEquals ?? {});
    if (!isPlain(st.Condition.StringEquals) || keys.length !== 1 || keys[0].toLowerCase() !== 'sts:externalid') throw bad('policy_unsupported', 'only the sts:ExternalId condition key is read by this lab');
    out.externalIds = textList(st.Condition.StringEquals[keys[0]], 'the sts:ExternalId condition', /^[\w+=,.@:/-]{1,512}$/);
  }
  return out;
}

// kind: 'trust' | 'permission'. Returns { statements: [...] } (normalized, plain data) or throws PolicyError.
export function parsePolicy(input, kind) {
  const obj = readBounded(input);
  return { statements: statementList(obj).map((s) => normalizeStatement(s, kind)) };
}

// A GCP-style IAM policy for the Vertex tab: { bindings: [{ role, members: [...] }] }.
const ROLE = /^roles\/[A-Za-z0-9._]{1,100}$/;
const MEMBER = /^(allUsers|allAuthenticatedUsers|(serviceAccount|user|group|domain):[A-Za-z0-9._@+-]{1,200})$/;
export function parseBindings(input) {
  const obj = readBounded(input);
  for (const k of Object.keys(obj)) if (!['bindings', 'version', 'etag'].includes(k)) throw bad('policy_bad_statement', 'the policy has a top-level field this lab does not read');
  if (!Array.isArray(obj.bindings) || obj.bindings.length === 0) throw bad('policy_bad_statement', 'the policy needs a non-empty bindings list');
  if (obj.bindings.length > POLICY_LIMITS.maxStatements) throw bad('policy_too_many_statements', `the policy has more than ${POLICY_LIMITS.maxStatements} bindings`);
  return obj.bindings.map((b) => {
    if (!isPlain(b)) throw bad('policy_bad_statement', 'a binding must be an object');
    for (const k of Object.keys(b)) {
      if (k === 'condition') throw bad('policy_unsupported', 'binding conditions are not read by this lab');
      if (!['role', 'members'].includes(k)) throw bad('policy_bad_statement', 'a binding has a field this lab does not read');
    }
    if (typeof b.role !== 'string' || !ROLE.test(b.role)) throw bad('policy_bad_statement', 'a binding needs a role such as roles/<name>');
    return { role: b.role, members: textList(b.members, 'members', MEMBER) };
  });
}
