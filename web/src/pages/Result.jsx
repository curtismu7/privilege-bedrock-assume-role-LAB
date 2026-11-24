import { useEffect, useRef } from "react";
import { visible } from "../safeText";
import { Card, Chip, HOT, Json } from "../components/Bits.jsx";
import Meter from "../components/Meter.jsx";
import GatewayTrace from "../gateway-trace/GatewayTrace.jsx";
import RunObservability from "../run-observability/RunObservability.jsx";
import { HOP_LABEL, HOP_STATE, clockText, ms } from "../fmt";

const BASIS = "Simulated: the lab's own mock gateway computed every decision, so each is marked checked. The hosts are .example names and the credentials shown are lab mocks, never real ones. How the real product words its response is UNVERIFIED.";
const HOP_WORD = { done: "done", failed: "FAILED", skipped: "not reached" };

// The six hops of one call as a strip: each is done, failed or not reached, so a failure shows where the call stopped and what did not run.
export function HopStrip({ call, label }) {
  return (
    <div className="hops" data-testid="hop-strip" role="group" aria-label={label || "The six hops of the call"}>
      {label && <p className="hops__title">{visible(label)}</p>}
      <ol className="hops__list">
        {call.hops.map((h, i) => (
          <li key={h.id} data-testid={`hop-${h.id}`} data-status={h.status}>
            <span className="step-num">{i + 1}</span>
            <span className="hops__name">{HOP_LABEL[h.id] || h.id}</span>
            <Chip state={HOP_STATE[h.status]} testId={`hop-${h.id}-status`}>{HOP_WORD[h.status] || h.status}</Chip>
          </li>
        ))}
      </ol>
    </div>
  );
}

// What the verdict card needs, from whatever ran: a live call, or a scenario of any of the four kinds.
export function describe(last) {
  const r = last.result;
  if (last.kind === "live") {
    const v = r.verdict;
    return { ok: r.ok, code: r.code, title: v.title, message: v.message, fix: v.fix, stage: v.stage, calls: [r], call: r };
  }
  const d = r.detail;
  switch (r.kind) {
    case "call": { const c = d.calls.at(-1); const v = r.verdict; return { ok: c.ok, code: c.code, title: v.title, message: v.message, fix: v.fix, stage: v.stage, calls: d.calls, call: c }; }
    case "vertex": { const e = d.evaluation; return { ok: e.ok, code: e.code, title: e.title, message: e.message, fix: e.fix, stage: e.stage, calls: [], call: null, evaluation: e }; }
    case "key-shape": return {
      ok: r.pass, code: r.pass ? "key_shape_as_expected" : "key_shape_differs", title: "Stored credential versus assumed role: the key's shape",
      message: "The stored-credential key has a credential entry that is only a mask. The assumed-role key has no credential entry at any depth, and refuses one by any name. Both keys were metered, guarded and audited the same way.",
      fix: null, stage: "key", calls: [d.storedCall, d.assumedCall], call: d.assumedCall, keyShape: d,
    };
    default: { const c = d.targetCall; return { ok: r.result.ok, code: c ? c.code : "target_failed", title: c?.ok ? "The assumed-role key served as the second target" : "No target served", message: "The primary model answered 503, so the assumed-role key was tried next. It is still metered, guarded and audited. This is an illustration with two attempts: the fallback lab owns the chain logic.", fix: null, stage: "fallback-target", calls: c ? [c] : [], call: c, fallback: d }; }
  }
}

const label = (n, i) => (n > 1 ? `Call ${i + 1} of ${n}` : null);

