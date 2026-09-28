/**
 * SAML Service
 * Handles SAML 2.0 SSO authentication using @node-saml/node-saml
 *
 * Security boundary (PR #140):
 *   - The organization is always the one whose SSO configuration is bound to
 *     the callback URL (?orgId=...): its certificate, audience (SP entity
 *     ID) and ACS URL are what the response is validated against. RelayState
 *     and assertion attributes never select the organization.
 *   - SSO works only for an Enterprise org with an ACTIVE configuration.
 *   - Only SP-initiated logins are accepted: every response must answer
 *     (InResponseTo) an AuthnRequest this service issued for this org, and
 *     each request ID is redeemed exactly once, from the saml_request_ids
 *     table (DELETE ... RETURNING). IdP-initiated SSO is rejected by design.
 *     If that table is missing, /initiate and /callback fail closed.
 *   - The response's Destination and every SubjectConfirmationData
 *     Recipient must equal this org's ACS URL (node-saml checks neither).
 *   - No JIT provisioning. An assertion never creates a user, never creates
 *     or reactivates a membership, and never links an account by email to a
 *     new organization: it can only authenticate a user who is ALREADY an
 *     active, accepted member of this org, and the token's user, org, and
 *     role come from that membership row -- never from the assertion.
 */

import { SAML, ValidateInResponseTo, CacheProvider } from '@node-saml/node-saml';
import { DOMParser } from '@xmldom/xmldom';
import { pool } from '../config/database';
import { encryptionService } from './encryption.service';
import { authService } from './auth.service';
import { getOrganizationTier } from '../middleware/subscription.middleware';
import { isOrganizationRole } from './organization-authorization';

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
  inResponseTo?: string;
  [key: string]: unknown;
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

/** How long a user has to complete the IdP login after /initiate. */
export const SAML_REQUEST_TTL_MS = 10 * 60 * 1000;

const SAML_PROTOCOL_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
const SAML_ASSERTION_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every SSO login failure. `message` is logged server-side only; callers
 * show the user a generic message so the callback never reveals whether an
 * email belongs to a member, whether SSO is configured, etc.
 */
export class SSOAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSOAuthenticationError';
  }
}

export function samlCallbackUrl(organizationId: string): string {
  return `${BACKEND_URL}/api/auth/saml/callback?orgId=${organizationId}`;
}

/**
 * node-saml's request-ID cache, backed by saml_request_ids and bound to one
 * organization. saveAsync records a newly issued AuthnRequest; getAsync lets
 * node-saml confirm InResponseTo names an outstanding, unexpired request for
 * THIS org. removeAsync is deliberately a no-op: redemption is the explicit,
 * atomic consumeRequestId() after the whole response has validated, so a
 * forged response can't burn a legitimate login's request ID, and two
 * concurrent submissions of one valid response can't both succeed.
 */
function requestIdStore(organizationId: string): CacheProvider {
  return {
    async saveAsync(key: string, value: string) {
      // Opportunistic cleanup -- keeps the table bounded without a job.
      await pool.query('DELETE FROM saml_request_ids WHERE expires_at <= NOW()');
      await pool.query(
        `INSERT INTO saml_request_ids (request_id, organization_id, expires_at)
         VALUES ($1, $2, NOW() + make_interval(secs => $3::double precision / 1000))`,
        [key, organizationId, SAML_REQUEST_TTL_MS]
      );
      return { value, createdAt: Date.now() };
    },
    async getAsync(key: string) {
      const result = await pool.query(
        `SELECT expires_at FROM saml_request_ids
         WHERE request_id = $1 AND organization_id = $2 AND expires_at > NOW()`,
        [key, organizationId]
      );
      if (result.rows.length === 0) return null;
      // node-saml re-checks age against requestIdExpirationPeriodMs from this
      // value, so hand back the issue time (expires_at - TTL).
      return new Date(new Date(result.rows[0].expires_at).getTime() - SAML_REQUEST_TTL_MS).toISOString();
    },
    async removeAsync(key: string | null) {
      return key;
    },
  };
}

