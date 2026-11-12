/**
 * Copy for the Connect AWS page, kept out of page.tsx (a Next.js page may export
 * only its component and route config). Every string here is founder-approved
 * (connect-step1.md, "PR E Step 1", E.1 as amended by the PR E decisions);
 * change one only with a new approval.
 */

/** Where every "contact us" on the Connect AWS page goes (PE-D2). */
export const SUPPORT_MAILTO = 'mailto:support@getdevcontrol.com?subject=AWS%20connection'

/** What each operation the post-connect permission check tests lets DevControl do. */
export const PERMISSION_CHECK_LABELS: Record<string, string> = {
  'ec2:DescribeRegions': 'List your AWS regions',
  's3:ListAllMyBuckets': 'List S3 buckets',
  'lambda:ListFunctions': 'List Lambda functions',
  'cloudwatch:GetMetricData': 'Read CloudWatch metrics',
  'ce:GetCostAndUsage': 'Read Cost Explorer spend',
  'resource-explorer-2:Search': 'Search Resource Explorer',
}

export const PAGE_TITLE = 'Connect your AWS account'
export const PAGE_SUBTITLE = 'DevControl reads your AWS account through an IAM role you create in it. You control the role and can delete it at any time.'
/** T1: the title when the page shows an existing connection (connected, ambiguous or loading). */
export const CONNECTION_PAGE_TITLE = 'AWS connection'
/** T2: the subtitle when connected; ambiguous and loading have none (T3). */
export const CONNECTED_PAGE_SUBTITLE = 'DevControl reads this AWS account through the IAM role you created in it. You control the role and can delete it at any time.'

// Board 1: the CloudFormation card (rendered only when connect-init returns launchStack).
export const CF_RECOMMENDED = 'Recommended'
export const CF_TITLE = 'Create the role with AWS CloudFormation'
export const CF_INTRO = 'The stack creates one IAM role using the same recommended DevControl permission set as the manual setup below.'
export const CF_STEP1_TITLE = 'Launch the stack in your AWS account'
export const CF_STEP1_BODY = 'Sign in to the AWS account you want to connect. The console opens with your External ID and role name already filled in. Tick the IAM acknowledgement, then create the stack.'
export const CF_LAUNCH = 'Launch stack ↗'
/** S-1 (PR D2): the template version under Launch stack, and its View template link. */
export const cfTemplateVersion = (version: string) => `Template v${version}`
export const CF_TEMPLATE_SEPARATOR = ' · '
export const CF_VIEW_TEMPLATE = 'View template'
export const CF_STEP2_TITLE = "Paste the role ARN from the stack's Outputs"
export const CF_STEP2_BODY = 'When the stack shows CREATE_COMPLETE, open its Outputs tab and copy RoleArn.'
export const CF_FAILED_TITLE = 'Stack failed?'
export const CF_FAILED_BODY = 'If the stack shows ROLLBACK_COMPLETE, open its Events tab to see why. AWS can only delete a stack in that state, so delete it before you launch again. A common cause is an existing role with the same name: launch again with another role name that starts with DevControlRole, or use that role under "Set it up by hand".'
export const MANUAL_SUMMARY = 'Set it up by hand instead'

