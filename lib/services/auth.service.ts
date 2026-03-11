import { api } from "../api";
import type { User } from "../types";

/**
 * Authentication API Response Types
 */
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
}

export interface AuthResponse {
  success: boolean;
  data: {
    user: User;
    accessToken: string;
    refreshToken: string;
  };
  message?: string;
}

export interface RefreshTokenResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * Authentication Service
 * Handles all authentication-related API calls
 */
export const authService = {
  /**
   * Register a new user account
   */
  async register(data: RegisterRequest): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>("/api/auth/register", data);
    return response.data;
  },

  /**
   * Login with email and password
   */
  async login(data: LoginRequest): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>("/api/auth/login", data);
    return response.data;
  },

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    await api.post("/api/auth/logout");
  },

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User> {
    const response = await api.get<{ success: boolean; data: User }>(
      "/api/auth/me"
    );
    return response.data.data;
  },

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse> {
    const response = await api.post<RefreshTokenResponse>(
      "/api/auth/refresh-token",
      {
        refreshToken,
      }
    );
    return response.data;
  },

  /**
   * Send password reset email
   */
  async forgotPassword(data: ForgotPasswordRequest): Promise<void> {
    await api.post("/api/auth/forgot-password", data);
  },

  /**
   * Reset password with token
   */
  async resetPassword(data: ResetPasswordRequest): Promise<void> {
    await api.post("/api/auth/reset-password", data);
  },

  /**
   * Change password for authenticated user
   */
  async changePassword(data: ChangePasswordRequest): Promise<void> {
    await api.patch("/api/auth/change-password", data);
  },

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<void> {
    await api.post("/api/auth/verify-email", { token });
  },
};

/**
 * Token Management Utilities
 */
export const tokenManager = {
  getAccessToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("accessToken");
  },

  setAccessToken(token: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("accessToken", token);
  },

  getRefreshToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("refreshToken");
  },

  setRefreshToken(token: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("refreshToken", token);
  },

  getSessionId(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("sessionId");
  },

  setSessionId(sessionId: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("sessionId", sessionId);
  },

  getUser(): User | null {
    if (typeof window === "undefined") return null;
    const userStr = localStorage.getItem("user");
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  },

  setUser(user: User): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("user", JSON.stringify(user));
  },

  clearAll(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("sessionId");
    localStorage.removeItem("user");
  },

  hasValidToken(): boolean {
    return !!this.getAccessToken();
  },

  /**
   * Set auth cookie for middleware
   */
  setAuthCookie(token: string): void {
    console.log('setAuthCookie called with:', token);
    console.log('typeof token:', typeof token);
    if (typeof window === "undefined") return;
    // Set cookie with SameSite and Secure flags for better compatibility
    const isSecure = window.location.protocol === "https:";
    const secureFlag = isSecure ? " Secure;" : "";
    console.log('Setting auth-token cookie with token:', token.substring(0, 20) + '...');
    document.cookie = `auth-token=${token}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Strict`;
    console.log('Cookie after set:', document.cookie);
  },

  /**
   * Clear auth cookie
   */
  clearAuthCookie(): void {
    if (typeof window === "undefined") return;
    document.cookie = "auth-token=; path=/; max-age=0; SameSite=Lax";
  },
};
