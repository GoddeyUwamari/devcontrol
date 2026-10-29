/**
 * AuthProvider.organizationStatus -- when the organization, and so the plan,
 * counts as known.
 *
 * Runs the real AuthProvider over fake /api/auth/me and /api/organizations
 * requests that the test settles one by one (org-load-harness). Ready once
 * either succeeds; one automatic retry when both fail on the first load,
 * then "error" until a load succeeds -- or "none" when a successful
 * response confirmed an empty organization list; a response sent earlier
 * never overwrites one sent later; responses from before a logout are
 * dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { useEffect } from "react";
import { useAuth, ORG_LOAD_RETRY_MS } from "@/lib/contexts/auth-context";
import { authService, tokenManager } from "@/lib/services/auth.service";
import { organizationsService } from "@/lib/services/organizations.service";
import {
  advanceToAutoRetry,
  fakeOrgSources,
  flush,
  org,
  renderWithAuth,
  seedSession,
  serverError,
  USER,
} from "./org-load-harness";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

let auth: ReturnType<typeof useAuth>;
function Capture() {
  const value = useAuth();
  useEffect(() => {
    auth = value;
  });
  return null;
}

async function mount() {
  const view = renderWithAuth(<Capture />);
  await flush();
  return view;
}

const unauthorized = () => Object.assign(new Error("expired"), { response: { status: 401 } });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  push.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  seedSession();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("organizationStatus on a hard refresh", () => {
  it("C1: loading while both requests are pending; no organization", async () => {
    fakeOrgSources();
    await mount();
    expect(auth.organizationStatus).toBe("loading");
    expect(auth.organization).toBeNull();
  });

  it("C2: ready from /me alone while /organizations is still pending", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.meOk(0, [org("enterprise")]);
    expect(auth.organizationStatus).toBe("ready");
    expect(auth.organization?.subscriptionTier).toBe("enterprise");
  });

  it("C3: ready from /organizations alone while /me is still pending", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.orgsOk(0, [org("pro")]);
    expect(auth.organizationStatus).toBe("ready");
    expect(auth.organization?.subscriptionTier).toBe("pro");
  });

  it("C4: /me fails, /organizations succeeds → ready", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.meFail(0);
    expect(auth.organizationStatus).toBe("loading");
    await src.orgsOk(0, [org("enterprise")]);
    expect(auth.organizationStatus).toBe("ready");
  });

  it("C5: /organizations 401s on an expired token while /me refreshes and succeeds → ready", async () => {
    const src = fakeOrgSources();
    vi.spyOn(authService, "refreshToken").mockResolvedValue({
      success: true,
      data: { accessToken: "access-2", refreshToken: "refresh-2" },
    } as never);
    await mount();
    await act(async () => {
      src.orgs[0].reject(unauthorized());
      src.me[0].reject(unauthorized());
    });
    // /me is retried with the refreshed token.
    expect(src.me).toHaveLength(2);
    expect(auth.organizationStatus).toBe("loading");
    await src.meOk(1, [org("enterprise")]);
    expect(auth.organizationStatus).toBe("ready");
    expect(push).not.toHaveBeenCalled();
  });

  it("C6: both fail, the one automatic retry fails → error, and no further requests", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.failBoth(0);
    expect(auth.organizationStatus).toBe("loading");
    expect(src.me).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(ORG_LOAD_RETRY_MS - 1);
    });
    expect(src.me).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(src.me).toHaveLength(2);
    expect(src.orgs).toHaveLength(2);

    await src.failBoth(1);
    expect(auth.organizationStatus).toBe("error");
    expect(auth.organization).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(ORG_LOAD_RETRY_MS * 20);
    });
    expect(src.me).toHaveLength(2);
    expect(src.orgs).toHaveLength(2);
    expect(auth.organizationStatus).toBe("error");
  });

  it("C7: both fail, the automatic retry succeeds → ready", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.failBoth(0);
    await advanceToAutoRetry();
    await src.orgsOk(1, [org("enterprise")]);
    expect(auth.organizationStatus).toBe("ready");
    expect(src.me).toHaveLength(2);
  });

  it("C8: Try again from error → one load (no duplicate while in flight) → ready", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.failBoth(0);
    await advanceToAutoRetry();
    await src.failBoth(1);
    expect(auth.organizationStatus).toBe("error");

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = auth.retryOrganizationLoad();
      second = auth.retryOrganizationLoad();
    });
    expect(second).toBe(first);
    expect(src.me).toHaveLength(3);
    expect(src.orgs).toHaveLength(3);
    expect(auth.organizationStatus).toBe("loading");

    await src.meOk(2, [org("enterprise")]);
    expect(auth.organizationStatus).toBe("ready");
  });

  it("C8b: a failed Try again goes back to error with no automatic retry after it", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.failBoth(0);
    await advanceToAutoRetry();
    await src.failBoth(1);

    await act(async () => {
      void auth.retryOrganizationLoad();
    });
    await src.failBoth(2);
    expect(auth.organizationStatus).toBe("error");
    await act(async () => {
      vi.advanceTimersByTime(ORG_LOAD_RETRY_MS * 20);
    });
    expect(src.me).toHaveLength(3);
  });

  it("C9: a response sent earlier but landing later never overwrites a newer one", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.meOk(0, [org("enterprise")]);

    // Two refreshes in flight: A sent first, B second.
    await act(async () => {
      void auth.refreshOrganizations();
      void auth.refreshOrganizations();
    });
    expect(src.orgs).toHaveLength(3);
    await src.orgsOk(2, [org("enterprise")]); // B (newest)
    await src.orgsOk(1, [org("free")]); // A, late
    await src.orgsOk(0, [org("free")]); // the original, latest of all
    expect(auth.organization?.subscriptionTier).toBe("enterprise");
    expect(auth.organizationStatus).toBe("ready");
  });

  it("C9b: /organizations sent before the post-refresh /me but landing after it is dropped", async () => {
    const src = fakeOrgSources();
    vi.spyOn(authService, "refreshToken").mockResolvedValue({
      success: true,
      data: { accessToken: "access-2", refreshToken: "refresh-2" },
    } as never);
    await mount();
    await act(async () => {
      src.me[0].reject(unauthorized());
    });
    await src.meOk(1, [org("enterprise")]);
    await src.orgsOk(0, [org("starter")]);
    expect(auth.organization?.subscriptionTier).toBe("enterprise");
  });

  it("C10: once ready, a failed refresh keeps the organization and the status", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.meOk(0, [org("enterprise")]);
    await src.orgsFail(0);
    await act(async () => {
      void auth.refreshOrganizations();
    });
    await src.orgsFail(1);
    expect(auth.organizationStatus).toBe("ready");
    expect(auth.organization?.subscriptionTier).toBe("enterprise");
  });

  it("C11: after logout, late responses and the pending retry are dropped", async () => {
    const src = fakeOrgSources();
    vi.spyOn(authService, "logout").mockResolvedValue(undefined as never);
    await mount();
    await src.failBoth(0); // auto-retry timer now pending
    await act(async () => {
      await auth.logout();
    });
    expect(auth.organizationStatus).toBe("idle");

    await advanceToAutoRetry();
    expect(src.me).toHaveLength(1);

    // A request sent before logout, landing after it.
    seedSession();
    await act(async () => {
      void auth.refreshOrganizations();
    });
    const { orgsOk } = src;
    await act(async () => {
      void auth.logout();
    });
    await orgsOk(1, [org("enterprise")]);
    expect(auth.organization).toBeNull();
    expect(auth.organizationStatus).toBe("idle");
  });

  it("C12: unmounting while loading (and with the retry pending) sends nothing more", async () => {
    const src = fakeOrgSources();
    const view = await mount();
    await src.failBoth(0);
    view.unmount();
    await advanceToAutoRetry();
    await act(async () => {
      vi.advanceTimersByTime(ORG_LOAD_RETRY_MS * 10);
    });
    expect(src.me).toHaveLength(1);
    expect(src.orgs).toHaveLength(1);
  });

  it("C12b: a response landing after unmount is ignored", async () => {
    const src = fakeOrgSources();
    const error = console.error as unknown as ReturnType<typeof vi.fn>;
    const view = await mount();
    view.unmount();
    await src.meOk(0, [org("enterprise")]);
    await src.orgsOk(0, [org("enterprise")]);
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/unmounted|act\(/);
  });

  it("C13: a successful empty organization list is \"none\" after its retry, never ready", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.meOk(0, []);
    await src.orgsOk(0, []);
    expect(auth.organizationStatus).toBe("loading");
    await advanceToAutoRetry();
    expect(src.me).toHaveLength(2);
    expect(src.orgs).toHaveLength(2);
    await src.meOk(1, []);
    await src.orgsOk(1, []);
    expect(auth.organizationStatus).toBe("none");
    expect(auth.organization).toBeNull();
    // No further automatic attempts.
    await act(async () => {
      vi.advanceTimersByTime(ORG_LOAD_RETRY_MS * 10);
    });
    expect(src.me).toHaveLength(2);
  });

  it("C14: login is ready from the login response, before the background refresh lands", async () => {
    localStorage.clear();
    const src = fakeOrgSources();
    vi.spyOn(authService, "login").mockResolvedValue({
      success: true,
      data: {
        accessToken: "access-9",
        refreshToken: "refresh-9",
        user: USER,
        organization: org("enterprise"),
      },
    } as never);
    await mount();
    expect(auth.organizationStatus).toBe("idle");
    await act(async () => {
      await auth.login(USER.email, "pw");
    });
    expect(auth.organizationStatus).toBe("ready");
    expect(auth.organization?.subscriptionTier).toBe("enterprise");
    expect(src.orgs).toHaveLength(1); // the background refresh, still pending
  });

  it("idle with no signed-in user, and nothing is requested", async () => {
    localStorage.clear();
    const src = fakeOrgSources();
    await mount();
    expect(auth.organizationStatus).toBe("idle");
    expect(src.me).toHaveLength(0);
    expect(src.orgs).toHaveLength(0);
    expect(tokenManager.getAccessToken()).toBeNull();
  });

  it("a forced logout during the load is not retried", async () => {
    const src = fakeOrgSources();
    vi.spyOn(authService, "refreshToken").mockRejectedValue(unauthorized());
    await mount();
    await act(async () => {
      src.me[0].reject(unauthorized());
    });
    // adoptRotatedSession waits once for another tab before logging out.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await src.orgsFail(0);
    expect(auth.organizationStatus).toBe("idle");
    await act(async () => {
      vi.advanceTimersByTime(ORG_LOAD_RETRY_MS * 10);
    });
    expect(src.me).toHaveLength(1);
    expect(src.orgs).toHaveLength(1);
  });
});

describe("organizationStatus: no workspace", () => {
  it("Z1: the latest attempt decides: /me [] first, then the retry fails on both → error, not none", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.meOk(0, []);
    await src.orgsFail(0);
    await advanceToAutoRetry();
    await src.failBoth(1);
    expect(auth.organizationStatus).toBe("error");
  });

  it("Z1b: the retry itself confirms an empty list (/me []) while /organizations fails → none", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.failBoth(0);
    await advanceToAutoRetry();
    await src.meOk(1, []);
    await src.orgsFail(1);
    expect(auth.organizationStatus).toBe("none");
  });

  it("Z2: failures only (twice) → error, never none", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.failBoth(0);
    await advanceToAutoRetry();
    await src.failBoth(1);
    expect(auth.organizationStatus).toBe("error");
  });

  it("Z3: /organizations answering something other than a list is a failure, not an empty list", async () => {
    const src = fakeOrgSources();
    await mount();
    await act(async () => { src.orgs[0].resolve(undefined); });
    await src.meFail(0);
    await advanceToAutoRetry();
    await act(async () => { src.orgs[1].resolve({ data: [] }); });
    await src.meFail(1);
    expect(auth.organizationStatus).toBe("error");
  });

  it("Z4: none, then a refresh that lists an organization → ready", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.meOk(0, []);
    await src.orgsOk(0, []);
    await advanceToAutoRetry();
    await src.meOk(1, []);
    await src.orgsOk(1, []);
    expect(auth.organizationStatus).toBe("none");
    const refresh = auth.refreshOrganizations();
    await src.orgsOk(2, [org("pro")]);
    await act(async () => { await refresh; });
    expect(auth.organizationStatus).toBe("ready");
    expect(auth.organization?.subscriptionTier).toBe("pro");
  });

  it("Z5: once ready, a later empty list keeps the workspace", async () => {
    const src = fakeOrgSources();
    await mount();
    await src.meOk(0, [org("enterprise")]);
    await src.orgsOk(0, []);
    expect(auth.organizationStatus).toBe("ready");
    const refresh = auth.refreshOrganizations();
    await src.orgsOk(1, []);
    await act(async () => { await refresh; });
    expect(auth.organizationStatus).toBe("ready");
    expect(auth.organization?.subscriptionTier).toBe("enterprise");
  });

  it("Z6: an empty list followed by a newer one with an organization → ready", async () => {
    const src = fakeOrgSources();
    await mount();
    // /me is sent first; /organizations (sent after it) lists an organization.
    await src.meOk(0, []);
    await src.orgsOk(0, [org("pro")]);
    expect(auth.organizationStatus).toBe("ready");
    await advanceToAutoRetry();
    expect(src.me).toHaveLength(1);
  });

  it("Z7: an expired session (refresh rejected) is idle and redirected, never none", async () => {
    const src = fakeOrgSources();
    vi.spyOn(authService, "refreshToken").mockRejectedValue(unauthorized());
    await mount();
    await src.orgsOk(0, []);
    await act(async () => {
      src.me[0].reject(unauthorized());
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(auth.organizationStatus).toBe("idle");
    expect(push).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(ORG_LOAD_RETRY_MS * 10);
    });
    expect(auth.organizationStatus).toBe("idle");
  });

  it("Z8: logout during an empty attempt → idle, and the pending retry never makes it none", async () => {
    const src = fakeOrgSources();
    vi.spyOn(authService, "logout").mockResolvedValue(undefined as never);
    await mount();
    await src.meOk(0, []);
    await src.orgsOk(0, []);
    await act(async () => { await auth.logout(); });
    await act(async () => {
      vi.advanceTimersByTime(ORG_LOAD_RETRY_MS * 10);
    });
    expect(auth.organizationStatus).toBe("idle");
    expect(src.me).toHaveLength(1);
  });
});

describe("services used by the harness", () => {
  it("serverError is not a 401", () => {
    expect(serverError().response.status).not.toBe(401);
    expect(typeof organizationsService.getAll).toBe("function");
  });
});
