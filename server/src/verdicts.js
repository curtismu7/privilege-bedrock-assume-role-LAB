// The named verdict for any code a call or an evaluation can end in: title, message, fix. The evaluators' own results (iamEvaluator.js,
// vertexEvaluator.js) are the source for their codes; the codes the call path adds around them (guard, budget, the mock Bedrock failing) are listed here.
// All wording is the lab's own (labText: true) and UNVERIFIED against the product.
import { RESULTS } from './iamEvaluator.js';
import { VERTEX_RESULTS } from './vertexEvaluator.js';

const CALL_EXTRA = Object.freeze({
  guard_blocked: { ok: false, stage: 'ai-guard', title: 'Blocked by the AI Guard stub', message: 'The lab\'s stub guard blocked the prompt before any role was assumed. Assuming a role does not route around the guard.', fix: 'Change the prompt (the stub blocks one marker string).' },
  out_of_budget: { ok: false, stage: 'metering', title: 'Key out of budget', message: 'The key\'s own budget cannot cover this call, so nothing was sent to Bedrock.', fix: 'Raise the key\'s budget or reset the lab.' },
  budget_exceeded_after_call: { ok: false, stage: 'metering', title: 'Budget exceeded after the call', message: 'The model answered but the key\'s budget could not be charged for it.', fix: 'Raise the key\'s budget.' },
  provider_unavailable: { ok: false, stage: 'bedrock-invoke', title: 'Bedrock unavailable (503)', message: 'The mock Bedrock answered 503. The role was assumed; the failure is the provider\'s.', fix: 'Retry later, or name a fallback target.' },
  provider_overloaded: { ok: false, stage: 'bedrock-invoke', title: 'Bedrock overloaded (429)', message: 'The mock Bedrock answered 429 (a provider-origin refusal, not the gateway\'s).', fix: 'Retry later, or name a fallback target.' },
  provider_timeout: { ok: false, stage: 'bedrock-invoke', title: 'Bedrock timed out (504)', message: 'The mock Bedrock did not answer inside the key\'s timeout.', fix: 'Retry, or name a fallback target.' },
});

const ALL = Object.freeze({ ...VERTEX_RESULTS, ...RESULTS, ...CALL_EXTRA });

// -> { code, ok, stage, title, message, fix, labText: true }. An unknown code is named, never blank.
export function verdictFor(code) {
  const v = Object.hasOwn(ALL, code) ? ALL[code] : { ok: false, stage: 'unknown', title: 'Unknown result', message: 'The lab returned a result it has no wording for.', fix: null };
  return { code: Object.hasOwn(ALL, code) ? code : 'unknown', ...v, labText: true };
}
