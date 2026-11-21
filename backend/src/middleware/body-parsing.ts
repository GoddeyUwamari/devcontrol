import express, { Express } from 'express';

// ✅ Stripe and GitHub webhook endpoints need RAW body (for signature verification)
export const GITHUB_APP_WEBHOOK_PATH = '/api/webhooks/github-app';
export const RAW_BODY_PATHS = ['/api/stripe/webhook', '/api/webhooks/github', GITHUB_APP_WEBHOOK_PATH];

/**
 * The GitHub App webhook's own raw-body limit (d8a-build.md D8-N5). The
 * nginx location for this path uses the same 1m (founder step, §1.10). A
 * larger delivery gets 413 and is not stored.
 */
export const GITHUB_APP_WEBHOOK_BODY_LIMIT = '1mb';

/**
 * Mounts the request body parsers. Kept apart from server.ts so tests can run
 * the same parser chain without starting the server.
 */
export function applyBodyParsing(app: Express): void {
  app.use(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' })
  );
  app.use(
    '/api/webhooks/github',
    express.raw({ type: 'application/json' })
  );
  // Its own mount: Express prefix mounts match whole path segments, so the
  // legacy mount above does not cover this path.
  app.use(
    GITHUB_APP_WEBHOOK_PATH,
    express.raw({ type: 'application/json', limit: GITHUB_APP_WEBHOOK_BODY_LIMIT })
  );

  // Body parsing middleware - skip webhook routes to preserve raw body
  app.use((req, res, next) => {
    if (RAW_BODY_PATHS.includes(req.path)) {
      return next();
    }
    express.json()(req, res, next);
  });
  app.use((req, res, next) => {
    if (RAW_BODY_PATHS.includes(req.path)) {
      return next();
    }
    express.urlencoded({ extended: true })(req, res, next);
  });
}
