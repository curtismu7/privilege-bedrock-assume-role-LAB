// Plain words shown beside the engine's codes, so a presenter and the table say the same thing.
export const HOP_LABEL = { key: "Key", "ai-guard": "AI Guard (stub)", "provider-auth": "Provider auth", "bedrock-invoke": "Bedrock invoke", metering: "Metering", audit: "Audit" };
export const HOP_STATE = { done: "ok", failed: "bad", skipped: "none" };
export const ms = (n) => `${n} ms`;
// A lab-clock reading as h:mm:ss.mmm (the lab starts at 0 on every reset), so a session's expiry reads as time and not as 3600000.
export function clockText(n) {
  if (!Number.isFinite(n)) return String(n);
  const h = Math.floor(n / 3600000); const m = Math.floor((n % 3600000) / 60000); const s = Math.floor((n % 60000) / 1000); const r = n % 1000;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
}
