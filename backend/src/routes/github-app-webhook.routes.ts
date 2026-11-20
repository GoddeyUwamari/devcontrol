import { Router, Request, Response } from 'express';
import { githubAppWebhookRateLimiter } from '../middleware/rateLimiter';
import { ingestDelivery } from '../services/github-app/ingest';

// POST /api/webhooks/github-app
// GitHub App deliveries for every customer installation (D8a). Public: the
// handler verifies GitHub's HMAC signature over the raw body before anything
// else (services/github-app/ingest.ts). The organization comes only from the
// installation's claim. Exempt from the general /api limiter (GitHub sends
// every customer's events from shared IPs); its own flood guard runs first.
export async function githubAppWebhookHandler(req: Request, res: Response): Promise<void> {
  const result = await ingestDelivery({ rawBody: req.body, headers: req.headers });
  res.status(result.status).json(result.body);
}

const router = Router();
router.post('/', githubAppWebhookRateLimiter, githubAppWebhookHandler);

export default router;
