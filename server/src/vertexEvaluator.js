// The Vertex tab's engine: the gateway uses its OWN service account (no role is assumed, no external ID, no session). A PURE function.
//   evaluateVertex({ policy, serviceAccount }) -> a named result.
// UNVERIFIED lab model: which role grants the call (the lab accepts two roles and no others) and the permission it needs.
// Service accounts are placeholders and must end in .example or .invalid, so a real address is refused rather than echoed back.
import { parseBindings, PolicyError } from './policy.js';

export const VERTEX_PERMISSION = 'aiplatform.endpoints.predict';
// role -> permissions it grants in the lab. Every role not listed grants nothing here.
export const ROLE_GRANTS = Object.freeze({
  'roles/aiplatform.user': Object.freeze([VERTEX_PERMISSION]),
  'roles/aiplatform.admin': Object.freeze([VERTEX_PERMISSION]),
  'roles/viewer': Object.freeze([]),
});
const SERVICE_ACCOUNT = /^[a-z][a-z0-9-]{3,28}[a-z0-9]@[a-z][a-z0-9-]{3,28}[a-z0-9](\.[a-z][a-z0-9-]*)*\.(example|invalid)$/;
export const SERVICE_ACCOUNT_FORMAT = SERVICE_ACCOUNT;

export const VERTEX_RESULTS = Object.freeze({
  success: { ok: true, stage: 'invoke', title: 'Service account may call Vertex AI', message: 'The gateway\'s service account holds a role that grants the permission the call needs.', fix: null },
  vertex_role_missing: { ok: false, stage: 'invoke-permission', title: 'Service account has no role', message: 'No binding in the policy names the gateway\'s service account, so it has no permission to call Vertex AI.', fix: 'Bind a role that grants aiplatform.endpoints.predict (for example roles/aiplatform.user) to the service account.' },
  vertex_role_insufficient: { ok: false, stage: 'invoke-permission', title: 'Role does not grant the call', message: 'The service account is bound to a role, but none of its roles grants the permission the call needs.', fix: 'Bind a role that grants aiplatform.endpoints.predict (for example roles/aiplatform.user).' },
  vertex_policy_invalid: { ok: false, stage: 'invoke-permission', title: 'Policy could not be read', message: 'The policy is missing, malformed, too large or uses something this lab does not read, so the call was not allowed.', fix: 'Send an IAM policy as JSON data with a bindings list.' },
  bad_input: { ok: false, stage: 'input', title: 'Input not valid', message: 'One of the inputs to the evaluator is not valid, so nothing was evaluated.', fix: 'Correct the named field.' },
});

const build = (code, extra = {}) => ({ ...VERTEX_RESULTS[code], code, labText: true, warnings: [], steps: [], ...extra });

export function evaluateVertex(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return build('bad_input', { field: 'input' });
  const sa = input.serviceAccount;
  if (typeof sa !== 'string' || sa.length > 256 || !SERVICE_ACCOUNT.test(sa)) return build('bad_input', { field: 'serviceAccount' });
  let bindings;
  try { bindings = parseBindings(input.policy); } catch (e) {
    const err = e instanceof PolicyError ? e : new PolicyError('policy_bad_value', 'the policy could not be read as plain JSON data');
    return build('vertex_policy_invalid', { steps: [{ id: 'policy', ok: false, detail: err.code }], policyError: { which: 'policy', code: err.code, message: err.message } });
  }
  const me = `serviceAccount:${sa}`;
  const warnings = [];
  const mine = bindings.filter((b) => b.members.some((m) => m === me || m === 'allUsers' || m === 'allAuthenticatedUsers'));
  if (mine.some((b) => b.members.includes('allUsers') || b.members.includes('allAuthenticatedUsers'))) {
    warnings.push({ code: 'wildcard_member', message: 'A binding uses allUsers or allAuthenticatedUsers, which matches every service account. (Lab advice, UNVERIFIED.)' });
  }
  if (mine.length === 0) return build('vertex_role_missing', { warnings, steps: [{ id: 'binding', ok: false, detail: 'no binding names the service account' }] });
  const granting = mine.filter((b) => (Object.hasOwn(ROLE_GRANTS, b.role) ? ROLE_GRANTS[b.role] : []).includes(VERTEX_PERMISSION));
  const roles = mine.map((b) => b.role);
  if (granting.length === 0) return build('vertex_role_insufficient', { warnings, roles, steps: [{ id: 'binding', ok: true, detail: 'the service account is bound' }, { id: 'role-grants-predict', ok: false, detail: `none of ${roles.join(', ')} grants ${VERTEX_PERMISSION}` }] });
  return build('success', { warnings, roles, steps: [{ id: 'binding', ok: true, detail: 'the service account is bound' }, { id: 'role-grants-predict', ok: true, detail: `${granting[0].role} grants ${VERTEX_PERMISSION}` }] });
}
