import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { readGitHubAppConfig } from '../config/github-app';
import { isDemoOrganization } from '../demo/demo-workspace';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';
import { listInstallations } from '../repositories/github-installations.repository';
import { lastEventReceivedAt } from '../repositories/pipeline-events.repository';
import { listRepositories, setRepositoryService } from '../repositories/pipeline-repositories.repository';
import { STATE_PATTERN, claimInstallation, retryClaim, startInstall } from '../services/github-app/claim';
import { defaultSource, withOrgClient } from '../services/github-app/db';

// /api/integrations/github -- the GitHub App connection (D8a-1; the setup
// screen is D8b). Every route authenticates; changes are owner/admin only and
// refused for the demo workspace. The organization is always the
// authenticated one: request bodies are strict and carry no organization id.
const router = Router();
router.use(authenticateToken);

function orgAndUser(req: Request): { organizationId: string; userId: string } {
  return { organizationId: req.organizationId as string, userId: req.user!.userId };
}

async function refuseDemo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (await isDemoOrganization(pool, req.organizationId as string)) {
      res.status(403).json({ success: false, error: 'not_available_in_demo' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

function refuseUnconfigured(_req: Request, res: Response, next: NextFunction): void {
  if (!readGitHubAppConfig().enabled) {
    res.status(503).json({ success: false, error: 'github_app_not_configured' });
    return;
  }
  next();
}

const claimBody = z.object({
  state: z.string().regex(STATE_PATTERN),
  code: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  installation_id: z.string().regex(/^[1-9][0-9]{0,18}$/).optional(),
  setup_action: z.enum(['install', 'update', 'request']).optional(),
}).strict();

const retryBody = z.object({ state: z.string().regex(STATE_PATTERN) }).strict();
const serviceBody = z.object({ service_id: z.string().uuid().nullable() }).strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalid = (res: Response) => res.status(400).json({ success: false, error: 'invalid_request' });

// POST /api/integrations/github/install -> { install_url, state }
router.post('/install', requireAdmin, refuseDemo, refuseUnconfigured, async (req, res, next) => {
  try {
    const { organizationId, userId } = orgAndUser(req);
    const result = await startInstall(organizationId, userId);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// POST /api/integrations/github/claim { state, code, installation_id, setup_action }
router.post('/claim', requireAdmin, refuseDemo, refuseUnconfigured, async (req, res, next) => {
  const parsed = claimBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res);
    return;
  }
  const installationId = parsed.data.installation_id ? Number(parsed.data.installation_id) : undefined;
  if (installationId !== undefined && !Number.isSafeInteger(installationId)) {
    invalid(res);
    return;
  }
  try {
    const result = await claimInstallation({
      ...orgAndUser(req),
      state: parsed.data.state,
      code: parsed.data.code,
      installationId,
      setupAction: parsed.data.setup_action,
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// POST /api/integrations/github/claim/retry { state }
router.post('/claim/retry', requireAdmin, refuseDemo, refuseUnconfigured, async (req, res, next) => {
  const parsed = retryBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res);
    return;
  }
  try {
    const result = await retryClaim({ ...orgAndUser(req), state: parsed.data.state });
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// GET /api/integrations/github -> connection state (any member of the organization)
router.get('/', async (req, res, next) => {
  try {
    const configured = readGitHubAppConfig().enabled;
    const { organizationId } = orgAndUser(req);
    const data = await withOrgClient(defaultSource, organizationId, async (client) => ({
      installations: await listInstallations(client, organizationId),
      last_event_at: await lastEventReceivedAt(client, organizationId),
    }));
    res.json({ success: true, data: { configured, ...data } });
  } catch (error) {
    next(error);
  }
});

// GET /api/integrations/github/repositories
router.get('/repositories', async (req, res, next) => {
  try {
    const { organizationId } = orgAndUser(req);
    const repositories = await withOrgClient(defaultSource, organizationId, (client) => listRepositories(client, organizationId));
    res.json({ success: true, data: { repositories } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/integrations/github/repositories/:id/service { service_id | null }
// Maps a repository to one of the organization's own services. Never creates one.
router.put('/repositories/:id/service', requireAdmin, refuseDemo, async (req, res, next) => {
  const parsed = serviceBody.safeParse(req.body);
  if (!parsed.success || !UUID.test(req.params.id)) {
    invalid(res);
    return;
  }
  try {
    const { organizationId } = orgAndUser(req);
    const updated = await withOrgClient(defaultSource, organizationId, (client) =>
      setRepositoryService(client, organizationId, req.params.id, parsed.data.service_id));
    if (!updated) {
      res.status(404).json({ success: false, error: 'not_found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
