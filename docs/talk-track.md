# Talk track

<!-- The source for the Talk track view and the presenter mode. Written once with {{castBrand}}-style tokens; the three vertical packs
     (retail, health, finance) and customer.config.json fill them. A test fails on a token no pack defines. A heading that starts with
     "S01:" to "S13:" belongs to the story of the same number. Keep every section short enough to say in a minute. -->

## Before you start

You are about to show an LLM key that stores no cloud credential and still reaches Bedrock, by assuming an IAM role. Say first what is sourced and what is not. The claims taken from the 2026-11-21 release notes are these: a key can reach Bedrock under an assumed IAM role, no provider credential is stored on the key, metering, AI Guard and audit stay intact on the call, and the same route also works as a fallback target. Vertex service accounts are the sibling feature in the same release. Everything else on the screen is this lab's own model and is labelled UNVERIFIED.

The story is told for {{castBrand}}, an invented example. The verticals change the words, not the policies and not the numbers.

## What is simulated, and what is not

Everything is simulated: the gateway, the IAM evaluator that reads a small subset of trust and permission policies as data, a mock Bedrock, a mock Vertex AI and the lab clock. Nothing leaves this machine and no AWS or Google call is made. Real mode is not built; its toggle is disabled with the reason.

Say plainly that the lab does not know the console setup fields, the session length, the exact error texts, the order of the checks, which principal the gateway presents, or whether the gateway refreshes an expired session by itself. The Limits page lists each of these. Every id on screen is a placeholder: never paste a real role, account id or external ID into this lab.

Say also what the lab makes no claim about: whether a gateway's own rate-limit refusal can trigger a fallback. That is an open question, not an answer.

## S01: The role is assumed and the call is served

Run the first scenario: {{castApp}} calls with {{castKey}} for {{castTask}}. The key has no credential field. The gateway assumes the role, and the call path shows six hops, all done: key, AI Guard, provider authentication, Bedrock invoke, metering and audit.

Point at the key comparison above: a stored-credential key carries a masked secret, the assumed-role key carries nothing to protect or rotate.

## S02: The trust policy names someone else

The trust policy names a different principal than the one the gateway presents. The role is never assumed, so provider authentication fails and the invoke and metering hops are skipped. The audit hop still runs: a refusal leaves an entry.

The result has its own name, Wrong trust principal, and its own fix. Say that the wording is the lab's, not the cloud's.

## S03: The external ID does not match

The role trusts the gateway, but the trust policy requires one external ID and the key carries another. The comparison is exact and case-sensitive. The result is External ID mismatch.

## S04: The external ID was never set

Same role, same trust, but the key carries no external ID, and an empty one counts as none. The result is External ID missing, not a mismatch: the two have different fixes, and the lab keeps them apart.

## S05: The role cannot invoke the model

Here the role is assumed. The trace shows provider authentication done and the invoke failed, because the permission policy allows another Bedrock action. Compare it with S02: the failure sits one hop later, and {{castOwner}} fixes a different policy.

## S06: The model is not enabled in that region

The role may invoke the model, but the model is not enabled in the region for the account. The role was assumed and the session is kept; the invoke is refused. The fix is on the account side, not in either policy.

## S07: The session expires and is refreshed

The first call assumes the role and gets a session that lasts 3600000 ms on the lab clock. The clock then reaches the expiry exactly and the next call assumes the role again, so the result is session_refreshed and the expiry moves. Use the lab clock control to do this live. Say that the session length and whether the real gateway refreshes by itself are UNVERIFIED.

## S08: AI Guard still applies to this key

A prompt that carries the stub guard's marker is blocked before any role is assumed: no session, no invoke, no metering, and the block is audited. The point is that assuming a role changes how the gateway authenticates to Bedrock and nothing else. The guard here is a labelled stub and says nothing about any product's detection.

## S09: The key with no credential, next to the key with one

Open the two key objects side by side. The stored key has a credential entry that is only a mask; the value is write-only and never comes back. The assumed-role key has no credential entry at any depth, and the lab refuses to accept one by any name. Both keys are metered, guarded and audited in the same way.

## S10: The assumed-role key serves as a fallback

The primary answers 503 and the assumed-role key is the second target. It serves, still metered, guarded and audited. This is an illustration with two attempts: the fallback chain itself belongs to the fallback lab.

## S11: Vertex AI: the service account has the role

Switch to the Vertex tab. On Vertex the gateway uses its own service account: no role is assumed, there is no external ID and there is no session. A binding to a role that grants the predict permission lets the call through.

## S12: Vertex AI: the service account has no role

The policy binds a different service account, so the gateway's own has no permission. The result is Service account has no role, with its fix.

## S13: Vertex AI: a role that does not grant the call

The service account is bound, but only to a viewer role. The result is Role does not grant the call. By its name {{castOwner}} can tell no role from the wrong role.

## What this run left behind

Open the panel under the result. It lists, in time order, what the run left behind for observability: the guard decision, the role assumption, the invoke permission, the provider reply, the metering and the audit entry. Every row is tagged simulated: the lab's mock computed it, nothing was read from a product log. Where a layer has nothing the panel says so. The lab never claims that a product logged an event.

## Closing

Three things to leave with {{castBrand}}: a key can reach Bedrock under an assumed role and store no cloud credential; metering, AI Guard and audit still see the call; and each way the role can fail has its own name and its own fix. Everything beyond that is this lab's model, to be checked against a real tenant before anyone relies on it.
