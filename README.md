# privilege-bedrock-assume-role-LAB

**Tier: Demo.** An LLM key that stores no cloud credential reaches Bedrock under an assumed IAM role. The lab shows the key's shape (no credential field versus a stored, masked one), a call whose trace still shows metering, an AI Guard step and an audit entry, and each way the role assumption fails, named with its fix: wrong trust principal, external ID mismatch or missing, missing invoke permission, model not enabled in the region, expired session (refreshed). A second tab models Vertex AI, where the gateway uses its own service account with or without the needed role.

**Status: step 2 of 3 (web UI, Vertex tab, presenter mode, talk track, content pack, Docker).** The repo exists (`curtismu7/privilege-bedrock-assume-role-LAB`) and port 7838 is claimed provisionally (it is not on the board). Step 3 (shelf registry entry, proxy route, submodule pin, release) is the owner's integration step and is not done here.

## What is simulated
Everything. A mock gateway, a mock IAM evaluator that reads a small subset of trust and permission policies as data, a mock Bedrock and Vertex AI, and a lab clock; no network, no AWS or Google call, nothing leaves the machine (a netguard enforces it). Only this is taken from the 2026-11-21 release notes: an LLM key can reach Bedrock under an assumed IAM role with no provider credential stored on the key and with metering, AI Guard and audit intact, and it also works as a fallback target; Vertex service accounts are the sibling feature. **Everything else is this lab's own model and UNVERIFIED** against the product: the console setup fields, the session length, every error text, the order of the checks (see `docs/spec.md` and the Limits page). Nothing here is verified against the real product or against AWS or Google Cloud. The banner on every page, presenter mode included, says so.

All identifiers are placeholders (made-up account ids, names starting `example`, hosts ending `.example`). Never paste a real ARN, role, external ID or credential; a stored credential must be a `MOCK-` value.

