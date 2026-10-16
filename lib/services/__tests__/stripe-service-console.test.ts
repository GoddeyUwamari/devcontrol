/**
 * Billing calls: a rejected request is reported to the caller as before and
 * logged as the logError line only -- no request body or Authorization header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cancelSubscription,
  changePlan,
  createCheckoutSession,
  getInvoices,
  getSubscription,
  openCustomerPortal,
  resumeSubscription,
} from "../stripe.service";
import {
  expectNoSentinelInConsole,
  rejectEveryApiRequest,
  spyOnConsole,
} from "@/lib/__tests__/support/console-sentinels";

const REJECTED = "Request failed with status code 402 (status 402, code PAYMENT_REQUIRED)";

let restoreApi: () => void;
let spies: ReturnType<typeof spyOnConsole>;

beforeEach(() => {
  restoreApi = rejectEveryApiRequest(402, { success: false, error: "Card declined", code: "PAYMENT_REQUIRED" });
  spies = spyOnConsole();
});

afterEach(() => {
  restoreApi();
  vi.restoreAllMocks();
});

describe("stripe service logs no request data", () => {
  it.each([
    ["Error creating checkout session", () => createCheckoutSession("pro", "monthly")],
    ["Error getting subscription", () => getSubscription()],
    ["Error getting invoices", () => getInvoices()],
    ["Error opening customer portal", () => openCustomerPortal()],
    ["Error canceling subscription", () => cancelSubscription(true)],
    ["Error resuming subscription", () => resumeSubscription()],
    ["Error changing subscription plan", () => changePlan("enterprise", "annual")],
  ] as const)("%s", async (context, call) => {
    const result = await call();

    expect(result).toEqual({ success: false, error: "Card declined" });
    expect(vi.mocked(console.error).mock.calls).toEqual([[`${context}: ${REJECTED}`]]);
    expectNoSentinelInConsole(spies);
  });
});
