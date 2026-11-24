import { useState } from "react";
import { postEvaluate } from "../api";
import { Card, Chip } from "../components/Bits.jsx";
import useDraft from "../hooks/useDraft";
import { visible } from "../safeText";

const WHOLE = /^\d{1,12}$/;

// The one card every evaluation result is drawn with (Bedrock and Vertex): the named result, its message and its fix first, then what was checked.
export function EvalResult({ r, testId = "eval-result" }) {
  return (
    <section className={`card card--${r.ok ? "ok" : "warn"}`} data-testid={testId} aria-label="Evaluation result">
      <p className="kicker">Evaluation (the live lab is not touched)</p>
      <h3 className="card__title"><Chip state={r.ok ? "ok" : "warn"} testId={`${testId}-chip`}>{r.ok ? "ALLOWED" : "REFUSED"}</Chip> <code data-testid={`${testId}-code`}>{visible(r.code)}</code></h3>
      <p data-testid={`${testId}-title`}><strong>{visible(r.title)}</strong></p>
      <p>{visible(r.message)}</p>
      {!r.ok && r.fix && <p data-testid={`${testId}-fix`}><strong>Fix:</strong> {visible(r.fix)}</p>}
      {r.policyError && <p className="field-error" role="alert" data-testid={`${testId}-policy-error`}>The {visible(r.policyError.which)} policy was not read: <code>{visible(r.policyError.code)}</code>. {visible(r.policyError.message)}</p>}
      {r.steps?.length > 0 && <ul className="plain" data-testid={`${testId}-steps`}>{r.steps.map((s, i) => <li key={`${s.id}-${i}`}><Chip state={s.ok ? "ok" : "bad"}>{s.ok ? "pass" : "fail"}</Chip> {visible(s.id)}: {visible(s.detail)}</li>)}</ul>}
      {r.warnings?.length > 0 && <ul className="plain" data-testid={`${testId}-warnings`}>{r.warnings.map((w) => <li key={w.code}><Chip state="warn">warning</Chip> <code>{visible(w.code)}</code>: {visible(w.message)}</li>)}</ul>}
      {r.session && <p className="muted">Session: assumed at {r.session.assumedAt} ms, expires at {r.session.expiresAt} ms on the lab clock.{r.sessionAction ? ` (${visible(r.sessionAction)})` : ""}</p>}
      <p className="muted">The wording is this lab's own (UNVERIFIED).</p>
    </section>
  );
}

// A policy textarea with its size against the server's limit. Over the limit is still sent: the server's named answer is the lesson.
export function PolicyBox({ label, value, onChange, max, testId, rows = 12 }) {
  const over = value.length > max;
  return (
    <label>{label}
      <textarea rows={rows} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} data-testid={testId} aria-describedby={`${testId}-count`} maxLength={max + 1000} />
      <span id={`${testId}-count`} className={`muted${over ? " danger-text" : ""}`} data-testid={`${testId}-count`}>{value.length} of {max} characters{over ? ": over the limit, the server will refuse it with a named result" : ""}</span>
    </label>
  );
}

// The trust and permission policies as editable JSON text, and an Evaluate button over the pure evaluator (POST /api/evaluate).
export default function PolicyPanel({ lab, trust, setTrust, permission, setPermission }) {
  const { info } = lab;
  const [ev, setEv] = useDraft(lab, "ev", { callerPrincipal: info.placeholders.gatewayPrincipal, externalId: info.defaultKey.externalId || "", modelId: info.defaultKey.modelId, region: info.defaultKey.region, now: "0", sessionExpiresAt: "", refresh: false });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const regions = [...new Set(Object.values(info.modelCatalog).flat())].sort();
  const max = info.limits.policy.maxChars;
  const setF = (patch) => setEv({ ...ev, ...patch });
  const nowBad = !WHOLE.test(ev.now) || (ev.sessionExpiresAt !== "" && !WHOLE.test(ev.sessionExpiresAt));

  const evaluate = async () => {
    setBusy(true); setError(null);
    try {
      const body = { trust, permission, callerPrincipal: ev.callerPrincipal, modelId: ev.modelId, region: ev.region, now: Number(ev.now), refresh: !!ev.refresh, ...(ev.externalId ? { externalId: ev.externalId } : {}) };
      if (ev.sessionExpiresAt !== "") body.session = { assumedAt: 0, expiresAt: Number(ev.sessionExpiresAt) };
      const r = await postEvaluate(body);
      if (!r.ok) { setResult(null); setError(`${r.body?.message || `HTTP ${r.status}`}${r.body?.error ? ` (${r.body.error})` : ""}`); return; }
      setResult(r.body);
    } finally { setBusy(false); }
  };

  return (
    <Card kicker="The AWS side" title="Trust policy and permission policy" testId="policy-panel">
      <p>Policies are plain JSON <strong>data</strong>: the lab reads a small subset of IAM (Allow and Deny, <code>*</code> wildcards, one external-ID condition) and never evaluates the text as code. Anything it does not read is refused as unsupported, never ignored.</p>
      <PolicyBox label="Trust policy (who may assume the role)" value={trust} onChange={setTrust} max={max} testId="trust-text" />
      <PolicyBox label="Permission policy (what the role may do)" value={permission} onChange={setPermission} max={max} testId="permission-text" />
      <div className="seg">
        <button type="button" onClick={() => { setTrust(JSON.stringify(info.defaultAws.trust, null, 2)); setPermission(JSON.stringify(info.defaultAws.permission, null, 2)); setResult(null); setError(null); }} data-testid="policy-defaults">Restore the default policies</button>
      </div>
      <fieldset className="fieldset">
        <legend>What to evaluate them for</legend>
        <div className="chain__fields">
          <label>Caller principal (what the gateway presents)<input type="text" value={ev.callerPrincipal} maxLength={300} onChange={(e) => setF({ callerPrincipal: e.target.value })} data-testid="ev-caller" /></label>
          <label>External ID sent (empty means none)<input type="text" value={ev.externalId} maxLength={200} onChange={(e) => setF({ externalId: e.target.value })} data-testid="ev-external-id" /></label>
          <label>Model<select value={ev.modelId} onChange={(e) => setF({ modelId: e.target.value })} data-testid="ev-model">{Object.keys(info.modelCatalog).map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label>Region<select value={ev.region} onChange={(e) => setF({ region: e.target.value })} data-testid="ev-region">{[...new Set([...regions, ev.region])].map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
          <label>Lab time now (ms)<input type="text" inputMode="numeric" value={ev.now} onChange={(e) => setF({ now: e.target.value })} data-testid="ev-now" /></label>
          <label>A held session expires at (ms; empty means none)<input type="text" inputMode="numeric" value={ev.sessionExpiresAt} onChange={(e) => setF({ sessionExpiresAt: e.target.value })} data-testid="ev-session" /></label>
        </div>
        <label className="check"><input type="checkbox" checked={!!ev.refresh} onChange={(e) => setF({ refresh: e.target.checked })} data-testid="ev-refresh" /> Refresh an expired session (assume the role again)</label>
      </fieldset>
      {nowBad && <p className="field-error" role="alert" data-testid="ev-problem">Times are whole numbers of milliseconds.</p>}
      <div className="seg"><button type="button" className="primary" onClick={evaluate} disabled={busy || nowBad} data-testid="evaluate">Evaluate</button></div>
      {error && <p className="field-error" role="alert" data-testid="eval-error">The server refused the request: {visible(error)}</p>}
      {result && <EvalResult r={result} />}
    </Card>
  );
}
