import { useState } from "react";
import { Card, Chip } from "../components/Bits.jsx";
import useDraft from "../hooks/useDraft";
import { clockText } from "../fmt";
import { visible } from "../safeText";

const WHOLE = /^\d{1,12}$/;

// A call through the live key, and the lab clock: the session lives on the lab clock, so moving it past the expiry is how a presenter shows a refresh.
export default function CallPanel({ lab, live, trust, permission, onCalled }) {
  const { info } = lab;
  const [prompt, setPrompt] = useDraft(lab, "prompt", info.defaultPrompt);
  const [state, setState] = useDraft(lab, "providerState", "healthy");
  const [advance, setAdvance] = useDraft(lab, "advance", "0");
  const [error, setError] = useState(null);
  const lim = info.limits.maxPromptChars;
  const session = live?.key?.session || null;
  const clock = live?.clockMs ?? 0;
  const advBad = !WHOLE.test(advance);
  const promptBad = !prompt.trim(); // an over-long prompt is still sent: the server's own 400 is the lesson

  const run = async (advanceMs) => {
    setError(null);
    try { window.history.replaceState(null, "", "#assumed-role"); } catch { /* ignore */ }
    const r = await lab.runCall({ prompt, providerState: state, aws: { trust, permission }, ...(advanceMs ? { advanceMs } : {}) });
    if (!r.ok) setError(r.message); else if (!r.stale) { setAdvance("0"); onCalled(r.state); }
  };

  return (
    <Card kicker="Your call" title="Call through the key, and move the lab clock" testId="call-panel">
      <label>Prompt (up to {lim} characters)
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} data-testid="prompt" maxLength={lim + 1000} />
        <span className={`muted${prompt.length > lim ? " danger-text" : ""}`} data-testid="prompt-count">{prompt.length} of {lim} characters. The stub guard blocks a prompt that contains <code>{visible(info.guardMarker)}</code>.</span>
      </label>
      <label>What the mock Bedrock does
        <select value={state} onChange={(e) => setState(e.target.value)} data-testid="provider-state">{info.providerStates.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </label>
      <section className="panel" data-testid="clock-panel" aria-label="Lab clock and session">
        <p className="kicker">Lab clock and session</p>
        <dl className="kv">
          <dt>Lab clock</dt><dd data-testid="clock-now">{clockText(clock)} ({clock} ms)</dd>
          <dt>Session</dt>
          <dd data-testid="session-now">{session ? <>assumed at {clockText(session.assumedAt)}, expires at {clockText(session.expiresAt)}: <Chip state={clock >= session.expiresAt ? "bad" : "ok"}>{clock >= session.expiresAt ? "expired" : `${session.expiresAt - clock} ms left`}</Chip></> : "none yet (the first call assumes the role)"}</dd>
        </dl>
        <label>Advance the lab clock by (ms) before the call
          <input type="text" inputMode="numeric" value={advance} onChange={(e) => setAdvance(e.target.value)} data-testid="advance" aria-describedby="advance-hint" />
        </label>
        <p id="advance-hint" className="muted">A session lasts 3600000 ms (UNVERIFIED). It is reused until the clock reaches its expiry exactly; then the next call assumes the role again.</p>
        <div className="seg">
          <button type="button" onClick={() => setAdvance("600000")} data-testid="advance-10m">+10 minutes</button>
          <button type="button" disabled={!session} onClick={() => setAdvance(String(Math.max(0, session.expiresAt - clock - 1)))} data-testid="advance-before">To 1 ms before the expiry</button>
          <button type="button" disabled={!session} onClick={() => setAdvance(String(Math.max(0, session.expiresAt - clock)))} data-testid="advance-expiry">To the expiry</button>
        </div>
      </section>
      <p className="muted">Each call sends the policies in the editors above. Changing a policy keeps a session already held, so its effect shows after the expiry.</p>
      <div className="seg">
        <button type="button" className="primary" onClick={() => run(0)} disabled={lab.busy || promptBad} data-testid="call">Call now</button>
        <button type="button" onClick={() => run(Number(advance))} disabled={lab.busy || promptBad || advBad || advance === "0"} data-testid="call-advance">Advance, then call</button>
      </div>
      {advBad && <p className="field-error" role="alert" data-testid="advance-problem">The clock moves by a whole number of milliseconds.</p>}
      {error && <p className="field-error" role="alert" data-testid="call-error">{visible(error)}</p>}
    </Card>
  );
}
