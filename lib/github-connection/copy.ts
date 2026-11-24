/**
 * The GitHub connection's copy (D8b-1), word for word from the locked mock
 * (boards 1-4 and 6, board 5's header, summary card and disconnect row) and
 * the founder rulings. Text the mock does not draw was worded by the founder
 * or approved as written (D8b-1 fix round).
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
  /** the AWS card when no account is connected (the app's existing button text). */
  awsConnect: 'Connect AWS account →',
  githubName: 'GitHub',
  githubDescription: 'Deployments from GitHub Actions, for Deployment History and Engineering Intelligence. Read-only, no access to your code.',
  githubByHand: 'You can still record deployments by hand.',
  githubSetUp: 'Set up GitHub →',
  githubLearnMore: 'Learn more →',
  /** the GitHub card's link when connected (mirrors "Manage AWS connection →"). */
  githubManage: 'Manage GitHub connection →',
  chipConnected: 'Connected',
  chipNotConnected: 'Not connected',
  chipNotAvailable: 'Not available yet',
  chipNeedsAttention: 'Needs attention',
  chipDemo: 'Demo data',
  /** a card whose state could not be read. */
  cardLoadFailed: "Couldn't load this connection.",

  // Boards 2, 3, 5: the GitHub page header.
  pageTitle: 'GitHub',
  pageSubtitle: 'Record deployments from GitHub Actions.',
  manageOnGitHub: 'Manage on GitHub ↗',
  /** GET / failed. Never "not connected". */
  pageLoadFailed: "Couldn't load the GitHub connection.",
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
  /** POST /install did not return an install link. */
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
  /** The heading is board 4's; the body is the API's own message (d8a §15 founder copy). */
  installEventMissingTitle: "We couldn't finish connecting",
  /** Founder copy (D8b-1 fix round): 500, network error or an unrecognised answer. Heading = noResponseTitle. */
  failedBody: 'Something went wrong on our side. Try connecting again in a few minutes.',
  /** missing_code_or_installation, invalid_request. */
  cancelledTitle: "GitHub didn't finish connecting",
  cancelledBody: "The GitHub step was cancelled or didn't complete. Start again from DevControl.",
  /** installation_not_accessible. */
  notAccessibleTitle: "DevControl can't reach this installation",
  notAccessibleBody: 'The app may have been uninstalled, suspended or installed on a different account. Check it on GitHub, then start again.',
  /** github_authorization_failed. */
  authFailedTitle: "GitHub didn't confirm your sign-in",
  authFailedBody: 'GitHub declined the sign-in step. Start again and approve access when GitHub asks.',

  // Board 5: summary card and disconnect row.
  permissionsExpected: 'Permissions: read-only, as expected',
  /** the summary line while the mismatch banner shows. */
  permissionsMismatch: "Permissions: don't match what DevControl expects",
  lastEvent: (relative: string) => `Last event from GitHub: ${relative}`,
  /** no event received yet. */
  lastEventNone: 'Last event from GitHub: none yet',
  connectedBy: (name: string, date: string) => `Connected by ${name} on ${date}`,
  /** the claimer has no name (deleted user). */
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
  /** DELETE failed. */
  disconnectFailed: "Couldn't disconnect. Try again.",
  demoChip: 'Demo data',
  demoBody: 'A sample of the connected screen. Nothing here can be changed.',
} as const

/** Where a repository is sent to create a service, and where "See plans" goes (D8b-2 R11). */
export const CREATE_SERVICE_HREF = `/services/new?returnTo=${encodeURIComponent(GITHUB_PAGE_HREF)}`
export const SEE_PLANS_HREF = '/settings/billing/upgrade'

/**
 * How long held events are picked up, when the server does not say (it sends
 * held_event_days, its HELD_EVENT_DAYS). One constant, never a literal in copy.
 */
export const HELD_EVENT_DAYS_FALLBACK = 7

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Board 5 / board 8: the repository table (D8b-2). LOCKED strings are word for
 * word from the mock; the rest were approved by the founder as drafted in
 * d8b2-step-a.md §g (N8 reworded). Counts pluralise from the number.
 */
