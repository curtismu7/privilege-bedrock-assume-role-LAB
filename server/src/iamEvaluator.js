// The assumed-role evaluator: a PURE function. Same input, same result; it reads no clock, no state and no network, and it changes nothing it is given.
//   evaluate({ trust, callerPrincipal, externalId, permission, modelId, region, now, session, sessionMs, catalog }) -> a NAMED result.
// `now` and the session's `expiresAt` are milliseconds on the LAB clock. The function is total: any bad input or bad policy is a named result with
// ok:false, never an exception and never a pass.
// The model is THIS LAB'S OWN (UNVERIFIED as the product's or the cloud's behaviour): trust (principal, then external ID), session, invoke permission,
// model access in the region, in that order. Error and fix texts are the lab's wording.
import { parsePolicy, PolicyError } from './policy.js';
import { globMatch } from './glob.js';
import { MODEL_CATALOG, SESSION_MS } from './data.js';

export const INVOKE_ACTION = 'bedrock:InvokeModel';
export const ASSUME_ACTION = 'sts:AssumeRole';
export const SESSION_LIMITS = Object.freeze({ minMs: 60_000, maxMs: 43_200_000, defaultMs: SESSION_MS });

// code -> { ok, stage, title, message, fix }. `stage` says which step of the call the result belongs to.
export const RESULTS = Object.freeze({
  success: { ok: true, stage: 'invoke', title: 'Role assumed, call allowed', message: 'The gateway holds a short-lived session for the role, the role may invoke the model, and the model is enabled in the region.', fix: null },
  session_refreshed: { ok: true, stage: 'invoke', title: 'Session expired and was refreshed', message: 'The earlier session had expired, so the gateway assumed the role again and the call went through.', fix: null },
  trust_principal_mismatch: { ok: false, stage: 'assume-role', title: 'Wrong trust principal', message: 'The role\'s trust policy does not name the principal the gateway presents, so the role cannot be assumed.', fix: 'Add the gateway\'s principal to the trust policy\'s Principal.AWS (or fix the principal the key presents).' },
  trust_explicit_deny: { ok: false, stage: 'assume-role', title: 'Trust policy denies the caller', message: 'A Deny statement in the trust policy matches the caller, and a Deny always wins.', fix: 'Remove or narrow the Deny statement.' },
  external_id_missing: { ok: false, stage: 'assume-role', title: 'External ID missing', message: 'The trust policy requires an external ID and the key sent none.', fix: 'Set the external ID on the key to the value the trust policy\'s sts:ExternalId condition expects.' },
  external_id_mismatch: { ok: false, stage: 'assume-role', title: 'External ID mismatch', message: 'The external ID on the key does not match the one the trust policy requires.', fix: 'Make the key\'s external ID equal to the trust policy\'s sts:ExternalId value (it is case-sensitive).' },
  trust_policy_invalid: { ok: false, stage: 'assume-role', title: 'Trust policy could not be read', message: 'The trust policy is missing, malformed, too large or uses something this lab does not read, so the role was not assumed.', fix: 'Send a trust policy as JSON data in the supported subset.' },
  session_expired: { ok: false, stage: 'session', title: 'Session expired', message: 'The session the gateway held has passed its expiry on the lab clock.', fix: 'Assume the role again (the gateway refreshes the session).' },
  permission_missing_invoke: { ok: false, stage: 'invoke-permission', title: 'Missing invoke permission', message: 'The role was assumed, but no Allow statement in its permission policy lets it invoke this model.', fix: 'Allow bedrock:InvokeModel on the model\'s ARN in the role\'s permission policy.' },
  permission_explicit_deny: { ok: false, stage: 'invoke-permission', title: 'Permission policy denies the invoke', message: 'A Deny statement in the permission policy matches the invoke, and a Deny always wins.', fix: 'Remove or narrow the Deny statement.' },
  permission_policy_invalid: { ok: false, stage: 'invoke-permission', title: 'Permission policy could not be read', message: 'The permission policy is missing, malformed, too large or uses something this lab does not read, so the invoke was not allowed.', fix: 'Send a permission policy as JSON data in the supported subset.' },
  model_not_enabled_in_region: { ok: false, stage: 'model-access', title: 'Model not enabled in the region', message: 'The role may invoke the model, but the model is not enabled in this region for the account.', fix: 'Enable the model in this region, or point the key at a region where it is enabled.' },
  bad_input: { ok: false, stage: 'input', title: 'Input not valid', message: 'One of the inputs to the evaluator is not valid, so nothing was evaluated.', fix: 'Correct the named field.' },
});

const CALLER = /^arn:aws:iam::\d{12}:(root|(role|user)\/[A-Za-z0-9+=,.@_/-]{1,128})$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;
const EXTERNAL_ID = /^[\w+=,.@:/-]{1,128}$/;
export const FORMATS = Object.freeze({ CALLER, MODEL, REGION, EXTERNAL_ID });

