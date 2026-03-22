/**
 * SAML Service
 * Handles SAML 2.0 SSO authentication using @node-saml/node-saml
 */

import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { Pool } from 'pg';
import { pool } from '../config/database';
import { encryptionService } from './encryption.service';
import { authService } from './auth.service';

interface SSOConfiguration {
  id: string;
  organization_id: string;
  provider_name: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string; // encrypted
  sp_entity_id: string;
  attribute_mapping: { email: string; name: string };
  allowed_domains: string[];
  is_active: boolean;
}

interface SAMLProfile {
  nameID?: string;
  email?: string;
  displayName?: string;
  [key: string]: unknown;
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3010';

/**
 * Build a SAML instance for a given org config
 */
function buildSAMLInstance(config: SSOConfiguration): SAML {
  const decryptedCert = encryptionService.decrypt(config.idp_certificate);

  return new SAML({
    issuer: config.sp_entity_id,
    callbackUrl: `${BACKEND_URL}/api/auth/saml/callback?orgId=${config.organization_id}`,
    entryPoint: config.idp_sso_url,
    idpIssuer: config.idp_entity_id,
    idpCert: decryptedCert,
    signatureAlgorithm: 'sha256',
    wantAuthnResponseSigned: true,
    validateInResponseTo: ValidateInResponseTo.never, // stateless — no session store
    disableRequestedAuthnContext: true,
  });
}

export const samlService = {
  /**
   * Fetch SSO config row for an org
   */
  async getConfig(organizationId: string): Promise<SSOConfiguration | null> {
    const result = await pool.query(
      'SELECT * FROM sso_configurations WHERE organization_id = $1',
      [organizationId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Fetch SSO config by allowed domain (for login-page domain lookup)
   */
  async getConfigByDomain(domain: string): Promise<{ organizationId: string; providerName: string } | null> {
    const result = await pool.query(
      `SELECT organization_id, provider_name
       FROM sso_configurations
       WHERE is_active = true AND allowed_domains @> $1::jsonb`,
      [JSON.stringify([domain.toLowerCase()])]
    );
    if (result.rows.length === 0) return null;
    return {
      organizationId: result.rows[0].organization_id,
      providerName: result.rows[0].provider_name,
    };
  },

  /**
   * Upsert SSO configuration for an org
   */
  async saveConfig(
    organizationId: string,
    data: {
      providerName: string;
      idpEntityId: string;
      idpSsoUrl: string;
      idpCertificate: string; // raw PEM — we encrypt it here
      attributeMapping?: { email?: string; name?: string };
      allowedDomains?: string[];
      isActive?: boolean;
    }
  ): Promise<SSOConfiguration> {
    const encryptedCert = encryptionService.encrypt(data.idpCertificate.trim());
    const spEntityId = `${BACKEND_URL}/saml/${organizationId}`;
    const attributeMapping = {
      email: data.attributeMapping?.email ?? 'email',
      name: data.attributeMapping?.name ?? 'displayName',
    };
    const allowedDomains = (data.allowedDomains ?? []).map((d) => d.toLowerCase().trim());

    const result = await pool.query(
      `INSERT INTO sso_configurations
         (organization_id, provider_name, idp_entity_id, idp_sso_url, idp_certificate,
          sp_entity_id, attribute_mapping, allowed_domains, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id) DO UPDATE SET
         provider_name     = EXCLUDED.provider_name,
         idp_entity_id     = EXCLUDED.idp_entity_id,
         idp_sso_url       = EXCLUDED.idp_sso_url,
         idp_certificate   = EXCLUDED.idp_certificate,
         sp_entity_id      = EXCLUDED.sp_entity_id,
         attribute_mapping = EXCLUDED.attribute_mapping,
         allowed_domains   = EXCLUDED.allowed_domains,
         is_active         = EXCLUDED.is_active,
         updated_at        = NOW()
       RETURNING *`,
      [
        organizationId,
        data.providerName,
        data.idpEntityId,
        data.idpSsoUrl,
        encryptedCert,
        spEntityId,
        JSON.stringify(attributeMapping),
        JSON.stringify(allowedDomains),
        data.isActive ?? false,
      ]
    );
    return result.rows[0];
  },

  /**
   * Delete SSO configuration for an org
   */
  async deleteConfig(organizationId: string): Promise<void> {
    await pool.query('DELETE FROM sso_configurations WHERE organization_id = $1', [organizationId]);
  },

  /**
   * Generate SP metadata XML
   */
  async generateMetadata(organizationId: string): Promise<string> {
    const config = await this.getConfig(organizationId);
    if (!config) throw new Error('SSO not configured for this organization');

    const saml = buildSAMLInstance(config);
    return saml.generateServiceProviderMetadata(null, null);
  },

  /**
   * Build IdP authorization URL (for initiating SAML flow)
   */
  async getInitiateUrl(organizationId: string): Promise<string> {
    const config = await this.getConfig(organizationId);
    if (!config) throw new Error('SSO not configured for this organization');
    if (!config.is_active) throw new Error('SSO is not active for this organization');

    const saml = buildSAMLInstance(config);
    // relayState carries orgId so callback can identify the org
    const url = await saml.getAuthorizeUrlAsync(organizationId, undefined, {});
    return url;
  },

  /**
   * Validate a SAML POST assertion and return extracted user info
   */
  async validateCallback(
    organizationId: string,
    body: Record<string, string>
  ): Promise<{ email: string; name: string; nameID: string }> {
    const config = await this.getConfig(organizationId);
    if (!config) throw new Error('SSO not configured for this organization');

    const saml = buildSAMLInstance(config);
    const { profile } = await saml.validatePostResponseAsync(body) as { profile: SAMLProfile; loggedOut: boolean };

    if (!profile) throw new Error('Invalid SAML assertion: no profile returned');

    const emailAttr = config.attribute_mapping.email;
    const nameAttr = config.attribute_mapping.name;

    // Try standard field first, then mapped attribute name
    const email =
      (profile.email as string) ||
      (profile[emailAttr] as string) ||
      (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] as string) ||
      profile.nameID ||
      '';

    const name =
      (profile.displayName as string) ||
      (profile[nameAttr] as string) ||
      (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] as string) ||
      email.split('@')[0];

    if (!email) throw new Error('SAML assertion did not include an email address');

    return { email: email.toLowerCase(), name, nameID: profile.nameID ?? '' };
  },

  /**
   * Find or create a user from SAML profile, scoped to the org
   */
  async findOrCreateUser(
    organizationId: string,
    profile: { email: string; name: string }
  ): Promise<{ userId: string; email: string; role: string }> {
    // Check if user already exists in this org
    const existing = await pool.query(
      `SELECT u.id, u.email, om.role
       FROM users u
       JOIN organization_memberships om ON om.user_id = u.id
       WHERE u.email = $1
         AND om.organization_id = $2
         AND om.is_active = true
         AND u.deleted_at IS NULL`,
      [profile.email, organizationId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      // Update last login
      await pool.query(
        'UPDATE users SET last_login_at = NOW() WHERE id = $1',
        [row.id]
      );
      return { userId: row.id, email: row.email, role: row.role };
    }

    // Create new user (SSO-provisioned — no password)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO users (email, full_name, is_email_verified, is_active, last_login_at)
         VALUES ($1, $2, true, true, NOW())
         ON CONFLICT (email) DO UPDATE SET last_login_at = NOW()
         RETURNING id, email`,
        [profile.email, profile.name]
      );
      const user = userResult.rows[0];

      // Add to org as member (IdP-provisioned users get 'member' role by default)
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', NOW())
         ON CONFLICT (organization_id, user_id) DO UPDATE SET is_active = true`,
        [organizationId, user.id]
      );

      await client.query('COMMIT');
      return { userId: user.id, email: user.email, role: 'member' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Issue a JWT token pair for an SSO-authenticated user
   */
  async issueTokens(
    userId: string,
    email: string,
    organizationId: string,
    role: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    return authService.generateTokenPair({ userId, email, organizationId, role });
  },
};