// Board 2: manual setup.
export const EXTERNAL_ID_LABEL = 'Your External ID'
export const COPY = 'Copy'
export const COPIED = '✓ Copied!'
export const EXTERNAL_ID_HINT = 'The same value every time you open this page. It never changes.'
export const STEP_CREATE_ROLE = 'Create the IAM role'
export const STEP_CREATE_ROLE_BODY = "In your AWS Console, create a new IAM role with the trust policy below. It lets DevControl's AWS account assume the role only with your External ID."
export const COPY_POLICY = 'Copy policy →'
export const STEP_ATTACH = 'Attach the permissions'
export const ATTACH_INTRO = 'Then attach these permissions to the role:'
export const INLINE_JSON_SUMMARY = 'DevControlReadExtras (JSON)'
export const COPY_INLINE_POLICY = 'Copy inline policy →'
export const BLOCKS_SUMMARY = 'What the inline policy blocks, and why'
export const BLOCKS_INTRO = 'SecurityAudit and ViewOnlyAccess allow some reads that come close to your stored data. DevControlReadExtras denies them, and an explicit deny always wins in AWS. For example:'
/** Each example: the denied action(s) and what it reads (null: the actions speak for themselves). */
export const BLOCKS_EXAMPLES: readonly { actions: readonly string[]; what: string | null }[] = [
  { actions: ['s3:ListBucket'], what: 'listing the objects inside your buckets' },
  { actions: ['lambda:GetFunctionConfiguration'], what: 'Lambda function configuration' },
  { actions: ['ec2:DescribeInstanceAttribute'], what: 'EC2 instance attributes' },
  { actions: ['ecs:DescribeTaskDefinition'], what: 'ECS task definitions' },
  { actions: ['cloudtrail:LookupEvents', 'cloudformation:GetTemplate'], what: null },
]
export const blocksFullList = (count: number) => `The full list of ${count} actions is in the JSON above.`
export const POLICIES_NOTE = 'These policies let DevControl read configuration and metadata. They do not let it read the contents of your S3 objects or DynamoDB items, and they grant no write access.'
export const READ_ONLY_ACCESS_NOTE = 'Already connected with ReadOnlyAccess? It keeps working. To narrow it, attach the three policies above first, then detach ReadOnlyAccess.'
export const STEP_ROLE_ARN = 'Enter your Role ARN'
export const CONNECT_BUTTON = 'Connect account'
export const CONNECT_NOT_READY = 'Connect session not ready — please wait a moment.'
export const ROLE_ARN_REQUIRED = 'Role ARN is required'
export const ROLE_ARN_FORMAT = 'Role ARN must match format: arn:aws:iam::123456789012:role/DevControlRole — the role name must start with DevControlRole'

// Board 3: checking.
export const CHECKING_BUTTON = 'Checking…'
export const CHECKING_TITLE = 'Checking your role'
export const CHECKING_ASSUME = 'Assuming the role with your External ID'
export const CHECKING_ASSUME_NOTE = 'A new role can take a minute to become usable in AWS, so DevControl retries for a short time before it reports a problem.'
export const CHECKING_PERMISSIONS = 'Checking six of the permissions DevControl uses'
export const CHECKING_SCAN = 'Starting the first scan'
export const CHECKING_NOTHING_SAVED = 'Nothing is saved until DevControl can assume the role.'

// Board 4: connected.
export const CONNECTED_TOAST = 'AWS account connected successfully'
export const CONNECTED_TITLE = 'AWS account connected'
export const LABEL_ACCOUNT = 'Account'
export const LABEL_ROLE = 'Role'
export const LABEL_HOME_REGION = 'Home region'
export const FACT_CONNECTION = 'Connection'
export const connectionValue = (date: string) => `Connected · ${date}`
export const FACT_PERMISSIONS = 'Permission checks'
export const permissionsValue = (passed: number, total: number, date: string) => `${passed} of ${total} passed · checked ${date}`
export const PERMISSIONS_NOTE = 'Six of the permissions DevControl uses. Not a full review of your role.'
export const FACT_DISCOVERY = 'Discovery'

// Board 4: health and saved checks (AWS connect PR D1, §6.3). {date} is formatScanTime.
export const FACT_HEALTH = 'Health'
export const healthOk = (date: string) => `OK · checked ${date}`
export const healthFailing = (date: string) => `Failing since ${date}`
export const healthLost = (date: string) => `Lost · failing since ${date}`
const LAST_RESULT_LABELS = { ok: 'OK', failing: 'Failing', lost: 'Lost' } as const
export const healthStale = (lastResult: keyof typeof LAST_RESULT_LABELS, date: string) =>
  `Not checked recently · last result ${LAST_RESULT_LABELS[lastResult]} on ${date}`
export const HEALTH_NOT_CHECKED_YET = 'Not checked yet. DevControl checks at each scan.'
export const HEALTH_FAILING_HELP = "DevControl couldn't assume your role during its scans. If the role, its trust policy or its External ID changed in AWS, fix it there, then use Check again. DevControl keeps this connection until you ask us to remove it."
export const HEALTH_STALE_HELP = "DevControl hasn't been able to finish a check for a while. This isn't necessarily a problem with your role."
export const PERMISSIONS_NOT_SAVED = 'Not saved for this connection yet.'
export const PERMISSIONS_NOT_SAVED_OWNER = 'Not saved for this connection yet. Use Check again to run them.'
export const ROLE_REPLACED = 'The role at this ARN was replaced in AWS after it was connected: it has a new role ID. DevControl can assume it. Use Check again to review its permissions.'

