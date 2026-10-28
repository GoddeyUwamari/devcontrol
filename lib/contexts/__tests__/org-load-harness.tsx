/**
 * Shared doubles for the organization load (AuthProvider) and the plan states
 * of plan-gated pages. Not a test file itself.
 *
 * fakeOrgSources() replaces GET /api/auth/me and GET /api/organizations with
 * requests that stay pending until the test settles each one, so a test can
 * make either slow, failed, or answered first. The real AuthProvider and the
 * real usePlan run on top of them.
 *
 * A test file using this must mock next/navigation itself (AuthProvider calls
 * useRouter), as vi.mock is hoisted per test file.
 */
import type { ReactElement } from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthProvider, ORG_LOAD_RETRY_MS } from "@/lib/contexts/auth-context";
import { authService } from "@/lib/services/auth.service";
import { organizationsService } from "@/lib/services/organizations.service";

export type Tier = "free" | "starter" | "pro" | "enterprise";

export const USER = { id: "user-1", email: "u1@example.test", fullName: "User One" };

export function org(tier: string | undefined, id = "org-1") {
  return {
    id,
    name: `Org ${id}`,
    slug: id,
    displayName: null,
    description: null,
    subscriptionTier: tier,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

/** A non-401 failure (backend blip): never a logout. */
export const serverError = () =>
  Object.assign(new Error("unavailable"), { response: { status: 503 } });

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A signed-in tab after a hard refresh: tokens and a cached user, no organization. */
export function seedSession() {
  localStorage.setItem("accessToken", "access-1");
  localStorage.setItem("refreshToken", "refresh-1");
  localStorage.setItem("user", JSON.stringify(USER));
}

export type OrgList = ReturnType<typeof org>[];

export function fakeOrgSources() {
  const me: Deferred<unknown>[] = [];
  const orgs: Deferred<unknown>[] = [];
  const meSpy = vi.spyOn(authService, "getCurrentUser").mockImplementation(() => {
    const d = deferred<unknown>();
    me.push(d);
    return d.promise as never;
  });
  const orgsSpy = vi.spyOn(organizationsService, "getAll").mockImplementation(() => {
    const d = deferred<unknown>();
    orgs.push(d);
    return d.promise as never;
  });
  const settle = async (fn: () => void) => {
    await act(async () => {
      fn();
    });
  };
  return {
    me,
    orgs,
    meSpy,
    orgsSpy,
    meOk: (i: number, list: OrgList) => settle(() => me[i].resolve({ ...USER, organizations: list })),
    orgsOk: (i: number, list: OrgList) => settle(() => orgs[i].resolve(list)),
    meFail: (i: number) => settle(() => me[i].reject(serverError())),
    orgsFail: (i: number) => settle(() => orgs[i].reject(serverError())),
    failBoth: (i: number) =>
      settle(() => {
        me[i].reject(serverError());
        orgs[i].reject(serverError());
      }),
  };
}

export async function flush() {
  await act(async () => {});
}

export async function advanceToAutoRetry() {
  await act(async () => {
    vi.advanceTimersByTime(ORG_LOAD_RETRY_MS);
  });
}

export function renderWithAuth(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

export const WORKSPACE_ERROR = "Couldn't load your workspace.";

export interface PlanStatesConfig {
  /** Renders the page under test (inside AuthProvider). */
  render: () => ReactElement;
  entitledTier: Tier;
  notEntitledTier: Tier;
  /** Total calls made so far to the page's paid endpoints. */
  paidCalls: () => number;
  /** Text only the entitled content shows. */
  content: string | RegExp;
  /** Text only the upgrade gate shows. */
  gate: string | RegExp;
  /** Resets the page's own service doubles. */
  reset?: () => void;
}

/**
 * The four required flows for a plan-gated page: loading → entitled,
 * loading → not entitled (gate), loading → org fetch error (retry message,
 * no gate), and Try again → entitled. Every flow asserts that no paid
 * endpoint is called before the plan is known and entitled.
 */
export function describePlanStates(name: string, cfg: PlanStatesConfig) {
  describe(`${name}: plan states`, () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      localStorage.clear();
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      cfg.reset?.();
      seedSession();
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const expectLoadingOnly = () => {
      expect(screen.getByTestId("plan-loading")).toBeTruthy();
      expect(screen.queryByText(cfg.gate)).toBeNull();
      expect(screen.queryByText(cfg.content)).toBeNull();
      expect(screen.queryByText(WORKSPACE_ERROR)).toBeNull();
      expect(cfg.paidCalls()).toBe(0);
    };

    it("loading → entitled: a skeleton, no gate and no paid call until the plan is known", async () => {
      const src = fakeOrgSources();
      renderWithAuth(cfg.render());
      await flush();
      expectLoadingOnly();

      // /me stays pending; /organizations alone establishes the plan.
      await src.orgsOk(0, [org(cfg.entitledTier)]);
      expect((await screen.findAllByText(cfg.content)).length).toBeGreaterThan(0);
      expect(screen.queryByText(cfg.gate)).toBeNull();
      expect(screen.queryByTestId("plan-loading")).toBeNull();
      expect(cfg.paidCalls()).toBeGreaterThan(0);
    });

    it("loading → not entitled: the gate, and never a paid call", async () => {
      const src = fakeOrgSources();
      renderWithAuth(cfg.render());
      await flush();
      expectLoadingOnly();

      // /organizations stays pending; /me alone establishes the plan.
      await src.meOk(0, [org(cfg.notEntitledTier)]);
      expect((await screen.findAllByText(cfg.gate)).length).toBeGreaterThan(0);
      expect(screen.queryByText(cfg.content)).toBeNull();
      await src.orgsOk(0, [org(cfg.notEntitledTier)]);
      await flush();
      expect(cfg.paidCalls()).toBe(0);
    });

    it("loading → org fetch error: one automatic retry, then the retry message — never the gate", async () => {
      const src = fakeOrgSources();
      renderWithAuth(cfg.render());
      await flush();

      await src.failBoth(0);
      expectLoadingOnly();
      expect(src.me).toHaveLength(1);

      await advanceToAutoRetry();
      expect(src.me).toHaveLength(2);
      expect(src.orgs).toHaveLength(2);
      await src.failBoth(1);

      expect(await screen.findByText(WORKSPACE_ERROR)).toBeTruthy();
      expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
      expect(screen.queryByText(cfg.gate)).toBeNull();
      expect(screen.queryByText(cfg.content)).toBeNull();
      expect(cfg.paidCalls()).toBe(0);

      // No further automatic attempts.
      await act(async () => {
        vi.advanceTimersByTime(ORG_LOAD_RETRY_MS * 10);
      });
      expect(src.me).toHaveLength(2);
      expect(cfg.paidCalls()).toBe(0);
    });

    it("error → Try again → entitled", async () => {
      const src = fakeOrgSources();
      renderWithAuth(cfg.render());
      await flush();
      await src.failBoth(0);
      await advanceToAutoRetry();
      await src.failBoth(1);
      await screen.findByText(WORKSPACE_ERROR);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      });
      expect(src.me).toHaveLength(3);
      expect(src.orgs).toHaveLength(3);
      expect(cfg.paidCalls()).toBe(0);

      await src.meOk(2, [org(cfg.entitledTier)]);
      expect((await screen.findAllByText(cfg.content)).length).toBeGreaterThan(0);
      expect(screen.queryByText(WORKSPACE_ERROR)).toBeNull();
      expect(screen.queryByText(cfg.gate)).toBeNull();
      expect(cfg.paidCalls()).toBeGreaterThan(0);
    });
  });
}
