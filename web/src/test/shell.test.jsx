import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { BANNER } from "../../../server/src/data.js";
import { validateConfig } from "../../../server/src/customer.js";
import { VERTICALS } from "../../../server/src/cast.js";
import { jsonResponse } from "./harness.js";
import { nav, screen, text, useLabHarness, userEvent, waitFor, within } from "./util.jsx";
import { isPresenterKey, MODE_LINES } from "../App.jsx";
import { WORKSPACE_ID, WORKSPACE_FORGOTTEN, fillRandom, noteWorkspaceHeaders } from "../workspace.js";
import { dialogItems } from "../talk.js";

const h = useLabHarness();
const PAGES = ["Assumed role", "Vertex AI", "Diagram", "Stories and talk track", "Limits (UNVERIFIED)"];

describe("shell: Real-or-mock modal, mode toggle, presenter, talk track, reset", () => {
  it("opens on a MOCK modal that carries the UNVERIFIED claim label; Got it closes it; no old banner on any page", async () => {
    const user = await h.mount();
    const modal = screen.getByTestId("mode-modal");
    expect(modal).toHaveAttribute("data-mode", "mock");
    expect(modal).toHaveTextContent("MOCK");
    expect(modal).toHaveTextContent(/nothing leaves this machine/);
    expect(modal).toHaveTextContent(/2026-11-21 release-notes claims are sourced/);
    expect(modal).toHaveTextContent(/UNVERIFIED/);
    expect(MODE_LINES.mock).toMatch(/UNVERIFIED/);
    await user.click(screen.getByTestId("mode-modal-ok"));
    expect(screen.queryByTestId("mode-modal")).toBeNull();
    for (const p of PAGES) {
      await nav(user, p);
      expect(screen.queryByTestId("banner"), p).toBeNull();
      expect(document.querySelector("main > .banner"), p).toBeNull();
      // The claim label that stays on every page once the modal is dismissed: the Limits tab is named UNVERIFIED in the nav.
      expect(screen.getByRole("link", { name: "Limits (UNVERIFIED)" }), p).toBeInTheDocument();
    }
    expect(screen.queryByTestId("mode-modal")).toBeNull();
  });

  it("the server's banner field is still sent (a server test pins it) but the page no longer draws it", async () => {
    await h.mount();
    const info = await h.lab.json("/api/info");
    expect(info.banner).toBe(BANNER);
    expect(document.body.textContent).not.toContain(BANNER);
  });

  it("shows the mode in the header and a Mock / Real toggle: Mock pressed, Real DISABLED with the plain reason from the server", async () => {
    await h.mount();
    expect(text("mode")).toBe("Mock");
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    const real = screen.getByTestId("mode-real");
    expect(real).toBeDisabled();
    const info = await h.lab.json("/api/info");
    expect(real).toHaveAttribute("title", info.realReason);
    expect(text("real-reason")).toBe(info.realReason);
    expect(info.realReason).toMatch(/not built yet/);
  });

  it("the server's 409 for Real is shown as the server worded it (a stale page that still asks)", async () => {
    const user = await h.mount({ overrides: { "/api/info": async (_init, _u, go) => { const r = await go(); return jsonResponse(200, { ...(await r.json()), realAvailable: true }); } } });
    const real = screen.getByTestId("mode-real");
    expect(real).not.toBeDisabled();
    await user.click(real);
    await waitFor(() => expect(screen.getByTestId("mode-error-banner")).toHaveTextContent(/not built yet/));
    expect(text("mode")).toBe("Mock");
    expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "mock"); // a refused Real never turns the modal to REAL
    expect(h.lab.calls.filter((c) => c.path === "/api/mode" && c.method === "POST").map((c) => c.body)).toEqual([{ source: "real" }]);
  });

  it("names a server that is down instead of a blank page, and offers a retry", async () => {
    await h.mount({ overrides: { "/api/info": () => jsonResponse(502, { error: "bad_gateway", message: "The lab server did not answer." }) } }).catch(() => {});
    expect(await screen.findByTestId("load-error")).toHaveTextContent(/Could not load the lab/);
    expect(screen.getByTestId("retry")).toBeInTheDocument();
    expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "mock"); // never blank, and never claiming more than it knows
    expect(screen.queryByTestId("banner")).toBeNull();
  });

  it("presenter mode shows the talk-track line for the page (the modal is not shown again in the same session); P toggles and Escape leaves", async () => {
    const user = await h.mount();
    await user.click(screen.getByTestId("mode-modal-ok"));
    await user.click(screen.getByTestId("presenter"));
    expect(screen.queryByTestId("mode-modal")).toBeNull();
    expect(screen.getByTestId("presenter-say")).toHaveTextContent(/The claims taken from the 2026-11-21 release notes/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false"));
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    await nav(user, "Diagram");
    expect(screen.getByTestId("presenter-say")).toHaveTextContent(/Everything is simulated/);
    expect(screen.queryByTestId("banner")).toBeNull();
  });

  it("the P shortcut ignores a chord, a held key and focus in a field or on a button; Ctrl+P still belongs to the browser", async () => {
    await h.mount();
    const on = () => screen.getByTestId("presenter").getAttribute("aria-pressed") === "true";
    fireEvent.keyDown(window, { key: "p", ctrlKey: true }); expect(on()).toBe(false);
    fireEvent.keyDown(window, { key: "p", metaKey: true }); expect(on()).toBe(false);
    fireEvent.keyDown(window, { key: "p", altKey: true }); expect(on()).toBe(false);
    fireEvent.keyDown(window, { key: "p", repeat: true }); expect(on()).toBe(false);
    fireEvent.keyDown(screen.getByTestId("mode-mock"), { key: "p" }); expect(on()).toBe(false);
    const area = await screen.findByTestId("trust-text");
    fireEvent.keyDown(area, { key: "p" }); expect(on()).toBe(false);
    fireEvent.keyDown(window, { key: "p" }); expect(on()).toBe(true);
    expect(isPresenterKey({ key: "p", target: document.body })).toBe(true);
    expect(isPresenterKey({ key: "p", repeat: true, target: document.body })).toBe(false);
  });

  it("presenter mode draws one <p> per paragraph of the talk track", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-success"));
    await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("presenter"));
    const say = screen.getByTestId("presenter-say");
    expect(within(say).getAllByText(/./, { selector: "p" }).length).toBeGreaterThanOrEqual(2);
    expect(say.textContent).not.toMatch(/\n\n/);
    expect(say.querySelectorAll("p")[1].textContent).toMatch(/Point at the key comparison/);
  });

  it("the talk track dialog opens with every section, filled for the vertical, one <p> per paragraph", async () => {
    const user = await h.mount();
    await user.click(screen.getByTestId("talk-track-toggle"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/AirGuard Airlines/).length).toBeGreaterThan(0);
    expect(dialog.textContent).toMatch(/The role is assumed and the call is served/);
    expect(dialog.textContent).not.toMatch(/\{\{/);
    expect(dialog.textContent).toMatch(/\(continued\)/);
    for (const p of dialog.querySelectorAll("li p")) expect(p.textContent, "a paragraph holds no blank line").not.toMatch(/\n\s*\n/);
  });

  it("dialogItems keeps ids unique and drops no word", () => {
    const items = dialogItems([{ id: "a", title: "A", say: "one\n\ntwo\n\nthree" }, { id: "b", title: "B", say: "solo" }]);
    expect(items.map((i) => i.id)).toEqual(["a", "a-2", "a-3", "b"]);
    expect(items.map((i) => i.say)).toEqual(["one", "two", "three", "solo"]);
    expect(items[1].title).toBe("A (continued)");
  });

  it("Reset clears the last run, the scenario in the address, and says what it did; a remount does not run the scenario again", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-wrong-trust-principal"));
    await screen.findByTestId("verdict");
    expect(window.location.hash).toBe("#assumed-role/wrong-trust-principal");
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/Reset: the key is back/));
    await screen.findByTestId("result-empty");
    expect(window.location.hash).toBe("#assumed-role");
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(h.lab.calls.filter((c) => c.path === "/api/scenario/wrong-trust-principal")).toHaveLength(1);
    expect(h.lab.calls.some((c) => c.path === "/api/reset" && c.method === "POST")).toBe(true);
  });

  it("every page has a first-level heading and the page's own intro line", async () => {
    const user = await h.mount();
    for (const p of PAGES) { await nav(user, p); expect(screen.getByTestId("head-intro").textContent.length, p).toBeGreaterThan(30); }
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("the random fallback fills the array in place (a typed array's map() would leave it zero), so ids differ", () => {
    const a = fillRandom(new Uint8Array(8), undefined); const b = fillRandom(new Uint8Array(8), {});
    expect([...a].some((n) => n !== 0)).toBe(true);
    expect(a).not.toEqual(b);
    const real = fillRandom(new Uint8Array(8), { getRandomValues: (x) => { x.fill(7); return x; } });
    expect([...real]).toEqual(Array(8).fill(7));
  });

  it("the client's workspace-id pattern is the server's", () => {
    expect(WORKSPACE_ID.source).toBe("^[a-z0-9][a-z0-9-]{0,31}$");
    for (const ok of ["w-0123456789abcdef", "a", "0"]) expect(WORKSPACE_ID.test(ok), ok).toBe(true);
    for (const bad of ["", "-a", "A", "a".repeat(33), "a b"]) expect(WORKSPACE_ID.test(bad), bad).toBe(false);
  });
});

