import { useState } from "react";
import { Card, Json } from "../components/Bits.jsx";
import { visible } from "../safeText";

// Copy to the clipboard; if the browser refuses (no permission, an insecure page), select the text so the visitor can copy it by hand.
async function copy(text, area) {
  try { await navigator.clipboard.writeText(text); return "Copied"; } catch { /* fall through */ }
  try { area?.select?.(); return "Select the text and copy it (the browser blocked the clipboard)"; } catch { return "Could not copy"; }
}

function Snippet({ s, onUse }) {
  const [msg, setMsg] = useState("");
  return (
    <div className="snippet" data-testid={`snippet-${s.id}`}>
      <h3 className="panel__sub">{visible(s.title)}</h3>
      {s.language === "json" ? <Json value={s.text} label={s.title} /> : <pre className="json json--raw" tabIndex={0} aria-label={s.title}>{visible(s.text)}</pre>}
      <div className="seg">
        <button type="button" onClick={async () => setMsg(await copy(s.text))} data-testid={`snippet-copy-${s.id}`}>Copy</button>
        {onUse && <button type="button" onClick={() => onUse(s)} data-testid={`snippet-use-${s.id}`}>Use in the editor</button>}
        <span className="muted" role="status" aria-live="polite">{msg}</span>
      </div>
    </div>
  );
}

// IAM examples with PLACEHOLDER ids only (made-up account ids, names that start with "example"). The text comes from the server, so the page cannot drift from it.
export default function Snippets({ snippets, onUse, ids }) {
  const shown = snippets.filter((s) => !ids || ids.includes(s.id));
  return (
    <Card kicker="Copy and paste" title="IAM snippets (placeholder ids only)" testId="snippets">
      <p className="muted">Every id here is a placeholder: a made-up account id, names that start with <code>example</code>. Replace them in an account you control. Never paste a real role, account id or external ID into this lab.</p>
      {shown.map((s) => <Snippet key={s.id} s={s} onUse={onUse && (s.id === "trust" || s.id === "permission" || s.id === "vertex") ? onUse : null} />)}
    </Card>
  );
}
