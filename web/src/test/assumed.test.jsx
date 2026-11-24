import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { SCENARIOS } from "../../../server/src/scenarios.js";
import { IAM_SNIPPETS } from "../../../server/src/data.js";
import { screen, text, useLabHarness, waitFor, within } from "./util.jsx";

const h = useLabHarness();
const HOPS = ["key", "ai-guard", "provider-auth", "bedrock-invoke", "metering", "audit"];
const type = (el, value) => fireEvent.change(el, { target: { value } });
// What the verdict must say for each scenario: the hand-written expectation in scenarios.js, never the engine's own answer.
const expectedCode = (s) => (s.kind === "call" ? s.expect.calls.at(-1).code : s.kind === "vertex" ? s.expect.code : s.kind === "key-shape" ? "key_shape_as_expected" : "success");

describe("Assumed role page: scenarios", () => {
  it("shows all thirteen scenarios as buttons from GET /api/scenarios, in two groups", async () => {
    await h.mount();
    await screen.findByTestId("scenarios");
    expect(screen.getAllByTestId(/^scenario-[a-z-]+$/)).toHaveLength(13);
    expect(within(screen.getByTestId("scenarios-bedrock")).getAllByRole("button")).toHaveLength(10);
    expect(within(screen.getByTestId("scenarios-vertex")).getAllByRole("button")).toHaveLength(3);
  });

  for (const s of SCENARIOS.filter((x) => x.kind !== "vertex")) {
    it(`scenario ${s.id}: the verdict equals the hand-written expectation, the six hops are listed and the run leaves its record`, async () => {
      const user = await h.mount();
      await user.click(await screen.findByTestId(`scenario-${s.id}`));
      await screen.findByTestId("verdict");
      expect(text("verdict-code")).toBe(expectedCode(s));
      expect(screen.getByTestId("expectation")).toHaveTextContent(/matches the expectation/);
      expect(screen.getByTestId("scenario-summary").textContent.length).toBeGreaterThan(40);
      if (s.kind === "call") {
        const strips = screen.getAllByTestId("hop-strip");
        expect(strips).toHaveLength(s.calls.length);
        strips.forEach((strip, i) => HOPS.forEach((id, n) => expect(within(strip).getByTestId(`hop-${id}`).getAttribute("data-status")).toBe(s.expect.calls[i].hops[n].split(":")[1])));
        if (!s.expect.calls.at(-1).ok) expect(screen.getByTestId("verdict-fix").textContent.length).toBeGreaterThan(10);
      }
      expect(screen.getByTestId("gateway-trace")).toBeInTheDocument();
      expect(await screen.findByTestId("ro-table")).toBeInTheDocument();
      expect(screen.getByTestId("raw-result")).toBeInTheDocument();
    });
  }

  it("a scenario that is about the Vertex tab opens it and runs there", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-vertex-with-role"));
    await waitFor(() => expect(text("verdict-code")).toBe("success"));
    expect(window.location.hash).toBe("#vertex/vertex-with-role");
    expect(screen.getByTestId("vertex-panel")).toBeInTheDocument();
  });

  it("the stored-vs-assumed scenario shows both key objects and the stored value appears nowhere", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-stored-vs-assumed-key-shape"));
    const keys = await screen.findByTestId("scenario-keys");
    expect(keys.textContent).toMatch(/\*{8}/);
    expect(document.body.textContent).not.toMatch(/MOCK-scenario-credential/);
  });

  it("a guard block stops the call before the role is assumed: hops 3 to 5 are not reached and the audit hop still ran", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-guard-still-applies"));
    await screen.findByTestId("verdict");
    expect(screen.getByTestId("hop-ai-guard").getAttribute("data-status")).toBe("failed");
    for (const id of ["provider-auth", "bedrock-invoke", "metering"]) expect(screen.getByTestId(`hop-${id}`).getAttribute("data-status")).toBe("skipped");
    expect(screen.getByTestId("hop-audit").getAttribute("data-status")).toBe("done");
  });

  it("a scenario never touches the live key: the audit log stays empty", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("scenario-success"));
    await screen.findByTestId("verdict");
    expect(screen.getByTestId("audit-empty")).toBeInTheDocument();
  });
});

