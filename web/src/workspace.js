// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call
// that touches server state. Storage can be blocked, so a failure falls back to a per-load id.
const KEY = "pba.workspace";
// The server's own pattern (server/src/workspaces.js): an id the server would refuse is never sent, and a stored one that does not match is replaced.
export const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
let memo = null;

// Fills the array IN PLACE (a typed array's map() returns a new array and would leave this one zero, so every tab would share one id).
export function fillRandom(bytes, cryptoImpl) {
  if (cryptoImpl && typeof cryptoImpl.getRandomValues === "function") return cryptoImpl.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function workspaceId() {
  if (memo) return memo;
  try { const saved = window.sessionStorage.getItem(KEY); if (saved && WORKSPACE_ID.test(saved)) return (memo = saved); } catch { /* blocked */ }
  const bytes = fillRandom(new Uint8Array(8), window.crypto);
  memo = `w-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

// FORGOTTEN WORKSPACE. A tab that has already used its workspace id says so on every request it sends (X-Workspace-Seen: 1, decided when the request is SENT). If the
// server then has to create the workspace for such a request (it was evicted at the cap, or the server restarted) it answers X-Workspace-Forgotten: 1, once: the lab is
// back at its defaults. That is announced as an event the app turns into a plain banner. The decision never depends on the order responses arrive in: the first
// requests of a brand-new tab all go out before any answer is back, so none of them says "seen". The visitor's own Reset is not "forgotten" (the server starts the
// workspace again as part of the Reset). The headers are read on every status, a 400 included.
const USED = "pba.workspace.used";
export const WORKSPACE_FORGOTTEN = "workspace:forgotten";
let usedMemo = false;
const used = () => { try { return window.sessionStorage.getItem(USED) === "1" || usedMemo; } catch { return usedMemo; } };
const markUsed = () => { usedMemo = true; try { window.sessionStorage.setItem(USED, "1"); } catch { /* blocked: the in-memory flag stands */ } };
// fresh: the X-Workspace-Fresh value (null on a route with no workspace); forgotten: the X-Workspace-Forgotten value.
export function noteWorkspaceHeaders(fresh, forgotten) {
  if (fresh === null || fresh === undefined) return;
  if (forgotten === "1") window.dispatchEvent(new Event(WORKSPACE_FORGOTTEN));
  markUsed();
}

export async function workspaceFetch(url, opts = {}) {
  const seen = used() ? { "x-workspace-seen": "1" } : {};
  const r = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), ...seen, "x-workspace": workspaceId() } });
  noteWorkspaceHeaders(r.headers?.get?.("x-workspace-fresh") ?? null, r.headers?.get?.("x-workspace-forgotten") ?? null);
  return r;
}

// For tests: a new tab starts with a new id.
export function forgetWorkspace() { memo = null; usedMemo = false; try { window.sessionStorage.removeItem(KEY); window.sessionStorage.removeItem(USED); } catch { /* blocked */ } }
