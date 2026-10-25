import express, { Express } from 'express';

// ✅ Stripe and GitHub webhook endpoints need RAW body (for signature verification)
export const RAW_BODY_PATHS = ['/api/stripe/webhook', '/api/webhooks/github'];

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
