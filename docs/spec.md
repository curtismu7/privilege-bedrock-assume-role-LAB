# privilege-bedrock-assume-role-LAB spec

**Status:** step 1 (engine and server API) built; web, Docker, shelf entry, content pack and stories are later steps. **Owner:** Curtis Muir (decides). **Tier:** Demo (Tier 2: colleagues will present it). Source: the 2026-11-21 vendor release notes, the only source. Everything else is **UNVERIFIED (model)** and the lab says so. Parent spec: `docs/specs/2026-11-24-model-gateway-labs.md` in AI-DEMO-Standalone, "Lab 4".

## Goal
Show an LLM key that stores no cloud credential reaching Bedrock under an assumed IAM role, with metering, AI Guard and audit still seeing the call, and each way the assumption can fail named with its fix; plus a Vertex AI tab where the gateway uses its own service account.

## What the release notes say (the only sourced claims)
An LLM key can reach Bedrock under an assumed IAM role: no provider credential stored on the key; metering, AI Guard and audit intact; it also works as a fallback target. Vertex service accounts are the sibling feature in the same release bullet. Nothing else is claimed.

## Model (the lab's own, UNVERIFIED)
- **Evaluator** (`iamEvaluator.js`), a pure, total function of (trust policy, caller principal, external ID, permission policy, model, region, now on the lab clock, session): checks trust (an Allow names the caller; a Deny wins), then the external ID (exact, case-sensitive; an empty one counts as none), then the session (a held session is reused until `now >= expiresAt`; the trust policy is not consulted while it is valid), then invoke permission (`bedrock:InvokeModel` on `arn:aws:bedrock:<region>::foundation-model/<model>`; a Deny wins), then model access in the region (the lab's catalog). A new session lasts 3600000 ms. `evaluateWithRefresh` re-assumes an expired session at `now`, evaluating trust afresh.
- **Results** are named: `success`, `session_refreshed`, `trust_principal_mismatch`, `trust_explicit_deny`, `external_id_missing`, `external_id_mismatch`, `trust_policy_invalid`, `session_expired`, `permission_missing_invoke`, `permission_explicit_deny`, `permission_policy_invalid`, `model_not_enabled_in_region`, `bad_input`. Each carries a stage, a title, a message, a fix and the steps checked. The texts are the lab's wording (`labText: true`).
- **Policy JSON is data only** (`policy.js`): `JSON.parse` or a plain object, never `eval`, `Function` or `vm`; at most 10000 characters, depth 8, 600 values, 20 statements, 512-character strings; iterative walkers; `__proto__`, `constructor` and `prototype` keys refused; a small subset of IAM is read and anything else (`NotPrincipal`, `NotAction`, other principals, other conditions) is refused as unsupported, never ignored. Wildcard principals (`*`, `{AWS:"*"}`, `*` inside an ARN, an account root) match as documented and raise a `wildcard_principal` warning. Glob matching is `*`-only with no regex (`glob.js`).
- **Keys** (`keyModes.js`) on the kit's `createLlmKey`: `stored-credential` holds a write-only `MOCK-` placeholder (a module-private store; the view shows a fixed mask); `assumed-role` has no credential field at all and refuses one by any name.
- **Call path** (`callPath.js`): always six hops, `key, ai-guard, provider-auth, bedrock-invoke, metering, audit`, each done, failed or skipped. The guard is a labelled stub (blocks one marker string) and runs before the role is assumed. Metering is the kit ledger and Usage counter. Every call, served or refused, writes an audit entry (ids, outcome, time; never the prompt, external ID or a credential). `serveAsFallbackTarget` returns a provider-shaped result for the fallback lab.
- **Vertex** (`vertexEvaluator.js`): the gateway's own service account (a `.example` placeholder) needs a binding to a role that grants `aiplatform.endpoints.predict` (the lab grants it to `roles/aiplatform.user` and `roles/aiplatform.admin`). Results: `success`, `vertex_role_missing`, `vertex_role_insufficient`, `vertex_policy_invalid`.

## API (`/api`, loopback only, Host check 421, same-origin writes 403)
`GET /health` (demo-health/1), `GET /info`, `GET|POST /mode` (Real is 409 with a reason), `GET /state`, `POST /call` (`{prompt, advanceMs?, key?, aws?, providerState?}`; a new `key` has a fresh ledger and no session), `POST /evaluate` (`{trust, permission, callerPrincipal?, externalId?, modelId?, region?, now?, session?, sessionMs?, refresh?}` or `{target:"vertex", policy, serviceAccount?}`; never touches the live lab), `GET /scenarios`, `POST /scenario/:id`, `POST /reset`. A refusal is a named result with HTTP 200 (the product's real status is UNVERIFIED); a bad field is a 400.

## Acceptance (each is a test and, for scenarios, a `npm run doctor` check)
1. `success`: six hops all done; usage 1, 128 tokens spent, one audit entry, session expiring at 3600000 ms.
2. `wrong-trust-principal`, `external-id-mismatch`, `external-id-missing`: not assumed; provider-auth failed, invoke and metering skipped; audit written; nothing charged.
3. `missing-invoke-permission`, `model-not-enabled-in-region`: role assumed (session kept), invoke failed.
4. `expired-session-refreshed`: the clock reaches the expiry exactly; the next call is `session_refreshed` on a new session.
5. `guard-still-applies`: the stub guard blocks an assumed-role call before any role is assumed; the block is audited.
6. `stored-vs-assumed-key-shape`: stored view has a masked `credential`; assumed-role has no credential-like key at any depth; the stored value never appears in any output or log.
7. `assumed-role-as-fallback-target`: primary down (503), the assumed-role key serves as second attempt.
8. `vertex-with-role`, `vertex-without-role`, `vertex-role-insufficient`.
9. A table of at least 25 evaluator cases; mutation checks on each core rule.

## Unhappy paths (each has a test)
Malformed, oversized, deeply nested, wide or prototype-keyed policy: a named error, never a pass, never evaluated. Wildcard principals. Empty or missing external ID where one is required. Prompt empty, over 20000 characters or not a string. Unknown field (so no credential field can be sent); credential in assumed-role mode; non-`MOCK-` credential; real-looking Vertex address. Bad JSON 400, body over 256 KB 413, wrong method 405, unknown route 404, bad Host 421, cross-origin write 403, `real` mode 409. Messages never echo the caller's text.

## UNVERIFIED (model)
The console setup fields, the session length, every error and fix text, the order of the checks, the principal the gateway presents, the IAM action and Vertex permission needed, how much of IAM is evaluated, the guard step, whether a refused call is audited, whether an expired session refreshes by itself, the Vertex role model.

## Out of scope
Any AWS or Google call; creating roles (Real mode, if ever built, is owner-run and read-only); streaming; the web page; Docker; shelf entry; content pack; stories. Identity-side permissions, SCPs and permission boundaries are not modelled. Whether a gateway rate-limit refusal triggers fallback is not modelled (owner decision 2026-11-24).
