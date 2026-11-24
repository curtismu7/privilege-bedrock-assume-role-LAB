import { useCallback, useEffect, useRef, useState } from "react";
import { getInfo, getObservability, getStory, postCall, postReset, postScenario, setMode } from "../api";

const say = (r, what) => r.body?.message || `${what} failed (HTTP ${r.status})`;
const DEFAULT_VERTICAL = "retail"; // what the picker shows until the server has answered; it is never SENT before a load has succeeded

/**
 * The lab's one data hook. It holds the info (source, realAvailable, the banner, the limits lists), the story and talk track for the picked vertical,
 * the last run (so a visitor can leave a page and come back to it) with the record the run left behind, and the form drafts (so a half-written policy
 * survives a trip to another page). `switchMode` is the rule 19 toggle: POST /api/mode with exactly { source }, then every piece of data is loaded
 * again. `epoch` goes up on a switch, a Reset or a new vertical so a page starts over.
 */
export default function useLab() {
  const [vertical, setVerticalState] = useState(DEFAULT_VERTICAL);
  const [info, setInfo] = useState(null);
  const [story, setStory] = useState(null);
  const [error, setError] = useState(null);
  const [modeError, setModeError] = useState(null);
  const [last, setLast] = useState(null); // { kind: "live" | "scenario", page, result, scenario?, runId, trace } or null before any run
  const [obs, setObs] = useState(null); // the run-observability answer for the last run
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const seq = useRef(0);
  // Goes up whenever the visitor starts over (Reset, a new vertical, a mode switch): a run that was already in flight must not write its result into the new view.
  const gen = useRef(0);
  // True once a load has succeeded. Until then every load asks for NO vertical (the configured customer vertical and its cast words are what must come back),
  // a Retry included; the picker's default is only ever sent after the server has said which vertical is configured.
  const loaded = useRef(false);
  const askFor = () => (loaded.current ? vertical : undefined);

  // `v` is the vertical to ask for. The FIRST load passes none, so the configured customer vertical (and its cast overrides) is what comes back;
  // later loads pass the one the visitor has picked.
  const load = useCallback(async (v) => {
    const mine = ++seq.current; // a late answer for a vertical or a mode the visitor has left is dropped
    const [i, s] = await Promise.all([getInfo(), getStory(v)]);
    if (mine !== seq.current) return;
    const bad = [i, s].find((r) => !r.ok);
    if (bad) { setError(say(bad, "Loading the lab")); return; }
    loaded.current = true;
    setError(null); setInfo(i.body); setStory(s.body);
    if (s.body.vertical && s.body.vertical !== v) setVerticalState(s.body.vertical); // the configured vertical wins on the first load
  }, []);

  useEffect(() => { load(undefined); }, [load]);
  const setVertical = useCallback((v) => { gen.current++; setVerticalState(v); setLast(null); setObs(null); setEpoch((n) => n + 1); load(v); }, [load]);
  const setDraft = useCallback((name, value) => setDrafts((d) => ({ ...d, [name]: typeof value === "function" ? value(d[name]) : value })), []);

  // Rule 19: the server decides. A 409 (Real not available) is shown as the server worded it; nothing else changes.
  const switchMode = useCallback(async (source) => {
    if (source === info?.source) return { ok: true }; // pressing the mode that is already active changes nothing: no request, no reload
    const r = await setMode(source);
    if (!r.ok) { setModeError(r.body?.message || `The mode did not change (HTTP ${r.status})`); return { ok: false, message: r.body?.message }; }
    gen.current++;
    setModeError(null); setLast(null); setObs(null); setEpoch((n) => n + 1);
    await load(askFor());
    return { ok: true };
  }, [load, vertical, info]);

  const refreshObs = useCallback(async () => {
    const mine = gen.current;
    const r = await getObservability();
    if (mine !== gen.current) return;
    setObs(r.ok ? r.body : { record: { error: r.body?.error || "run_observability_failed", message: r.body?.message || `HTTP ${r.status}` }, streams: [] });
  }, []);

  // A call is data, a refusal included (HTTP 200 with ok false). Only a validation or transport failure (4xx/5xx) is returned as { ok: false } for the page to show.
  const runCall = useCallback(async (payload) => {
    setBusy(true);
    const mine = gen.current;
    try {
      const r = await postCall(payload);
      if (mine !== gen.current) return { ok: true, stale: true }; // the visitor started over while this was running: drop it
      if (!r.ok) return { ok: false, status: r.status, message: say(r, "The call"), code: r.body?.error };
      const { runId, trace, state, ...result } = r.body;
      setLast({ kind: "live", page: "assumed-role", result, runId, trace });
      await refreshObs();
      return { ok: true, state };
    } finally { setBusy(false); }
  }, [refreshObs]);

  const runScenario = useCallback(async (id) => {
    setBusy(true);
    const mine = gen.current;
    try {
      const r = await postScenario(id);
      if (mine !== gen.current) return { ok: true, stale: true };
      if (!r.ok) return { ok: false, status: r.status, message: say(r, "The scenario"), code: r.body?.error };
      const { runId, trace, ...result } = r.body;
      const { id: sid, kind, title, summary, expect, pass, mismatches } = result;
      setLast({ kind: "scenario", page: kind === "vertex" ? "vertex" : "assumed-role", id: sid, result, scenario: { id: sid, kind, title, summary, expect, pass, mismatches }, runId, trace });
      await refreshObs();
      return { ok: true };
    } finally { setBusy(false); }
  }, [refreshObs]);

  // The server forgot this tab's workspace (see workspace.js): its lab is at its defaults. Drop what the page shows of the old one and load again.
  // It does NOT bump `gen`: the request that revealed it already ran on the NEW workspace, so its result is valid and must still be shown.
  const startOver = useCallback(() => { setLast(null); setObs(null); setEpoch((n) => n + 1); }, []);

  const reset = useCallback(async () => {
    gen.current++;
    const r = await postReset();
    setLast(null); setObs(null); setDrafts({}); setEpoch((n) => n + 1);
    await load(askFor());
    return r.ok;
  }, [load, vertical]);

  return { vertical, setVertical, info, story, source: info?.source || null, error, modeError, last, obs, drafts, setDraft, busy, epoch, reload: () => load(askFor()), switchMode, runCall, runScenario, reset, startOver };
}
