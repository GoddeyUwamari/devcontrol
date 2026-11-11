/**
 * Customer-facing plan names for server messages. The UI's copy is
 * lib/plan/plan-names.ts; lib/plan/__tests__/plan-catalog.parity.test.ts keeps
 * the two equal. Internal tier ids must not reach customers.
 */
export const PLAN_NAME = {
  free: 'Visibility',
  starter: 'Cost Control',
  pro: 'Optimization Engine',
  enterprise: 'Revenue Protection',
} as const;
