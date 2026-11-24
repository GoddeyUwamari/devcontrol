/**
 * The GitHub connection's copy (D8b-1), word for word from the locked mock
 * (boards 1-4 and 6, board 5's header, summary card and disconnect row) and
 * the founder rulings. Text the mock does not draw is marked NOT IN MOCK and
 * listed in the build report for founder wording.
 *
 * Rules (founder, Nov 23): never imply every deployment is captured, or that
 * failed or over-limit deploys are retried later; no retry or replay wording.
 */

export const GITHUB_PAGE_HREF = '/settings/integrations/github'
export const INTEGRATIONS_HREF = '/settings/integrations'
export const RECORD_DEPLOYMENT_HREF = '/deployments/new'
export const CONNECT_AWS_HREF = '/connect-aws'

export const COPY = {
  // Board 1: the index.
  indexTitle: 'Integrations',
  indexSubtitle: 'Connect the accounts DevControl reads from.',
  awsName: 'Amazon Web Services',
  awsDescription: 'Cost, resources, security findings and health checks, through a read-only role in your account.',
  awsManage: 'Manage AWS connection →',
  /** NOT IN MOCK: the AWS card when no account is connected (the app's existing button text). */
  awsConnect: 'Connect AWS account →',
  githubName: 'GitHub',
  githubDescription: 'Deployments from GitHub Actions, for Deployment History and Engineering Intelligence. Read-only, no access to your code.',
  githubByHand: 'You can still record deployments by hand.',
  githubSetUp: 'Set up GitHub →',
  githubLearnMore: 'Learn more →',
  /** NOT IN MOCK: the GitHub card's link when connected (mirrors "Manage AWS connection →"). */
  githubManage: 'Manage GitHub connection →',
  chipConnected: 'Connected',
  chipNotConnected: 'Not connected',
  chipNotAvailable: 'Not available yet',
  chipNeedsAttention: 'Needs attention',
  chipDemo: 'Demo data',
  /** NOT IN MOCK: a card whose state could not be read. */
  cardLoadFailed: "Couldn't load this connection.",

  // Boards 2, 3, 5: the GitHub page header.
  pageTitle: 'GitHub',
  pageSubtitle: 'Record deployments from GitHub Actions.',
  manageOnGitHub: 'Manage on GitHub ↗',
  /** NOT IN MOCK: GET / failed. Never "not connected". */
  pageLoadFailed: "Couldn't load the GitHub connection.",
  /** NOT IN MOCK. */
  tryAgain: 'Try again',

  // Board 2: switched off.
  offTitle: "The GitHub connection isn't available yet",
  offBody: 'Until it is, you can record deployments by hand. They count toward Deployment History and Engineering Intelligence the same way.',
  offRecord: 'Record a deployment',

  // Board 3: not connected.
  stepsTitle: 'Connect GitHub in three steps',
  steps: [
    { title: 'Install DevControl Deployments on GitHub', body: 'Choose all repositories or only the ones you want.' },
    { title: 'Come back here', body: 'GitHub sends you back to DevControl to finish connecting.' },
    { title: 'Pick a service and a deploy rule for each repository', body: 'Nothing is recorded for a repository until you do.' },
  ],
  connectGitHub: 'Connect GitHub',
  onlyOwnersCanConnect: 'Only owners and admins of this workspace can connect.',
  memberAsk: 'Ask an owner or admin of this workspace to connect GitHub.',
  canReadTitle: 'What DevControl can read',
  canReadBody: 'Read-only access to Actions, Deployments, Pull requests and repository metadata.',
  cantTitle: "What it can't",
  cantBody: "Your code, secrets or settings. It can't change anything on GitHub.",
  planLimitsTitle: 'Plan limits',
  planLimitsBody:
    "Deployments from GitHub count toward your plan's monthly deployment limit, together with any you record by hand. Deployments over the limit aren't recorded.",
  /** NOT IN MOCK: POST /install did not return an install link. */
  installFailed: "Couldn't start the GitHub connection. Try again.",

  // Board 4: callback and claim outcomes.
  connectedTitle: 'GitHub connected',
  connectedBody: (account: string) =>
    `DevControl Deployments is installed on ${account}. Pick a service for each repository to start recording deployments.`,
  dismiss: 'Dismiss',
  finishingTitle: 'Finishing your GitHub connection…',
  finishingBody: 'This usually takes a few seconds.',
  signInTitle: 'Sign in to finish connecting GitHub',
  signInBody: "Your DevControl session ended while you were on GitHub. Sign in and we'll finish the connection.",
  signIn: 'Sign in',
  expiredTitle: 'This connection link has expired',
  expiredBody: "Start again from DevControl. The app stays installed on GitHub, so you won't need to reinstall it.",
  noResponseTitle: "We couldn't finish connecting",
  noResponseBody: "GitHub didn't respond in time. Nothing was changed.",
  elsewhereTitle: 'This installation belongs to another DevControl workspace',
  elsewhereBody: 'Disconnect it in that workspace first, or install DevControl Deployments on a different GitHub account or organization.',
  installerTitle: "We couldn't confirm who installed the app",
  installerBody:
    'To connect, the person who installs DevControl Deployments on GitHub has to be the one who finishes here. Start again, signed in to GitHub as that person.',
  approvalTitle: 'Waiting for an owner of the GitHub organization',
  approvalBody:
    "Your request to install DevControl Deployments went to the organization's owners. Once one of them approves it, they need to connect it from this page while signed in to DevControl.",
  notAllowedTitle: 'Only owners and admins can connect GitHub',
  notAllowedBody: 'Ask an owner or admin of this DevControl workspace to finish the connection.',
  /** NOT IN MOCK as a card: the heading is board 4's; the body is the API's own message (d8a §15 founder copy). */
  installEventMissingTitle: "We couldn't finish connecting",

  // Board 5: summary card and disconnect row.
  permissionsExpected: 'Permissions: read-only, as expected',
  /** NOT IN MOCK: the summary line while the mismatch banner shows. */
  permissionsMismatch: "Permissions: don't match what DevControl expects",
  lastEvent: (relative: string) => `Last event from GitHub: ${relative}`,
  /** NOT IN MOCK: no event received yet. */
  lastEventNone: 'Last event from GitHub: none yet',
  connectedBy: (name: string, date: string) => `Connected by ${name} on ${date}`,
  /** NOT IN MOCK: the claimer has no name (deleted user). */
  connectedOn: (date: string) => `Connected on ${date}`,
  disconnectTitle: 'Disconnect GitHub',
  disconnectBody: 'Stops recording. Your repositories, services, rules and past deployments are kept.',
  disconnect: 'Disconnect',

  // Board 6: problem states, disconnect dialog, demo, loading.
  mismatchTitle: "GitHub permissions don't match what DevControl expects",
  mismatchBody: (has: string) =>
    `On GitHub the app now has: ${has}. Expected: Actions, Deployments, Pull requests and Metadata, read-only. Review the app's permissions on GitHub.`,
  reviewOnGitHub: 'Review on GitHub ↗',
  suspendedTitle: 'The app is suspended on GitHub',
  suspendedBody:
    "GitHub doesn't send events while the app is suspended, so deploys that finish in that time aren't recorded and won't be added later. You can record them by hand on the Deployments page.",
  unsuspendOnGitHub: 'Unsuspend on GitHub ↗',
  uninstalledTitle: (account: string) => `DevControl Deployments was uninstalled from ${account}`,
  uninstalledBody: 'Nothing is being recorded. Your repositories, services and past deployments are kept. Connect again to pick up where you left off.',
  removedRepo: 'Removed from the app on GitHub · past deployments kept · nothing new is recorded',
  dialogTitle: 'Disconnect GitHub?',
  dialogBody: (account: string) =>
    `DevControl stops recording deployments from ${account}. Your repositories, services, deploy rules and past deployments are kept, and connecting again picks them back up.`,
  dialogStaysInstalled: 'The app stays installed on GitHub until you uninstall it there.',
  uninstallOnGitHub: 'Uninstall on GitHub ↗',
  cancel: 'Cancel',
  /** NOT IN MOCK: DELETE failed. */
  disconnectFailed: "Couldn't disconnect. Try again.",
  demoChip: 'Demo data',
  demoBody: 'A sample of the connected screen. Nothing here can be changed.',
  planLimitNote: "Deployments over your plan's monthly limit aren't recorded.",
} as const

