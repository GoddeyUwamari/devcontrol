import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubscriptionStatus } from "../subscription-status";
import type { Subscription, BillingPlan } from "@/types/billing";

const mockOpenCustomerPortal = vi.fn();
vi.mock("@/lib/services/stripe.service", () => ({
  openCustomerPortal: (...args: unknown[]) => mockOpenCustomerPortal(...args),
}));

const mockUseIsBillingAdmin = vi.fn();
vi.mock("@/lib/hooks/use-current-role", () => ({
  useIsBillingAdmin: () => mockUseIsBillingAdmin(),
}));

function baseSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    tier: "pro",
    status: "active",
    cancelAtPeriodEnd: false,
    billingLifecycleState: "healthy",
    isRestricted: false,
    ...overrides,
  };
}

describe("SubscriptionStatus -- payment-failure lifecycle UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsBillingAdmin.mockReturnValue(true);
  });

  it("healthy: shows no grace/restricted banner", () => {
    render(<SubscriptionStatus subscription={baseSubscription()} />);

    expect(screen.queryByText(/couldn't process your last payment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/access restricted/i)).not.toBeInTheDocument();
  });

  it("grace period: shows the grace banner with the exact expiration date and a Manage Billing CTA for an admin", () => {
    const graceEndsAt = Math.floor(new Date("2026-09-15T12:00:00Z").getTime() / 1000);
    render(
      <SubscriptionStatus
        subscription={baseSubscription({ billingLifecycleState: "grace_period", isRestricted: false, graceEndsAt })}
      />
    );

    expect(screen.getByText(/couldn't process your last payment/i)).toBeInTheDocument();
    expect(screen.getByText(/September 15, 2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeInTheDocument();
    expect(screen.queryByText(/access restricted/i)).not.toBeInTheDocument();
  });

  it("grace period: hides the Manage Billing CTA for a member/viewer and tells them to ask an admin", () => {
    mockUseIsBillingAdmin.mockReturnValue(false);
    render(
      <SubscriptionStatus
        subscription={baseSubscription({ billingLifecycleState: "grace_period", isRestricted: false, graceEndsAt: 1799999999 })}
      />
    );

    expect(screen.getByText(/couldn't process your last payment/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ask an organization owner or admin/i)).toBeInTheDocument();
  });

  it("restricted: shows the restricted banner (not the grace banner) and preserves the tier name in the message", () => {
    render(
      <SubscriptionStatus
        subscription={baseSubscription({ tier: "enterprise", billingLifecycleState: "restricted", isRestricted: true })}
      />
    );

    expect(screen.getByText(/access restricted due to a payment issue/i)).toBeInTheDocument();
    // The customer-facing plan name (approved S4), never the tier id.
    expect(screen.getByText(/Revenue Protection plan and billing history are preserved/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't process your last payment/i)).not.toBeInTheDocument();
  });

  it("restricted: hides the Manage Billing CTA for a member/viewer", () => {
    mockUseIsBillingAdmin.mockReturnValue(false);
    render(
      <SubscriptionStatus subscription={baseSubscription({ billingLifecycleState: "restricted", isRestricted: true })} />
    );

    expect(screen.getByText(/access restricted due to a payment issue/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage billing/i })).not.toBeInTheDocument();
  });

  it("isRestricted always takes precedence over a stale billingLifecycleState of 'grace_period'", () => {
    render(
      <SubscriptionStatus
        subscription={baseSubscription({ billingLifecycleState: "grace_period", isRestricted: true })}
      />
    );

    expect(screen.getByText(/access restricted due to a payment issue/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't process your last payment/i)).not.toBeInTheDocument();
  });
});

// ─── Trial PR: rendering only the server's billing summary ───────────────────

const TRIAL_END = Math.floor(new Date("2026-11-23T12:00:00Z").getTime() / 1000);

function plan(overrides: Partial<BillingPlan> = {}): BillingPlan {
  return { storedTier: "pro", effectiveTier: "pro", entitlementHold: null, source: "subscription", isTopPlan: false, ...overrides };
}

function summarySubscription(overrides: Partial<Subscription> = {}): Subscription {
  return baseSubscription({
    plan: plan(),
    subscription: { status: "active", currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: { amount: 19900, currency: "usd", interval: "month" } },
    trial: { used: false, active: false, endsAt: null, eligible: false },
    actions: { selfServe: "change_plan", showUpgrade: true, manageSubscription: true },
    ...overrides,
  });
}

describe("SubscriptionStatus -- trial, managed plan, price (approved copy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsBillingAdmin.mockReturnValue(true);
  });

  it("S1 + S2: a running trial shows its end date and the price after it; no 'add a payment method'", () => {
    const { container } = render(
      <SubscriptionStatus
        subscription={summarySubscription({
          status: "trialing",
          trial: { used: true, active: true, endsAt: TRIAL_END, eligible: false },
          subscription: { status: "trialing", currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: { amount: 199000, currency: "usd", interval: "year" } },
        })}
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Trial ends on November 23, 2026. Your card on file will be charged then unless you cancel.");
    expect(text).toContain("Trial Period Active");
    expect(text).toContain("Trial ends on November 23, 2026. After that you'll be charged $1,990 per year.");
    expect(text).not.toMatch(/add a payment method|days/i);
    expect(screen.getByRole("button", { name: "Manage Billing" })).toBeInTheDocument();
  });

  it("S2 without a known price: only the date", () => {
    const { container } = render(
      <SubscriptionStatus
        subscription={summarySubscription({
          status: "trialing",
          trial: { used: true, active: true, endsAt: TRIAL_END, eligible: false },
          subscription: { status: "trialing", currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: null },
        })}
      />
    );
    expect(container.textContent).toContain("Trial Period ActiveTrial ends on November 23, 2026.");
    expect(container.textContent).not.toContain("charged $");
  });

  it("a trial whose end is unknown shows no trial date at all (never '0 days')", () => {
    const { container } = render(
      <SubscriptionStatus subscription={summarySubscription({ status: "trialing", trial: { used: true, active: true, endsAt: null, eligible: false } })} />
    );
    expect(container.textContent).not.toMatch(/Trial ends|0 days/);
  });

  it("members see the trial date without the Manage Billing button", () => {
    mockUseIsBillingAdmin.mockReturnValue(false);
    render(<SubscriptionStatus subscription={summarySubscription({ status: "trialing", trial: { used: true, active: true, endsAt: TRIAL_END, eligible: false } })} />);
    expect(screen.queryByRole("button", { name: "Manage Billing" })).not.toBeInTheDocument();
  });

  it("S3a/S3b: a plan our team manages shows its real name, Managed, and no price, cycle or Free", () => {
    const { container } = render(
      <SubscriptionStatus
        subscription={baseSubscription({
          tier: "enterprise",
          status: null,
          plan: plan({ storedTier: "enterprise", effectiveTier: "enterprise", source: "managed", isTopPlan: true }),
          subscription: null,
          actions: { selfServe: "none", showUpgrade: false, manageSubscription: false },
        })}
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Revenue Protection");
    expect(text).toContain("Managed by our team");
    expect(screen.getByText("Managed")).toBeInTheDocument();
    expect(text).not.toMatch(/Free|Price:|Billing Cycle|\$/);
  });

  it("S4: the plan name and the subscription's own price and interval", () => {
    const { container } = render(
      <SubscriptionStatus
        subscription={summarySubscription({
          tier: "starter",
          plan: plan({ storedTier: "starter", effectiveTier: "starter" }),
          subscription: { status: "active", currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: { amount: 49000, currency: "usd", interval: "year" } },
        })}
      />
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Cost Control");
    expect(text).toContain("$490/year");
    expect(text).toContain("Annual");
    expect(text).not.toMatch(/Monthly recurring|Starter/);
  });

  it("S4: no made-up price when the subscription's price is unknown", () => {
    const { container } = render(
      <SubscriptionStatus
        subscription={summarySubscription({
          subscription: { status: "active", currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: null },
        })}
      />
    );
    expect(container.textContent).toContain("Optimization Engine");
    expect(container.textContent).not.toMatch(/Price:|\$199|Billing Cycle/);
  });

  it("free, no subscription: Free badge and $0/month", () => {
    const { container } = render(
      <SubscriptionStatus
        subscription={baseSubscription({
          tier: "free",
          status: null,
          plan: plan({ storedTier: "free", effectiveTier: "free", source: "none" }),
          subscription: null,
          actions: { selfServe: "checkout", showUpgrade: true, manageSubscription: false },
        })}
      />
    );
    expect(screen.getAllByText("Free").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("$0/month");
  });

  it("the payment hold comes from the server's decision (entitlementHold), not the lifecycle field", () => {
    render(
      <SubscriptionStatus
        subscription={summarySubscription({ isRestricted: false, plan: plan({ effectiveTier: "free", entitlementHold: "payment" }) })}
      />
    );
    expect(screen.getByText(/access restricted due to a payment issue/i)).toBeInTheDocument();
  });

  it("a canceled subscription with an old restriction shows no payment banner (no hold)", () => {
    render(
      <SubscriptionStatus
        subscription={summarySubscription({ status: "canceled", isRestricted: true, billingLifecycleState: "restricted", plan: plan({ storedTier: "free", effectiveTier: "free", entitlementHold: null }) })}
      />
    );
    expect(screen.queryByText(/access restricted/i)).not.toBeInTheDocument();
  });

  it("S11: the subscription_inactive hold, for an admin and for a member", () => {
    const { container, unmount } = render(
      <SubscriptionStatus subscription={summarySubscription({ status: "paused", plan: plan({ effectiveTier: "free", entitlementHold: "subscription_inactive" }) })} />
    );
    expect(container.textContent).toContain("Your Optimization Engine subscription isn't active, so paid features are paused. Complete or resume it in Manage Billing.");
    expect(screen.getByRole("button", { name: "Manage Billing" })).toBeInTheDocument();
    unmount();
    mockUseIsBillingAdmin.mockReturnValue(false);
    const member = render(
      <SubscriptionStatus subscription={summarySubscription({ status: "paused", plan: plan({ effectiveTier: "free", entitlementHold: "subscription_inactive" }) })} />
    );
    expect(member.container.textContent).toContain("Complete or resume it in Manage Billing. Ask an organization owner or admin to update billing.");
    expect(screen.queryByRole("button", { name: "Manage Billing" })).not.toBeInTheDocument();
  });
});
