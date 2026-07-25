import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../config/database';
import { DeploymentsRepository } from '../repositories/deployments.repository';

const router = Router();
const repository = new DeploymentsRepository();

// Only the deploy-backend job represents a real production deployment attempt.
// lint-and-build runs on every PR too and would otherwise pollute DORA data.
const DEPLOY_JOB_NAME = 'deploy-backend';
const ORGANIZATION_ID = process.env.GITHUB_WEBHOOK_ORG_ID || null;

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);

  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

async function resolveServiceId(repoName: string): Promise<string> {
  const lookupConditions = ORGANIZATION_ID
    ? `(LOWER(name) = LOWER($1) AND (organization_id = $2 OR organization_id IS NULL))`
    : `LOWER(name) = LOWER($1)`;
  const lookupValues = ORGANIZATION_ID ? [repoName, ORGANIZATION_ID] : [repoName];

  const { rows: existing } = await pool.query(
    `SELECT id FROM services WHERE ${lookupConditions} ORDER BY created_at DESC LIMIT 1`,
    lookupValues
  );
  if (existing.length > 0) return existing[0].id;

  const { rows: inserted } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'github-actions@webhook', 'active', $2)
     RETURNING id`,
    [repoName, ORGANIZATION_ID]
  );
  return inserted[0].id;
}

// POST /api/webhooks/github
// Receives GitHub Actions `workflow_job` events for the devcontrol repo and
// records completed deploy-backend job runs as `deployments` rows, which
// feeds Deployment Frequency, Lead Time, Change Failure Rate and MTTR on the
// DORA metrics page.
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[github-webhook] GITHUB_WEBHOOK_SECRET is not configured');
    res.status(500).json({ success: false, error: 'Webhook not configured' });
    return;
  }

  const rawBody = req.body as Buffer;
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  if (!Buffer.isBuffer(rawBody) || !verifySignature(rawBody, signature, secret)) {
    res.status(401).json({ success: false, error: 'Invalid signature' });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ success: false, error: 'Invalid JSON payload' });
    return;
  }

  const event = req.headers['x-github-event'] as string | undefined;

  if (event === 'ping') {
    res.status(200).json({ success: true, message: 'pong' });
    return;
  }

  if (event !== 'workflow_job') {
    res.status(200).json({ success: true, message: `Ignored event: ${event}` });
    return;
  }

  const job = payload.workflow_job;
  if (!job || payload.action !== 'completed' || job.name !== DEPLOY_JOB_NAME) {
    res.status(200).json({ success: true, message: 'Ignored (not a completed deploy-backend job)' });
    return;
  }

  if (job.conclusion !== 'success' && job.conclusion !== 'failure') {
    // cancelled / skipped / timed_out etc. — not a meaningful deploy attempt
    res.status(200).json({ success: true, message: `Ignored conclusion: ${job.conclusion}` });
    return;
  }

  const jobId = String(job.id);

  try {
    // GitHub redelivers on timeout/non-2xx; de-dupe on the job id.
    const alreadyRecorded = await repository.findByMetadataField('github_job_id', jobId);
    if (alreadyRecorded) {
      res.status(200).json({ success: true, message: 'Already recorded', data: { id: alreadyRecorded.id } });
      return;
    }

    const repoName = payload.repository?.name || 'devcontrol';
    const service_id = await resolveServiceId(repoName);

    const deployment = await repository.create({
      service_id,
      environment: 'production',
      aws_region: 'us-east-1',
      status: job.conclusion === 'success' ? 'success' : 'failed',
      deployed_by: payload.sender?.login || 'github-actions',
      deployed_at: job.completed_at ? new Date(job.completed_at) : new Date(),
      organization_id: ORGANIZATION_ID || undefined,
      metadata: {
        source: 'github_actions',
        github_run_id: job.run_id,
        github_job_id: job.id,
        workflow_name: DEPLOY_JOB_NAME,
        head_sha: job.head_sha,
        html_url: job.html_url,
        conclusion: job.conclusion,
      },
    });

    res.status(201).json({ success: true, data: deployment });
  } catch (err: any) {
    console.error('[github-webhook]', err);
    res.status(500).json({ success: false, error: 'Failed to record deployment' });
  }
});

export default router;
