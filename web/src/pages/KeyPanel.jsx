import { useState } from "react";
import { putKey } from "../api";
import { Card, Chip, Json } from "../components/Bits.jsx";
import useDraft from "../hooks/useDraft";
import { visible } from "../safeText";

const MOCK = /^MOCK-[A-Za-z0-9_-]{4,64}$/;
const ARN = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]{1,128}$/;

// What the client can catch before the server does. The server checks again and has the last word (its message is shown).
export function keyProblems(k, limits) {
  const p = [];
  if (!Number.isInteger(k.budgetTokens) || k.budgetTokens < 0 || k.budgetTokens > limits.key.maxBudgetTokens) p.push(`Budget is a whole number from 0 to ${limits.key.maxBudgetTokens}.`);
  if (!String(k.modelId).trim()) p.push("Model is required.");
  if (k.mode === "assumed-role" && !ARN.test(String(k.roleArn))) p.push("Role ARN must look like arn:aws:iam::<12 digits>:role/<name>.");
  if (k.mode === "stored-credential" && !MOCK.test(String(k.credential))) p.push("A stored credential here must be a MOCK- placeholder (MOCK- and 4 to 64 letters, digits, dashes or underscores).");
  return p;
}

// The two key modes side by side (the objects the server builds, as JSON), then the form for the live key. The credential of a stored key is write-only:
// it is sent once, never shown again, and the input is cleared after a save.
export default function KeyPanel({ lab, shapes, liveKey, onSaved }) {
  const { info } = lab;
  const [key, setKey] = useDraft(lab, "key", { ...info.defaultKey, credential: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const set = (patch) => { setSaved(false); setKey({ ...key, ...patch }); };
  const regions = [...new Set(Object.values(info.modelCatalog).flat())].sort();
  const problems = keyProblems(key, info.limits);
  const assumed = key.mode === "assumed-role";

  const save = async () => {
    setSaving(true); setError(null);
    const spec = assumed
      ? { mode: key.mode, modelId: key.modelId, region: key.region, budgetTokens: key.budgetTokens, roleArn: key.roleArn, ...(key.externalId ? { externalId: key.externalId } : {}) }
      : { mode: key.mode, modelId: key.modelId, region: key.region, budgetTokens: key.budgetTokens, credential: key.credential };
    try {
      const r = await putKey(spec);
      if (!r.ok) { setError(r.body?.message || `HTTP ${r.status}`); return; }
      setKey({ ...key, credential: "" }); setSaved(true); onSaved(r.body);
    } finally { setSaving(false); }
  };

  return (
    <Card kicker="The key" title="Stored credential versus assumed role" testId="key-panel">
      <p>An assumed-role key stores <strong>no cloud credential</strong>: the key object has no credential field at all. A stored-credential key holds a secret, shown here only as a mask.</p>
      {shapes ? (
        <div className="cols" data-testid="key-compare">
          <div data-testid="key-stored">
            <h3 className="panel__sub">Stored credential <Chip state="warn">has a credential entry</Chip></h3>
            <Json value={shapes.stored} label="Stored-credential key" hot={["credential"]} testId="key-stored-json" />
          </div>
          <div data-testid="key-assumed">
            <h3 className="panel__sub">Assumed role <Chip state="ok">no credential field</Chip></h3>
            <Json value={shapes.assumed} label="Assumed-role key" hot={["roleArn", "session", "externalIdSet"]} testId="key-assumed-json" />
          </div>
        </div>
      ) : <p className="muted" role="status">Loading the two key objects...</p>}

      <h3 className="panel__sub">Your live key</h3>
      <div className="seg" role="group" aria-label="Key mode">
        {info.keyModes.map((m) => <button key={m} type="button" aria-pressed={key.mode === m} onClick={() => set({ mode: m })} data-testid={`key-mode-${m}`}>{m === "assumed-role" ? "Assumed role" : "Stored credential"}</button>)}
      </div>
      <div className="chain__fields">
        <label>Model<select value={key.modelId} onChange={(e) => set({ modelId: e.target.value })} data-testid="key-model">{Object.keys(info.modelCatalog).map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label>Region<select value={key.region} onChange={(e) => set({ region: e.target.value })} data-testid="key-region">{regions.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <label>Budget (tokens)<input type="number" min="0" max={info.limits.key.maxBudgetTokens} value={Number.isFinite(key.budgetTokens) ? key.budgetTokens : ""} onChange={(e) => set({ budgetTokens: e.target.value === "" ? NaN : Number(e.target.value) })} data-testid="key-budget" /></label>
      </div>
      {assumed ? (
        <div className="chain__fields">
          <label>Role ARN (a placeholder)<input type="text" value={key.roleArn} maxLength={300} onChange={(e) => set({ roleArn: e.target.value })} data-testid="key-role" /></label>
          <label>External ID (a placeholder; empty means none)<input type="text" value={key.externalId || ""} maxLength={200} onChange={(e) => set({ externalId: e.target.value })} data-testid="key-external-id" /></label>
        </div>
      ) : (
        <label>Credential (a MOCK- placeholder; write-only)<input type="password" autoComplete="off" value={key.credential} maxLength={100} onChange={(e) => set({ credential: e.target.value })} data-testid="key-credential" /></label>
      )}
      {problems.length > 0 && <ul className="plain field-error" role="alert" data-testid="key-problems">{problems.map((t) => <li key={t}>{t}</li>)}</ul>}
      <div className="seg">
        <button type="button" className="primary" onClick={save} disabled={saving || problems.length > 0} data-testid="key-save">Save the key</button>
        {saved && <span className="muted" role="status" data-testid="key-saved">Saved. A new key has a fresh budget and no session; the lab clock and the audit log are kept.</span>}
      </div>
      {error && <p className="field-error" role="alert" data-testid="key-error">{visible(error)}</p>}
      {liveKey && (
        <details open data-testid="key-live">
          <summary>The key on the server now</summary>
          <Json value={liveKey} label="The live key" hot={["credential", "session", "mode"]} testId="key-live-json" />
        </details>
      )}
    </Card>
  );
}