const isNum = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const account = (arn) => /^arn:aws:iam::(\d{12}):/.exec(arn)?.[1] ?? null;

function normalizeInput(input) {
  const i = input;
  if (i === null || typeof i !== 'object' || Array.isArray(i)) return { error: 'input' };
  if (typeof i.callerPrincipal !== 'string' || i.callerPrincipal.length > 256 || !CALLER.test(i.callerPrincipal)) return { error: 'callerPrincipal' };
  let externalId = null;
  if (i.externalId !== undefined && i.externalId !== null && i.externalId !== '') {
    if (typeof i.externalId !== 'string' || !EXTERNAL_ID.test(i.externalId)) return { error: 'externalId' };
    externalId = i.externalId;
  }
  if (typeof i.modelId !== 'string' || !MODEL.test(i.modelId)) return { error: 'modelId' };
  if (typeof i.region !== 'string' || i.region.length > 32 || !REGION.test(i.region)) return { error: 'region' };
  if (!isNum(i.now)) return { error: 'now' };
  let sessionMs = SESSION_LIMITS.defaultMs;
  if (i.sessionMs !== undefined) {
    if (!Number.isInteger(i.sessionMs) || i.sessionMs < SESSION_LIMITS.minMs || i.sessionMs > SESSION_LIMITS.maxMs) return { error: 'sessionMs' };
    sessionMs = i.sessionMs;
  }
  let session = null;
  if (i.session !== undefined && i.session !== null) {
    const s = i.session;
    if (typeof s !== 'object' || Array.isArray(s) || !isNum(s.assumedAt) || !isNum(s.expiresAt) || s.expiresAt <= s.assumedAt || s.assumedAt > i.now) return { error: 'session' };
    session = { assumedAt: s.assumedAt, expiresAt: s.expiresAt };
  }
  const catalog = i.catalog === undefined ? MODEL_CATALOG : i.catalog;
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) return { error: 'catalog' };
  return { v: { trust: i.trust, permission: i.permission, callerPrincipal: i.callerPrincipal, externalId, modelId: i.modelId, region: i.region, now: i.now, sessionMs, session, catalog } };
}

function principalMatches(pattern, caller) {
  if (pattern === '*') return true;
  if (/^\d{12}$/.test(pattern)) return account(caller) === pattern;
  // An account root ("arn:aws:iam::<id>:root") trusts the whole account in this lab (identity-side permissions are not modelled).
  if (!pattern.includes('*') && pattern.endsWith(':root')) return account(pattern) === account(caller);
  return globMatch(pattern, caller);
}

const hasWildcard = (principals) => principals.some((p) => p.includes('*'));

function evaluateTrust(trust, caller, externalId) {
  let allowMatchedPrincipal = false, conditionRequired = false, allowOk = false, denied = false, wildcard = false;
  for (const st of trust.statements) {
    if (!st.actions.some((a) => globMatch(a, ASSUME_ACTION, true))) continue;
    if (!st.principals.some((p) => principalMatches(p, caller))) continue;
    // Exact, case-sensitive; a missing or empty external ID never satisfies a condition.
    const conditionMet = st.externalIds === null ? true : (externalId !== null && st.externalIds.includes(externalId));
    if (st.effect === 'Deny') { if (conditionMet) denied = true; continue; }
    allowMatchedPrincipal = true;
    if (st.externalIds !== null) conditionRequired = true;
    if (hasWildcard(st.principals)) wildcard = true;
    if (conditionMet) allowOk = true;
  }
  const warnings = wildcard ? [{ code: 'wildcard_principal', message: 'A trust statement that matched uses a wildcard principal, so any caller it matches can assume the role. (Lab advice, UNVERIFIED.)' }] : [];
  if (denied) return { code: 'trust_explicit_deny', warnings, steps: [{ id: 'trust-principal', ok: false, detail: 'a Deny statement matches the caller' }] };
  if (allowOk) return { code: null, warnings, steps: [{ id: 'trust-principal', ok: true, detail: 'an Allow statement names the caller' }, { id: 'external-id', ok: true, detail: conditionRequired ? 'the external ID satisfies the trust policy\'s condition' : 'the trust policy asks for no external ID' }] };
  if (!allowMatchedPrincipal) return { code: 'trust_principal_mismatch', warnings, steps: [{ id: 'trust-principal', ok: false, detail: 'no Allow statement names the caller' }] };
  const code = externalId === null ? 'external_id_missing' : 'external_id_mismatch';
  return { code, warnings, steps: [{ id: 'trust-principal', ok: true, detail: 'an Allow statement names the caller' }, { id: 'external-id', ok: false, detail: code === 'external_id_missing' ? 'the trust policy requires an external ID and none was sent' : 'the external ID sent is not the one the trust policy requires' }] };
}

