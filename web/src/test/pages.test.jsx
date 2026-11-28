import { describe, expect, it } from "vitest";
import { STORIES } from "../../../server/src/stories.js";
import { VERTICALS } from "../../../server/src/cast.js";
import { SCENARIOS } from "../../../server/src/scenarios.js";
import { rawDiagram } from "../../../server/src/diagramData.js";
import { UNVERIFIED, SOURCED, LAB_MODEL, NOT_CLAIMED } from "../../../server/src/data.js";
import { jsonResponse } from "./harness.js";
import { screen, text, useLabHarness, waitFor, within } from "./util.jsx";

const h = useLabHarness();

describe("Stories and talk track", () => {
  it("shows the thirteen stories filled for the vertical, each with its own talk-track words and a Show it link to its scenario's page", async () => {
    const user = await h.mount({ page: "stories" });
    await screen.findByTestId("story-grid");
    expect(screen.getAllByTestId(/^story-S\d\d$/)).toHaveLength(13);
    for (const s of STORIES) {
      const kind = SCENARIOS.find((x) => x.id === s.scenario).kind;
      expect(screen.getByTestId(`story-show-${s.id}`)).toHaveAttribute("href", `#${kind === "vertex" ? "vertex" : "assumed-role"}/${s.scenario}`);
      expect(text(`story-say-${s.id}`).length).toBeGreaterThan(60);
    }
    expect(document.body.textContent).not.toMatch(/\{\{/);
    expect(text("stories-for")).toContain(VERTICALS.airlines.cast.castBrand);
    expect(screen.getByTestId("vertical-select")).toHaveValue("airlines");
    expect(document.body.textContent).toContain("AirGuard Airlines");
    expect(within(screen.getByTestId("talk-general")).getByText("Before you start")).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId("vertical-select"), "finance");
    await waitFor(() => expect(text("stories-for")).toContain(VERTICALS.finance.cast.castBrand));
    expect(screen.getAllByTestId(/^story-S\d\d$/)).toHaveLength(13);
    expect(document.body.textContent).not.toContain(VERTICALS.airlines.cast.castBrand);
  });

  it("a multi-paragraph story is drawn as one <p> per paragraph", async () => {
    await h.mount({ page: "stories" });
    await screen.findByTestId("story-grid");
    const say = screen.getByTestId("story-say-S01");
    expect(say.querySelectorAll("p").length).toBe(2);
    expect(say.textContent).not.toMatch(/\n\n/);
  });

  it("Show it opens the page of that scenario and runs it: an assumed-role story and a Vertex story", async () => {
    const user = await h.mount({ page: "stories" });
    await screen.findByTestId("story-grid");
    await user.click(screen.getByTestId("story-show-S02"));
    await screen.findByTestId("verdict");
    expect(text("verdict-code")).toBe("trust_principal_mismatch");
    await user.click(screen.getByRole("link", { name: "Stories and talk track" }));
    await user.click(await screen.findByTestId("story-show-S12"));
    await waitFor(() => expect(text("verdict-code")).toBe("vertex_role_missing"));
  });
});

describe("Limits page: what the release notes say versus the lab's model", () => {
  it("lists exactly the server's sourced claims, the lab's model, the UNVERIFIED list and the open question, and says why Real is off", async () => {
    await h.mount({ page: "limits" });
    await screen.findByTestId("limits-sourced");
    const items = (id) => within(screen.getByTestId(id)).getAllByRole("listitem").map((li) => li.textContent);
    expect(items("limits-sourced-list")).toEqual([...SOURCED]);
    expect(items("limits-model-list")).toEqual([...LAB_MODEL]);
    expect(items("limits-unverified-list")).toEqual([...UNVERIFIED]);
    expect(items("limits-open-list")).toEqual([...NOT_CLAIMED]);
    expect(text("limits-real-reason")).toMatch(/not built yet/);
    for (const w of [/console setup fields/, /session length/, /error text/, /order of the checks/, /refreshes an expired session/]) expect(text("limits-unverified-list")).toMatch(w);
  });
});

describe("Diagram page: drawn from diagram-studio data by name", () => {
  it("draws exactly the boxes the data lists, asks the server for it by name, and Simulate walks the arrows", async () => {
    const user = await h.mount({ page: "diagram" });
    const data = rawDiagram("bedrock-assumed-role");
    await screen.findByTestId("pattern-canvas");
    for (const n of data.nodes) expect(await screen.findByTestId(`pat-node-${n.id}`)).toHaveTextContent(n.label);
    expect(document.querySelectorAll("[data-testid^='pat-node-']")).toHaveLength(data.nodes.length);
    expect(h.lab.calls.find((c) => c.path === "/api/diagram").search).toContain("name=bedrock-assumed-role");
    expect(screen.getByTestId("step-caption")).toHaveTextContent(/walks the 5 arrows/);
    await user.click(screen.getByTestId("simulate"));
    expect(screen.getByTestId("step-caption")).toHaveTextContent(/Arrow 1 of 5/);
    await user.click(screen.getByTestId("next"));
    expect(screen.getByTestId("step-caption")).toHaveTextContent(/Arrow 2 of 5/);
    expect(screen.getByTestId("speed")).toBeInTheDocument();
    await user.click(screen.getByTestId("pattern-reset"));
    expect(screen.getByTestId("step-caption")).toHaveTextContent(/walks the 5 arrows/);
  });

  it("no node or edge is written in the page's source: the data file is the only list", async () => {
    const fs = await import("node:fs");
    const src = ["../pages/DiagramPage.jsx", "../components/PatternDiagram.jsx"].map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
    for (const n of rawDiagram("bedrock-assumed-role").nodes) expect(src).not.toMatch(new RegExp(`id:\\s*["']${n.id}["']`));
    expect(src).not.toMatch(/\b(source|target|from|to):\s*["']/);
    expect(src).not.toMatch(/mermaid/i);
  });

  it("a server that cannot give the diagram is named, with the data's name, never a blank canvas", async () => {
    await h.mount({ page: "diagram", overrides: { "/api/diagram": () => jsonResponse(404, { error: "unknown_diagram", message: "no diagram with that name" }) } });
    expect(await screen.findByTestId("diagram-error-text")).toHaveTextContent(/no diagram with that name/);
    expect(screen.queryByTestId("pattern-canvas")).toBeNull();
  });

  it("the header Reset puts the diagram back (a new walkthrough)", async () => {
    const user = await h.mount({ page: "diagram" });
    await screen.findByTestId("pattern-canvas");
    await user.click(screen.getByTestId("next"));
    expect(screen.getByTestId("step-caption")).toHaveTextContent(/Arrow 1 of 5/);
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("step-caption")).toHaveTextContent(/walks the 5 arrows/));
  });
});

describe("Stories page: a missing talk track is named", () => {
  it("shows the server's talkTrackProblem plainly", async () => {
    await h.mount({ page: "stories", overrides: { "/api/story": async (_i, _u, go) => { const r = await go(); const b = await r.json(); return jsonResponse(200, { ...b, talkTrack: [], talkTrackProblem: "docs/talk-track.md is missing or empty, so there is no talk track to show" }); } } });
    expect(await screen.findByTestId("talk-problem")).toHaveTextContent(/no talk track to show/);
  });
});

describe("Diagram page: the keyboard", () => {
  it("a box's name is a real button: Enter opens its details, the details' own buttons work from the keyboard (Copy link, Close), and no role=button wraps interactive content", async () => {
    const user = await h.mount({ page: "diagram" });
    await screen.findByTestId("pattern-canvas");
    const name = await screen.findByTestId("pat-name-gw");
    expect(name.tagName).toBe("BUTTON");
    expect(name).toHaveAttribute("aria-expanded", "false");
    name.focus();
    await user.keyboard("{Enter}");
    const passport = await screen.findByTestId("dk-passport-gw");
    expect(name).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelectorAll("[role='button'] button, [role='button'] a, [role='button'] input")).toHaveLength(0);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.resolve() } });
    const copy = within(passport).getByTestId("dk-passport-copy");
    copy.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(passport).toHaveTextContent(/Copied/i));
    expect(screen.getByTestId("dk-passport-gw")).toBeInTheDocument(); // the Enter on Copy did not toggle the box
    const close = within(passport).getByTestId("dk-passport-close");
    close.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByTestId("dk-passport-gw")).toBeNull());
    expect(name).toHaveAttribute("aria-expanded", "false");
    name.focus();
    await user.keyboard(" ");
    await screen.findByTestId("dk-passport-gw");
  });
});
