/**
 * Authentication Service
 * Handles user authentication, JWT tokens, and password management
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { pool } from '../config/database';
import { encryptionService } from './encryption.service';

const BCRYPT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRY = '7d'; // 7 days
const REFRESH_TOKEN_EXPIRY = '30d'; // 30 days
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 30;

interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  avatar_url: string | null;
  is_active: boolean;
  is_email_verified: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
}

interface OrganizationMembership {
  organization_id: string;
  role: string;
  organization_slug: string;
  organization_name: string;
}

interface JWTPayload {
  userId: string;
  email: string;
  organizationId: string;
  role: string;
  type: 'access' | 'refresh';
}

export class AuthService {
  private jwtSecret: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-this';

    if (!process.env.JWT_SECRET) {
      console.warn('⚠️  WARNING: JWT_SECRET not set. Using default key. This is insecure!');
    }
  }

  /**
   * Register a new user
   */
  async register(data: {
    email: string;
    password: string;
    fullName: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    user: any;
    organization: any;
    message: string;
  }> {
    const { email, password, fullName } = data;

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    // Validate password strength
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Generate email verification token
    const verificationToken = encryptionService.generateToken();
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Generate organization slug from email (e.g., "john-workspace" from "john@example.com")
    const emailUsername = email.split('@')[0].toLowerCase();
    const baseSlug = `${emailUsername}-workspace`;

    // Ensure slug is unique by appending a number if needed
    let slug = baseSlug;
    let slugCounter = 1;
    let slugExists = true;

    while (slugExists) {
      const slugCheck = await pool.query(
        'SELECT id FROM organizations WHERE slug = $1 AND deleted_at IS NULL',
        [slug]
      );

      if (slugCheck.rows.length === 0) {
        slugExists = false;
      } else {
        slug = `${baseSlug}-${slugCounter}`;
        slugCounter++;
      }
    }

    // Start transaction - all operations must succeed together
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create user
      const userResult = await client.query(
        `INSERT INTO users (
          email,
          password_hash,
          full_name,
          email_verification_token,
          email_verification_expires_at
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, email, full_name, is_email_verified, created_at`,
        [email.toLowerCase(), passwordHash, fullName, verificationToken, verificationExpiry]
      );

      const user = userResult.rows[0];

      // Create organization for the user
      const organizationName = `${fullName}'s Workspace`;
      const orgResult = await client.query(
        `INSERT INTO organizations (
          name,
          slug,
          display_name,
          description,
          subscription_tier,
          max_services,
          max_users
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, name, slug, display_name, subscription_tier, created_at`,
        [
          organizationName,
          slug,
          organizationName,
          `Personal workspace for ${fullName}`,
          'free',
          10,
          5
        ]
      );

      const organization = orgResult.rows[0];

      // Create organization membership (make user the owner)
      await client.query(
        `INSERT INTO organization_memberships (
          organization_id,
          user_id,
          role,
          joined_at
        ) VALUES ($1, $2, $3, NOW())`,
        [organization.id, user.id, 'owner']
      );

      // Commit transaction
      await client.query('COMMIT');

      // Generate tokens for immediate login
      const accessToken = this.generateAccessToken({
        userId: user.id,
        email: user.email,
        organizationId: organization.id,
        role: 'owner',
      });

      const refreshToken = this.generateRefreshToken({
        userId: user.id,
        email: user.email,
        organizationId: organization.id,
        role: 'owner',
      });

      // Store session
      await this.createSession(
        user.id,
        organization.id,
        accessToken,
        refreshToken
      );

      // TODO: Send verification email
      console.log(`📧 Email verification token for ${email}: ${verificationToken}`);
      console.log(`✅ Created organization "${organizationName}" (slug: ${slug}) for ${email}`);

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          avatarUrl: user.avatar_url,
          isEmailVerified: user.is_email_verified,
          createdAt: user.created_at,
        },
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          displayName: organization.display_name,
          subscriptionTier: organization.subscription_tier,
          createdAt: organization.created_at,
          role: 'owner',
        },
        message: 'User registered successfully. Your personal workspace has been created. Please check your email to verify your account.',
      };
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Login user with email and password
   */
  async login(
    email: string,
    password: string,
    ipAddress?: string
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: any;
    organization: any;
  }> {
    // Find user
    const userResult = await pool.query<User>(
      `SELECT id, email, password_hash, full_name, avatar_url, is_active,
              is_email_verified, failed_login_attempts, locked_until
       FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = userResult.rows[0];

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.locked_until).getTime() - Date.now()) / (60 * 1000)
      );
      throw new Error(
        `Account is locked due to too many failed login attempts. Try again in ${minutesLeft} minutes.`
      );
    }

    // Check if account is active
    if (!user.is_active) {
      throw new Error('Account is deactivated. Please contact support.');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      // Increment failed attempts
      const newFailedAttempts = user.failed_login_attempts + 1;
      let lockedUntil = null;

      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);
      }

      await pool.query(
        `UPDATE users
         SET failed_login_attempts = $1, locked_until = $2
         WHERE id = $3`,
        [newFailedAttempts, lockedUntil, user.id]
      );

      throw new Error('Invalid email or password');
    }

    // Get user's organizations
    const orgsResult = await pool.query<OrganizationMembership>(
      `SELECT om.organization_id, om.role, o.slug as organization_slug, o.name as organization_name
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1 AND om.is_active = true AND o.is_active = true AND o.deleted_at IS NULL
       ORDER BY om.created_at ASC
       LIMIT 1`,
      [user.id]
    );

    if (orgsResult.rows.length === 0) {
      throw new Error('User is not a member of any organization. Please contact support.');
    }

    const primaryOrg = orgsResult.rows[0];

    // Reset failed attempts and update last login
    await pool.query(
      `UPDATE users
       SET failed_login_attempts = 0,
           locked_until = NULL,
           last_login_at = NOW(),
           last_login_ip = $1
       WHERE id = $2`,
      [ipAddress, user.id]
    );

    // Generate tokens
    const accessToken = this.generateAccessToken({
      userId: user.id,
      email: user.email,
      organizationId: primaryOrg.organization_id,
      role: primaryOrg.role,
    });

    const refreshToken = this.generateRefreshToken({
      userId: user.id,
      email: user.email,
      organizationId: primaryOrg.organization_id,
      role: primaryOrg.role,
    });

    // Store session
    await this.createSession(
      user.id,
      primaryOrg.organization_id,
      accessToken,
      refreshToken,
      ipAddress
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        avatarUrl: user.avatar_url,
        isEmailVerified: user.is_email_verified,
      },
      organization: {
        id: primaryOrg.organization_id,
        slug: primaryOrg.organization_slug,
        name: primaryOrg.organization_name,
        role: primaryOrg.role,
      },
    };
  }

  /**
   * Generate access token (JWT)
   */
  private generateAccessToken(payload: Omit<JWTPayload, 'type'>): string {
    return jwt.sign(
      {
        ...payload,
        type: 'access',
      },
      this.jwtSecret,
      {
        expiresIn: ACCESS_TOKEN_EXPIRY,
      }
    );
  }

  /**
   * Generate refresh token (JWT)
   */
  private generateRefreshToken(payload: Omit<JWTPayload, 'type'>): string {
    return jwt.sign(
      {
        ...payload,
        type: 'refresh',
      },
      this.jwtSecret,
      {
        expiresIn: REFRESH_TOKEN_EXPIRY,
      }
    );
  }

  /**
   * Generate a token pair for an authenticated user (used by SAML and other SSO flows)
   */
  async generateTokenPair(payload: {
    userId: string;
    email: string;
    organizationId: string;
    role: string;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);
    await this.createSession(payload.userId, payload.organizationId, accessToken, refreshToken);
    return { accessToken, refreshToken };
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): JWTPayload {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      }
      throw new Error('Token verification failed');
    }
  }

  /**
   * Create session record
   */
  private async createSession(
    userId: string,
    organizationId: string,
    accessToken: string,
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const accessTokenHash = encryptionService.hash(accessToken);
    const refreshTokenHash = encryptionService.hash(refreshToken);

    const accessTokenDecoded = jwt.decode(accessToken) as any;
    const refreshTokenDecoded = jwt.decode(refreshToken) as any;

    await pool.query(
      `INSERT INTO sessions (
        user_id,
        organization_id,
        access_token_hash,
        refresh_token_hash,
        access_token_expires_at,
        refresh_token_expires_at,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        organizationId,
        accessTokenHash,
        refreshTokenHash,
        new Date(accessTokenDecoded.exp * 1000),
        new Date(refreshTokenDecoded.exp * 1000),
        ipAddress,
        userAgent,
      ]
    );
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    // Verify refresh token
    const decoded = this.verifyToken(refreshToken);

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Check if session is still active
    const refreshTokenHash = encryptionService.hash(refreshToken);
    const sessionResult = await pool.query(
      `SELECT id FROM sessions
       WHERE refresh_token_hash = $1 AND is_active = true AND revoked_at IS NULL`,
      [refreshTokenHash]
    );

    if (sessionResult.rows.length === 0) {
      throw new Error('Session not found or has been revoked');
    }

    // Generate new tokens
    const newAccessToken = this.generateAccessToken({
      userId: decoded.userId,
      email: decoded.email,
      organizationId: decoded.organizationId,
      role: decoded.role,
    });

    const newRefreshToken = this.generateRefreshToken({
      userId: decoded.userId,
      email: decoded.email,
      organizationId: decoded.organizationId,
      role: decoded.role,
    });

    // Update session
    const newAccessTokenHash = encryptionService.hash(newAccessToken);
    const newRefreshTokenHash = encryptionService.hash(newRefreshToken);

    await pool.query(
      `UPDATE sessions
       SET access_token_hash = $1,
           refresh_token_hash = $2,
           access_token_expires_at = $3,
           refresh_token_expires_at = $4,
           last_used_at = NOW()
       WHERE id = $5`,
      [
        newAccessTokenHash,
        newRefreshTokenHash,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        sessionResult.rows[0].id,
      ]
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout user (revoke session)
   */
  async logout(accessToken: string): Promise<void> {
    const tokenHash = encryptionService.hash(accessToken);

    await pool.query(
      `UPDATE sessions
       SET is_active = false, revoked_at = NOW()
       WHERE access_token_hash = $1`,
      [tokenHash]
    );
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    // Validate new password
    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long');
    }

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    // Verify old password
    const isValid = await bcrypt.compare(oldPassword, result.rows[0].password_hash);

    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // Update password
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, userId]
    );

    // Revoke all sessions (force re-login)
    await pool.query(
      'UPDATE sessions SET is_active = false, revoked_at = NOW() WHERE user_id = $1',
      [userId]
    );
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<string> {
    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      // Don't reveal if email exists or not (security best practice)
      return 'If the email exists, a password reset link has been sent.';
    }

    const userId = result.rows[0].id;
    const resetToken = encryptionService.generateToken();
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `UPDATE users
       SET password_reset_token = $1,
           password_reset_expires_at = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [resetToken, resetExpiry, userId]
    );

    // TODO: Send password reset email
    console.log(`🔑 Password reset token for ${email}: ${resetToken}`);

    return 'If the email exists, a password reset link has been sent.';
  }

  /**
   * Reset password using token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }

    const result = await pool.query(
      `SELECT id FROM users
       WHERE password_reset_token = $1
         AND password_reset_expires_at > NOW()
         AND deleted_at IS NULL`,
      [token]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid or expired reset token');
    }

    const userId = result.rows[0].id;
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           password_reset_token = NULL,
           password_reset_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, userId]
    );

    // Revoke all sessions
    await pool.query(
      'UPDATE sessions SET is_active = false, revoked_at = NOW() WHERE user_id = $1',
      [userId]
    );
  }

  /**
   * Verify email using token
   */
  async verifyEmail(token: string): Promise<void> {
    const result = await pool.query(
      `SELECT id FROM users
       WHERE email_verification_token = $1
         AND email_verification_expires_at > NOW()
         AND deleted_at IS NULL`,
      [token]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid or expired verification token');
    }

    await pool.query(
      `UPDATE users
       SET is_email_verified = true,
           email_verification_token = NULL,
           email_verification_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [result.rows[0].id]
    );
  }

  /**
   * Get current user info
   */
  async getCurrentUser(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT id, email, full_name, avatar_url, is_email_verified, created_at, last_login_at
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];

    // Get organizations
    const orgsResult = await pool.query(
      `SELECT o.id, o.name, o.slug, o.display_name, om.role
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       WHERE om.user_id = $1 AND om.is_active = true AND o.is_active = true AND o.deleted_at IS NULL
       ORDER BY om.created_at ASC`,
      [userId]
    );

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      avatarUrl: user.avatar_url,
      isEmailVerified: user.is_email_verified,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      organizations: orgsResult.rows,
    };
  }
}

// Export singleton instance
export const authService = new AuthService();
