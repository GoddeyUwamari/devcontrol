/**
 * The Security Overview redesign's page copy (NEXT_PUBLIC_SECURITY_V2). Strings built from data live in
 * securityModel.ts; these are the fixed ones. Each comes from the founder's decisions of Oct 26, 2026
 * (review log security-v2-f2/founder-decisions.md: e2 1–21 and the answers to the 12 mock details), or
 * from the plan's mock table (security-page-plan.md §4, §9.3) where marked.
 */
export const PAGE_COPY = {
  title: 'Security Overview',
  subtitle: "What's exposed, what to fix first, and what we checked in your AWS account.",

  syncNow: 'Sync now',
  syncing: 'Syncing…',
  syncComplete: (discovered: number) => `Sync complete — ${discovered} resources discovered`,
  syncFailed: 'Sync failed — check your AWS connection',
  syncForbidden: "You don't have permission to start a sync.",
  syncLimit: "Your plan's sync limit is reached.",
  syncRateLimited: 'Too many syncs. Try again in a few minutes.',
  viewerCantSync: "Viewers can't start a sync",

  tileScore: 'Security score',
  tileFindings: 'Open findings',
  tileCompliance: 'Compliance baseline',
  tileAnomalies: 'Anomalies',
  scoreSuffix: '/100',
  openFrameworks: 'Open frameworks →',
  history: 'History →',
  anomaliesError: "Couldn't load anomalies.",
  retry: 'Retry',
  unavailable: '—',
  notAvailable: 'not available',

  findingsHeading: 'Security findings',
  viewList: 'List',
  viewGroups: 'Group by issue',
  showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
  showAll: (total: number) => `Show all ${total}`,
  showFewer: 'Show fewer',
  // The findings table's column headers (the mock). Action is empty in F2a's read-only list.
  tableHeaders: ['Severity', 'Issue', 'Where', 'Scope', 'Action'],

  trendHeading: 'Score, last 30 days',
  checkedHeading: 'What we checked',
  // The checked-line statuses: the mock's lines as quoted in the plan (§4: "Checked", "Not checked").
  checked: 'Checked',
  notChecked: 'Not checked',
  regionCoverage: 'Region coverage →',
  frameworksHeading: 'Compliance frameworks',
  manage: 'Manage →',

  anomaliesCard: 'Anomalies',
  anomaliesCardText: 'Unusual activity and its history',
  auditCard: 'Audit logs',
  auditCardText: 'Who did what, and when',
} as const

export const PAGE_HREF = {
  frameworks: '/compliance/frameworks',
  anomalies: '/anomalies',
  auditLogs: '/audit-logs',
} as const

/** The list shows this many rows before "Show all" (plan §9.3). */
export const LIST_LIMIT = 10
