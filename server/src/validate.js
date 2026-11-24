// Bounds and validation for what a caller sends to the API. Fixed messages, never an echo of the caller's text.
// Policy JSON itself is NOT judged here: a bad policy is a named evaluator result (never a pass), so it is read by policy.js.
// The key has no credential field in assumed-role mode: createKeyObject refuses one, and any field not listed is refused as unknown.
import { PROVIDER_STATES, MAX_PROMPT_CHARS } from './model-gateway-sim/providerStub.js';
import { POLICY_LIMITS } from './policy.js';
import { SESSION_LIMITS } from './iamEvaluator.js';
import { KEY_LIMITS } from './keyModes.js';
import { refuse } from './errors.js';

export const LIMITS = Object.freeze({
  maxPromptChars: MAX_PROMPT_CHARS,
  maxAdvanceMs: 100_000_000,
  policy: POLICY_LIMITS,
  session: SESSION_LIMITS,
  key: KEY_LIMITS,
});

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function onlyKeys(obj, allowed, what) {
  if (!isPlain(obj)) throw refuse('bad_body', `${what} must be a JSON object`);
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw refuse('unknown_field', `${what} has a field this lab does not accept`);
}

export function validatePrompt(prompt) {
  if (typeof prompt !== 'string') throw refuse('bad_prompt', 'prompt must be a string');
  if (prompt.length > LIMITS.maxPromptChars) throw refuse('prompt_too_long', `prompt is over ${LIMITS.maxPromptChars} characters`);
  if (!prompt.trim()) throw refuse('empty_prompt', 'prompt must not be empty');
  return prompt;
}

export function validateAdvance(ms) {
  if (ms === undefined) return 0;
  if (!Number.isInteger(ms) || ms < 0 || ms > LIMITS.maxAdvanceMs) throw refuse('bad_advance', `advanceMs must be a whole number from 0 to ${LIMITS.maxAdvanceMs}`);
  return ms;
}

export function validateProviderState(state) {
  if (state === undefined) return undefined;
  if (typeof state !== 'string' || !PROVIDER_STATES.includes(state)) throw refuse('unknown_provider_state', `providerState must be one of: ${PROVIDER_STATES.join(', ')}`);
  return state;
}

// The AWS side of a call: { trust?, permission? }. Each is whatever the caller wrote (text or object); the evaluator names what is wrong with it.
export function validateAws(aws) {
  onlyKeys(aws, ['trust', 'permission'], 'the aws block');
  return aws;
}
