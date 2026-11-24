// One in-memory lab: a lab clock, one LLM key, the AWS side (trust + permission policy as the user wrote them), and an audit log.
// Scenarios build their own throwaway lab and never touch the live one.
import { createClock } from './model-gateway-sim/labClock.js';
import { createKeyObject, keyView } from './keyModes.js';
import { callThroughKey, createAuditLog } from './callPath.js';
import { DEFAULT_AWS, EXTERNAL_ID, GATEWAY_PRINCIPAL, LARGE_MODEL, DEFAULT_REGION, ROLE_ARN } from './data.js';

export const DEFAULT_KEY_SPEC = () => ({ mode: 'assumed-role', modelId: LARGE_MODEL, region: DEFAULT_REGION, roleArn: ROLE_ARN, externalId: EXTERNAL_ID, budgetTokens: 2000 });

export function createLab({ key = DEFAULT_KEY_SPEC(), aws = DEFAULT_AWS() } = {}) {
  let clock = createClock(0);
  let current = createKeyObject(key, clock);
  let policies = aws;
  let audit = createAuditLog();
  return {
    clock: () => clock,
    key: () => current,
    aws: () => policies,
    audit: () => audit,
    // A new key has a new ledger, a new Usage counter and NO session; the clock and the audit log are kept.
    setKey(spec) { current = createKeyObject(spec, clock); },
    // Changing the policies keeps a session already held (as the evaluator models it), so the effect shows after expiry.
    setAws(next) { policies = next; },
    advance(ms) { clock.advance(ms); },
    call(prompt, opts = {}) { return callThroughKey(current, { prompt, clock, aws: policies, audit, gatewayPrincipal: GATEWAY_PRINCIPAL, ...opts }); },
    view() { return { key: keyView(current), aws: policies, clockMs: clock.now(), audit: audit.list().slice(-50), auditSize: audit.size() }; },
    reset() { clock = createClock(0); current = createKeyObject(DEFAULT_KEY_SPEC(), clock); policies = DEFAULT_AWS(); audit = createAuditLog(); },
  };
}
