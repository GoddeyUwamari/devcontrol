"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { User } from "../types";
import { authService, tokenManager } from "../services/auth.service";
import {
  organizationsService,
  type Organization,
} from "../services/organizations.service";

/**
 * Auth Context Value Interface
 */
interface AuthContextValue {
  // State
  user: User | null;
  organization: Organization | null;
  organizations: Organization[];
  isAuthenticated: boolean;
  isLoading: boolean;

  // Auth Methods
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;

  // Organization Methods
  switchOrganization: (organizationId: string) => Promise<void>;
  setCurrentOrganization: (org: Organization) => void;
  refreshOrganizations: () => Promise<void>;
  createOrganization: (name: string, slug?: string, displayName?: string, description?: string) => Promise<Organization>;
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
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Debug: Log auth state changes
   */
  useEffect(() => {
    console.log("🔍 Auth Context State Changed:");
    console.log("  User:", user);
    console.log("  Organization:", organization);
    console.log("  Organizations:", organizations);
    console.log("  isAuthenticated:", !!user);
    console.log("  isLoading:", isLoading);
  }, [user, organization, organizations, isLoading]);

  /**
   * Initialize auth state on mount
   */
  useEffect(() => {
    initializeAuth();
  }, []);

  /**
   * Initialize authentication state from localStorage
   */
  const initializeAuth = async () => {
    console.log("🔐 Auth Context - Initializing...");
    try {
      const token = tokenManager.getAccessToken();
      const cachedUser = tokenManager.getUser();

      console.log("🔐 Token exists:", !!token);
      console.log("🔐 Cached user:", cachedUser);

      if (token && cachedUser) {
        setUser(cachedUser);
        // Re-set the auth cookie in case it was cleared (cookie can expire while localStorage persists)
        tokenManager.setAuthCookie(token);
        console.log("🔐 Setting cached user, fetching fresh data...");
        // Fetch fresh user data and organizations in the background
        await Promise.all([refreshUser(), refreshOrganizations()]);
      } else {
        console.log("🔐 No token or cached user, user not authenticated");
      }
    } catch (error) {
      console.error("❌ Failed to initialize auth:", error);
      // Clear invalid auth state
      tokenManager.clearAll();
    } finally {
      setIsLoading(false);
      console.log("🔐 Auth initialization complete");
    }
  };

  /**
   * Refresh organizations
   */
  const refreshOrganizations = useCallback(async () => {
    try {
      const orgs = await organizationsService.getAll();
      setOrganizations(orgs);

      // Set first organization as active if none selected — use functional update
      // to avoid capturing `organization` in deps (which would cause identity churn)
      if (orgs.length > 0) {
        setOrganization((prev) => prev ?? orgs[0]);
      }
    } catch (error) {
      console.error("Failed to fetch organizations:", error);
    }
  }, []);

  /**
   * Login method
   */
  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const response = await authService.login({ email, password });
        console.log('FULL RESPONSE:', JSON.stringify(response, null, 2));

        // Handle both flat and nested response structures
        const payload = response?.data ?? response;
        const accessToken = payload?.accessToken || (response as any)?.token;
        const refreshToken = payload?.refreshToken;
        const user = payload?.user;
        const organization = payload?.organization;

        // Store tokens
        tokenManager.setAccessToken(accessToken);
        tokenManager.setRefreshToken(refreshToken);
        tokenManager.setUser(user);
        tokenManager.setAuthCookie(accessToken);

        setUser(user);

        // Set organization from login response
        if (organization) {
          setOrganization(organization);
          setOrganizations([organization]);
        }

        // Fetch all user's organizations in background
        refreshOrganizations().catch(console.error);

        toast.success("Welcome back!", {
          description: `Logged in as ${response.data.user.email}`,
        });