describe("Assumed role page: the key", () => {
  it("shows the stored key and the assumed-role key side by side: a masked credential entry on one, no credential entry on the other", async () => {
    await h.mount();
    const stored = await screen.findByTestId("key-stored");
    const assumed = screen.getByTestId("key-assumed");
    expect(stored.textContent).toMatch(/credential/);
    expect(stored.textContent).toMatch(/\*{8}/);
    expect(within(assumed).getByTestId("key-assumed-json").textContent).not.toMatch(/credential/i);
    expect(within(assumed).getByTestId("key-assumed-json").textContent).toMatch(/roleArn/);
  });

  it("saves a stored-credential key: the value is write-only (never shown, field cleared), a call uses it, and an assumed-role key has no credential field to fill", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("key-mode-stored-credential"));
    const cred = screen.getByTestId("key-credential");
    expect(cred).toHaveAttribute("type", "password");
    type(cred, "not-a-mock");
    expect(screen.getByTestId("key-problems")).toHaveTextContent(/MOCK-/);
    expect(screen.getByTestId("key-save")).toBeDisabled();
    type(cred, "MOCK-ui-credential-4242");
    await user.click(screen.getByTestId("key-save"));
    await screen.findByTestId("key-saved");
    expect(screen.getByTestId("key-credential")).toHaveValue("");
    expect(document.body.textContent).not.toContain("MOCK-ui-credential-4242");
    expect(text("key-live-json")).toMatch(/\*{8}/);
    await user.click(screen.getByTestId("call"));
    await screen.findByTestId("verdict");
    expect(text("verdict-code")).toBe("success");
    expect(screen.getByTestId("hop-provider-auth-status")).toHaveTextContent("done");
    await user.click(screen.getByTestId("key-mode-assumed-role"));
    expect(screen.queryByTestId("key-credential")).toBeNull();
  });

  it("shows the server's 400 for a key it refuses, in plain words", async () => {
    const user = await h.mount({ overrides: { "/api/key": async () => new Response(JSON.stringify({ error: "bad_budget", message: "budgetTokens must be a whole number from 0 to 1000000" }), { status: 400, headers: { "content-type": "application/json" } }) } });
    await user.click(await screen.findByTestId("key-save"));
    expect(await screen.findByTestId("key-error")).toHaveTextContent(/budgetTokens must be a whole number/);
  });
});

