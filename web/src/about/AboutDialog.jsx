// What the version button opens: THIS lab's own short notes. (The shared ReleaseNotes dialog is another lab's text and is never shown here.)
// The claims listed are the server's own sourced list (data.js SOURCED), so nothing appears here that the Limits page does not say.
import FloatingDialog from "../floating-dialog/FloatingDialog";
import { visible } from "../safeText";

export default function AboutDialog({ isOpen, onClose, info, version }) {
  return (
    <FloatingDialog isOpen={isOpen} onClose={onClose} title="About this lab" ariaLabel="About this lab" defaultWidth={430} defaultHeight={null} placement="right" storageKey="about-dialog" singletonKey="about" noBackdrop testId="about-dialog">
      {info && (
        <div className="about">
          <h2>{visible(info.lab)} {visible(version || "")}</h2>
          <p>A Demo-tier lab. Mock only: a mock gateway, IAM evaluator, Bedrock and Vertex AI on a lab clock. Nothing leaves this machine.</p>
          <p><strong>From the {visible(info.sourced?.[0]?.match(/\(([\d-]+) release notes\)/)?.[1] || "2026-11-21")} release notes:</strong></p>
          <ul>{(info.sourced || []).map((t) => <li key={t}>{visible(t)}</li>)}</ul>
          <p>Everything else is this lab's own model and UNVERIFIED. <a href="#limits" onClick={onClose}>See the Limits page</a>.</p>
          <p className="muted">{visible(info.realReason)}</p>
        </div>
      )}
    </FloatingDialog>
  );
}