        // Redirect to dashboard with fallback
        console.log("🚀 Redirecting to dashboard...");
        try {
          // Use Next.js router for client-side navigation
          await router.push("/dashboard");

          // Fallback: Force navigation if router.push doesn't work
          setTimeout(() => {
            if (window.location.pathname === "/login") {
              console.log("⚠️ Router redirect failed, using window.location");
              window.location.href = "/dashboard";
            }
          }, 100);
        } catch (error) {
          console.error("❌ Router navigation failed, using window.location:", error);
          window.location.href = "/dashboard";
        }
      } catch (error: any) {
        console.error("Login failed:", error);
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
    [router, refreshOrganizations]
  );

  /**
   * Register method
   */
  const register = useCallback(
    async (email: string, password: string, fullName: string) => {
      try {
        const response = await authService.register({
          email,
          password,
          fullName,
        });

        // Backend returns tokens on registration, so we can log user in immediately
        // Check if tokens are in response
        if (response.data.accessToken && response.data.refreshToken) {
          // Store tokens
          tokenManager.setAccessToken(response.data.accessToken);
          tokenManager.setRefreshToken(response.data.refreshToken);
          tokenManager.setUser(response.data.user);
          tokenManager.setAuthCookie(response.data.accessToken);

          // Update state
          setUser(response.data.user);

          // Set organization from registration response
          if (response.data.organization) {
            setOrganization(response.data.organization);
            setOrganizations([response.data.organization]);
          }

          toast.success("Account created successfully!", {
            description: "Welcome to DevControl",
          });

          // Redirect to dashboard with fallback
          console.log("🚀 Redirecting to dashboard...");
          try {
            await router.push("/dashboard");

            // Fallback: Force navigation if router.push doesn't work
            setTimeout(() => {
              if (window.location.pathname !== "/dashboard") {
                console.log("⚠️  Router redirect failed, using window.location");
                window.location.href = "/dashboard";
              }
            }, 100);
          } catch (error) {
            console.error("❌ Router navigation failed, using window.location:", error);
            window.location.href = "/dashboard";
          }
        } else {
          // Older backend that doesn't return tokens on registration
          toast.success("Account created successfully!", {
            description: "Please log in with your new account",
          });
          router.push("/login");
        }
      } catch (error: any) {
        console.error("Registration failed:", error);
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
    [router]
  );

  /**
   * Logout method
   */
  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error("Logout API call failed:", error);
      // Continue with logout even if API call fails
    } finally {
      // Clear local state
      tokenManager.clearAll();
      tokenManager.clearAuthCookie();
      setUser(null);
      setOrganization(null);
      setOrganizations([]);

      toast.success("Logged out successfully");

      // Only redirect if not already on login/signup page
      if (typeof window !== 'undefined' &&
          !window.location.pathname.startsWith('/login') &&
          !window.location.pathname.startsWith('/signup')) {
        router.push("/login");
      }
    }
  }, [router]);

  /**
   * Refresh user data
   */
  const refreshUser = useCallback(async () => {
    try {
      const response = await authService.getCurrentUser();

      // Extract user data (getCurrentUser returns user with organizations array)
      const { organizations: userOrgs, ...userData } = response as any;

      console.log("🔄 Refreshed user data:", userData);
      console.log("🔄 User organizations:", userOrgs);

      setUser(userData);
      tokenManager.setUser(userData);

      // If organizations are included in the response, update them
      if (userOrgs && Array.isArray(userOrgs)) {
        setOrganizations(userOrgs);

        // Set first organization as active if none selected — use functional update
        // to avoid capturing `organization` in deps (which would cause identity churn)
        if (userOrgs.length > 0) {
          setOrganization((prev) => {
            if (!prev) console.log("🔄 Set active organization:", userOrgs[0]);
            return prev ?? userOrgs[0];
          });
        }
      }
    } catch (error) {
      console.error("Failed to refresh user:", error);
      // If refresh fails with 401, logout
      if ((error as any)?.response?.status === 401) {
        await logout();
      }
    }
  }, [logout]);

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

        // Switch to new organization
        setOrganization(newOrg);

        toast.success("Organization created!", {
          description: `${newOrg.name} is ready to use`,
        });

        return newOrg;
      } catch (error: any) {
        console.error("Failed to create organization:", error);
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
    []
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
          setOrganization(org);
          toast.success(`Switched to ${org.name}`);

          // Refresh data for new organization
          router.refresh();
        }
      } catch (error: any) {
        console.error("Failed to switch organization:", error);
        toast.error("Failed to switch organization", {
          description:
            error.response?.data?.message || "Please try again later",
        });
      }
    },
    [organizations, router]
  );

  /**
   * Set current organization
   */
  const setCurrentOrganization = useCallback((org: Organization) => {
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
      isAuthenticated,
      isLoading,
      login,
      register,
      logout,
      refreshUser,
      switchOrganization,
      setCurrentOrganization,
      refreshOrganizations,
      createOrganization,
    }),
    [
      user,
      organization,
      organizations,
      isAuthenticated,
      isLoading,
      login,
      register,
      logout,
      refreshUser,
      switchOrganization,
      setCurrentOrganization,
      refreshOrganizations,
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
