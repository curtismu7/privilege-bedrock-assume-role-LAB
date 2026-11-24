import { useEffect, useRef, useState } from "react";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import AboutDialog from "./about/AboutDialog.jsx";
import ModeToggle from "./components/ModeToggle.jsx";
import PresenterSay from "./components/PresenterSay.jsx";
import useLab from "./hooks/useLab";
import AssumedRolePage from "./pages/AssumedRolePage.jsx";
import VertexPage from "./pages/VertexPage.jsx";
import DiagramPage from "./pages/DiagramPage.jsx";
import StoriesPage from "./pages/StoriesPage.jsx";
import LimitsPage from "./pages/LimitsPage.jsx";
import { visible } from "./safeText";
import { WORKSPACE_FORGOTTEN } from "./workspace";
import { dialogItems } from "./talk";

export const PAGES = [
  { id: "assumed-role", label: "Assumed role", View: AssumedRolePage },
  { id: "vertex", label: "Vertex AI", View: VertexPage },
  { id: "diagram", label: "Diagram", View: DiagramPage },
  { id: "stories", label: "Stories and talk track", View: StoriesPage },
  { id: "limits", label: "Limits (UNVERIFIED)", View: LimitsPage },
];
// Shown until the server's own banner has loaded: never blank, and never claiming more than it knows.
export const BANNER_UNKNOWN = "SIMULATED. Mock gateway, mock IAM, mock Bedrock and Vertex AI and a lab clock; nothing leaves this machine. Everything beyond the 2026-11-21 release-notes claims is this lab's own model and UNVERIFIED.";
// One line per page above the content.
const PAGE_INTRO = {
  "assumed-role": "An LLM key that stores no cloud credential reaches Bedrock under an assumed IAM role. Compare the two key objects, edit the trust and permission policies, run a scenario or your own call: the verdict names the result and its fix, then the six hops of the call and what the run left behind.",
  vertex: "On Vertex AI the gateway uses its own service account instead of an assumed role. Run a scenario or evaluate your own policy: the verdict names the result and its fix.",
  diagram: "The flow from the key to Bedrock under an assumed role, drawn from diagram-studio data. Drag the boxes, Simulate the arrows, Reset puts everything back.",
  stories: "Thirteen stories as data, told for an invented company. Each one opens the scenario it teaches. The talk track is the script behind them.",
  limits: "Exactly what the release notes say, and what is this lab's own model.",
};
// Which talk-track items the presenter sees on each page (ids from the server's talkTrack). The Assumed role and Vertex pages show the story of the scenario in view.
const PRESENTER_TALK = { diagram: ["what-is-simulated-and-what-is-not"], limits: ["what-is-simulated-and-what-is-not"], stories: ["before-you-start"], vertex: ["S11"] };
const THEME_KEY = "pba.theme";
const FONT_KEY = "pba.font";
const THEMES = ["auto", "light", "dark"];
function initialTheme() { try { const v = localStorage.getItem(THEME_KEY); if (THEMES.includes(v)) return v; } catch { /* storage blocked */ } return "auto"; }
function initialFont() { try { const f = localStorage.getItem(FONT_KEY); return ["S", "M", "L"].includes(f) ? f : "M"; } catch { return "M"; } }
// "#assumed-role/<scenario>" opens that page and runs the scenario: the page is the part before the slash.
const pageFromHash = () => { const h = window.location.hash.replace("#", "").split("/")[0]; return PAGES.some((p) => p.id === h) ? h : "assumed-role"; };
// The shortcut is for the presenter's hands, not for typing: ignore a held key, a chord (so Ctrl/Cmd+P still prints) and focus in a field or on a control.
export const isPresenterKey = (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !(e.target && e.target.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(e.target.tagName) || e.target.isContentEditable));
};

