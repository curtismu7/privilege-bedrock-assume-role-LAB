import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { SCENARIOS } from "../../../server/src/scenarios.js";
import { screen, text, useLabHarness, waitFor } from "./util.jsx";

const h = useLabHarness();
const type = (el, value) => fireEvent.change(el, { target: { value } });

describe("Vertex AI tab", () => {
  it("says the gateway uses its own service account: no role assumed, no external ID, no session", async () => {
    await h.mount({ page: "vertex" });
    const panel = await screen.findByTestId("vertex-panel");
    expect(panel.textContent).toMatch(/no role is assumed/);
    expect(panel.textContent).toMatch(/no external ID/);
    expect(panel.textContent).toMatch(/no session/);
    expect(panel.textContent).toMatch(/UNVERIFIED/);
  });

  for (const s of SCENARIOS.filter((x) => x.kind === "vertex")) {
    it(`scenario ${s.id}: the verdict is ${s.expect.code}, as written by hand`, async () => {
      const user = await h.mount({ page: "vertex" });
      await user.click(await screen.findByTestId(`scenario-${s.id}`));
      await screen.findByTestId("verdict");
      expect(text("verdict-code")).toBe(s.expect.code);
      expect(screen.getByTestId("expectation")).toHaveTextContent(/matches the expectation/);
      expect(screen.getByTestId("verdict-chip")).toHaveTextContent(s.expect.ok ? "SERVED" : "REFUSED");
      if (!s.expect.ok) expect(screen.getByTestId("verdict-fix").textContent).toMatch(/aiplatform/);
      expect(screen.getByTestId("gateway-trace")).toBeInTheDocument();
      expect(await screen.findByTestId("ro-table")).toBeInTheDocument();
    });
  }

  it("evaluates the example policy, then a policy for another service account, then a viewer role, each its own named result", async () => {
    const user = await h.mount({ page: "vertex" });
    await user.click(await screen.findByTestId("vertex-evaluate"));
    await waitFor(() => expect(text("vertex-eval-code")).toBe("success"));
    const area = screen.getByTestId("vertex-policy");
    type(area, area.value.replace("gateway-vertex@", "someone-else@"));
    await user.click(screen.getByTestId("vertex-evaluate"));
    await waitFor(() => expect(text("vertex-eval-code")).toBe("vertex_role_missing"));
    type(screen.getByTestId("vertex-policy"), area.value.replace("someone-else@", "gateway-vertex@").replace("roles/aiplatform.user", "roles/viewer"));
    await user.click(screen.getByTestId("vertex-evaluate"));
    await waitFor(() => expect(text("vertex-eval-code")).toBe("vertex_role_insufficient"));
    expect(text("vertex-eval-fix")).toMatch(/roles\/aiplatform\.user/);
  });

  it("an unreadable policy is a named result; a real-looking service account is the server's plain 400", async () => {
    const user = await h.mount({ page: "vertex" });
    type(await screen.findByTestId("vertex-policy"), "[1,");
    await user.click(screen.getByTestId("vertex-evaluate"));
    await waitFor(() => expect(text("vertex-eval-code")).toBe("vertex_policy_invalid"));
    type(screen.getByTestId("vertex-account"), "real.person@gmail.com");
    await user.click(screen.getByTestId("vertex-evaluate"));
    expect(await screen.findByTestId("vertex-error")).toHaveTextContent(/serviceAccount.*not valid \(bad_input\)/);
    expect(screen.queryByTestId("vertex-eval")).toBeNull();
  });

  it("a scenario that belongs to the Assumed role page opens it and runs there", async () => {
    const user = await h.mount({ page: "vertex" });
    await user.click(await screen.findByTestId("scenario-success"));
    await waitFor(() => expect(text("verdict-code")).toBe("success"));
    expect(window.location.hash).toBe("#assumed-role/success");
    expect(screen.getByTestId("key-panel")).toBeInTheDocument();
  });
});
