import { visible } from "../safeText";

// The key's token budget: spent against its limit, as a bar AND as words (never colour alone). Tokens only; the bar's width is data, its colour a token.
export default function Meter({ budget, name }) {
  const { limit, spent, remaining } = budget;
  const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 100;
  return (
    <div className="meter" data-testid="meter">
      <p className="meter__name"><code>{visible(name)}</code></p>
      <div className="meter__bar" role="meter" aria-label={`Budget spent on ${name}`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={spent} aria-valuetext={`${spent} of ${limit} tokens spent`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="muted meter__text" data-testid="meter-text">{spent} of {limit} tokens spent, {remaining} left</p>
    </div>
  );
}