export default function App() {
  const lab = useLab();
  const [page, setPage] = useState(pageFromHash());
  const [presenter, setPresenter] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [fontStep, setFontStep] = useState(initialFont);
  const [resetMsg, setResetMsg] = useState("");

  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { applyFontSize(fontStep); try { localStorage.setItem(FONT_KEY, fontStep); } catch { /* not remembered */ } }, [fontStep]);
  // A scenario in the address ("#assumed-role/<id>") would run again when the page remounts: Reset, a mode switch, a new vertical and a forgotten workspace leave only the page.
  const pageRef = useRef(page);
  pageRef.current = page;
  const clearScenarioHash = () => { try { window.history.replaceState(null, "", `#${pageRef.current}`); } catch { /* ignore */ } };
  useEffect(() => { const on = () => { clearScenarioHash(); setForgotten(true); lab.startOver(); }; window.addEventListener(WORKSPACE_FORGOTTEN, on); return () => window.removeEventListener(WORKSPACE_FORGOTTEN, on); }, [lab.startOver]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const on = () => setPage(pageFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => {
    const on = (e) => {
      if (e.key === "Escape") { setPresenter(false); return; }
      if ((e.key === "p" || e.key === "P") && isPresenterKey(e)) setPresenter((v) => !v);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const pickTheme = (next) => { try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ } setTheme(next); };
  const select = (id) => { setPage(id); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };
  const reset = async () => {
    // The shared TopMenu has no way to disable its Reset button, so while a run is in flight Reset says so instead (a run that finishes after a Reset is dropped anyway).
    if (lab.busy) { setResetMsg("A run is in progress: Reset again when it has finished."); return; }
    clearScenarioHash();
    setForgotten(false);
    const ok = await lab.reset();
    setResetMsg(ok ? "Reset: the key is back to the default assumed-role key with its default policies, the lab clock is at zero, the audit log and the last run are cleared and the diagram is back in place." : "Reset failed on the server; the view was reloaded.");
  };

  const { source, story, info } = lab;
  const banner = info?.banner || BANNER_UNKNOWN;
  const View = PAGES.find((p) => p.id === page).View;
  const sc = lab.last?.scenario && lab.last.page === page ? story?.stories.find((s) => s.scenario === lab.last.scenario.id) : null;
  const say = !story ? [] : page === "vertex" ? story.talkTrack.filter((x) => x.id === (sc ? sc.id : "S11")) : page === "assumed-role" ? story.talkTrack.filter((x) => x.id === (sc ? sc.id : "before-you-start")) : story.talkTrack.filter((x) => (PRESENTER_TALK[page] || []).includes(x.id));

  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">PBA</span>
          <h1>{visible(story?.name || "Privilege Bedrock assume-role LAB")}</h1>
          {source && <span className="shell-badge" data-testid="mode" title="Mock: nothing leaves this machine">{source === "real" ? "Real" : "Mock"}</span>}
        </span>
        <nav className="shell-nav" aria-label="Lab sections">
          {PAGES.map((p) => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); select(p.id); }}>{p.label}</a>)}
        </nav>
        <TopMenu
          vertical={{ value: lab.vertical, onChange: (v) => { clearScenarioHash(); lab.setVertical(v); }, options: story ? story.verticals.map((v) => v.id) : [lab.vertical] }}
          theme={{ value: theme, onChange: pickTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: presenter, onToggle: () => setPresenter((v) => !v), label: "Presenter (P)" }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
          help={{ href: "https://github.com/curtismu7/privilege-bedrock-assume-role-LAB#readme" }}
          version={info?.version ? `v${info.version}` : null}
          onVersion={() => setAboutOpen((v) => !v)}
          onReset={reset}
          extra={<ModeToggle source={source || "mock"} info={info} onSwitch={(s) => { if (s !== source) clearScenarioHash(); return lab.switchMode(s); }} />}
        />
      </header>
      <main className="page">
        <p className="banner" role="note" data-state={source === "real" ? "live" : "mock"} data-testid="banner">{banner}</p>
        {forgotten && (
          <div className="field-error" role="alert" data-testid="workspace-forgotten">
            <p>The server forgot this workspace; the lab was reset to its defaults (its key, policies, clock, audit log and last run are back at their start). Your drafts are kept.</p>
            <button type="button" onClick={() => setForgotten(false)} data-testid="workspace-forgotten-dismiss">Dismiss</button>
          </div>
        )}
        {lab.modeError && <p className="field-error" role="alert" data-testid="mode-error-banner">{lab.modeError}</p>}
        {lab.error && (
          <div className="field-error" role="alert" data-testid="load-error">
            <p>Could not load the lab ({lab.error}). Is the server running?</p>
            <button type="button" onClick={lab.reload} data-testid="retry">Try again</button>
          </div>
        )}
        <p className={resetMsg ? "reset-note" : "sr-only"} role="status" aria-live="polite" data-testid="reset-note">{resetMsg}</p>
        {!presenter && <div className="page-head"><p className="head__intro" data-testid="head-intro">{PAGE_INTRO[page]}</p></div>}
        {presenter && <PresenterSay say={say} heading={null} />}
        <div id={`panel-${page}`}>
          {lab.error && !story ? null : !story || !info ? <p className="muted" role="status">Loading...</p> : <View key={`${page}-${lab.epoch}`} lab={lab} />}
        </div>
      </main>
      <AboutDialog isOpen={aboutOpen} onClose={() => setAboutOpen(false)} info={info} version={info?.version ? `v${info.version}` : ""} />
      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={dialogItems(story?.talkTrack ?? [])} />
    </div>
  );
}
