import { visible } from "../safeText";

// The scenarios from GET /api/scenarios as buttons, in two groups. A scenario runs on a fresh lab and a fresh clock and never touches the live key.
// A scenario of the other page opens that page (the pages handle it: their hash carries the scenario, so it runs there).
export default function ScenarioPicker({ scenarios, active, busy, onRun, summary }) {
  const group = (title, items, testId) => (
    <div role="group" aria-label={title} data-testid={testId}>
      <p className="kicker">{title}</p>
      <div className="seg">
        {items.map((s) => <button key={s.id} type="button" aria-pressed={active === s.id} disabled={busy} onClick={() => onRun(s)} data-testid={`scenario-${s.id}`}>{visible(s.title)}</button>)}
      </div>
    </div>
  );
  const bedrock = scenarios.filter((s) => s.kind !== "vertex");
  const vertex = scenarios.filter((s) => s.kind === "vertex");
  return (
    <section className="card" data-testid="scenarios" aria-label="Scenarios">
      <p className="kicker">Scenarios</p>
      <h2 className="card__title">{scenarios.length} scripted runs, each with a hand-written expected result</h2>
      {group(`Bedrock under an assumed role (${bedrock.length})`, bedrock, "scenarios-bedrock")}
      {group(`Vertex AI service account (${vertex.length}; they open the Vertex tab)`, vertex, "scenarios-vertex")}
      {summary ? <p data-testid="scenario-summary">{visible(summary)}</p> : <p className="muted">A scenario runs on a fresh key and a fresh clock and never touches the live key below.</p>}
    </section>
  );
}
