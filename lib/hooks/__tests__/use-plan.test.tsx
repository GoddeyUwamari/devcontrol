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

function plan(organizationStatus: string, subscriptionTier?: unknown, withOrg = true) {
  auth.value = {
    organizationStatus,
    organization: withOrg ? { id: "org-1", subscriptionTier } : null,
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
