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

export const workspaceFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });

// For tests: a new tab starts with a new id.
export function forgetWorkspace() { memo = null; try { window.sessionStorage.removeItem(KEY); } catch { /* blocked */ } }