describe("Assumed role page: policies and Evaluate", () => {
  it("evaluates the default policies as allowed, and a wrong trust principal as its own named result with the fix", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("evaluate"));
    await screen.findByTestId("eval-result");
    expect(text("eval-result-code")).toBe("success");
    const trust = screen.getByTestId("trust-text");
    type(trust, trust.value.replace("444455556666", "999900001111"));
    await user.click(screen.getByTestId("evaluate"));
    await waitFor(() => expect(text("eval-result-code")).toBe("trust_principal_mismatch"));
    expect(text("eval-result-fix")).toMatch(/Principal\.AWS/);
    expect(document.querySelector("[data-testid='eval-result-steps']")).toBeTruthy();
  });

  it("a policy that is not JSON is a named result with the reason, never a pass", async () => {
    const user = await h.mount();
    type(await screen.findByTestId("permission-text"), "{ not json");
    await user.click(screen.getByTestId("evaluate"));
    await waitFor(() => expect(text("eval-result-code")).toBe("permission_policy_invalid"));
    expect(screen.getByTestId("eval-result-policy-error")).toHaveTextContent(/permission policy was not read/);
    expect(screen.getByTestId("eval-result-chip")).toHaveTextContent("REFUSED");
  });

  it("the size limit: the counter names the limit, a policy over it is still sent and the server's named answer is shown", async () => {
    const user = await h.mount();
    const trust = await screen.findByTestId("trust-text");
    type(trust, `{"Version":"2012-10-17","Statement":[]${" ".repeat(10100)}}`);
    expect(screen.getByTestId("trust-text-count")).toHaveTextContent(/10\d{3} of 10000 characters: over the limit/);
    await user.click(screen.getByTestId("evaluate"));
    await waitFor(() => expect(text("eval-result-code")).toBe("trust_policy_invalid"));
    expect(screen.getByTestId("eval-result-policy-error")).toHaveTextContent(/policy_too_large/);
  });

  it("shows the server's 400 for a bad field plainly, with its code, and no result card", async () => {
    const user = await h.mount();
    type(await screen.findByTestId("ev-caller"), "someone@elsewhere");
    await user.click(screen.getByTestId("evaluate"));
    const err = await screen.findByTestId("eval-error");
    expect(err).toHaveTextContent(/The server refused the request: the field "callerPrincipal" is not valid \(bad_input\)/);
    expect(screen.queryByTestId("eval-result")).toBeNull();
  });

  it("a time field that is not a number is caught before it is sent", async () => {
    await h.mount();
    type(await screen.findByTestId("ev-now"), "soon");
    expect(screen.getByTestId("ev-problem")).toBeInTheDocument();
    expect(screen.getByTestId("evaluate")).toBeDisabled();
  });

  it("a held session that has expired is refused, and refresh turns it into session_refreshed", async () => {
    const user = await h.mount();
    type(await screen.findByTestId("ev-now"), "5000");
    type(screen.getByTestId("ev-session"), "5000");
    await user.click(screen.getByTestId("evaluate"));
    await waitFor(() => expect(text("eval-result-code")).toBe("session_expired"));
    await user.click(screen.getByTestId("ev-refresh"));
    await user.click(screen.getByTestId("evaluate"));
    await waitFor(() => expect(text("eval-result-code")).toBe("session_refreshed"));
  });

  it("drafts survive a trip to another page, and Restore puts the defaults back", async () => {
    const user = await h.mount();
    type(await screen.findByTestId("trust-text"), '{"Version":"2012-10-17","Statement":[]}');
    await user.click(screen.getByRole("link", { name: "Limits (UNVERIFIED)" }));
    await screen.findByTestId("limits-sourced");
    await user.click(screen.getByRole("link", { name: "Assumed role" }));
    expect((await screen.findByTestId("trust-text")).value).toBe('{"Version":"2012-10-17","Statement":[]}');
    await user.click(screen.getByTestId("policy-defaults"));
    expect(screen.getByTestId("trust-text").value).toMatch(/AllowGatewayToAssume/);
  });
});

