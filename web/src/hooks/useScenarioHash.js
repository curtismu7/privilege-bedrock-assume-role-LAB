import { useEffect, useRef } from "react";

// "#<page>/<scenario>" names a scenario to run on that page (a Stories link, a shared link). Returns the scenario id or null.
export const scenarioFromHash = (page) => { const parts = window.location.hash.replace("#", "").split("/"); return parts[0] === page && parts[1] ? parts[1] : null; };

/**
 * Runs the scenario named in the address on a DELIBERATE navigation: when the page opens with one, and when the address changes to one (a link; hashchange).
 * The page's own buttons rewrite the address with replaceState, which fires no event, so a click never runs a scenario twice. Reset, a mode switch and a new
 * vertical clear the scenario from the address before the page starts over, so a remount never re-runs it.
 * `onScenario(scenario)` gets the scenario object from GET /api/scenarios.
 */
export default function useScenarioHash(page, scenarios, onScenario) {
  const latest = useRef(onScenario);
  latest.current = onScenario;
  useEffect(() => {
    if (scenarios.length === 0) return undefined;
    const go = () => { const id = scenarioFromHash(page); const sc = scenarios.find((s) => s.id === id); if (sc) latest.current(sc); };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [page, scenarios]);
}