describe("the configured customer reaches the first load", () => {
  it("the first story request carries NO vertical, so a non-default customer vertical and its cast overrides are what the page shows", async () => {
    await h.mount({ page: "stories", customer: validateConfig({ vertical: "health", cast: { brand: "Test Brand Co" } }) });
    await screen.findByTestId("story-grid");
    const firstStory = h.lab.calls.find((c) => c.path === "/api/story");
    expect(firstStory.search).toBe("");
    expect(text("stories-for")).toContain("Test Brand Co");
    expect(screen.getByTestId("vertical-select")).toHaveValue("health");
    expect(VERTICALS.health.cast.castBrand).not.toBe("Test Brand Co");
  });
});

describe("a run in flight, a mode press that changes nothing, a deliberate hash change", () => {
  const slow = (ms) => async (init, u, go) => { await new Promise((r) => setTimeout(r, ms)); return go(); };

  it("pressing the active Mock button changes nothing: no request, no reload", async () => {
    const user = await h.mount();
    const before = h.lab.calls.length;
    await user.click(screen.getByTestId("mode-mock"));
    await new Promise((r) => setTimeout(r, 100));
    expect(h.lab.calls.length).toBe(before);
    expect(h.lab.calls.some((c) => c.path === "/api/mode")).toBe(false);
  });

  it("a result that arrives after the visitor changed the vertical is dropped; the address loses the scenario", async () => {
    const user = await h.mount({ overrides: { "/api/scenario/success": slow(400) } });
    await user.click(await screen.findByTestId("scenario-success"));
    expect(window.location.hash).toBe("#assumed-role/success");
    await user.selectOptions(screen.getByTestId("vertical-select"), "finance");
    expect(window.location.hash).toBe("#assumed-role");
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByTestId("verdict")).toBeNull();
    await screen.findByTestId("result-empty");
  });

  it("Reset while a run is in flight says so and does nothing (the shared menu cannot disable its button); afterwards it works", async () => {
    const user = await h.mount({ overrides: { "/api/scenario/success": slow(400) } });
    await user.click(await screen.findByTestId("scenario-success"));
    await user.click(screen.getByTestId("reset"));
    expect(screen.getByTestId("reset-note")).toHaveTextContent(/A run is in progress/);
    expect(h.lab.calls.some((c) => c.path === "/api/reset")).toBe(false);
    await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("reset"));
    await screen.findByTestId("result-empty");
    expect(h.lab.calls.some((c) => c.path === "/api/reset")).toBe(true);
  });

  it("a mode switch clears the scenario from the address too", async () => {
    const user = await h.mount({ overrides: { "/api/info": async (_i, _u, go) => { const r = await go(); return jsonResponse(200, { ...(await r.json()), realAvailable: true }); } } });
    await user.click(await screen.findByTestId("scenario-success"));
    await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("mode-real"));
    await waitFor(() => expect(window.location.hash).toBe("#assumed-role"));
  });

  it("an address that changes to a scenario runs it (a link while the page is open); the page's own buttons never run it twice", async () => {
    const user = await h.mount();
    await screen.findByTestId("scenario-success");
    window.location.hash = "#assumed-role/external-id-missing";
    await waitFor(() => expect(text("verdict-code")).toBe("external_id_missing"));
    await user.click(screen.getByTestId("scenario-wrong-trust-principal"));
    await waitFor(() => expect(text("verdict-code")).toBe("trust_principal_mismatch"));
    await new Promise((r) => setTimeout(r, 150));
    expect(h.lab.calls.filter((c) => c.path === "/api/scenario/external-id-missing")).toHaveLength(1);
    expect(h.lab.calls.filter((c) => c.path === "/api/scenario/wrong-trust-principal")).toHaveLength(1);
  });

  it("the Limits page shows customer.config warnings; the Stories page names a missing talk track", async () => {
    await h.mount({ page: "limits", customer: validateConfig({ name: "<b>", vertical: "mining" }) });
    expect(await screen.findByTestId("limits-config-warnings")).toHaveTextContent(/name:/);
  });
});