// The verdict first: the named result and its fix. For a scenario, whether the result equals the scenario's hand-written expectation.
export function Verdict({ d, scenario }) {
  const c = d.call;
  return (
    <Card tone={d.ok ? "ok" : "warn"} kicker={scenario ? `Scenario: ${scenario.title}` : "Your call on the live key"} testId="verdict">
      <h2 className="card__title"><Chip state={d.ok ? "ok" : "warn"} testId="verdict-chip">{d.ok ? "SERVED" : "REFUSED"}</Chip> <code data-testid="verdict-code">{visible(d.code)}</code></h2>
      <p data-testid="verdict-title"><strong>{visible(d.title)}</strong></p>
      <p data-testid="verdict-message">{visible(d.message)}</p>
      {!d.ok && d.fix && <p data-testid="verdict-fix"><strong>Fix:</strong> {visible(d.fix)}</p>}
      <dl className="kv">
        <dt>Stage</dt><dd data-testid="verdict-stage">{visible(d.stage)}</dd>
        {c && <><dt>Lab time</dt><dd>{ms(c.clock.endedAt - c.clock.startedAt)} (clock {clockText(c.clock.endedAt)})</dd></>}
        {c?.ok && <><dt>Served by</dt><dd data-testid="served-by"><code>{visible(`${c.servedBy.model} in ${c.servedBy.region}`)}</code></dd><dt>Tokens charged</dt><dd>{c.tokensCharged}</dd><dt>Answer (lab mock)</dt><dd><code>{visible(c.answer)}</code></dd></>}
        {c?.session && <><dt>Session</dt><dd data-testid="verdict-session">assumed at {clockText(c.session.assumedAt)}, expires at {clockText(c.session.expiresAt)} on the lab clock</dd></>}
        {c && <><dt>Audit entry</dt><dd data-testid="verdict-audit">#{c.audit.seq}: {visible(c.audit.outcome)}, {visible(c.audit.code)}</dd></>}
      </dl>
      {d.evaluation?.steps?.length > 0 && (
        <ul className="plain" data-testid="eval-steps">{d.evaluation.steps.map((s) => <li key={s.id}><Chip state={s.ok ? "ok" : "bad"}>{s.ok ? "pass" : "fail"}</Chip> {visible(s.id)}: {visible(s.detail)}</li>)}</ul>
      )}
      <p className="muted">The wording is this lab's own (UNVERIFIED against the product or the cloud). A refusal is returned as a normal result; the lab does not imitate a status.</p>
      {scenario && (
        <p data-testid="expectation" className={scenario.pass ? undefined : "field-error"} role={scenario.pass ? undefined : "alert"}>
          <Chip state={scenario.pass ? "ok" : "bad"}>{scenario.pass ? "matches the expectation" : "differs from the expectation"}</Chip>{" "}
          {scenario.pass ? "The result equals the scenario's hand-written expectation." : visible(scenario.mismatches.join("; "))}
        </p>
      )}
    </Card>
  );
}

function KeyShape({ d }) {
  return (
    <section className="card card--neutral" data-testid="scenario-keys" aria-label="The two keys">
      <p className="kicker">The two key objects this scenario built</p>
      <div className="cols">
        <div><h3 className="panel__sub">Stored credential</h3><Json value={d.storedView} label="Stored-credential key" hot={["credential"]} /></div>
        <div><h3 className="panel__sub">Assumed role</h3><Json value={d.assumedView} label="Assumed-role key" hot={["roleArn", "session"]} /></div>
      </div>
    </section>
  );
}

function Attempts({ d }) {
  const p = d.fallback.primary; const t = d.fallback.target;
  return (
    <section className="card card--neutral" data-testid="attempts" aria-label="Attempts">
      <p className="kicker">Both attempts, in order</p>
      <div className="scroll">
        <table className="tbl tbl--wide">
          <caption className="sr-only">Attempts</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Target</th><th scope="col">Outcome</th><th scope="col">HTTP</th><th scope="col">Latency</th></tr></thead>
          <tbody>
            <tr data-testid="attempt-0"><td>1</td><td><code>{visible(`${p.provider}/${p.model}`)}</code></td><td><Chip state="bad" wrap>{visible(p.error || "failed")}</Chip></td><td>{p.status}</td><td>{ms(p.latencyMs)}</td></tr>
            {t && <tr data-testid="attempt-1"><td>2</td><td><code>{visible(`${t.provider}/${t.model}`)}</code> (assumed-role key)</td><td><Chip state={t.ok ? "ok" : "bad"} wrap>{t.ok ? "served" : visible(t.error)}</Chip></td><td>{t.status ?? "none"}</td><td>{ms(t.latencyMs)}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Everything one run left: the verdict, the call path, the budget, the trace, what the run left behind and the raw result.
export default function Result({ last, obs, source, page }) {
  const top = useRef(null);
  const runId = last?.runId;
  // On a narrow screen the result sits below the form: bring the verdict into view when a run finishes.
  useEffect(() => { if (runId && top.current && window.matchMedia?.("(max-width: 900px)").matches) top.current.scrollIntoView({ block: "start" }); }, [runId]);
  if (!last || last.page !== page) {
    return (
      <Card tone="neutral" kicker="Result" title="No run yet" testId="result-empty">
        <p>{page === "vertex" ? "Pick a Vertex scenario above or press Evaluate on your own policy." : "Pick a scenario above or press Call on your own key."} The verdict (the named result and its fix) appears here first, then the six hops of the call, the budget, the gateway trace and what the run left behind.</p>
        <GatewayTrace exchanges={[]} source="mock" title="What the gateway did (simulated)" basisNote={BASIS} />
        <RunObservability record={null} source={source} streams={obs?.streams || []} />
      </Card>
    );
  }
  const d = describe(last);
  const { scenario, trace } = last;
  const key = d.call && !d.keyShape ? d.call.ledger : null;
  return (
    <div className="stack" data-testid="result" data-run={runId} ref={top}>
      <Verdict d={d} scenario={scenario || null} />
      {d.keyShape && <KeyShape d={d.keyShape} />}
      {d.fallback && <Attempts d={d} />}
      {d.calls.length > 0 && (
        <section className="card card--neutral" data-testid="call-path" aria-label="Call path">
          <p className="kicker">The call path: six hops, every one listed</p>
          {d.calls.map((c, i) => <HopStrip key={i} call={c} label={label(d.calls.length, i) || (last.kind === "scenario" && d.keyShape ? (i === 0 ? "Stored-credential key" : "Assumed-role key") : null)} />)}
          <p className="muted">A failed or not-reached hop shows where the call stopped. Metering, the AI Guard step and the audit entry are on the call for both key modes.</p>
        </section>
      )}
      {key && (
        <section className="card card--neutral" data-testid="meters" aria-label="Budget">
          <p className="kicker">The key's budget, after this call</p>
          <Meter budget={key} name={`${d.call.hops[0].keyId} (${d.call.hops[0].mode})`} />
          <p className="muted">Requests counted by Usage: {d.call.usage.requests}. A refused call is not charged.</p>
        </section>
      )}
      <GatewayTrace exchanges={trace?.exchanges || []} source="mock" title="What the gateway did (simulated)" basisNote={BASIS} hot={["error", "ok", "code", "title", "fix", "Session"]} />
      <RunObservability record={obs?.record ?? null} source={source} streams={obs?.streams || []} title="What this run left behind" />
      <p className="muted" data-testid="obs-note">In this lab: Agent is the calling app, Authorize holds the lab's mock IAM decisions (assume role, invoke permission, the Vertex binding), Privilege is the lab's model of the gateway (the guard, metering and the audit entry), Resource server is the mock Bedrock. Person and Agent gateway have nothing to log here and the panel says so. Times are when the lab computed them.</p>
      <details className="card card--neutral" data-testid="raw-result">
        <summary>The raw result</summary>
        <Json value={scenario ? { scenario, result: last.result } : last.result} label="The raw result" hot={HOT} />
      </details>
    </div>
  );
}
