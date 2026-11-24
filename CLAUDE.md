# privilege-bedrock-assume-role-LAB

Demo-tier standalone lab, step 2 (engine, API and web UI). The repo exists (`curtismu7/privilege-bedrock-assume-role-LAB`); port **7838 is claimed provisionally** (not on the board, no shelf entry, no proxy route yet). Spec: `docs/spec.md`. Source of claims: the 2026-11-21 release notes only; everything else is UNVERIFIED (lab model) and the banner (`server/src/data.js`) says so. Never present anything here as a Ping, AWS or Google statement.

- Run `npm start`; test `npm test` (glob); preflight `npm run doctor`; reset `npm run reset`. Node 26. Tests go to the Air: `air-test . -- npm test`.
- Core: `iamEvaluator.js` (pure, total evaluator), `policy.js` + `glob.js` (policy as bounded data), `vertexEvaluator.js`, `keyModes.js` (two key modes), `callPath.js` (six hops, fallback-target export), `lab.js` (state), `scenarios.js` (data with hand-written expectations), `app.js` (one `ROUTES` table), `doctor.js` (one check per scenario), `netguard.js`, `safety.js`.
- Rules that bite: Mock only, zero outbound (netguard + test). `server/src/model-gateway-sim/` and `health.js` are vendored byte for byte, never edited (pin test + doctor). An assumed-role key has NO credential field, in any view, at any depth; a stored credential is `MOCK-` only, write-only, never returned or logged. Policy JSON is never evaluated as code (no eval, Function, vm; a static test scans). A bad policy is a named result, never a pass. Placeholder ids only (account ids in the test allowlist, `.example` hosts). The static scans skip `.github/` and the shared attribution script. No AI attribution in commits or files.
- Web (`web/`, React + Vite, built to `web/dist`, served by the server; tests need no build): pages Assumed role, Vertex AI, Diagram, Stories and talk track, Limits. Everything vendored from `shared/` (top-menu, floating-dialog, talk-track, diagram-kit, gateway-trace, run-observability, JsonPane, standalone-ui.css) is pinned by a test and never hand-edited: change the shared component first. Diagram data `server/diagrams/bedrock-assumed-role.json` is a byte copy from diagram-studio `origin/main` (the pin names the source commit).
- State is per workspace (`X-Workspace`, default `default`): the lab (key, policies, clock, audit log), the last run and the run log (`workspaces.js`, a bounded LRU map). Stories are data (`server/src/data/stories`, `{{cast}}` tokens, three packs in `data/verticals`), the talk track is `docs/talk-track.md`; a test fails on an undefined token. Content pack: `npm run content-pack` (a test fails on drift).
- Rule 27: `runObs.js` builds the run's events, one stdout line per decision and the record for the shared panel (all `simulated`); the lab reads no logs. Trace: `runTrace.js` (step 1 is the app's call with the six hops as decisions, then one step per call the gateway really made). `verdicts.js` names every result code once.
- Docker: `docker-compose.yml` publishes `127.0.0.1:7838` only, non-root, read-only, `restart: unless-stopped`; pinned by `scripts/compose.test.mjs`. `.dockerignore` must keep `docs/talk-track.md` (the image copies it): prove a Dockerfile change by building the image, not by a text test.
- Not built yet: Real mode, the shelf registry entry, proxy route, submodule pin and release (step 3, owner-gated), Story mode.

## Never-repeat lessons
- A worktree basename must be unique (air-test names its remote folder after it).
- `new URL('./x', import.meta.url)` in a server file the web tests import must go through a variable (Vite rewrites the literal).
- A missing `/assets` file is a 404, never `index.html`.
- Dockerfile COPY sources must not be excluded by `.dockerignore` (a compose test checks it; a real OrbStack build proves it).
- The first story/talk-track load sends no `vertical` (a default param must not turn undefined into `retail`), so the customer's vertical and cast words arrive.
- Reset, a mode switch and a vertical change clear the scenario from the address; a page runs a hash scenario only on a deliberate navigation (page open or `hashchange`; its own buttons use `replaceState`).
- A run that finishes after Reset, a mode switch or a vertical change is dropped (`gen` counter in `useLab`); the shared menu cannot disable Reset, so Reset says "a run is in progress" instead.
- The workspace-id pattern is the same on client and server, and the random fallback fills the array in place (`map()` on a typed array leaves it zero).
- Pressing the active Mock button changes nothing (no request, no reload).
- `npm run reset` takes a workspace id (argument or `WORKSPACE`) and clears that workspace only.
- Netguard allows literal IPs through the guarded `lookup` for an opted-in bind; connecting to them is still refused.
- Shortcut keys ignore modifiers, repeats and focused controls.
- Tests must pass with and without `web/dist` (`startLab` defaults `distDir` to a directory that does not exist; only the web-serving tests opt in).
- The role-service trace shows whether the key sent an external ID from the call itself (`externalIdSent`), never a fixed string.
- Static scans skip `.github/` and the shared attribution script.
- Before claiming a port check running containers and compose files (`docker ps`; the ap-* labs use 7839 to 7843), not only the registry.
- A box or button wrapper only handles keys when `e.target === e.currentTarget`; an interactive control is a real `<button>`, never a `role=button` wrapper around other controls.
- A vendored dialog must not show another lab's content: check every vendored dialog's text (the shared ReleaseNotes is another lab's; the version button opens `AboutDialog` instead, and a test fails on 'Token Workbench').
- The server says on every workspace route whether it just created the workspace (`X-Workspace-Fresh`); a tab that already used its id and gets `1` shows the "server forgot this workspace" banner, and its own Reset announces itself first (`expectForgetting`).
- Parsed talk-track sections are cached at load (missing file logged once); a paragraph starts only at a blank line.
- HEAD is allowed wherever GET is; the forbidden-strings CI job is skipped for fork pull requests (no secret there).
