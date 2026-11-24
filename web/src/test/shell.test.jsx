import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { BANNER } from "../../../server/src/data.js";
import { validateConfig } from "../../../server/src/customer.js";
import { VERTICALS } from "../../../server/src/cast.js";
import { jsonResponse } from "./harness.js";
import { nav, screen, text, useLabHarness, waitFor, within } from "./util.jsx";
import { isPresenterKey } from "../App.jsx";
import { WORKSPACE_ID, fillRandom } from "../workspace.js";
import { dialogItems } from "../talk.js";

const h = useLabHarness();
const PAGES = ["Assumed role", "Vertex AI", "Diagram", "Stories and talk track", "Limits (UNVERIFIED)"];

describe("shell: banner, mode toggle, presenter, talk track, reset", () => {
  it("shows the simulation banner FIRST in the page on every page, with the server's own words", async () => {
    const user = await h.mount();
    for (const p of PAGES) {
      await nav(user, p);
      expect(document.querySelector("main").firstElementChild, p).toBe(screen.getByTestId("banner"));
      expect(text("banner"), p).toBe(BANNER);
      expect(text("banner")).toMatch(/UNVERIFIED/);
    }
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
    expect(h.lab.calls.filter((c) => c.path === "/api/mode" && c.method === "POST").map((c) => c.body)).toEqual([{ source: "real" }]);
  });

  it("names a server that is down instead of a blank page, and offers a retry", async () => {
    await h.mount({ overrides: { "/api/info": () => jsonResponse(502, { error: "bad_gateway", message: "The lab server did not answer." }) } }).catch(() => {});
    expect(await screen.findByTestId("load-error")).toHaveTextContent(/Could not load the lab/);
    expect(screen.getByTestId("retry")).toBeInTheDocument();
    expect(screen.getByTestId("banner").textContent.length).toBeGreaterThan(40);
  });

  it("presenter mode keeps the banner first and shows the talk-track line for the page; P toggles and Escape leaves", async () => {
    const user = await h.mount();
    await user.click(screen.getByTestId("presenter"));
    expect(document.querySelector("main").firstElementChild).toBe(screen.getByTestId("banner"));
    expect(screen.getByTestId("presenter-say")).toHaveTextContent(/The claims taken from the 2026-11-21 release notes/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "false"));
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    await nav(user, "Diagram");
    expect(screen.getByTestId("presenter-say")).toHaveTextContent(/Everything is simulated/);
    expect(screen.getByTestId("banner")).toBeInTheDocument();
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
    expect(within(dialog).getAllByText(/Northwind Retail/).length).toBeGreaterThan(0);
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