/** "GitHub organization" (board 5). Other account types: NOT IN MOCK. */
export function accountTypeLabel(type: string): string {
  if (type === 'Organization') return 'GitHub organization'
  if (type === 'User') return 'GitHub personal account'
  if (type === 'Enterprise') return 'GitHub enterprise'
  return 'GitHub account'
}

/** A GitHub permission name as the banner names it: pull_requests -> "Pull requests". */
export function permissionLabel(name: string): string {
  const words = name.replace(/_/g, ' ').trim()
  return words.length === 0 ? name : words[0].toUpperCase() + words.slice(1)
}

/**
 * The mismatch banner's "now has" list: each permission that differs, with what
 * GitHub granted ("Contents (read)"); one DevControl asks for but the app lacks
 * reads "(no access)" (NOT IN MOCK).
 */
export function permissionsNowHave(differences: readonly { permission: string; granted: string | null }[]): string {
  return differences.map((d) => `${permissionLabel(d.permission)} (${d.granted ?? 'no access'})`).join(', ')
}

/** "Goddey U." from "Goddey Uwamari"; one word stays as it is. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

/** "Nov 24". */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "4 minutes ago", "2 hours ago" (board 5's form). */
export function relativeTime(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * The installation's settings page on GitHub, where its repositories,
 * permissions, suspension and uninstall live. VERIFY the paths on production
 * (Q17); GitHub documents both forms.
 */
export function installationSettingsUrl(installation: { installation_id: string; account_login: string; account_type: string }): string {
  const id = encodeURIComponent(installation.installation_id)
  return installation.account_type === 'Organization'
    ? `https://github.com/organizations/${encodeURIComponent(installation.account_login)}/settings/installations/${id}`
    : `https://github.com/settings/installations/${id}`
}
