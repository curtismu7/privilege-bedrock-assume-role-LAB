#!/usr/bin/env node
// Reset a running lab: default key and policies, empty ledger and audit log, no session, a fresh lab clock, no last run and an empty run log.
//   node scripts/reset.mjs [base-url] [workspace-id]      (default http://localhost:${PORT:-7838}; workspace-id or WORKSPACE, default "default")
// It clears ONE workspace (rule 13): the one named (sent as X-Workspace), else "default". The page's tabs each have their own workspace id, so to reset a tab's
// workspace pass its id (it is shown in GET /api/info as "workspace" when called with that header). Other workspaces are not touched.
// Loopback only: refuses any other host. Needs the server already running; sends the same-origin header the server requires.
import { pathToFileURL } from 'node:url';
import { isLoopbackHost } from '../server/src/safety.js';
import { validWorkspace } from '../server/src/workspaces.js';

export async function reset(base = `http://localhost:${process.env.PORT || 7838}`, workspace = process.env.WORKSPACE) {
  const u = new URL(base);
  if (!isLoopbackHost(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  if (workspace !== undefined && workspace !== '' && !validWorkspace(workspace)) throw new Error('workspace id must be 1 to 32 lowercase letters, digits and dashes, starting with a letter or digit');
  const headers = { 'content-type': 'application/json', origin: u.origin, ...(workspace ? { 'x-workspace': workspace } : {}) };
  const r = await fetch(new URL('/api/reset', u), { method: 'POST', headers, body: '{}' });
  if (!r.ok) throw new Error(`reset failed: HTTP ${r.status}`);
  return r.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reset(process.argv[2], process.argv[3]).then((j) => console.log(`reset: ${j.reset} (workspace ${j.workspace})`), (e) => { console.error(e.message); process.exit(1); });
}
