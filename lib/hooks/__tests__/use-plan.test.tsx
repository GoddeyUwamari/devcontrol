/**
 * usePlan status mapping. The plan is known only when the organization is
 * ready with a recognised tier; while it isn't, the booleans keep their old
 * free fallback (existing callers) but status is never "known".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePlan } from "@/lib/hooks/use-plan";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => auth.value }));

const retry = vi.fn(async () => {});

function plan(organizationStatus: string, subscriptionTier?: unknown, withOrg = true, effectiveTier?: unknown) {
  auth.value = {
    organizationStatus,
    organization: withOrg
      ? { id: "org-1", subscriptionTier, ...(effectiveTier === undefined ? {} : { effectiveTier }) }
      : null,
    retryOrganizationLoad: retry,
  };
  return renderHook(() => usePlan()).result.current;
}

beforeEach(() => retry.mockClear());

describe("usePlan status", () => {
  it.each(["idle", "loading"])("%s → loading, not known, booleans fall back to free", (s) => {
    const p = plan(s, undefined, false);
    expect(p.status).toBe("loading");
    expect(p.isKnown).toBe(false);
    expect(p.tier).toBe("free");
    expect(p.isFree).toBe(true);
    expect(p.isEnterprise).toBe(false);
  });

  it("loading with a leftover organization is still not known", () => {
    expect(plan("loading", "enterprise").isKnown).toBe(false);
  });

  it("error → error, never known", () => {
    const p = plan("error", undefined, false);
    expect(p.status).toBe("error");
    expect(p.isKnown).toBe(false);
  });

  it.each([
    ["free", { isFree: true, isStarter: false, isPro: false, isEnterprise: false }],
    ["starter", { isFree: false, isStarter: true, isPro: false, isEnterprise: false }],
    ["pro", { isFree: false, isStarter: true, isPro: true, isEnterprise: false }],
    ["enterprise", { isFree: false, isStarter: true, isPro: true, isEnterprise: true }],
  ])("ready + %s → known with the matching booleans", (tier, flags) => {
    const p = plan("ready", tier);
    expect(p.status).toBe("known");
    expect(p.isKnown).toBe(true);
    expect(p.tier).toBe(tier);
    expect(p).toMatchObject(flags);
  });

  it.each([[undefined], [null], ["team"], [""]])("ready with tier %s → error, never known", (tier) => {
    const p = plan("ready", tier);
    expect(p.status).toBe("error");
    expect(p.isKnown).toBe(false);
  });

  it("canAccess is unchanged", () => {
    const p = plan("ready", "pro");
    expect(p.canAccess("starter")).toBe(true);
    expect(p.canAccess("enterprise")).toBe(false);
  });

  it("retry is the context's retryOrganizationLoad", async () => {
    await plan("error").retry();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("usePlan: no workspace", () => {
  it("none → error, not known, noWorkspace; booleans fall back to free", () => {
    const p = plan("none", undefined, false);
    expect(p.status).toBe("error");
    expect(p.isKnown).toBe(false);
    expect(p.noWorkspace).toBe(true);
    expect(p.tier).toBe("free");
    expect(p.isEnterprise).toBe(false);
  });

  it.each(["idle", "loading", "ready", "error"])("%s → noWorkspace false", (s) => {
    expect(plan(s, "pro").noWorkspace).toBe(false);
  });
});

/**
 * hasEntitlement / lacksEntitlement: the features of lib/plan/entitlements.ts,
 * decided by the tier the server enforces (organization.effectiveTier), never
 * by the stored tier, and neither true until the plan is known.
 */
describe("usePlan: entitlements by the enforced tier", () => {
  const FEATURES = {
    resourceInventoryExport: "starter",
    doraMetrics: "pro",
    securityHubSync: "pro",
    doraCustomBenchmarks: "enterprise",
  } as const;
  const RANK = { free: 0, starter: 1, pro: 2, enterprise: 3 } as const;

  // [state, stored tier, enforced tier]
  const STATES: Array<[string, string, string]> = [
    ["free", "free", "free"],
    ["starter", "starter", "starter"],
    ["pro", "pro", "pro"],
    ["enterprise", "enterprise", "enterprise"],
    ["pro, restricted", "pro", "free"],
    ["enterprise, restricted", "enterprise", "free"],
    ["starter, grace period ended", "starter", "free"],
    ["enterprise, grace period ended", "enterprise", "free"],
  ];

  it.each(STATES)("%s: each feature follows the enforced tier; the stored tier is still the plan shown", (_name, stored, enforced) => {
    const p = plan("ready", stored, true, enforced);
    expect(p.status).toBe("known");
    expect(p.tier).toBe(stored);
    for (const [feature, minimum] of Object.entries(FEATURES)) {
      const included = RANK[enforced as keyof typeof RANK] >= RANK[minimum];
      expect([feature, p.hasEntitlement(feature as keyof typeof FEATURES)]).toEqual([feature, included]);
      expect([feature, p.lacksEntitlement(feature as keyof typeof FEATURES)]).toEqual([feature, !included]);
    }
  });

  it("a restricted Pro organization lacks DORA metrics although it is shown as Pro", () => {
    const p = plan("ready", "pro", true, "free");
    expect(p.isPro).toBe(true);
    expect(p.hasEntitlement("doraMetrics")).toBe(false);
    expect(p.lacksEntitlement("doraMetrics")).toBe(true);
  });

  it.each([
    ["idle, no organization", "idle", false],
    ["loading, no organization", "loading", false],
    ["loading, with a leftover organization", "loading", true],
    ["error", "error", false],
    ["none (no workspace)", "none", false],
  ] as Array<[string, string, boolean]>)("%s: neither granted nor refused", (_name, status, withOrg) => {
    const p = plan(status, "enterprise", withOrg, "enterprise");
    for (const feature of Object.keys(FEATURES) as Array<keyof typeof FEATURES>) {
      expect([feature, p.hasEntitlement(feature), p.lacksEntitlement(feature)]).toEqual([feature, false, false]);
    }
  });

  it.each([[undefined], [null], ["team"], [""]])("stored tier %s: error, neither granted nor refused", (stored) => {
    const p = plan("ready", stored, true, "pro");
    expect(p.status).toBe("error");
    expect(p.hasEntitlement("doraMetrics")).toBe(false);
    expect(p.lacksEntitlement("doraMetrics")).toBe(false);
  });

  it.each([["team"], [""], [7]])("enforced tier %s (unrecognised): error, neither granted nor refused", (enforced) => {
    const p = plan("ready", "enterprise", true, enforced);
    expect(p.status).toBe("error");
    expect(p.hasEntitlement("doraMetrics")).toBe(false);
    expect(p.lacksEntitlement("doraMetrics")).toBe(false);
  });

  it("a response without effectiveTier (from before the field existed): the stored tier stands in", () => {
    const p = plan("ready", "pro");
    expect(p.status).toBe("known");
    expect(p.hasEntitlement("doraMetrics")).toBe(true);
    expect(p.lacksEntitlement("doraCustomBenchmarks")).toBe(true);
  });
});
