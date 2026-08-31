import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubscriptionStatus } from "../subscription-status";
import type { Subscription } from "@/types/billing";

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
    expect(screen.getByText(/enterprise plan and billing history are preserved/i)).toBeInTheDocument();
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
