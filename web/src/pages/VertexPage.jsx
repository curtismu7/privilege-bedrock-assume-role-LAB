import { useCallback, useEffect, useState } from "react";
import { getScenarios, postEvaluate } from "../api";
import { Card, Chip, Loading } from "../components/Bits.jsx";
import useDraft from "../hooks/useDraft";
import { EvalResult, PolicyBox } from "./PolicyPanel.jsx";
import Result from "./Result.jsx";
import ScenarioPicker from "./ScenarioPicker.jsx";
import Snippets from "./Snippets.jsx";
import useScenarioHash from "../hooks/useScenarioHash";
import { visible } from "../safeText";

export const PAGE = "vertex";

// The Vertex tab: the gateway uses its OWN service account. No role is assumed, no external ID, no session. The policy is the one thing that can be wrong.
export default function VertexPage({ lab }) {
  const { info } = lab;
  const [scenarios, setScenarios] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [runError, setRunError] = useState(null);
  const [policy, setPolicy] = useDraft(lab, "vertex-policy", JSON.stringify({ bindings: [{ role: "roles/aiplatform.user", members: [`serviceAccount:${info.placeholders.vertexServiceAccount}`] }] }, null, 2));
  const [account, setAccount] = useDraft(lab, "vertex-account", info.placeholders.vertexServiceAccount);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getScenarios().then((s) => { if (!alive) return; if (!s.ok) setLoadError(s.body?.message || "The scenarios could not be loaded."); else setScenarios(s.body.scenarios); });
    return () => { alive = false; };
  }, []);

  const runScenario = useCallback(async (id) => {
    setRunError(null);
    try { window.history.replaceState(null, "", `#${PAGE}/${id}`); } catch { /* ignore */ }
    const r = await lab.runScenario(id);
    if (!r.ok) setRunError(r.message);
  }, [lab]);
  const pick = (s) => { if (s.kind !== "vertex") window.location.hash = `#assumed-role/${s.id}`; else runScenario(s.id); };

  useScenarioHash(PAGE, scenarios, (sc) => {
    if (sc.kind !== "vertex") window.location.hash = `#assumed-role/${sc.id}`;
    else if (!(lab.last?.id === sc.id && lab.last.page === PAGE)) runScenario(sc.id);
  });

  const evaluate = async () => {
    setBusy(true); setError(null);
    try {
      const r = await postEvaluate({ target: "vertex", policy, serviceAccount: account });
      if (!r.ok) { setResult(null); setError(`${r.body?.message || `HTTP ${r.status}`}${r.body?.error ? ` (${r.body.error})` : ""}`); return; }
      setResult(r.body);
    } finally { setBusy(false); }
  };

  const active = lab.last?.kind === "scenario" && lab.last.page === PAGE ? lab.last.id : null;
  const activeScenario = scenarios.find((s) => s.id === active);
  if (loadError) return <Card tone="warn" title="The lab could not be loaded" testId="vertex-load-error"><p role="alert">{visible(loadError)}</p></Card>;
  if (scenarios.length === 0) return <Loading />;

  return (
    <div className="stack">
      <ScenarioPicker scenarios={scenarios} active={active} busy={lab.busy} onRun={pick} summary={activeScenario?.summary} />
      {runError && <p className="field-error" role="alert" data-testid="run-error">{visible(runError)}</p>}
      <div className="cols cols--result">
        <div className="stack">
          <Card kicker="Vertex AI (the sibling feature)" title="The gateway's own service account" testId="vertex-panel">
            <p>On Vertex AI the gateway uses its <strong>own service account</strong>: <Chip state="info">no role is assumed</Chip> <Chip state="info">no external ID</Chip> <Chip state="info">no session</Chip>. What can go wrong is the policy: the service account needs a binding to a role that grants <code>aiplatform.endpoints.predict</code> (the lab grants it to <code>roles/aiplatform.user</code> and <code>roles/aiplatform.admin</code>, and to no others; that role model is UNVERIFIED).</p>
            <label>Gateway service account (a placeholder that ends in .example)
              <input type="text" value={account} maxLength={300} onChange={(e) => setAccount(e.target.value)} data-testid="vertex-account" />
            </label>
            <PolicyBox label="IAM policy (a bindings list)" value={policy} onChange={setPolicy} max={info.limits.policy.maxChars} testId="vertex-policy" rows={10} />
            <div className="seg">
              <button type="button" onClick={() => { setPolicy(info.snippets.find((s) => s.id === "vertex").text); setAccount(info.placeholders.vertexServiceAccount); setResult(null); setError(null); }} data-testid="vertex-defaults">Restore the example policy</button>
              <button type="button" className="primary" onClick={evaluate} disabled={busy} data-testid="vertex-evaluate">Evaluate</button>
            </div>
            {error && <p className="field-error" role="alert" data-testid="vertex-error">The server refused the request: {visible(error)}</p>}
            {result && <EvalResult r={result} testId="vertex-eval" />}
          </Card>
          <Snippets snippets={info.snippets} ids={["vertex"]} onUse={(s) => setPolicy(s.text)} />
        </div>
        <div className="stack">
          <Result last={lab.last} obs={lab.obs} source={lab.source || "mock"} page={PAGE} />
        </div>
      </div>
    </div>
  );
}