describe("the version button, and a workspace the server forgot", () => {
  it("the version button opens THIS lab's own notes (its sourced claims and the Limits link), never another lab's release notes", async () => {
    const user = await h.mount();
    await user.click(screen.getByTestId("version"));
    const dialog = await screen.findByTestId("about-dialog");
    expect(dialog).toHaveTextContent("Privilege Bedrock assume-role LAB");
    expect(dialog).toHaveTextContent(/v0\.1\.0/);
    const info = await h.lab.json("/api/info");
    for (const claim of info.sourced) expect(dialog).toHaveTextContent(claim);
    expect(dialog.querySelector("a[href='#limits']")).toBeTruthy();
    expect(screen.queryByTestId("release-notes")).toBeNull();
    for (const other of [/Token Workbench/, /PingFederate/, /PingOne/, /Wrong-token/, /Real mode maturity/]) expect(document.body.textContent).not.toMatch(other);
  });

  // The server forgets a tab's workspace when 20 other workspaces have been used since (here: 21 other tabs' first requests).
  const evict = async () => { for (let i = 0; i < 21; i++) await fetch(`${h.lab.base}/api/state`, { headers: { "x-workspace": `evict-${i}` } }); };

  it("a tab that already used its workspace and finds it forgotten gets a plain banner and starts over; its own Reset does not", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-success"));
    await screen.findByTestId("verdict");
    await screen.findByTestId("ro-table");
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
    await evict();
    await user.click(screen.getByTestId("scenario-wrong-trust-principal"));
    const banner = await screen.findByTestId("workspace-forgotten");
    expect(banner).toHaveTextContent(/The server forgot this workspace; the lab was reset to its defaults/);
    await user.click(screen.getByTestId("workspace-forgotten-dismiss"));
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
    // the visitor's own Reset is not "forgotten"
    await user.click(await screen.findByTestId("scenario-success"));
    await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("reset"));
    await screen.findByTestId("result-empty");
    await user.click(await screen.findByTestId("call"));
    await screen.findByTestId("verdict");
    await screen.findByTestId("ro-table"); // let the call's last request finish: a late response from this test must not reach the next one
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
  });

  it("the request that REVEALED the forgetting is not lost: a call that really ran shows its verdict and the advance box goes back to 0", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("call"));
    await screen.findByTestId("verdict");
    await screen.findByTestId("ro-table");
    await evict();
    await user.click(screen.getByTestId("advance-10m"));
    expect(screen.getByTestId("advance")).toHaveValue("600000");
    await user.click(screen.getByTestId("call-advance"));
    await screen.findByTestId("workspace-forgotten");
    await waitFor(() => expect(text("verdict-code")).toBe("success"));
    await waitFor(() => expect(screen.getByTestId("advance")).toHaveValue("0"));
    await waitFor(() => expect(screen.getByTestId("clock-now")).toHaveTextContent("600400")); // the call ran on the NEW workspace: 10 minutes + 400 ms
    await screen.findByTestId("ro-table");
  });

  it("a forgotten workspace clears the scenario from the address first, so the remount does not run it again", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-success"));
    await screen.findByTestId("verdict");
    await screen.findByTestId("ro-table");
    await evict();
    await user.click(screen.getByTestId("scenario-wrong-trust-principal"));
    await screen.findByTestId("workspace-forgotten");
    await waitFor(() => expect(text("verdict-code")).toBe("trust_principal_mismatch"));
    expect(window.location.hash).toBe("#assumed-role");
    await new Promise((r) => setTimeout(r, 200));
    expect(h.lab.calls.filter((c) => c.path === "/api/scenario/wrong-trust-principal")).toHaveLength(1);
    expect(h.lab.calls.filter((c) => c.path === "/api/scenario/success")).toHaveLength(1);
    await screen.findByTestId("ro-table");
  });

  it("a Reset after the server forgot the workspace (the tab has not noticed yet) does not raise the banner either", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-success"));
    await screen.findByTestId("verdict");
    await screen.findByTestId("ro-table");
    await evict();
    await user.click(screen.getByTestId("reset"));
    await screen.findByTestId("result-empty");
    await user.click(await screen.findByTestId("call"));
    await screen.findByTestId("verdict");
    await screen.findByTestId("ro-table");
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
  });

  it("detection does not depend on the order answers arrive in: a brand-new tab whose first requests run in parallel never shows the banner", async () => {
    const slow = async (_init, _u, go) => { await new Promise((r) => setTimeout(r, 250)); return go(); };
    await h.mount({ page: "assumed-role/success", overrides: { "/api/state": slow } });
    await screen.findByTestId("verdict");
    await screen.findByTestId("scenario-success");
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
    const events = [];
    const on = () => events.push("forgotten"); window.addEventListener(WORKSPACE_FORGOTTEN, on);
    noteWorkspaceHeaders("0", null); noteWorkspaceHeaders("1", null); noteWorkspaceHeaders(null, null);
    expect(events).toEqual([]);
    noteWorkspaceHeaders("1", "1");
    expect(events).toEqual(["forgotten"]);
    window.removeEventListener(WORKSPACE_FORGOTTEN, on);
    await screen.findByTestId("ro-table");
  });

  it("the headers are read on an error status too (a 400 that carries them is still seen)", async () => {
    const user = await h.mount({ overrides: { "/api/scenario/success": () => new Response(JSON.stringify({ error: "x", message: "refused" }), { status: 400, headers: { "content-type": "application/json", "x-workspace-fresh": "1", "x-workspace-forgotten": "1" } }) } });
    await user.click(await screen.findByTestId("scenario-success"));
    expect(await screen.findByTestId("workspace-forgotten")).toBeInTheDocument();
  });

  it("a failed first load and a Retry ask for NO vertical, so the configured customer vertical arrives", async () => {
    let n = 0;
    await h.mount({ customer: validateConfig({ vertical: "health", cast: { brand: "Test Brand Co" } }), overrides: { "/api/story": async (_i, _u, go) => (++n === 1 ? jsonResponse(502, { error: "bad_gateway", message: "down" }) : go()) } }).catch(() => {});
    await userEvent.setup().click(await screen.findByTestId("retry"));
    await waitFor(() => expect(document.querySelector("[data-testid='mode']")).toBeTruthy());
    const stories = h.lab.calls.filter((c) => c.path === "/api/story");
    expect(stories.map((c) => c.search)).toEqual(["", ""]);
    expect(screen.getByTestId("vertical-select")).toHaveValue("health");
  });

  it("a first visit is not 'forgotten' even though the server just created the workspace", async () => {
    await h.mount();
    await screen.findByTestId("scenario-success");
    expect(screen.queryByTestId("workspace-forgotten")).toBeNull();
  });
});
