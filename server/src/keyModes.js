// An LLM key in two modes. Built on the kit's createLlmKey (ledger + Usage counter); the kit itself is vendored and never edited.
//   stored-credential: the key holds a credential. The value is WRITE-ONLY: it goes into a module-private WeakMap, never onto the key object,
//                      never into a view, an audit entry, a result or a log. A view shows only a fixed mask.
//   assumed-role:      the key holds NO credential field at all (not even an empty one). It names a role and an optional external ID;
//                      the gateway assumes the role at call time and keeps only session metadata (when it was assumed, when it expires).
// The lab never stores a real credential: a stored value must start with MOCK-, and anything else is refused without being echoed.
import { createProvider } from './model-gateway-sim/providerStub.js';
import { createLlmKey } from './model-gateway-sim/llmKey.js';
import { refuse } from './errors.js';
import { FORMATS } from './iamEvaluator.js';
import { LARGE_MODEL, DEFAULT_REGION, ROLE_ARN } from './data.js';

export const KEY_MODES = Object.freeze(['stored-credential', 'assumed-role']);
export const KEY_LIMITS = Object.freeze({ maxBudgetTokens: 1_000_000, defaultBudgetTokens: 2000, latencyMs: 400, replyTokens: 120, timeoutMs: 3000 });
export const MASK = '********';
const MOCK_CREDENTIAL = /^MOCK-[A-Za-z0-9_-]{4,64}$/;
const ROLE_ARN_FORMAT = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]{1,128}$/;

// key -> { credential?, externalId? }. Private to this module: nothing exports the values.
const secrets = new WeakMap();

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (obj, allowed) => { for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw refuse('unknown_field', 'the key config has a field this lab does not accept'); };

// spec: { mode, modelId?, region?, budgetTokens?, roleArn?, externalId?, credential?, id? }. Throws InputError (a 4xx) on anything invalid.
export function createKeyObject(spec, clock, { providerState = 'healthy' } = {}) {
  if (!isPlain(spec)) throw refuse('bad_body', 'the key config must be a JSON object');
  if (!KEY_MODES.includes(spec.mode)) throw refuse('bad_mode', `mode must be one of: ${KEY_MODES.join(', ')}`);
  if (spec.mode === 'assumed-role') {
    if (Object.hasOwn(spec, 'credential')) throw refuse('credential_not_allowed', 'an assumed-role key stores no credential: there is no credential field to set');
    only(spec, ['id', 'mode', 'modelId', 'region', 'budgetTokens', 'roleArn', 'externalId']);
  } else {
    if (Object.hasOwn(spec, 'roleArn') || Object.hasOwn(spec, 'externalId')) throw refuse('role_not_allowed', 'a stored-credential key assumes no role: there is no role or external ID to set');
    only(spec, ['id', 'mode', 'modelId', 'region', 'budgetTokens', 'credential']);
  }
  const id = spec.id === undefined ? 'key-1' : spec.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw refuse('bad_key_id', 'id must be 1 to 64 letters, digits, dots, dashes or underscores');
  const modelId = spec.modelId === undefined ? LARGE_MODEL : spec.modelId;
  if (typeof modelId !== 'string' || !FORMATS.MODEL.test(modelId)) throw refuse('bad_model', 'modelId must be 1 to 128 letters, digits, dots, colons, dashes or underscores');
  const region = spec.region === undefined ? DEFAULT_REGION : spec.region;
  if (typeof region !== 'string' || region.length > 32 || !FORMATS.REGION.test(region)) throw refuse('bad_region', 'region must look like us-east-1');
  const budgetTokens = spec.budgetTokens === undefined ? KEY_LIMITS.defaultBudgetTokens : spec.budgetTokens;
  if (!Number.isInteger(budgetTokens) || budgetTokens < 0 || budgetTokens > KEY_LIMITS.maxBudgetTokens) throw refuse('bad_budget', `budgetTokens must be a whole number from 0 to ${KEY_LIMITS.maxBudgetTokens}`);

  const key = {
    id, mode: spec.mode, modelId, region,
    llm: createLlmKey({ id, budgetTokens }),
    stub: createProvider({ id: spec.mode === 'assumed-role' ? 'bedrock-assumed-role' : 'bedrock-stored-credential', model: modelId, latencyMs: KEY_LIMITS.latencyMs, timeoutMs: KEY_LIMITS.timeoutMs, replyTokens: KEY_LIMITS.replyTokens }, clock),
  };
  key.stub.setState(providerState);
  const priv = {};
  if (spec.mode === 'assumed-role') {
    const roleArn = spec.roleArn === undefined ? ROLE_ARN : spec.roleArn;
    if (typeof roleArn !== 'string' || roleArn.length > 256 || !ROLE_ARN_FORMAT.test(roleArn)) throw refuse('bad_role_arn', 'roleArn must look like arn:aws:iam::<12 digits>:role/<name>');
    key.roleArn = roleArn;
    key.session = null; // { assumedAt, expiresAt } only: session metadata, never a credential
    if (spec.externalId !== undefined && spec.externalId !== null && spec.externalId !== '') {
      if (typeof spec.externalId !== 'string' || !FORMATS.EXTERNAL_ID.test(spec.externalId)) throw refuse('bad_external_id', 'externalId must be 1 to 128 letters, digits or + = , . @ : / - _');
      priv.externalId = spec.externalId;
    }
  } else {
    if (typeof spec.credential !== 'string' || !MOCK_CREDENTIAL.test(spec.credential)) throw refuse('credential_not_mock', 'a stored credential in this lab must be a MOCK- placeholder (MOCK- plus 4 to 64 letters, digits, dashes or underscores); never paste a real one');
    priv.credential = spec.credential;
  }
  secrets.set(key, priv);
  return key;
}

// Rotate the stored credential (write-only). An assumed-role key has none to rotate.
export function setCredential(key, value) {
  if (key.mode !== 'stored-credential') throw refuse('credential_not_allowed', 'an assumed-role key stores no credential: there is no credential field to set');
  if (typeof value !== 'string' || !MOCK_CREDENTIAL.test(value)) throw refuse('credential_not_mock', 'a stored credential in this lab must be a MOCK- placeholder; never paste a real one');
  secrets.get(key).credential = value;
}

// Booleans only: the call path asks whether a credential is held, never what it is.
export const hasStoredCredential = (key) => typeof secrets.get(key)?.credential === 'string';
export const hasExternalId = (key) => typeof secrets.get(key)?.externalId === 'string';
// The one read of the external ID: for the evaluator. It is not returned by any view.
export const externalIdFor = (key) => secrets.get(key)?.externalId ?? null;

// What a page or API response may show. Stored mode: a `credential` entry with a fixed mask. Assumed-role mode: no credential entry at all.
export function keyView(key) {
  const ledger = key.llm.ledger;
  const base = {
    id: key.id, mode: key.mode, modelId: key.modelId, region: key.region,
    budget: { limit: ledger.limit, spent: ledger.spent(), remaining: ledger.remaining() },
    usage: key.llm.usage.snapshot(),
  };
  if (key.mode === 'assumed-role') return { ...base, roleArn: key.roleArn, externalIdSet: hasExternalId(key), session: key.session ? { ...key.session } : null };
  return { ...base, credential: { stored: hasStoredCredential(key), masked: MASK } };
}