## Run
```sh
npm ci
npm run build      # builds web/dist, which the server serves
npm start          # http://127.0.0.1:7838/  (loopback only; the API is under /api)
npm test           # server (node --test test/*.test.js), web (vitest), scripts (node --test scripts/*.test.mjs)
npm run doctor     # one check per scenario, kit pin, stories and diagram, netguard, an HTTP run of every scenario
npm run reset      # resets ONE workspace of a running lab (default key and policies, empty ledger and audit log, no session, fresh clock, no last run); `npm run reset -- http://localhost:7838 <workspace-id>` or WORKSPACE=<id>; default workspace "default"
./scripts/run.sh   # install if needed, build if needed, doctor, start
```
Docker (OrbStack): `HOST_PORT=7838 docker compose up --build -d`, published on `127.0.0.1` only, non-root, read-only file system, `restart: unless-stopped`, healthcheck on `/api/health`. Branding: the root file system is read-only, so `customer.config.json` is mounted, not written: copy `customer.config.example.json` to `customer.config.json`, uncomment the `volumes` block in `docker-compose.yml` and set `CUSTOMER_CONFIG=/config/customer.config.json`. Without it the lab runs with its defaults.
Node 26. Heavy work on the Air: `air-test . -- npm test` (git add new files first). The tests need no web build.

## Pages
- **Assumed role**: the thirteen scenarios as buttons; the key shown two ways side by side (a stored-credential key with a masked credential, an assumed-role key with no credential field at all) and a form for the live key; the trust and permission policies as editable JSON data with the server's size limit shown, and Evaluate (the pure evaluator: the named result, its fix and what was checked); a call with a prompt, the state of the mock Bedrock and a lab-clock control that moves the session to its expiry; copy-paste IAM snippets with placeholder ids; then the result: the verdict first (the named result and its fix), the six hops of the call (key, ai-guard, provider-auth, bedrock-invoke, metering, audit), the key's budget, the trace of every call the gateway made (shared `GatewayTrace`), the audit log and what the run left behind (below).
- **Vertex AI**: the gateway's own service account (no role assumed, no external ID, no session): the three Vertex scenarios, an editable IAM bindings policy and Evaluate.
- **Diagram**: `bedrock-assumed-role`, loaded by name from diagram-studio data: movable boxes, Simulate, Prev/Next, speed, and Reset (also restores the box positions).
- **Stories and talk track**: thirteen stories as data with `{{cast}}` tokens and three vertical packs (retail, health, finance), filled for the vertical picked in the header; each opens its scenario. The talk track is `docs/talk-track.md`, one source for the page, the header dialog and presenter mode (`P`).
- **Limits (UNVERIFIED)**: exactly what the release notes say and what is the lab's own model (console fields, session length, error texts, check order, refresh behaviour).

## Port
**7838 is PROVISIONAL and NOT CLAIMED on the board yet** (claim it with `npm run ports -- --next` in demo-shelf-LAB before shipping). Set `PORT` (7800-7999) to move it.

## Mock and Real
Mock only. The header toggle shows Mock pressed and Real disabled with the server's reason. `GET /api/info` reports `source: mock`, `realAvailable: false` with a plain reason; `POST /api/mode {"source":"real"}` answers 409. Real (owner-run, read-only, needs a tenant running the 2026-11-21 release and an AWS account the owner controls) is not built and comes after Mock.

## Workspaces and branding
Each browser tab sends `X-Workspace` (default `default`); the key, the policies, the lab clock, the audit log, the last run and the run log are per workspace (at most 20 besides the default one; the least recently used is forgotten, never a refusal), and Reset clears one. `customer.config.json` (git-ignored; see `customer.config.example.json`) sets the lab's name, tagline, vertical and the five cast words; a bad field falls back to its default with a warning.

## Scenarios
`GET /api/scenarios`; run one with `POST /api/scenario/:id`: success, wrong-trust-principal, external-id-mismatch, external-id-missing, missing-invoke-permission, model-not-enabled-in-region, expired-session-refreshed, guard-still-applies, stored-vs-assumed-key-shape, assumed-role-as-fallback-target, vertex-with-role, vertex-without-role, vertex-role-insufficient. Each carries a hand-written expected result, and the UI shows whether the run equals it.

## Fallback target
`serveAsFallbackTarget(key, ctx)` in `server/src/callPath.js` answers in a provider-shaped result, so the fallback lab can use an assumed-role key as a target; the scenario `assumed-role-as-fallback-target` illustrates it with two attempts. The two labs never import each other.

## Observability (rule 27)
Every call and every scenario leaves two things. **On the lab's standard output (`docker logs`)** one line per decision: `<iso time> privilege-bedrock-assume-role-lab decision step=<step> actor=<actor> result=passed|stopped|unclear run=<id>`, never a prompt, an external ID or a credential. **In the page**, under the result, the shared "what this run left behind" panel lists the same decisions in time order across the six layers; every row is tagged **simulated** (the lab's mock computed it) and a layer with nothing says **not logged** (Person and Agent gateway have nothing here). Agent is the calling app, Authorize holds the lab's mock IAM decisions (assume role, invoke permission, the Vertex binding), Privilege is the lab's model of the gateway (the guard, metering and the audit entry), Resource server is the mock Bedrock. The lab reads no log, so it claims nothing about what any product logged; whether and where the real gateway logs an assumed-role call is UNVERIFIED. Where such logs could stream (a log collector to a SIEM) is named in the panel's "where these logs live" block. Time is when the lab computed it: the run's start plus the time the calls took on the lab clock (idle time the clock was advanced by is not added). The lab's own audit log (`GET /api/state`, shown on the page) holds ids, outcomes and lab-clock times for every call, served or refused.

## Vendored
`server/src/model-gateway-sim/` is copied byte for byte from `shared/model-gateway-sim` and pinned by `server/test/model-gateway-sim.sha256`. `server/src/health.js`, `gatewayTrace.js`, `runObservability.js`, `web/src/{top-menu,floating-dialog,diagram-kit,gateway-trace,run-observability,talk-track}/`, `web/src/components/JsonPane.*` and `web/src/standalone-ui.css` are copies of the family's shared components, each pinned by a test. Never hand-edit; change the shared component first, then re-vendor and re-pin. The diagram data `server/diagrams/bedrock-assumed-role.json` is a byte copy of the diagram-studio data (diagram-studio-LAB `origin/main`, PR #35 merged), pinned by `server/diagrams/diagrams.sha256`, which names the source commit.
