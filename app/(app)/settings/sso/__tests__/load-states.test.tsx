/**
 * SSO settings load states for a known Enterprise plan: a failed config read
 * shows "Couldn't load SSO settings." with Try again -- never the blank
 * "not configured" form -- and a TIER_REQUIRED 402 shows the page's own
 * gate naming the plan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithKnownPlan } from "@/lib/contexts/__tests__/org-load-harness";
import { resourceLimitBody, tierRequiredBody } from "@/lib/plan/__tests__/tier-required-fixture";
import SSOSettingsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/sso",
  useSearchParams: () => new URLSearchParams(),
}));

const CONFIG = {
  id: "c-1", providerName: "Okta", idpEntityId: "http://idp.example.test", idpSsoUrl: "https://idp.example.test/sso",
  idpCertificate: "••••", spEntityId: "https://sp.example.test", attributeMapping: { email: "email", name: "displayName" },
  allowedDomains: ["example.test"], isActive: true,
};

const res = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubConfig(...answers: Array<() => Response | Promise<Response>>) {
  let i = 0;
  const fetchMock = vi.fn(async (url: string) => {
    if (!String(url).includes("/api/auth/saml/config")) return res(404, {});
    const answer = answers[Math.min(i, answers.length - 1)];
    i += 1;
    return answer();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ERROR_TEXT = "Couldn't load SSO settings.";
const expectNoForm = () => {
  expect(screen.queryByPlaceholderText("company.com, subsidiary.com")).toBeNull();
  expect(screen.queryByText("Service Provider Details")).toBeNull();
};

describe("SSO settings: loading the config", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["a 500", () => res(500, { success: false, error: "Failed to fetch SSO configuration" })],
    ["a non-JSON 502", () => res(502, "<html>Bad gateway</html>")],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["another 402", () => res(402, resourceLimitBody())],
    ["a 200 with success: false", () => res(200, { success: false })],
  ])("%s → the error message with Try again, never a blank form", async (_label, answer) => {
    stubConfig(answer);
    await renderWithKnownPlan(<SSOSettingsPage />, "enterprise");
    expect(await screen.findByText(ERROR_TEXT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expectNoForm();
    expect(screen.queryByText(/This feature is on/)).toBeNull();
  });

  it("Try again → the saved config", async () => {
    const fetchMock = stubConfig(() => res(500, { success: false }), () => res(200, { success: true, data: CONFIG }));
    await renderWithKnownPlan(<SSOSettingsPage />, "enterprise");
    await screen.findByText(ERROR_TEXT);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(await screen.findByText("Service Provider Details")).toBeTruthy();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("200 with data: null → the empty form (not configured), no error", async () => {
    stubConfig(() => res(200, { success: true, data: null }));
    await renderWithKnownPlan(<SSOSettingsPage />, "enterprise");
    expect(await screen.findByPlaceholderText("company.com, subsidiary.com")).toBeTruthy();
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expect(screen.queryByText("Service Provider Details")).toBeNull();
  });

  it("200 with a config → populated", async () => {
    stubConfig(() => res(200, { success: true, data: CONFIG }));
    await renderWithKnownPlan(<SSOSettingsPage />, "enterprise");
    expect(await screen.findByText("Service Provider Details")).toBeTruthy();
    expect(screen.getByDisplayValue("example.test")).toBeTruthy();
  });

  it("402 TIER_REQUIRED → the gate naming the plan, no error message, no form", async () => {
    stubConfig(() => res(402, tierRequiredBody("enterprise", "/settings/billing?upgrade=enterprise")));
    await renderWithKnownPlan(<SSOSettingsPage />, "enterprise");
    expect(await screen.findByText("This feature is on Enterprise.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/settings/billing/upgrade");
    expect(screen.queryByText(ERROR_TEXT)).toBeNull();
    expectNoForm();
  });
});
