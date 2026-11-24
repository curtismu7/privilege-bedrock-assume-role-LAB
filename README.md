# privilege-bedrock-assume-role-LAB

**Tier: Demo.** An LLM key that stores no cloud credential reaches Bedrock under an assumed IAM role. The lab shows the key's shape (no credential field versus a stored, masked one), a call whose trace still shows metering, an AI Guard step and an audit entry, and each way the role assumption fails, named with its fix: wrong trust principal, external ID mismatch or missing, missing invoke permission, model not enabled in the region, expired session (refreshed). A second tab models Vertex AI, where the gateway uses its own service account with or without the needed role.

**Status: step 1 of 3 (engine and server API).** No web page, Docker image, shelf entry, content pack or stories yet.

## What is simulated
Everything. A mock gateway, a mock IAM evaluator that reads a small subset of trust and permission policies as data, a mock Bedrock and Vertex AI, and a lab clock; no network, no AWS or Google call, nothing leaves the machine (a netguard enforces it). Only this is taken from the 2026-11-21 release notes: an LLM key can reach Bedrock under an assumed IAM role with no provider credential stored on the key and with metering, AI Guard and audit intact, and it also works as a fallback target; Vertex service accounts are the sibling feature. **Everything else is this lab's own model and UNVERIFIED** against the product: the console setup fields, the session length, every error text, the order of the checks (see `docs/spec.md`). Nothing here is verified against the real product or against AWS or Google Cloud.

All identifiers are placeholders (made-up account ids, names starting `example`, hosts ending `.example`). Never paste a real ARN, role, external ID or credential; a stored credential must be a `MOCK-` value.

## Run
```sh
npm install
npm start          # http://127.0.0.1:7838/api/info  (loopback only)
npm test           # node --test test/*.test.js (a glob)
npm run doctor     # one check per scenario, kit pin, netguard, an HTTP run of every scenario
npm run reset      # resets a running lab (default key and policies, empty ledger and audit log, no session, fresh clock)
```
Node 26. Heavy work on the Air: `air-test . -- npm test` (git add new files first).

## Port
**7838 is PROVISIONAL and NOT CLAIMED yet** (claim it with `npm run ports -- --next` in demo-shelf-LAB before shipping). Set `PORT` (7800-7999) to move it.

## Mock and Real
Mock only. `GET /api/info` reports `source: mock`, `realAvailable: false` with a plain reason; `POST /api/mode {"source":"real"}` answers 409. Real (owner-run, read-only, needs a tenant running the 2026-11-21 release and an AWS account the owner controls) is not built and comes after Mock.

## Scenarios
`GET /api/scenarios`; run one with `POST /api/scenario/:id`: success, wrong-trust-principal, external-id-mismatch, external-id-missing, missing-invoke-permission, model-not-enabled-in-region, expired-session-refreshed, guard-still-applies, stored-vs-assumed-key-shape, assumed-role-as-fallback-target, vertex-with-role, vertex-without-role, vertex-role-insufficient. Each carries a hand-written expected result.

## Fallback target
`serveAsFallbackTarget(key, ctx)` in `server/src/callPath.js` answers in a provider-shaped result, so the fallback lab can use an assumed-role key as a target. The two labs never import each other.

## Observability
Step 1 keeps an in-memory audit log (`GET /api/state`) of ids, outcomes and lab-clock times for every call, served or refused. It is the lab's own; this lab never claims a product wrote or streamed it. The "what this run left behind" panel is a later step.

## Vendored
`server/src/model-gateway-sim/` is copied byte for byte from `shared/model-gateway-sim` and pinned by `server/test/model-gateway-sim.sha256` (a test and a doctor check). `server/src/health.js` is the shared `shared/health` copy. Never hand-edit; change the kit first, then re-vendor and re-pin.
