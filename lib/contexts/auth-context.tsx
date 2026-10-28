"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { resetQueryClientForIdentityChange } from "../query-client";
import { clearOrgScopedCaches } from "../org-scoped-cache";
import { MEMBERSHIP_REVOKED_EVENT } from "../api";
import type { User } from "../types";
import { authService, tokenManager } from "../services/auth.service";
import {
  organizationsService,
  type Organization,
} from "../services/organizations.service";
import { logError } from "@/lib/safe-log";
import { DEFAULT_RETURN_PATH, safeReturnPath } from "@/lib/safe-return-path";
import { clearPendingInvitation, hasPendingInvitation } from "@/lib/pending-invitation";
import { loginPathReturningHere } from "@/lib/login-redirect";

/**
 * Where to go once signed in: a safe return path if one was given, else an
 * invitation opened in this tab before signing in (as the SSO callback
 * does), else the dashboard.
 */
function postSignInPath(redirectTo: string | undefined): string {
  return (
    safeReturnPath(redirectTo) ??
    (hasPendingInvitation() ? "/accept-invitation" : DEFAULT_RETURN_PATH)
  );
}

/**
 * Whether `organization` -- and so the plan -- is established for the
 * signed-in identity:
 * - idle: no signed-in user
 * - loading: no org-bearing response has succeeded yet for this identity
 * - ready: one has (/api/auth/me, /api/organizations, login, registration
 *   or creating an organization), with at least one organization
 * - error: a load and its one automatic retry failed on both sources, or
 *   the user has no organization
 */
export type OrganizationStatus = "idle" | "loading" | "ready" | "error";

/** How long a failed first organization load waits before its one automatic retry. */
export const ORG_LOAD_RETRY_MS = 1500;

/**
 * Auth Context Value Interface
 */