// Check again (§6.4, B7). Only the owner sees the button.
export const CHECK_AGAIN = 'Check again'
export const CHECK_AGAIN_NOTE = 'Runs the six checks and the policy comparison again. One check is a Cost Explorer request, which AWS bills to your account at USD 0.01.'
export const availableAgainAt = (time: string) => `Available again at ${time}`
export const CHECK_AGAIN_ROLE_REFUSED = "DevControl couldn't assume your role. Its health on this page now shows the failure."
export const CHECK_AGAIN_CAUSES_TITLE = "AWS didn't allow DevControl to assume the role. Possible causes include:"
export const CHECK_AGAIN_CAUSE_DELETED = 'The role was deleted or renamed in IAM.'
export const CHECK_AGAIN_CAUSE_TRUST = "Its trust policy no longer allows DevControl's AWS account."
/** Owner only: the External ID is in GET /accounts for the owner alone. */
export const checkAgainCauseExternalId = (externalId: string) => `Its External ID condition isn't exactly ${externalId} anymore.`
export const CHECK_AGAIN_CAUSES_FOOT = "AWS gives DevControl the same answer for each of these, so DevControl can't tell which one applies. Your connection stays as it is."

// Board 5: the role's policies (§6.5).
export const POLICIES_TITLE = "Your role's policies"
export const policiesTitleChecked = (date: string) => `${POLICIES_TITLE} · checked ${date}`
export const POLICY_SECURITY_AUDIT_ATTACHED = 'SecurityAudit attached'
export const POLICY_SECURITY_AUDIT_MISSING = 'SecurityAudit not attached'
export const POLICY_VIEW_ONLY_ATTACHED = 'ViewOnlyAccess attached'
export const POLICY_VIEW_ONLY_MISSING = 'ViewOnlyAccess not attached'
export const POLICY_READ_EXTRAS_MATCHES = 'DevControlReadExtras matches the current version'
export const POLICY_READ_EXTRAS_DIFFERS = 'DevControlReadExtras differs from the current version'
export const POLICY_READ_EXTRAS_MISSING = 'No inline policy named DevControlReadExtras'
export const POLICY_READ_EXTRAS_UNREADABLE = "DevControlReadExtras couldn't be read. Reading it needs SecurityAudit."
export const POLICY_READ_ONLY_ACCESS = 'ReadOnlyAccess attached: it works, but allows more than DevControl needs. To narrow it, attach the three policies above, then detach ReadOnlyAccess.'
/** P9, with the founder's natural forms for a count without names and for one policy (2026-11-11). */
export function policiesAlsoAttached(names: readonly string[], otherCount: number): string {
  const others = otherCount === 1 ? '1 other policy' : `${otherCount} other policies`
  if (names.length === 0) return `Also attached: ${others}`
  return `Also attached: ${names.join(', ')}${otherCount > 0 ? `, and ${others}` : ''}`
}
export const POLICIES_UNREADABLE = "DevControl couldn't read this role's policies. AWS refused the IAM calls SecurityAudit and ViewOnlyAccess allow, so they may not be attached."
export const POLICIES_NOT_COMPARED = 'Not compared yet.'
export const POLICIES_NOT_COMPARED_OWNER = 'Not compared yet. Use Check again.'

// Refused sources (§6.6): the 8 listings a scan saves.
export const refusedTitle = (date: string) => `Refused during the scan on ${date}`
export const REFUSED_SOURCE_LABELS: Readonly<Record<string, string>> = {
  ec2: 'EC2 instances',
  ebs: 'EBS volumes',
  rds: 'RDS databases',
  s3: 'S3 buckets',
  lambda: 'Lambda functions',
  'load-balancer': 'Load balancers',
  cloudfront: 'CloudFront distributions',
  'resource-explorer': 'Resource Explorer search',
}
export const refusedLine = (label: string, action: string) =>
  `${label} (${action}): AWS refused this listing, so DevControl couldn't read these resources.`
