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

// Two namespaces that share code names (success, bad_input) but say different things: the Bedrock one (evaluator results and the codes the call path adds around
// them) and the Vertex one (no role is assumed there). They are never merged.
const BEDROCK = Object.freeze({ ...RESULTS, ...CALL_EXTRA });
const NAMESPACES = Object.freeze({ bedrock: BEDROCK, vertex: Object.freeze({ ...VERTEX_RESULTS }) });

// -> { code, ok, stage, title, message, fix, labText: true }. `kind` is 'bedrock' (default: a call or a Bedrock evaluation) or 'vertex'. An unknown code is named, never blank.
export function verdictFor(code, kind = 'bedrock') {
  const table = Object.hasOwn(NAMESPACES, kind) ? NAMESPACES[kind] : BEDROCK;
  const known = Object.hasOwn(table, code);
  const v = known ? table[code] : { ok: false, stage: 'unknown', title: 'Unknown result', message: 'The lab returned a result it has no wording for.', fix: null };
  return { code: known ? code : 'unknown', ...v, labText: true };
}
