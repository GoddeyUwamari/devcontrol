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
  // The findings table's column headers (the mock). Action holds each row's Review / Hide.
  tableHeaders: ['Severity', 'Issue', 'Where', 'Scope', 'Action'],

  // The expanded row (e2 7, 8, 21).
  review: 'Review',
  hide: 'Hide',
  // "… on <resource name>" so rows with the same issue differ (founder, F2c); the plain form when there's no name.
  showDetails: (title: string, resource?: string) => `Show details for ${title}${resource ? ` on ${resource}` : ''}`,
  hideDetails: (title: string, resource?: string) => `Hide details for ${title}${resource ? ` on ${resource}` : ''}`,
  whyItMatters: 'Why it matters',
  nextStep: 'Next step',
  fixRisk: 'Risk of the fix',
  copyStatement: 'Copy policy statement',
  copied: 'Copied',
  copyFailed: "Couldn't copy to the clipboard.",
  // Resource findings before B4: navigation only (the F2b brief, quoting the mock).
  resourceNote: "This opens the Infrastructure page. It doesn't fix anything. Acknowledge, Accept risk and Dismiss for resource findings come in a later release.",

  trendHeading: 'Score, last 30 days',
  checkedHeading: 'What we checked',
  // The checked-line statuses: the mock's lines as quoted in the plan (§4: "Checked", "Not checked").
  checked: 'Checked',
  notChecked: 'Not checked',
  regionCoverage: 'Region coverage →',
  frameworksHeading: 'Compliance frameworks',
  manage: 'Manage →',

  // The bottom link cards, each with the page's trailing arrow (F2c; "Anomaly Rules →" is new, founder-approved).
  anomaliesCard: 'Anomalies →',
  anomaliesCardText: 'Unusual activity and its history',
  anomalyRulesCard: 'Anomaly Rules →',
  anomalyRulesCardText: 'Custom detection thresholds',
  auditCard: 'Audit logs →',
  auditCardText: 'Who did what, and when',
} as const

/**
 * Account-finding decisions (F2b): decision 3, e2 10–12, and the F2b answers S1, S2, D2, D3. The dialog keeps the
 * legacy text (SEC/page.tsx) except the sentence the mock's score note replaces; the toasts are the legacy ones.
 */
export const ACTION_COPY = {
  acknowledge: 'Acknowledge',
  acceptRisk: 'Accept risk…',
  dismiss: 'Dismiss',
  viewerCantChange: "Viewers can't change findings",
  adminsOnly: 'Admins only',

  dismissTitle: 'Dismiss finding',
  acceptTitle: 'Accept risk',
  scoreNote: "Accepting or dismissing records your decision. It doesn't change anything in AWS, and the score still counts this finding until a complete scan shows it's fixed.",
  justification: 'A justification is required.',
  reasonLabel: 'Reason (required)',
  reasonHint: 'Why? (required)',
  cancel: 'Cancel',
  confirmDismiss: 'Dismiss',
  confirmAccept: 'Accept risk',

  acknowledged: 'Finding acknowledged',
  dismissed: 'Finding dismissed',
  accepted: 'Risk accepted',
  toastDescription: 'This records your decision — it does not change anything in AWS. Only a future scan can mark it Verified Resolved.',

  failed: 'Action failed',
  failedTryAgain: 'Action failed. Try again.',
} as const

/** The server messages shown after "Action failed" (D2); any other message reads "Action failed. Try again." */
export const PLAIN_SERVER_MESSAGES: readonly string[] = [
  'Insufficient permissions',
  'Finding not found',
  'This finding is already verified resolved and cannot be dispositioned',
  'A non-empty note is required to accept risk for this finding',
]

export const PAGE_HREF = {
  frameworks: '/compliance/frameworks',
  anomalies: '/anomalies',
  anomalyRules: '/anomalies/rules',
  auditLogs: '/audit-logs',
} as const

/** The list shows this many rows before "Show all" (plan §9.3). */
export const LIST_LIMIT = 10