export const FOUND_TITLE = 'What DevControl found'
export const TABLE_SCOPE = 'Scope'
export const TABLE_RESOURCES = 'Resources'
export const TABLE_LAST_SCAN = 'Last scan'
export const ROW_TOTAL = 'All scanned resources'
export const rowHome = (region: string) => `Home region (${region})`
export const ROW_S3_OTHER_REGIONS = 'S3 buckets in other regions'
export const ROW_CLOUDFRONT = 'CloudFront (global)'
export const COVERAGE_LOADING = 'Loading scan coverage…'
export const COVERAGE_ERROR = 'Scan coverage could not be loaded.'
export const TRY_AGAIN = 'Try again'
export const GO_TO_DASHBOARD = 'Go to dashboard →'
/** The one disconnect sentence; "contact us" is the SUPPORT_MAILTO link. */
export const DISCONNECT_BEFORE = 'To disconnect or change accounts, '
export const DISCONNECT_LINK = 'contact us'
export const DISCONNECT_AFTER = '.'
export const ACCOUNTS_ERROR = "Couldn't check your AWS connection. Refresh to try again."
export const AMBIGUOUS_TEXT = "More than one active AWS connection was found for this organization, so DevControl isn't scanning any of them. "

// Board 5: some permissions need attention (right after a connect).
export const ATTENTION_TITLE = 'Connected. Some permissions need attention.'
export const ATTENTION_BODY = 'DevControl checked a few of the permissions it uses. This is not a full review of your role: AWS policies outside the role can also allow or block access.'
export const STATUS_DENIED = 'AWS refused this call. DevControl features that rely on it may not work until the role allows it.'
export const STATUS_NOT_CHECKED = "Couldn't be checked. It may still work."
export const passedLine = (labels: readonly string[]) => `${labels.join(' · ')} passed`
export const SCP_NOTE = "If the policy is already attached, an AWS Organizations service control policy or a permissions boundary may block the call. DevControl can't see those."
export const CONTINUE_TO_DASHBOARD = 'Continue to dashboard →'

/** The actions only DevControlReadExtras grants; SecurityAudit and ViewOnlyAccess both grant the other four. */
export const INLINE_POLICY_ACTIONS: readonly string[] = ['ce:GetCostAndUsage', 'resource-explorer-2:Search']

/** What to do about one action the permission check could not confirm. */
export function permissionFixText(action: string, status: 'denied' | 'not_verified'): string {
  if (INLINE_POLICY_ACTIONS.includes(action)) {
    if (status === 'denied') return "To fix: this permission comes from the DevControlReadExtras inline policy. Check that it's attached and that its JSON matches the policy on this page."
    return action === 'resource-explorer-2:Search'
      ? 'To check: this permission comes from DevControlReadExtras. If it is attached, Resource Explorer may not be set up in this account.'
      : "To check: this permission comes from DevControlReadExtras. Check that it's attached."
  }
  return status === 'denied'
    ? "To fix: SecurityAudit and ViewOnlyAccess both allow this. Check that they're attached to the role."
    : "To check: SecurityAudit and ViewOnlyAccess both allow this. Check that they're attached to the role."
}

// Board 6: errors.
export const NOTHING_SENT = 'Nothing was sent to AWS.'
export const NOT_ASSUMABLE_TITLE = "AWS didn't allow DevControl to assume this role. Possible causes include:"
export const NOT_ASSUMABLE_FOOT = "AWS gives DevControl the same answer for every one of these, so DevControl can't tell which one applies. Nothing was saved."
export const ALREADY_CONNECTED_TEXT = 'This organization already has a connected AWS account.'
export const NETWORK_ERROR = "We couldn't reach DevControl. Check your connection and try again."
export const GENERIC_ERROR = 'Something went wrong while connecting your account. Please try again.'

/** The possible causes of a ROLE_NOT_ASSUMABLE refusal (6b). Stack wording only when the CloudFormation card is shown. */
export function notAssumableCauses(ctx: { cloudFormation: boolean; accountId: string; platformAccountId: string; externalId: string }): string[] {
  return [
    ctx.cloudFormation
      ? "The stack hasn't finished (CREATE_COMPLETE), or the ARN wasn't copied from its RoleArn output."
      : "The role doesn't exist under this ARN, for example because of a typo in the role name.",
    `The ARN is from a different account than the one you set the role up in (this one names ${ctx.accountId}).`,
    `The role's trust policy doesn't name arn:aws:iam::${ctx.platformAccountId}:root.`,
    `Its External ID condition isn't exactly ${ctx.externalId}.`
      + (ctx.cloudFormation ? " If you changed the stack's ExternalId parameter, set it back to this value." : ''),
    "The role was created moments ago and AWS hasn't made it usable yet.",
  ]
}