interface AuthContextValue {
  // State
  user: User | null;
  organization: Organization | null;
  organizations: Organization[];
  organizationStatus: OrganizationStatus;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Auth Methods
  /** redirectTo: where to go once signed in; ignored unless a same-origin path (see postSignInPath). */
  login: (email: string, password: string, redirectTo?: string) => Promise<void>;
  register: (email: string, password: string, fullName: string, redirectTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;

  // Organization Methods
  switchOrganization: (organizationId: string) => Promise<void>;
  setCurrentOrganization: (org: Organization) => void;
  refreshOrganizations: () => Promise<void>;
  /** Loads the organization again after `error`; returns the running load if one is in flight. */
  retryOrganizationLoad: () => Promise<void>;
  createOrganization: (name: string, slug?: string, displayName?: string, description?: string) => Promise<Organization>;
}

/**
 * How long refreshUser waits, once, for another tab to finish rotating the
 * refresh token before treating a failed refresh as a logout.
 */
export const REFRESH_RACE_RECHECK_MS = 1000;

/**
 * Drops every browser cache of the previous identity's or organization's
 * data: the localStorage caches (lib/org-scoped-cache.ts), which outlive the
 * session, and the in-memory query cache. Runs on login, registration,
 * logout, forced logout, and creating an organization. switchOrganization
 * also calls it, but only after organizationsService.switch succeeds -- and
 * that call has no backend route yet, so today a switch never reaches it.
 * The SSO callback page clears the localStorage caches itself.
 */
async function resetCachesForIdentityChange(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  clearOrgScopedCaches();
  await resetQueryClientForIdentityChange(queryClient);
}

/**
 * Auth Context
 */
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Auth Provider Props
 */
interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Auth Provider Component
 * Manages authentication state and provides auth methods to the app
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const router = useRouter();
  // The app's single QueryClient (app/providers.tsx wraps AuthProvider in
  // QueryClientProvider with the lib/query-client singleton). Every identity
  // transition below resets it -- see resetCachesForIdentityChange.
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationStatus, setOrganizationStatusState] = useState<OrganizationStatus>("idle");
  const [isLoading, setIsLoading] = useState(true);

  // Organization load bookkeeping. Every org-bearing request takes a sequence
  // number when it is sent; a response is applied only if it was sent after
  // the last applied one, so a late, older response never overwrites a newer
  // one. The generation changes with the identity (login, registration,
  // logout, forced logout, creating an organization): a response or retry
  // timer from an earlier generation is dropped.
  const orgSeqRef = useRef(0);
  const appliedOrgSeqRef = useRef(0);
  const generationRef = useRef(0);
  const statusRef = useRef<OrganizationStatus>("idle");
  const mountedRef = useRef(true);
  const attemptRef = useRef<Promise<void> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set below, once startOrganizationLoad exists; initializeAuth and the
  // retry timer call it through this ref.
  const startOrganizationLoadRef = useRef<(autoRetry: boolean) => Promise<void>>(
    async () => {}
  );

  const setOrganizationStatus = useCallback((status: OrganizationStatus) => {
    statusRef.current = status;
    setOrganizationStatusState(status);
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  /** A new identity: drops every in-flight response and pending retry of the previous one. */
  const startNewGeneration = useCallback(
    (status: OrganizationStatus) => {
      generationRef.current += 1;
      appliedOrgSeqRef.current = orgSeqRef.current;
      attemptRef.current = null;
      clearRetryTimer();
      setOrganizationStatus(status);
    },
    [clearRetryTimer, setOrganizationStatus]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  /**
   * Applies an organization list from a response sent with `seq` in
   * `generation`. Returns whether the workspace is ready afterwards. A failed
   * or empty response never clears an organization already applied.
   */
  const applyOrganizationList = useCallback(
    (orgs: Organization[], seq: number, generation: number): boolean => {
      if (!mountedRef.current || generation !== generationRef.current) return false;
      if (seq <= appliedOrgSeqRef.current) return statusRef.current === "ready";
      appliedOrgSeqRef.current = seq;
      setOrganizations(orgs);
      if (orgs.length > 0) {
        setOrganization(orgs[0]);
        setOrganizationStatus("ready");
      }
      return statusRef.current === "ready";
    },
    [setOrganizationStatus]
  );

  /**
   * Initialize authentication state from localStorage
   */
  const initializeAuth = useCallback(async () => {
    console.log("🔐 Auth Context - Initializing...");
    try {
      const token = tokenManager.getAccessToken();
      const cachedUser = tokenManager.getUser();

      console.log("🔐 Token exists:", !!token);

      if (token && cachedUser) {
        setUser(cachedUser);
        // Re-set the auth cookie in case it was cleared (cookie can expire while localStorage persists)
        tokenManager.setAuthCookie(token);
        console.log("🔐 Setting cached user, fetching fresh data in background...");
        // Kick off background refreshes — do NOT await them here so that
        // isLoading drops immediately and the cached user is shown right away.
        // Errors in these background calls must not clear the user state.
        // The organization stays "loading" until one of them succeeds.
        startOrganizationLoadRef.current(true).catch((error) =>
          logError("Failed to load organization", error)
        );
      } else {
        console.log("🔐 No token or cached user, user not authenticated");
      }
    } catch (error) {
      logError("❌ Failed to initialize auth", error);
    } finally {
      setIsLoading(false);
      console.log("🔐 Auth initialization complete");
    }
  }, []);

  /**
   * Initialize auth state on mount
   */
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  /**
   * GET /api/organizations. Returns whether the workspace is ready afterwards.
   */
  const loadOrganizations = useCallback(async (): Promise<boolean> => {
    const generation = generationRef.current;
    const seq = ++orgSeqRef.current;
    try {
      const orgs = await organizationsService.getAll();
      return applyOrganizationList(Array.isArray(orgs) ? orgs : [], seq, generation);
    } catch (error) {
      logError("Failed to fetch organizations", error);
      return false;
    }
  }, [applyOrganizationList]);

  /**
   * Refresh organizations
   */
  const refreshOrganizations = useCallback(async () => {
    await loadOrganizations();
  }, [loadOrganizations]);

  /**
   * Login method
   */
  const login = useCallback(
    async (email: string, password: string, redirectTo?: string) => {
      const target = postSignInPath(redirectTo);
      try {
        const response = await authService.login({ email, password });

        // Handle both flat and nested response structures
        const payload = response?.data ?? response;
        const accessToken = payload?.accessToken || (response as any)?.token;
        const refreshToken = payload?.refreshToken;
        const user = payload?.user;
        const organization = payload?.organization;

        // New identity: drop any previous identity's cached queries before the
        // new session's tokens exist, so no query can run as (or be served
        // from) the old identity once this user lands on /dashboard.
        await resetCachesForIdentityChange(queryClient);

        // Store tokens
        tokenManager.setAccessToken(accessToken);
        tokenManager.setRefreshToken(refreshToken);
        tokenManager.setUser(user);
        tokenManager.setAuthCookie(accessToken);

        setUser(user);
        startNewGeneration("loading");

        // Set organization from login response
        if (organization) {
          applyOrganizationList([organization], ++orgSeqRef.current, generationRef.current);
        }

        // Fetch all user's organizations in background
        if (statusRef.current === "ready") {
          refreshOrganizations().catch((error) => logError("Failed to fetch organizations", error));
        } else {
          startOrganizationLoadRef.current(true).catch((error) =>
            logError("Failed to load organization", error)
          );
        }

        toast.success("Welcome back!", {
          description: `Logged in as ${user?.email ?? email}`,
        });

        // Redirect (see postSignInPath) with fallback
        console.log("🚀 Redirecting after login...");
        try {
          // Use Next.js router for client-side navigation
          await router.push(target);

          // Fallback: Force navigation if router.push doesn't work
          setTimeout(() => {
            if (window.location.pathname === "/login") {
              console.log("⚠️ Router redirect failed, using window.location");
              window.location.href = target;
            }
          }, 100);
        } catch (error) {
          logError("❌ Router navigation failed, using window.location", error);
          window.location.href = target;
        }
      } catch (error: any) {
        logError("Login failed", error);
        const message =
          error.response?.data?.error ||
          error.response?.data?.message ||
          "Invalid email or password";
        toast.error("Login failed", {
          description: message,
        });
        throw error;
      }
    },
    [router, refreshOrganizations, queryClient, startNewGeneration, applyOrganizationList]
  );

  /**
   * Register method
   */
  const register = useCallback(
    async (email: string, password: string, fullName: string, redirectTo?: string) => {
      const target = postSignInPath(redirectTo);
      try {
        const response = await authService.register({
          email,
          password,
          fullName,
        });

        // Backend returns tokens on registration, so we can log user in immediately
        // Check if tokens are in response
        if (response.data.accessToken && response.data.refreshToken) {
          // New identity -- same reset as login().
          await resetCachesForIdentityChange(queryClient);

          // Store tokens
          tokenManager.setAccessToken(response.data.accessToken);
          tokenManager.setRefreshToken(response.data.refreshToken);
          tokenManager.setUser(response.data.user);
          tokenManager.setAuthCookie(response.data.accessToken);

          // Update state
          setUser(response.data.user);
          startNewGeneration("loading");

          // Set organization from registration response
          if (response.data.organization) {
            applyOrganizationList(
              [response.data.organization],
              ++orgSeqRef.current,
              generationRef.current
            );
          }
          if (statusRef.current !== "ready") {
            startOrganizationLoadRef.current(true).catch((error) =>
              logError("Failed to load organization", error)
            );
          }

          toast.success("Account created successfully!", {
            description: "Welcome to DevControl",
          });

          // Redirect (see postSignInPath) with fallback
          console.log("🚀 Redirecting after registration...");
          try {
            await router.push(target);

            // Fallback: Force navigation if router.push doesn't work
            setTimeout(() => {
              if (window.location.pathname !== new URL(target, window.location.origin).pathname) {
                console.log("⚠️  Router redirect failed, using window.location");
                window.location.href = target;
              }
            }, 100);
          } catch (error) {
            logError("❌ Router navigation failed, using window.location", error);
            window.location.href = target;
          }
        } else {
          // Older backend that doesn't return tokens on registration
          toast.success("Account created successfully!", {
            description: "Please log in with your new account",
          });
          router.push("/login");
        }
      } catch (error: any) {
        logError("Registration failed", error);
        const message =
          error.response?.data?.error ||
          error.response?.data?.message ||
          "Failed to create account";
        toast.error("Registration failed", {
          description: message,
        });
        throw error;
      }
    },
    [router, queryClient, startNewGeneration, applyOrganizationList]
  );

  /**
   * Logout method
   */
  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      logError("Logout API call failed", error);
      // Continue with logout even if API call fails
    } finally {
      // Clear local state
      tokenManager.clearAll();
      tokenManager.clearAuthCookie();
      // An invitation opened in this tab must not carry over to whoever signs in next.
      clearPendingInvitation();
      setUser(null);
      setOrganization(null);
      setOrganizations([]);
      startNewGeneration("idle");

      // Identity ended: drop its cached queries before navigating away, so a
      // later login in this same tab starts from an empty cache.
      await resetCachesForIdentityChange(queryClient);

      toast.success("Logged out successfully");

      // Only redirect if not already on login/signup page. The only
      // navigation for a logout (AuthGate leaves an ended session to this),
      // and deliberately without ?from=: the next sign-in starts fresh.
      if (typeof window !== 'undefined' &&
          !window.location.pathname.startsWith('/login') &&
          !window.location.pathname.startsWith('/signup')) {
        router.push("/login");
      }
    }
  }, [router, queryClient, startNewGeneration]);

  /**
   * GET /api/auth/me, with the expired-token recovery below. Returns whether
   * the workspace is ready afterwards.
   */
  const loadUser = useCallback(async (): Promise<boolean> => {
    const generation = generationRef.current;

    /** One /me request; its organization list is applied in send order. */
    const fetchAndApplyUser = async (): Promise<boolean> => {
      const seq = ++orgSeqRef.current;
      const response = await authService.getCurrentUser();
      if (!mountedRef.current || generation !== generationRef.current) return false;
      const { organizations: userOrgs, ...userData } = response as any;
      setUser(userData);
      tokenManager.setUser(userData);
      if (userOrgs && Array.isArray(userOrgs)) {
        return applyOrganizationList(userOrgs, seq, generation);
      }
      return statusRef.current === "ready";
    };

    /** null when the session could not be adopted; otherwise whether the workspace is ready. */
    const adoptRotatedSession = async (
      usedRefreshToken: string
    ): Promise<{ ready: boolean } | null> => {
      const rotated = () => {
        const current = tokenManager.getRefreshToken();
        return !!current && current !== usedRefreshToken;
      };
      if (!rotated()) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_RACE_RECHECK_MS));
        if (!rotated()) return null;
      }
      const accessToken = tokenManager.getAccessToken();
      if (!accessToken) return null;
      try {
        tokenManager.setAuthCookie(accessToken);
        return { ready: await fetchAndApplyUser() };
      } catch {
        return null;
      }
    };

    try {
      return await fetchAndApplyUser();
    } catch (error: any) {
      const status = error?.response?.status;

      if (status === 401) {
        // Token expired — try silent refresh before giving up
        const storedRefreshToken = tokenManager.getRefreshToken();
        if (storedRefreshToken) {
          try {
            const refreshResponse = await authService.refreshToken(storedRefreshToken);
            const { accessToken, refreshToken: newRefreshToken } = refreshResponse.data;
            tokenManager.setAccessToken(accessToken);
            tokenManager.setRefreshToken(newRefreshToken);
            tokenManager.setAuthCookie(accessToken);
            // Retry with new token
            return await fetchAndApplyUser();
          } catch {
            // Refresh tokens are single-use: another tab may have rotated this
            // one first. If it has (now or after one short wait), continue with
            // the session it stored instead of logging out.
            const adopted = await adoptRotatedSession(storedRefreshToken);
            if (adopted) {
              return adopted.ready;
            }
            // Refresh token also rejected — fall through to forced logout
          }
        }
        // No refresh token or refresh failed — clear session and redirect
        console.warn("Session expired — redirecting to login");
        tokenManager.clearAll();
        tokenManager.clearAuthCookie();
        setUser(null);
        setOrganization(null);
        setOrganizations([]);
        startNewGeneration("idle");
        // Same identity-ended reset as logout() -- this path doesn't call it.
        // Unlike logout(), a pending invitation is kept: an invitee whose
        // stale session expires on /accept-invitation must get back to it.
        await resetCachesForIdentityChange(queryClient);
        // The only navigation for an expired session (AuthGate leaves an
        // ended session to this): back to this page once signed in again --
        // unless an invitation is pending, which plain /login returns to
        // (postSignInPath).
        router.push(hasPendingInvitation() ? "/login" : loginPathReturningHere());
      } else {
        // Non-401 error (network down, 5xx, etc.) — don't clear the session,
        // the cached user state is still valid.
        logError("Failed to refresh user", error);
      }
      return false;
    }
  }, [router, queryClient, applyOrganizationList, startNewGeneration]);

  /**
   * Refresh user data
   */
  const refreshUser = useCallback(async () => {
    await loadUser();
  }, [loadUser]);

  /**
   * One organization load: /api/auth/me and /api/organizations together, as
   * on page load. Ready as soon as either succeeds. If both fail, the first
   * load (autoRetry) tries once more after ORG_LOAD_RETRY_MS; any other load
   * goes straight to "error". Never two loads at once: a call while one is
   * running returns it. A failure never changes a workspace already ready.
   */
  const startOrganizationLoad = useCallback(
    (autoRetry: boolean): Promise<void> => {
      if (attemptRef.current) return attemptRef.current;
      clearRetryTimer();
      const generation = generationRef.current;
      if (statusRef.current !== "ready") setOrganizationStatus("loading");

      const attempt: Promise<void> = Promise.all([
        loadUser().catch(() => false),
        loadOrganizations().catch(() => false),
      ]).then(
        ([fromUser, fromOrganizations]) => {
          if (attemptRef.current === attempt) attemptRef.current = null;
          if (!mountedRef.current || generation !== generationRef.current) return;
          if (fromUser || fromOrganizations || statusRef.current === "ready") return;
          if (autoRetry) {
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              if (!mountedRef.current || generation !== generationRef.current) return;
              startOrganizationLoadRef.current(false).catch((error) =>
                logError("Failed to load organization", error)
              );
            }, ORG_LOAD_RETRY_MS);
          } else {
            setOrganizationStatus("error");
          }
        }
      );
      attemptRef.current = attempt;
      return attempt;
    },
    [loadUser, loadOrganizations, clearRetryTimer, setOrganizationStatus]
  );
  startOrganizationLoadRef.current = startOrganizationLoad;

  /** Manual "Try again": one load, no automatic retry after it. */
  const retryOrganizationLoad = useCallback(
    () => startOrganizationLoadRef.current(false),
    []
  );

  /**
   * The backend reports MEMBERSHIP_REVOKED (via lib/api.ts) when this
   * session's organization membership has ended. Run refreshUser once: its
   * /me call fails the same way, the refresh is rejected, and it logs out.
   * Ignored while one run is in flight, and once signed out -- a late
   * response to a request sent before logout must not start another.
   */
  const refreshUserRef = useRef(refreshUser);
  useEffect(() => {
    refreshUserRef.current = refreshUser;
  }, [refreshUser]);

  useEffect(() => {
    let inFlight = false;
    const onMembershipRevoked = () => {
      if (inFlight || !tokenManager.getAccessToken()) return;
      inFlight = true;
      refreshUserRef.current()
        .catch((error) => logError("Failed to refresh user", error))
        .finally(() => {
          inFlight = false;
        });
    };
    window.addEventListener(MEMBERSHIP_REVOKED_EVENT, onMembershipRevoked);
    return () => window.removeEventListener(MEMBERSHIP_REVOKED_EVENT, onMembershipRevoked);
  }, []);

  /**
   * Create organization
   */
  const createOrganization = useCallback(
    async (
      name: string,
      slug?: string,
      displayName?: string,
      description?: string
    ) => {
      try {
        const newOrg = await organizationsService.create({
          name,
          slug,
          displayName,
          description,
        });

        // Add to organizations list
        setOrganizations((prev) => [...prev, newOrg]);

        // Switch to new organization. Drop the previous organization's cached
        // data first, so none of it is ever shown as the new one's. No
        // earlier organization response may replace it afterwards.
        await resetCachesForIdentityChange(queryClient);
        startNewGeneration("loading");
        appliedOrgSeqRef.current = ++orgSeqRef.current;
        setOrganization(newOrg);
        setOrganizationStatus("ready");

        toast.success("Organization created!", {
          description: `${newOrg.name} is ready to use`,
        });

        return newOrg;
      } catch (error: any) {
        logError("Failed to create organization", error);
        const message =
          error.response?.data?.error ||
          error.response?.data?.message ||
          "Failed to create organization";
        toast.error("Creation failed", {
          description: message,
        });
        throw error;
      }
    },
    [queryClient, startNewGeneration, setOrganizationStatus]
  );

  /**
   * Switch organization
   */
  const switchOrganization = useCallback(
    async (organizationId: string) => {
      try {
        // Call API to switch organization
        await organizationsService.switch(organizationId);

        // Find organization in list
        const org = organizations.find((o) => o.id === organizationId);
        if (org) {
          // Same as an identity change: no cached data of the previous
          // organization may be served once this one is current.
          await resetCachesForIdentityChange(queryClient);
          setOrganization(org);
          toast.success(`Switched to ${org.name}`);

          // Refresh data for new organization
          router.refresh();
        }
      } catch (error: any) {
        logError("Failed to switch organization", error);
        toast.error("Failed to switch organization", {
          description:
            error.response?.data?.message || "Please try again later",
        });
      }
    },
    [organizations, router, queryClient]
  );

  /**
   * Set current organization
   */
  const setCurrentOrganization = useCallback((org: Organization) => {
    appliedOrgSeqRef.current = ++orgSeqRef.current;
    setOrganization(org);
  }, []);

  /**
   * Computed value: is user authenticated
   */
  const isAuthenticated = useMemo(() => !!user, [user]);

  /**
   * Context value
   */
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organization,
      organizations,
      organizationStatus,
      isAuthenticated,
      isLoading,
      login,
      register,
      logout,
      refreshUser,
      switchOrganization,
      setCurrentOrganization,
      refreshOrganizations,
      retryOrganizationLoad,
      createOrganization,
    }),
    [
      user,
      organization,
      organizations,
      organizationStatus,
      isAuthenticated,
      isLoading,
      login,
      register,
      logout,
      refreshUser,
      switchOrganization,
      setCurrentOrganization,
      refreshOrganizations,
      retryOrganizationLoad,
      createOrganization,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth Hook
 * Custom hook to access auth context
 *
 * @throws {Error} If used outside of AuthProvider
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
