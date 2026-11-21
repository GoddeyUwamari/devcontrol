import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { readGitHubAppConfig } from '../config/github-app';
import { isDemoOrganization } from '../demo/demo-workspace';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/rbac.middleware';
import { listInstallations } from '../repositories/github-installations.repository';
import { lastEventReceivedAt } from '../repositories/pipeline-events.repository';
import {
  githubRepoIdOf,
  listJobsSeen,
  listRepositories,
  setRepositoryDeployRule,
  setRepositoryService,
} from '../repositories/pipeline-repositories.repository';
import { STATE_PATTERN, claimInstallation, retryClaim, startInstall } from '../services/github-app/claim';
import { defaultSource, withOrgClient } from '../services/github-app/db';
import { deployRuleBody, environmentMapProblem, storedDeployRule } from '../services/github-app/deploy-rule';
import { MAPPING_REPLAY, replayRepository, RULE_REPLAY } from '../services/github-app/replay';

// /api/integrations/github -- the GitHub App connection (D8a-1; the setup
// screen is D8b). Every route authenticates; changes are owner/admin only and
// refused for the demo workspace. The organization is always the
// authenticated one: request bodies are strict and carry no organization id.
//
// Feature off (GITHUB_APP_ENABLED unset, or the configuration incomplete):
// right after authentication, before any role, demo or table check, GET /
// answers { configured: false } and every other route answers 503
// github_app_not_configured. Nothing here reads a D8a table while it is off,
// so the code is safe to deploy before the admin migration is applied.
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
router.post('/install', refuseUnconfigured, requireAdmin, refuseDemo, async (req, res, next) => {
  try {
    const { organizationId, userId } = orgAndUser(req);
    const result = await startInstall(organizationId, userId);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

// POST /api/integrations/github/claim { state, code, installation_id, setup_action }
router.post('/claim', refuseUnconfigured, requireAdmin, refuseDemo, async (req, res, next) => {
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
router.post('/claim/retry', refuseUnconfigured, requireAdmin, refuseDemo, async (req, res, next) => {
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
  if (!readGitHubAppConfig().enabled) {
    res.json({ success: true, data: { configured: false } });
    return;
  }
  try {
    const { organizationId } = orgAndUser(req);
    const data = await withOrgClient(defaultSource, organizationId, async (client) => ({
      installations: await listInstallations(client, organizationId),
      last_event_at: await lastEventReceivedAt(client, organizationId),
    }));
    res.json({ success: true, data: { configured: true, ...data } });
  } catch (error) {
    next(error);
  }
});

// GET /api/integrations/github/repositories
router.get('/repositories', refuseUnconfigured, async (req, res, next) => {
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
router.put('/repositories/:id/service', refuseUnconfigured, requireAdmin, refuseDemo, async (req, res, next) => {
  const parsed = serviceBody.safeParse(req.body);
  if (!parsed.success || !UUID.test(req.params.id)) {
    invalid(res);
    return;
  }
  try {
    const { organizationId } = orgAndUser(req);
    const githubRepoId = await withOrgClient(defaultSource, organizationId, async (client) =>
      (await setRepositoryService(client, organizationId, req.params.id, parsed.data.service_id))
        ? githubRepoIdOf(client, organizationId, req.params.id)
        : null);
    if (githubRepoId === null) {
      res.status(404).json({ success: false, error: 'not_found' });
      return;
    }
    // D8a-2: events held back while the repository was unmapped are recorded now.
    const replay = parsed.data.service_id === null
      ? { considered: 0, recorded: 0 }
      : await replayRepository(organizationId, githubRepoId, MAPPING_REPLAY);
    res.json({ success: true, data: { replay } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/integrations/github/repositories/:id/deploy-rule
//   { mode: 'none' }
//   { mode: 'job', workflow_name, job_name, environment?, branch?, branch_name?, aws_region? }
//   { mode: 'github_deployments', environment_map?, aws_region? }
// Which of the repository's events are deployments (D8a-2). Stored events
// the new rule decides are replayed; existing deployment rows never change.
router.put('/repositories/:id/deploy-rule', refuseUnconfigured, requireAdmin, refuseDemo, async (req, res, next) => {
  const parsed = deployRuleBody.safeParse(req.body);
  if (!parsed.success || !UUID.test(req.params.id)) {
    const problem = parsed.success ? null : environmentMapProblem(req.body);
    if (problem) {
      res.status(400).json({ success: false, error: 'invalid_request', message: problem });
      return;
    }
    invalid(res);
    return;
  }
  try {
    const { organizationId } = orgAndUser(req);
    const stored = storedDeployRule(parsed.data);
    const githubRepoId = await withOrgClient(defaultSource, organizationId, (client) =>
      setRepositoryDeployRule(client, organizationId, req.params.id, stored));
    if (githubRepoId === null) {
      res.status(404).json({ success: false, error: 'not_found' });
      return;
    }
    const replay = await replayRepository(organizationId, githubRepoId, RULE_REPLAY);
    res.json({ success: true, data: { deploy_rule: stored, replay } });
  } catch (error) {
    next(error);
  }
});

// GET /api/integrations/github/repositories/:id/jobs-seen (any member of the organization)
// Completed jobs received for the repository in the last 30 days: the deploy-job picker.
router.get('/repositories/:id/jobs-seen', refuseUnconfigured, async (req, res, next) => {
  if (!UUID.test(req.params.id)) {
    invalid(res);
    return;
  }
  try {
    const { organizationId } = orgAndUser(req);
    const jobs = await withOrgClient(defaultSource, organizationId, async (client) => {
      const githubRepoId = await githubRepoIdOf(client, organizationId, req.params.id);
      return githubRepoId === null ? null : listJobsSeen(client, organizationId, githubRepoId);
    });
    if (jobs === null) {
      res.status(404).json({ success: false, error: 'not_found' });
      return;
    }
    res.json({ success: true, data: { jobs } });
  } catch (error) {
    next(error);
  }
});

export default router;