// Board 7: security explanation.
export const SEC_CAN_READ_TITLE = 'What DevControl can read'
export const SEC_CAN_READ: readonly string[] = [
  'Configuration and metadata of EC2, EBS, RDS and Aurora, Lambda, load balancers, CloudFront, DynamoDB tables and S3 bucket settings',
  'CloudWatch metrics and alarms',
  'Cost Explorer data',
  'Your Resource Explorer index',
  'IAM user security settings: MFA devices, access-key metadata, console-login status',
  'Security Hub findings, if you use Security Hub',
]
export const SEC_CANT_TITLE = "What this role can't do with the recommended policy set"
export const SEC_CANT: readonly string[] = [
  "With the recommended policies, the role can't change, stop or delete your resources: they grant read access only.",
  "With the recommended policies, the role can't read the contents of your S3 objects or DynamoDB items.",
  "With the recommended policies, the role can't list the objects in your buckets, or read Lambda function configuration, EC2 instance attributes, ECS task definitions, CloudTrail events or CloudFormation templates. DevControlReadExtras explicitly denies these.",
]
export const SEC_READ_ONLY_ACCESS = "A role set up with ReadOnlyAccess instead allows more than DevControl uses, so these limits don't apply to it."
export const SEC_ACCESS_TITLE = 'How access works and how to remove it'
export const SEC_EXTERNAL_ID_LEAD = 'External ID.'
export const SEC_EXTERNAL_ID = "DevControl can assume your role only with your organization's External ID, which never changes. Together with the trust policy, it means DevControl can assume this role only for your organization. It isn't a secret: anyone who can read the role in IAM can see it."
export const SEC_CREDENTIALS_LEAD = 'Short-lived credentials.'
export const SEC_CREDENTIALS = "DevControl doesn't ask for access keys. It uses short-lived credentials from your role, with a configured maximum of one hour."
export const SEC_REMOVE_LEAD = 'Remove access.'
export const SEC_REMOVE = 'Delete the role in IAM. DevControl can then no longer assume it. Credentials it already holds stop working when they expire, with a configured maximum of one hour.'
/** S-3 (PR D2): only in the setup view while the CloudFormation card is shown. */
export const SEC_REMOVE_STACK = 'If you created the role with the DevControl CloudFormation stack, you can delete the stack instead: that deletes the role.'
export const SEC_ROLE_DELETED = "Deleting the role in AWS doesn't remove your connection in DevControl. This page then shows its health as failing, then lost."
export const SEC_DATA_BEFORE = 'DevControl keeps the data it already collected. '
export const SEC_DATA_LINK = 'Contact us'
export const SEC_DATA_AFTER = " and we'll delete it."

// Sidebar.
export const SIDE_READS_TITLE = 'What DevControl reads'
export const SIDE_READS: readonly string[] = ['EC2, RDS, Lambda, S3 resource metadata', 'CloudWatch metrics and alarms', 'Cost Explorer data']
/** DB-D16 (founder wording, Nov 12): what reading Cost Explorer costs the customer. Backend cache TTL: aws-cost.service.ts MONTHLY_COST_CACHE_TTL. */
export const COST_EXPLORER_BILLING_NOTE = 'Cost Explorer requests are billed at USD 0.01 per request. Results are cached for 4 hours, so a typical account makes only a few requests per day.'
export const SIDE_SECURITY_TITLE = 'Security'
export const SIDE_SECURITY: readonly string[] = ['Database stored on an encrypted disk (AWS EBS encryption)', 'Role credentials never stored']
export const SIDE_NEED_HELP = 'Need help?'
export const SIDE_MANUAL_LINK = 'Set it up by hand →'
export const SIDE_SECURITY_LINK = "What DevControl can and can't do →"

/** Section anchors the sidebar links to. */
export const MANUAL_SETUP_ID = 'manual-setup'
export const SECURITY_ID = 'security'