function evaluatePermission(permission, resource) {
  let allowed = false;
  for (const st of permission.statements) {
    if (!st.actions.some((a) => globMatch(a, INVOKE_ACTION, true))) continue;
    if (!st.resources.some((r) => globMatch(r, resource))) continue;
    if (st.effect === 'Deny') return 'deny';
    allowed = true;
  }
  return allowed ? 'allow' : 'none';
}

const build = (code, steps, extra = {}) => ({ ...RESULTS[code], code, labText: true, steps, warnings: [], session: null, sessionAction: null, ...extra });

// Parsing is total: anything that is not a PolicyError (a throwing getter on a hand-built object) is still a named policy error.
function tryParse(input, kind) {
  try { return { policy: parsePolicy(input, kind) }; } catch (e) {
    return { error: e instanceof PolicyError ? e : new PolicyError('policy_bad_value', 'the policy could not be read as plain JSON data') };
  }
}
const policyFailure = (code, steps, e, which, extra) => build(code, steps, { policyError: { which, code: e.code, message: e.message }, ...extra });

export function evaluate(input) {
  let n;
  try { n = normalizeInput(input); } catch { n = { error: 'input' }; } // a hostile object (a throwing getter) is still a named result
  if (n.error) return build('bad_input', [], { field: n.error });
  const v = n.v;
  const steps = [];
  let session, sessionAction, warnings = [];

  if (v.session) {
    if (v.now >= v.session.expiresAt) {
      return build('session_expired', [{ id: 'session', ok: false, detail: `the session expired at ${v.session.expiresAt} ms and the lab clock is at ${v.now} ms` }], { session: { ...v.session, expired: true } });
    }
    steps.push({ id: 'session', ok: true, detail: `a session from an earlier AssumeRole is valid until ${v.session.expiresAt} ms (the trust policy is not consulted again)` });
    session = v.session; sessionAction = 'reused';
  } else {
    const parsed = tryParse(v.trust, 'trust');
    if (parsed.error) return policyFailure('trust_policy_invalid', [{ id: 'trust-policy', ok: false, detail: parsed.error.code }], parsed.error, 'trust');
    const t = evaluateTrust(parsed.policy, v.callerPrincipal, v.externalId);
    warnings = t.warnings;
    steps.push(...t.steps);
    if (t.code) return build(t.code, steps, { warnings });
    session = { assumedAt: v.now, expiresAt: v.now + v.sessionMs };
    sessionAction = 'assumed';
  }

  const resource = `arn:aws:bedrock:${v.region}::foundation-model/${v.modelId}`;
  const parsedPermission = tryParse(v.permission, 'permission');
  if (parsedPermission.error) return policyFailure('permission_policy_invalid', [...steps, { id: 'invoke-permission', ok: false, detail: parsedPermission.error.code }], parsedPermission.error, 'permission', { warnings, session, sessionAction });
  const p = evaluatePermission(parsedPermission.policy, resource);
  if (p !== 'allow') {
    const code = p === 'deny' ? 'permission_explicit_deny' : 'permission_missing_invoke';
    return build(code, [...steps, { id: 'invoke-permission', ok: false, detail: `${INVOKE_ACTION} on ${resource}: ${p === 'deny' ? 'denied' : 'no Allow statement matches'}` }], { warnings, session, sessionAction });
  }
  steps.push({ id: 'invoke-permission', ok: true, detail: `${INVOKE_ACTION} on ${resource} is allowed` });

  const regions = Object.hasOwn(v.catalog, v.modelId) && Array.isArray(v.catalog[v.modelId]) ? v.catalog[v.modelId] : [];
  if (!regions.includes(v.region)) {
    return build('model_not_enabled_in_region', [...steps, { id: 'model-access', ok: false, detail: `the model is not enabled in ${v.region}` }], { warnings, session, sessionAction });
  }
  steps.push({ id: 'model-access', ok: true, detail: `the model is enabled in ${v.region}` });
  return build('success', steps, { warnings, session, sessionAction });
}

// An expired session is refreshed by assuming the role again at `now` (trust is evaluated afresh, so a refresh can fail where the first assume worked).
export function evaluateWithRefresh(input) {
  const first = evaluate(input);
  if (first.code !== 'session_expired') return first;
  const expiredStep = first.steps[0];
  const again = evaluate({ ...input, session: null });
  if (!again.ok) return { ...again, steps: [expiredStep, ...again.steps], afterExpiry: true };
  return build('session_refreshed', [expiredStep, ...again.steps], { warnings: again.warnings, session: again.session, sessionAction: 'refreshed', refreshedFrom: { expiredAt: first.session.expiresAt } });
}
