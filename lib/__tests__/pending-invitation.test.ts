/**
 * Pending invitation: kept in this tab's sessionStorage for at most 7 days;
 * an expired or malformed entry is removed when read.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  PENDING_INVITATION_KEY,
  PENDING_INVITATION_MAX_AGE_MS,
  clearPendingInvitation,
  hasPendingInvitation,
  readPendingInvitation,
  savePendingInvitation,
} from "../pending-invitation";

const NOW = 1_800_000_000_000;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("pending invitation", () => {
  it("saves { token, savedAt } in sessionStorage only", () => {
    savePendingInvitation("invite-placeholder", NOW);

    expect(JSON.parse(sessionStorage.getItem(PENDING_INVITATION_KEY)!)).toEqual({
      token: "invite-placeholder",
      savedAt: NOW,
    });
    expect(localStorage.length).toBe(0);
    expect(readPendingInvitation(NOW)).toBe("invite-placeholder");
    expect(hasPendingInvitation(NOW)).toBe(true);
  });

  it("is readable until just before 7 days, then removed", () => {
    savePendingInvitation("invite-placeholder", NOW);

    expect(readPendingInvitation(NOW + PENDING_INVITATION_MAX_AGE_MS - 1)).toBe("invite-placeholder");
    expect(readPendingInvitation(NOW + PENDING_INVITATION_MAX_AGE_MS)).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
  });

  it.each([
    ["not JSON", "not-json"],
    ["no token", JSON.stringify({ savedAt: NOW })],
    ["empty token", JSON.stringify({ token: "", savedAt: NOW })],
    ["no savedAt", JSON.stringify({ token: "invite-placeholder" })],
    ["savedAt in the future", JSON.stringify({ token: "invite-placeholder", savedAt: NOW + 1000 })],
    ["null", "null"],
  ])("removes a malformed entry (%s)", (_kind, raw) => {
    sessionStorage.setItem(PENDING_INVITATION_KEY, raw);

    expect(readPendingInvitation(NOW)).toBeNull();
    expect(sessionStorage.getItem(PENDING_INVITATION_KEY)).toBeNull();
  });

  it("clears", () => {
    savePendingInvitation("invite-placeholder", NOW);
    clearPendingInvitation();

    expect(hasPendingInvitation(NOW)).toBe(false);
  });
});