describe("Assumed role page: a call, the lab clock and the session", () => {
  it("a call is served, shows the six hops, the budget, the gateway trace over the six hops and an audit entry", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("call"));
    await screen.findByTestId("verdict");
    expect(text("verdict-code")).toBe("success");
    expect(screen.getByTestId("verdict-chip")).toHaveTextContent("SERVED");
    HOPS.forEach((id) => expect(screen.getByTestId(`hop-${id}`).getAttribute("data-status")).toBe("done"));
    expect(screen.getByTestId("meter-text")).toHaveTextContent("128 of 2000 tokens spent");
    await waitFor(() => expect(screen.getByTestId("audit-1")).toHaveTextContent("success"));
    const trace = screen.getByTestId("gateway-trace");
    for (const label of ["The LLM key", "AI Guard (lab stub)", "Provider authentication", "Bedrock invoke", "Metering", "Audit"]) expect(trace.textContent).toContain(label);
    expect(screen.getByTestId("session-now")).toHaveTextContent(/expires at 1:00:00\.000/);
  });

  it("moving the lab clock to the expiry exactly makes the next call session_refreshed on a new session", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("call"));
    await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("advance-expiry"));
    expect(screen.getByTestId("advance")).toHaveValue("3599600");
    await user.click(screen.getByTestId("call-advance"));
    await waitFor(() => expect(text("verdict-code")).toBe("session_refreshed"));
    expect(h.lab.calls.filter((c) => c.path === "/api/call").at(-1).body.advanceMs).toBe(3599600);
    expect(screen.getByTestId("verdict-session")).toHaveTextContent(/expires at 2:00:00/);
    await waitFor(() => expect(screen.getByTestId("audit-2")).toHaveTextContent("session_refreshed"));
    expect(screen.getByTestId("advance")).toHaveValue("0");
  });

  it("1 ms before the expiry the session is still reused (no new assume); the call itself then crosses the expiry and the next call refreshes", async () => {
    const user = await h.mount();
    await user.click(await screen.findByTestId("call"));
    await screen.findByTestId("verdict");
    await user.click(screen.getByTestId("advance-before"));
    expect(screen.getByTestId("advance")).toHaveValue("3599599");
    await user.click(screen.getByTestId("call-advance"));
    await waitFor(() => expect(h.lab.calls.filter((c) => c.path === "/api/call").length).toBe(2));
    await waitFor(() => expect(screen.getByTestId("audit-2")).toHaveTextContent("success"));
    expect(screen.getByTestId("session-now")).toHaveTextContent(/expired/);
    await user.click(screen.getByTestId("call"));
    await waitFor(() => expect(text("verdict-code")).toBe("session_refreshed"));
  });

  it("presets that need a session are off until there is one", async () => {
    await h.mount();
    expect(await screen.findByTestId("advance-expiry")).toBeDisabled();
    expect(screen.getByTestId("session-now")).toHaveTextContent(/none yet/);
  });

  it("each call sends the policies in the editors; a call whose policy lacks the invoke permission is refused with its named result and fix", async () => {
    const user = await h.mount();
    const perm = await screen.findByTestId("permission-text");
    type(perm, perm.value.replace("bedrock:InvokeModel", "bedrock:ListFoundationModels"));
    await user.click(screen.getByTestId("call"));
    await screen.findByTestId("verdict");
    expect(text("verdict-code")).toBe("permission_missing_invoke");
    expect(screen.getByTestId("verdict-fix")).toHaveTextContent(/bedrock:InvokeModel/);
    expect(screen.getByTestId("hop-provider-auth").getAttribute("data-status")).toBe("done");
    expect(screen.getByTestId("hop-bedrock-invoke").getAttribute("data-status")).toBe("failed");
    expect(h.lab.calls.find((c) => c.path === "/api/call").body.aws.permission).toContain("ListFoundationModels");
  });

  it("the mock Bedrock failing is its own named result, not an IAM one", async () => {
    const user = await h.mount();
    await user.selectOptions(await screen.findByTestId("provider-state"), "down");
    await user.click(screen.getByTestId("call"));
    await screen.findByTestId("verdict");
    expect(text("verdict-code")).toBe("provider_unavailable");
  });

  it("the server's 400 for a prompt over the limit is shown plainly and no verdict appears", async () => {
    const user = await h.mount();
    type(await screen.findByTestId("prompt"), "x".repeat(20500));
    expect(screen.getByTestId("prompt-count")).toHaveTextContent(/20500 of 20000/);
    await user.click(screen.getByTestId("call"));
    expect(await screen.findByTestId("call-error")).toHaveTextContent(/over 20000 characters/);
    expect(screen.queryByTestId("verdict")).toBeNull();
  });

  it("a guard-marker prompt is blocked by the stub, and shown as such", async () => {
    const user = await h.mount();
    type(await screen.findByTestId("prompt"), "hello [[guard-block]]");
    await user.click(screen.getByTestId("call"));
    await screen.findByTestId("verdict");
    expect(text("verdict-code")).toBe("guard_blocked");
  });
});

describe("Assumed role page: IAM snippets", () => {
  it("shows the server's snippets, placeholder ids only, with Copy and a way into the editor", async () => {
    const user = await h.mount();
    const box = await screen.findByTestId("snippets");
    for (const id of ["trust", "permission", "cli"]) expect(within(box).getByTestId(`snippet-${id}`)).toBeInTheDocument();
    for (const m of box.textContent.matchAll(/::(\d{12})\b/g)) expect(["111122223333", "444455556666", "999900001111"]).toContain(m[1]);
    expect(box.textContent).toMatch(/example-bedrock-invoke-role/);
    expect(IAM_SNIPPETS.length).toBe(4);
    type(screen.getByTestId("trust-text"), "x");
    await user.click(screen.getByTestId("snippet-use-trust"));
    expect(screen.getByTestId("trust-text").value).toMatch(/AllowGatewayToAssume/);
  });

  it("Copy says what happened, including when the browser refuses", async () => {
    const user = await h.mount();
    await screen.findByTestId("snippets");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("blocked")) } });
    await user.click(screen.getByTestId("snippet-copy-cli"));
    await waitFor(() => expect(screen.getByTestId("snippet-cli")).toHaveTextContent(/blocked the clipboard|Could not copy/));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.resolve() } });
    await user.click(screen.getByTestId("snippet-copy-cli"));
    await waitFor(() => expect(screen.getByTestId("snippet-cli")).toHaveTextContent("Copied"));
  });
});
