import { visible } from "../safeText";
import { paragraphs } from "../talk";

// Text with blank-line paragraphs: one <p> each. `lead` (optional) is a bold first words in the first paragraph.
export default function Paragraphs({ text, lead, className, testId }) {
  const ps = paragraphs(text);
  return ps.map((p, i) => <p key={i} className={className} data-testid={testId && i === 0 ? testId : undefined}>{i === 0 && lead ? <><strong>{visible(lead)}</strong> </> : null}{visible(p)}</p>);
}
