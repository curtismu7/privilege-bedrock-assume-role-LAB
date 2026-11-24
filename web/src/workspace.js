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

// The server says on every workspace route whether THIS request created the workspace (X-Workspace-Fresh: 1) or not (0). A tab that has already used its id and
// gets a 1 was forgotten (evicted at the cap, reset by someone else, or the server restarted): its lab is back at its defaults. That is announced once, as an event
// the app turns into a plain banner. The visitor's own Reset also makes the next request fresh, so Reset says so first (expectFresh).
const USED = "pba.workspace.used";
export const WORKSPACE_FORGOTTEN = "workspace:forgotten";
let expectFresh = false;
const used = () => { try { return window.sessionStorage.getItem(USED) === "1"; } catch { return usedMemo; } };
let usedMemo = false;
const markUsed = () => { usedMemo = true; try { window.sessionStorage.setItem(USED, "1"); } catch { /* blocked: the in-memory flag stands */ } };
export const expectForgetting = () => { expectFresh = true; };
export function noteFresh(header) {
  if (header === null || header === undefined) return; // a route with no workspace
  if (header === "1") {
    if (expectFresh) expectFresh = false;
    else if (used()) window.dispatchEvent(new Event(WORKSPACE_FORGOTTEN));
  }
  markUsed();
}

export async function workspaceFetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });
  noteFresh(r.headers?.get?.("x-workspace-fresh") ?? null);
  return r;
}

// For tests: a new tab starts with a new id.
export function forgetWorkspace() { memo = null; usedMemo = false; expectFresh = false; try { window.sessionStorage.removeItem(KEY); window.sessionStorage.removeItem(USED); } catch { /* blocked */ } }