export const REPO_COPY = {
  title: (n: number) => `Repositories (${n})`,
  subtitle: 'The repositories you chose on GitHub. Each needs a service and a deploy rule before anything is recorded.',
  createService: 'Create a service →',
  colRepository: 'Repository',
  colService: 'Service',
  colRule: 'Deploy rule',
  colStatus: 'Status',
  chooseService: 'Choose a service',
  /** N5: once mapped, unmaps from now on. */
  noService: 'No service',
  chipUseService: (name: string) => `Use “${name}”`,
  chooseServiceFirst: 'Choose a service first',
  chooseRule: 'Choose a deploy rule',
  /** N2 */
  nothingSeen: 'Nothing seen from GitHub yet',
  /** N11 (members): no rule. */
  noRule: 'No deploy rule',
  ruleEnvironment: (name: string) => `Environment: ${name}`,
  ruleJob: (job: string) => `Job: ${job}`,
  /** N4: the same job name in two workflows. */
  ruleJobInWorkflow: (workflow: string, job: string) => `Job: ${workflow} › ${job}`,
  /** N3: stored rules the select can't offer (never for rules saved from this screen). */
  ruleJobNamedBranch: (job: string, branch: string) => `Job: ${job} (branch ${branch})`,
  ruleJobAnyBranch: (job: string) => `Job: ${job} (any branch)`,
  ruleAnyEnvironment: 'Environments: any known name',
  seen: (environments: readonly string[], jobs: readonly string[]) => {
    const parts: string[] = []
    if (environments.length > 0) parts.push(`environments ${environments.join(', ')}`)
    if (jobs.length > 0) parts.push(`jobs ${jobs.join(', ')}`)
    return `Seen: ${parts.join(' · ')}`
  },
  statusRecording: 'Recording',
  statusWaiting: 'Waiting for a service',
  statusNoRule: 'No deploy rule yet',
  lastDeployment: (relative: string) => `Last deployment ${relative}`,
  /** N1 */
  noDeploymentYet: 'No deployment recorded yet',
  held: (n: number) => `${plural(n, 'event', 'events')} held`,
  overLimit: (n: number) => `${plural(n, 'deployment', 'deployments')} not recorded this month: plan limit reached`,
  seePlans: 'See plans',
  saving: 'Saving…',
  saved: 'Saved',
  /** N6 */
  saveFailed: "Couldn't save. Try again.",
  /** N7 */
  saveNotFound: 'This repository or service no longer exists.',
  /** N8 (founder wording) */
  saveMaybe: 'The save may still be processing. Refresh this list to check.',
  /** N9 */
  loadFailed: "Couldn't load repositories.",
  /** Not in §g: the workspace's services could not be listed (flagged in d8b2-build.md). */
  servicesFailed: "Couldn't load your services.",
  /** N10 */
  none: 'No repositories yet.',
  chooseOnGitHub: 'Choose repositories on GitHub.',
  footerHeldLabel: 'Held events:',
  footerHeld: (days: number) =>
    ` held for ${days} days. They're recorded once the repository has a service and deploy rule; after ${days} days, they're dropped.`,
  footerRuleLabel: 'Deploy rule:',
  /** R3 (founder): "…on the default branch". */
  footerRule:
    ' a deployment is recorded when GitHub reports a deployment to the environment you choose, or when the workflow job you choose finishes on the default branch.',
  footerLimitLabel: 'Plan limit:',
  footerLimit: " deployments over your plan's monthly limit aren't recorded.",
} as const

/** "GitHub organization" (board 5), and the other account types. */
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
 * reads "(no access)".
 */
export function permissionsNowHave(differences: readonly { permission: string; granted: string | null }[]): string {
  return differences.map((d) => `${permissionLabel(d.permission)} (${d.granted ?? 'no access'})`).join(', ')
}

/** "Sam R." from "Sam Rivera"; one word stays as it is. */
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
 * permissions, suspension and uninstall live. Enterprise accounts (account_login
 * is the enterprise slug): /enterprises/ENTERPRISE/settings/installations/ID,
 * documented at https://docs.github.com/en/enterprise-cloud@latest/admin/managing-github-apps-for-your-enterprise/automate-installations
 * (D8b-1 fix N-4). The organization and personal-account forms are still to be
 * confirmed on production (Q17).
 */
export function installationSettingsUrl(installation: { installation_id: string; account_login: string; account_type: string }): string {
  const id = encodeURIComponent(installation.installation_id)
  const login = encodeURIComponent(installation.account_login)
  if (installation.account_type === 'Organization') return `https://github.com/organizations/${login}/settings/installations/${id}`
  if (installation.account_type === 'Enterprise') return `https://github.com/enterprises/${login}/settings/installations/${id}`
  return `https://github.com/settings/installations/${id}`
}

/**
 * Board 7 (D8b-2): copy on other pages, shown only while the GitHub App is
 * switched on (GET /api/integrations/github says configured). Switched off,
 * every page keeps its existing copy, "Coming soon" included.
 */
export const SURFACE_COPY = {
  chipConnect: 'GitHub · Connect →',
  chipRecording: (n: number) => `GitHub · ${n} ${n === 1 ? 'repository' : 'repositories'} recording`,
  /** R14 (founder): connected, nothing recording yet. */
  chipSetupIncomplete: 'GitHub · Setup incomplete',
  chipAttention: 'GitHub · Needs attention',
  tileConnect: 'Connect GitHub →',
  tileManage: 'Manage GitHub connection →',
  eiNotConnected: 'Connect GitHub to record deployments from GitHub Actions. You can also record them by hand.',
  eiConnect: 'Connect GitHub →',
  eiConnected: "GitHub is connected. Deployments appear here after the next deploy that matches a repository's deploy rule.",
  /** R15: replaces the GitHub Actions method sentence when the records are App-backed. */
  methodGitHubApp:
    'Measured from your deployment records: from GitHub Actions through the DevControl Deployments app, and from any deployments recorded by hand.',
} as const