/**
 * Build a SAML instance for a given org config
 */
function buildSAMLInstance(config: SSOConfiguration): SAML {
  const decryptedCert = encryptionService.decrypt(config.idp_certificate);

  return new SAML({
    issuer: config.sp_entity_id,
    audience: config.sp_entity_id,
    callbackUrl: samlCallbackUrl(config.organization_id),
    entryPoint: config.idp_sso_url,
    idpIssuer: config.idp_entity_id,
    idpCert: decryptedCert,
    signatureAlgorithm: 'sha256',
    wantAuthnResponseSigned: true,
    wantAssertionsSigned: true,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    cacheProvider: requestIdStore(config.organization_id),
    disableRequestedAuthnContext: true,
  });
}

/**
 * node-saml validates the signature, audience, issuer and timestamps but
 * never compares the response's Destination or the SubjectConfirmationData
 * Recipient to our ACS URL. Run only AFTER validatePostResponseAsync has
 * accepted the response: wantAuthnResponseSigned makes node-saml verify a
 * signature over the root Response element, so the attributes read here
 * are covered by that signature.
 */
function assertResponseAddressedTo(samlResponse: string, expectedUrl: string): void {
  const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'Response' || root.namespaceURI !== SAML_PROTOCOL_NS) {
    throw new SSOAuthenticationError('SAML response root is not a samlp:Response');
  }
  if (root.getAttribute('Destination') !== expectedUrl) {
    throw new SSOAuthenticationError('SAML response Destination does not match this ACS URL');
  }
  const confirmations = root.getElementsByTagNameNS(SAML_ASSERTION_NS, 'SubjectConfirmationData');
  if (confirmations.length === 0) {
    throw new SSOAuthenticationError('SAML assertion has no SubjectConfirmationData');
  }
  for (let i = 0; i < confirmations.length; i++) {
    if (confirmations.item(i)?.getAttribute('Recipient') !== expectedUrl) {
      throw new SSOAuthenticationError('SAML SubjectConfirmationData Recipient does not match this ACS URL');
    }
  }
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
   * The org's SSO configuration, if and only if SSO may be used right now:
   * a well-formed org id, an ACTIVE configuration, and an org that is still
   * on Enterprise (getOrganizationTier also treats a billing-restricted org
   * as free, and a deleted/unknown org as free).
   */
  async requireUsableConfig(organizationId: string): Promise<SSOConfiguration> {
    if (typeof organizationId !== 'string' || !UUID_RE.test(organizationId)) {
      throw new SSOAuthenticationError('Malformed organization id');
    }
    const config = await this.getConfig(organizationId);
    if (!config) throw new SSOAuthenticationError('SSO not configured for this organization');
    if (!config.is_active) throw new SSOAuthenticationError('SSO is not active for this organization');
    const tier = await getOrganizationTier(organizationId);
    if (tier !== 'enterprise') {
      throw new SSOAuthenticationError('Organization is not on the Enterprise plan');
    }
    return config;
  },

  /**
   * Build IdP authorization URL (for initiating SAML flow). Records the
   * AuthnRequest ID in saml_request_ids (see requestIdStore) -- fails closed
   * if that table is missing.
   */
  async getInitiateUrl(organizationId: string): Promise<string> {
    const config = await this.requireUsableConfig(organizationId);
    const saml = buildSAMLInstance(config);
    // RelayState is informational only -- the callback never reads it.
    return saml.getAuthorizeUrlAsync(organizationId, undefined, {});
  },

  /**
   * Validate a SAML POST response for `organizationId` (from the callback
   * URL) and return the asserted identity. Protocol checks only -- says
   * nothing about membership.
   */
  async validateCallback(
    organizationId: string,
    body: Record<string, unknown>
  ): Promise<{ email: string; name: string; nameID: string }> {
    const config = await this.requireUsableConfig(organizationId);

    const samlResponse = body?.SAMLResponse;
    if (typeof samlResponse !== 'string' || samlResponse.length === 0) {
      throw new SSOAuthenticationError('Missing SAMLResponse');
    }

    const saml = buildSAMLInstance(config);
    let profile: SAMLProfile | null;
    try {
      ({ profile } = (await saml.validatePostResponseAsync({ SAMLResponse: samlResponse })) as {
        profile: SAMLProfile | null;
        loggedOut: boolean;
      });
    } catch (err: any) {
      throw new SSOAuthenticationError(`SAML response rejected: ${err?.message ?? err}`);
    }
    if (!profile) throw new SSOAuthenticationError('Invalid SAML assertion: no profile returned');

    assertResponseAddressedTo(samlResponse, samlCallbackUrl(organizationId));

    // Single-use: redeem the request ID only now that the response is known
    // genuine. A replay (or a concurrent duplicate) finds no row.
    const requestId = profile.inResponseTo;
    if (typeof requestId !== 'string' || !(await this.consumeRequestId(organizationId, requestId))) {
      throw new SSOAuthenticationError('SAML response replayed or not issued for this organization');
    }

    const emailAttr = config.attribute_mapping.email;
    const nameAttr = config.attribute_mapping.name;

    // Try standard field first, then mapped attribute name
    const email =
      (profile.email as string) ||
      (profile[emailAttr] as string) ||
      (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] as string) ||
      profile.nameID ||
      '';

    if (typeof email !== 'string' || !email) {
      throw new SSOAuthenticationError('SAML assertion did not include a single email address');
    }

    const name =
      (profile.displayName as string) ||
      (profile[nameAttr] as string) ||
      (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] as string) ||
      email.split('@')[0];

    return { email: email.toLowerCase(), name, nameID: profile.nameID ?? '' };
  },

  /**
   * Atomically redeem an outstanding AuthnRequest ID for this org. True
   * exactly once per issued request; false if unknown, expired, issued for
   * a different org, or already redeemed.
   */
  async consumeRequestId(organizationId: string, requestId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM saml_request_ids
       WHERE request_id = $1 AND organization_id = $2 AND expires_at > NOW()
       RETURNING request_id`,
      [requestId, organizationId]
    );
    return result.rowCount === 1;
  },

  /**
   * The existing, active, ACCEPTED membership of the asserted email in this
   * org -- or a rejection. Never creates, reactivates, or links anything.
   */
  async resolveActiveMember(
    organizationId: string,
    email: string
  ): Promise<{ userId: string; email: string; role: string }> {
    const result = await pool.query(
      `SELECT u.id, u.email, om.role
       FROM users u
       JOIN organization_memberships om ON om.user_id = u.id
       JOIN organizations o ON o.id = om.organization_id
       WHERE u.email = $1
         AND om.organization_id = $2
         AND om.is_active = true
         AND om.invitation_token IS NULL
         AND u.is_active = true
         AND u.deleted_at IS NULL
         AND o.is_active = true
         AND o.deleted_at IS NULL`,
      [email, organizationId]
    );

    if (result.rows.length !== 1) {
      throw new SSOAuthenticationError('Asserted user is not an active member of this organization');
    }
    const row = result.rows[0];
    if (!isOrganizationRole(row.role)) {
      throw new SSOAuthenticationError('Membership has an invalid role');
    }
    return { userId: row.id, email: row.email, role: row.role };
  },

  /**
   * The full callback: protocol validation, then membership resolution,
   * then token issuance from the membership row alone.
   */
  async authenticateCallback(
    organizationId: string,
    body: Record<string, unknown>
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const profile = await this.validateCallback(organizationId, body);
    const member = await this.resolveActiveMember(organizationId, profile.email);

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [member.userId]);

    return authService.generateTokenPair({
      userId: member.userId,
      email: member.email,
      organizationId,
      role: member.role,
    });
  },
};
