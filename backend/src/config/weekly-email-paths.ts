/**
 * Every frontend path the weekly summary email links to. No runtime imports,
 * so the frontend's link test (app/__tests__/in-app-links-resolve.test.ts)
 * can read it and check that each path resolves to a page.
 */
export const WEEKLY_EMAIL_PATHS = {
  dashboard: '/dashboard',
  connectAws: '/connect-aws',
  costs: '/costs',
  security: '/security',
  costOptimization: '/cost-optimization',
  operationalHealth: '/admin/monitoring',
  deployments: '/deployments',
  comparePlans: '/settings/billing',
  preferences: '/settings/notifications',
  privacy: '/legal/privacy',
} as const;

/** The support mailbox the email names and replies go to (WE-D11). */
export const SUPPORT_EMAIL = 'support@getdevcontrol.com';
