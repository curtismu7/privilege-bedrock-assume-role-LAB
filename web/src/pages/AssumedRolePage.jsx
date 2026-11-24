import { useCallback, useEffect, useState } from "react";
import { getKeyShapes, getScenarios, getState } from "../api";
import { Card, Loading } from "../components/Bits.jsx";
import useDraft from "../hooks/useDraft";
import useScenarioHash from "../hooks/useScenarioHash";
import CallPanel from "./CallPanel.jsx";
import KeyPanel from "./KeyPanel.jsx";
import PolicyPanel from "./PolicyPanel.jsx";
import Result from "./Result.jsx";
import ScenarioPicker from "./ScenarioPicker.jsx";
import Snippets from "./Snippets.jsx";
import { visible } from "../safeText";

export const PAGE = "assumed-role";

export default function AssumedRolePage({ lab }) {
  const { info } = lab;
  const [scenarios, setScenarios] = useState([]);
  const [shapes, setShapes] = useState(null);
  const [live, setLive] = useState(null); // GET /api/state: the live key, the clock, the policies as saved, the audit log
  const [loadError, setLoadError] = useState(null);
  const [runError, setRunError] = useState(null);
  const [trust, setTrust] = useDraft(lab, "trust", JSON.stringify(info.defaultAws.trust, null, 2));
  const [permission, setPermission] = useDraft(lab, "permission", JSON.stringify(info.defaultAws.permission, null, 2));

  useEffect(() => {
    let alive = true;
    Promise.all([getScenarios(), getKeyShapes(), getState()]).then(([s, k, st]) => {
      if (!alive) return;
      const bad = [s, k, st].find((r) => !r.ok);
      if (bad) { setLoadError(bad.body?.message || "The lab could not be loaded."); return; }
      setScenarios(s.body.scenarios); setShapes(k.body); setLive(st.body);
    });
    return () => { alive = false; };
  }, []);

  const runScenario = useCallback(async (id) => {
    setRunError(null);
    try { window.history.replaceState(null, "", `#${PAGE}/${id}`); } catch { /* ignore */ }
    const r = await lab.runScenario(id);
    if (!r.ok) setRunError(r.message);
  }, [lab]);
  const pick = (s) => { if (s.kind === "vertex") window.location.hash = `#vertex/${s.id}`; else runScenario(s.id); };

  // "#assumed-role/<scenario>" (the Stories page, a shared link) runs that scenario when the page opens and when the address changes to one.
  useScenarioHash(PAGE, scenarios, (sc) => {
    if (sc.kind === "vertex") window.location.hash = `#vertex/${sc.id}`;
    else if (!(lab.last?.id === sc.id && lab.last.page === PAGE)) runScenario(sc.id);
  });

  const use = (s) => { if (s.id === "trust") setTrust(s.text); else if (s.id === "permission") setPermission(s.text); };
  const active = lab.last?.kind === "scenario" && lab.last.page === PAGE ? lab.last.id : null;
  const activeScenario = scenarios.find((s) => s.id === active);

  if (loadError) return <Card tone="warn" title="The lab could not be loaded" testId="assumed-load-error"><p role="alert">{visible(loadError)}</p></Card>;
  if (!live || !shapes) return <Loading />;

  return (
    <div className="stack">
      <ScenarioPicker scenarios={scenarios} active={active} busy={lab.busy} onRun={pick} summary={activeScenario?.summary} />
      {runError && <p className="field-error" role="alert" data-testid="run-error">{visible(runError)}</p>}
      <KeyPanel lab={lab} shapes={shapes} liveKey={live.key} onSaved={setLive} />
      <div className="cols cols--result">
        <div className="stack">
          <PolicyPanel lab={lab} trust={trust} setTrust={setTrust} permission={permission} setPermission={setPermission} />
          <CallPanel lab={lab} live={live} trust={trust} permission={permission} onCalled={setLive} />
          <Snippets snippets={info.snippets} ids={["trust", "permission", "cli"]} onUse={use} />
        </div>
        <div className="stack">
          <Result last={lab.last} obs={lab.obs} source={lab.source || "mock"} page={PAGE} />
          <AuditLog live={live} />
        </div>
      </div>
    </div>
  );
}

// The audit log of the live key: ids, outcomes and lab times, never the prompt, an external ID or a credential.
function AuditLog({ live }) {
  return (
    <section className="card card--neutral" data-testid="audit" aria-label="Audit log">
      <p className="kicker">Audit log of the live key ({live.auditSize} {live.auditSize === 1 ? "entry" : "entries"})</p>
      {live.audit.length === 0 ? <p className="muted" data-testid="audit-empty">No call has been made on the live key yet. Every call, served or refused, writes one entry: ids, the outcome and the lab time, never the prompt or a credential.</p> : (
        <div className="scroll">
          <table className="tbl tbl--wide">
            <caption className="sr-only">Audit entries</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Lab time</th><th scope="col">Mode</th><th scope="col">Outcome</th><th scope="col">Code</th></tr></thead>
            <tbody>{live.audit.map((e) => <tr key={e.seq} data-testid={`audit-${e.seq}`}><td>{e.seq}</td><td>{e.at} ms</td><td>{visible(e.mode)}</td><td>{visible(e.outcome)}</td><td><code>{visible(e.code)}</code></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
