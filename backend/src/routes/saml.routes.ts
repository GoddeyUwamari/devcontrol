/**
 * SAML / SSO Routes
 * Handles SAML 2.0 authentication flows and SSO configuration management
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { samlInitiateRateLimiter, authRateLimiter } from '../middleware/rateLimiter';
import { samlService } from '../services/saml.service';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3010';

export function createSAMLRoutes(): Router {
  const router = Router();

  // ─── Public: check if a domain has SSO configured ────────────────────────
  router.get('/check-domain', authRateLimiter, async (req: Request, res: Response) => {
    try {
      const domain = (req.query.domain as string || '').toLowerCase().trim();
      if (!domain) {
        res.status(400).json({ success: false, error: 'domain query param is required' });
        return;
      }

      const config = await samlService.getConfigByDomain(domain);
      if (!config) {
        res.json({ success: true, data: { hasSSO: false } });
        return;
      }

      res.json({
        success: true,
        data: {
          hasSSO: true,
          organizationId: config.organizationId,
          providerName: config.providerName,
        },
      });
    } catch (err) {
      console.error('[SAML] check-domain error:', err);
      res.status(500).json({ success: false, error: 'Failed to check domain' });
    }
  });

  // ─── Public: initiate SAML SSO (redirects browser to IdP) ────────────────
  router.get('/initiate', samlInitiateRateLimiter, async (req: Request, res: Response) => {
    try {
      const orgId = req.query.orgId as string;
      if (!orgId) {
        res.status(400).json({ success: false, error: 'orgId query param is required' });
        return;
      }

      const url = await samlService.getInitiateUrl(orgId);
      res.redirect(url);
    } catch (err: any) {
      console.error('[SAML] initiate error:', err);
      const msg = encodeURIComponent(err.message || 'SSO initiation failed');
      res.redirect(`${FRONTEND_URL}/login?error=sso_failed&message=${msg}`);
    }
  });

  // ─── Public: SAML callback (IdP posts assertion here) ────────────────────
  // Must parse URL-encoded body — express.urlencoded is mounted globally in server.ts
  router.post('/callback', async (req: Request, res: Response) => {
    try {
      const orgId = req.query.orgId as string;
      if (!orgId) {
        res.redirect(`${FRONTEND_URL}/login?error=sso_failed&message=Missing+orgId`);
        return;
      }

      const profile = await samlService.validateCallback(orgId, req.body);
      const user = await samlService.findOrCreateUser(orgId, profile);
      const tokens = await samlService.issueTokens(user.userId, user.email, orgId, user.role);

      // Redirect to frontend SSO landing page with tokens in query params
      // The frontend page reads these, stores to localStorage, then redirects to /dashboard
      const params = new URLSearchParams({
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        orgId,
      });
      res.redirect(`${FRONTEND_URL}/auth/sso/callback?${params.toString()}`);
    } catch (err: any) {
      console.error('[SAML] callback error:', err);
      const msg = encodeURIComponent(err.message || 'SSO authentication failed');
      res.redirect(`${FRONTEND_URL}/login?error=sso_failed&message=${msg}`);
    }
  });

  // ─── Public: SP metadata XML ──────────────────────────────────────────────
  router.get('/metadata', async (req: Request, res: Response) => {
    try {
      const orgId = req.query.orgId as string;
      if (!orgId) {
        res.status(400).send('orgId query param is required');
        return;
      }

      const xml = await samlService.generateMetadata(orgId);
      res.set('Content-Type', 'application/xml');
      res.send(xml);
    } catch (err: any) {
      console.error('[SAML] metadata error:', err);
      res.status(500).send('Failed to generate SP metadata');
    }
  });

  // ─── Protected: get SSO config (Enterprise only) ─────────────────────────
  router.get('/config', authenticateToken, requireEnterprise, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).organizationId || (req as any).user?.organizationId;
      const config = await samlService.getConfig(orgId);

      if (!config) {
        res.json({ success: true, data: null });
        return;
      }

      // Never return encrypted certificate — return a masked placeholder
      res.json({
        success: true,
        data: {
          id: config.id,
          providerName: config.provider_name,
          idpEntityId: config.idp_entity_id,
          idpSsoUrl: config.idp_sso_url,
          idpCertificate: '••••••••••••••••',
          spEntityId: config.sp_entity_id,
          attributeMapping: config.attribute_mapping,
          allowedDomains: config.allowed_domains,
          isActive: config.is_active,
        },
      });
    } catch (err) {
      console.error('[SAML] get config error:', err);
      res.status(500).json({ success: false, error: 'Failed to fetch SSO configuration' });
    }
  });

  // ─── Protected: save SSO config (Enterprise only) ────────────────────────
  router.post('/config', authenticateToken, requireEnterprise, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).organizationId || (req as any).user?.organizationId;
      const {
        providerName,
        idpEntityId,
        idpSsoUrl,
        idpCertificate,
        attributeMapping,
        allowedDomains,
        isActive,
      } = req.body;

      if (!idpEntityId || !idpSsoUrl || !idpCertificate) {
        res.status(400).json({
          success: false,
          error: 'idpEntityId, idpSsoUrl, and idpCertificate are required',
        });
        return;
      }

      const config = await samlService.saveConfig(orgId, {
        providerName: providerName || 'SAML IdP',
        idpEntityId,
        idpSsoUrl,
        idpCertificate,
        attributeMapping,
        allowedDomains,
        isActive,
      });

      res.json({
        success: true,
        data: {
          id: config.id,
          providerName: config.provider_name,
          idpEntityId: config.idp_entity_id,
          idpSsoUrl: config.idp_sso_url,
          spEntityId: config.sp_entity_id,
          attributeMapping: config.attribute_mapping,
          allowedDomains: config.allowed_domains,
          isActive: config.is_active,
        },
      });
    } catch (err: any) {
      console.error('[SAML] save config error:', err);
      res.status(500).json({ success: false, error: 'Failed to save SSO configuration' });
    }
  });

  // ─── Protected: delete SSO config (Enterprise only) ──────────────────────
  router.delete('/config', authenticateToken, requireEnterprise, async (req: Request, res: Response) => {
    try {
      const orgId = (req as any).organizationId || (req as any).user?.organizationId;
      await samlService.deleteConfig(orgId);
      res.json({ success: true, message: 'SSO configuration deleted' });
    } catch (err) {
      console.error('[SAML] delete config error:', err);
      res.status(500).json({ success: false, error: 'Failed to delete SSO configuration' });
    }
  });

  return router;
}
