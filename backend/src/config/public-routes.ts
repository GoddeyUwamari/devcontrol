/**
 * Every HTTP route the app serves without `authenticate` running before its
 * handler. Authentication is opt-in per router, so
 * __tests__/route-auth-inventory.test.ts walks the real app and fails on any
 * route that is neither authenticated nor listed here, on any entry that no
 * longer matches a route, and on any "token" or "signature" entry whose guard
 * is not in that route's chain.
 *
 * Adding an entry is a review decision: say why the route is safe to reach
 * without a session. A route is not listed just because it is public today.
 *
 * `guard` is the exact function that must be in the route's chain. For the
 * webhook and unsubscribe entries the check happens inside that handler, so
 * this proves the verifying handler is wired up; the behaviour itself is
 * covered by those routes' own suites.
 */
import { requireMetricsToken } from '../routes/metrics.routes';
import { stripeWebhookHandler } from '../routes/stripe.routes';
import { githubWebhookHandler } from '../routes/github-webhook.routes';
import { showUnsubscribeConfirm, confirmUnsubscribe } from '../controllers/user-preferences.controller';

/** Any middleware or handler; compared by identity only. */
export type RouteFunction = (...args: never[]) => unknown;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Category = 'auth-flow' | 'operational' | 'integration' | 'marketing';

interface Entry {
  method: Method;
  /** Full external path, as the walker normalises it: no trailing slash, params as written. */
  path: string;
  category: Category;
  reason: string;
}

export type PublicRoute =
  | (Entry & { type: 'public' })
  | (Entry & { type: 'token' | 'signature'; guard: RouteFunction });

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  // ── Sign-in and account recovery ──────────────────────────────────────────
  { method: 'POST', path: '/api/auth/register', type: 'public', category: 'auth-flow',
    reason: 'Creates a new account; returns tokens only for that account.' },
  { method: 'POST', path: '/api/auth/login', type: 'public', category: 'auth-flow',
    reason: 'Exchanges credentials for tokens.' },
  { method: 'POST', path: '/api/auth/refresh', type: 'public', category: 'auth-flow',
    reason: 'Exchanges a valid refresh token for new tokens; the refresh token is the credential.' },
  { method: 'POST', path: '/api/auth/forgot-password', type: 'public', category: 'auth-flow',
    reason: 'Starts a password reset; the link goes to the account\'s own email address.' },
  { method: 'POST', path: '/api/auth/reset-password', type: 'public', category: 'auth-flow',
    reason: 'Requires the emailed reset token.' },
  { method: 'POST', path: '/api/auth/verify-email', type: 'public', category: 'auth-flow',
    reason: 'Requires the emailed verification token.' },
  { method: 'GET', path: '/api/auth/saml/check-domain', type: 'public', category: 'auth-flow',
    reason: 'SSO discovery on the login page: whether an email domain signs in through SSO.' },
  { method: 'GET', path: '/api/auth/saml/initiate', type: 'public', category: 'auth-flow',
    reason: 'Redirects the browser to the organization\'s identity provider to start SSO.' },
  { method: 'POST', path: '/api/auth/saml/callback', type: 'public', category: 'auth-flow',
    reason: 'The identity provider posts the signed assertion here; tokens are issued only for an active member.' },
  { method: 'GET', path: '/api/auth/saml/metadata', type: 'public', category: 'auth-flow',
    reason: 'Service-provider metadata that identity providers must be able to fetch.' },

  // ── Operational ───────────────────────────────────────────────────────────
  { method: 'GET', path: '/health', type: 'public', category: 'operational',
    reason: 'Load balancer and deploy smoke-test health check; no tenant data.' },
  { method: 'GET', path: '/version', type: 'public', category: 'operational',
    reason: 'Reports which build is running; no tenant data.' },
  { method: 'GET', path: '/api', type: 'public', category: 'operational',
    reason: 'Static index of API sections; no data.' },

  // ── Integrations with their own credential ────────────────────────────────
  { method: 'GET', path: '/metrics', type: 'token', guard: requireMetricsToken, category: 'integration',
    reason: 'Prometheus scrape; requires the metrics bearer token.' },
  { method: 'POST', path: '/api/stripe/webhook', type: 'signature', guard: stripeWebhookHandler, category: 'integration',
    reason: 'Stripe events; the handler verifies the Stripe signature before acting.' },
  { method: 'POST', path: '/api/webhooks/github', type: 'signature', guard: githubWebhookHandler, category: 'integration',
    reason: 'GitHub Actions events; the handler verifies the HMAC signature before acting.' },
  { method: 'GET', path: '/api/user/preferences/unsubscribe', type: 'token', guard: showUnsubscribeConfirm, category: 'integration',
    reason: 'Email unsubscribe link (required to work without login); shows a confirm page for a valid signed token.' },
  { method: 'POST', path: '/api/user/preferences/unsubscribe', type: 'token', guard: confirmUnsubscribe, category: 'integration',
    reason: 'Email unsubscribe (confirm page or one-click); acts only on a valid unsubscribe token.' },

  // ── Marketing site ────────────────────────────────────────────────────────
  { method: 'GET', path: '/api/organizations/founding-count', type: 'public', category: 'marketing',
    reason: 'Pricing-page counter; a single aggregate number, no organization details.' },
  { method: 'POST', path: '/api/newsletter/subscribe', type: 'public', category: 'marketing',
    reason: 'Blog and changelog newsletter signup.' },
];
