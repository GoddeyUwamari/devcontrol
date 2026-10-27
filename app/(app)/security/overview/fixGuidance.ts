/**
 * Static fix guidance for the Security Overview redesign, keyed by the issue a
 * finding belongs to (security-page-plan.md §7). The wording was approved by
 * the founder on Oct 26, 2026 and is pinned word for word by fix-guidance.test.ts:
 * change it only with a new approval.
 *
 * A finding gets a key only when its own check and evidence identify the issue
 * exactly; anything else (an unknown check, missing or malformed evidence) gets
 * no key and shows its own title and recommendation only. Pure, no React.
 */
import type { AccountSecurityFinding } from '@/lib/services/account-security-findings.service'

export const GUIDANCE_KEYS = [
  'sg_open_admin',
  'sg_open_web',
  'sg_open_other',
  'iam_no_mfa_console',
  'iam_no_mfa_unknown',
  'iam_key_stale',
  's3_https_only',
  's3_public_policy',
  's3_public_acl',
] as const

export type GuidanceKey = (typeof GUIDANCE_KEYS)[number]

export interface FixGuidance {
  /** The group title in "Group by issue". */
  title: string
  whyItMatters: string
  nextStep: string
  fixRisk: string
  /** One policy statement to merge into the bucket's existing policy ({bucket} is filled in by buildHttpsOnlyStatement). */
  policyStatementTemplate?: string
}

const GUIDANCE: ReadonlyMap<GuidanceKey, FixGuidance> = new Map<GuidanceKey, FixGuidance>([
  ['sg_open_admin', {
    title: `Remote-admin port open to the internet`,
    whyItMatters: `Remote-admin ports open to the whole internet are scanned constantly; a weak or leaked credential becomes a way in.`,
    nextStep: `Limit the source to specific IP ranges, or remove the rule once you have another way in. Session Manager or a VPN can give admin access without an open port, once you've confirmed it works for this instance.`,
    fixRisk: `Anyone connecting from outside the allowed range loses access. Keep the current rule until the alternative is tested.`,
  }],
  ['sg_open_web', {
    title: `Web port open to the internet`,
    whyItMatters: `Anyone on the internet can reach this port. That's expected for a public web server or load balancer, and unnecessary exposure for anything else.`,
    nextStep: `If this resource serves public web traffic, accept the risk and record why. If not, limit the source to known ranges or to a load balancer's security group.`,
    fixRisk: `Narrowing the source blocks visitors and services outside the allowed ranges. Check what depends on this port first.`,
  }],
  ['sg_open_other', {
    title: `Port open to the internet`,
    whyItMatters: `An open port exposes whatever service listens on it, and many services aren't built to face the internet directly.`,
    nextStep: `Check which service uses this port. Remove the rule if nothing needs it; otherwise limit the source to the addresses or security groups that do.`,
    fixRisk: `Clients outside the new range lose access. Review the affected resource before changing the rule.`,
  }],
  ['iam_no_mfa_console', {
    title: `Console user without MFA`,
    whyItMatters: `This user can sign in to the AWS console with a password alone; a leaked or guessed password is enough to get in.`,
    nextStep: `If the user still needs the console, assign an MFA device. If not, remove its console password; that doesn't affect the user's access keys, which are a separate risk to review.`,
    fixRisk: `Adding MFA is usually a small change. Removing console access can break workflows that rely on it, so check who uses this sign-in first.`,
  }],
  ['iam_no_mfa_unknown', {
    title: `User without MFA (console access unknown)`,
    whyItMatters: `This user has no MFA device, and we couldn't confirm whether it can sign in to the console.`,
    nextStep: `Check the user's console access in IAM. If it has a password, assign MFA or remove console access.`,
    fixRisk: `Review the user first; removing console access can break workflows that rely on it.`,
  }],
  ['iam_key_stale', {
    title: `Access key older than 90 days`,
    whyItMatters: `Long-lived keys are a common source of leaks. Age alone doesn't mean this key is compromised or unused, but the longer a key lives, the more places it may have been copied to.`,
    nextStep: `List what uses the key (IAM shows when and where it was last used). Move those workloads to roles where practical; otherwise issue a new key, switch each workload over and test it. Then deactivate the old key, check that nothing breaks, and delete it.`,
    fixRisk: `Anything still using the old key fails once it's deactivated; deactivating first lets you turn it back on.`,
  }],
  ['s3_https_only', {
    title: `S3 bucket accepts HTTP`,
    whyItMatters: `The bucket accepts requests over plain HTTP, so data can travel unencrypted.`,
    nextStep: `Review the bucket's existing policy, then add a statement that denies requests where aws:SecureTransport is false.`,
    fixRisk: `Clients still using HTTP will start failing. This is one statement to merge into the existing policy, not a complete policy; replacing the policy with it would remove your existing permissions.`,
    policyStatementTemplate: `{"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*","Action":"s3:*","Resource":["arn:aws:s3:::{bucket}","arn:aws:s3:::{bucket}/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}`,
  }],
  ['s3_public_policy', {
    title: `Bucket policy allows public access`,
    whyItMatters: `The bucket policy has a statement that grants access to everyone. Depending on the actions it allows and the account's Block Public Access settings, that may make objects publicly accessible.`,
    nextStep: `Review the public statement, the bucket's purpose and its effective Block Public Access settings. If public access isn't intended, remove or narrow the statement, then consider turning on Block Public Access.`,
    fixRisk: `Public access is sometimes intentional (static websites, public downloads); removing it, or turning on Block Public Access, stops those from working.`,
  }],
  ['s3_public_acl', {
    title: `Bucket ACL grants access to everyone`,
    whyItMatters: `An access list on this bucket grants access to everyone or to all AWS users. Whether that exposes data depends on the grant and on the Block Public Access settings.`,
    nextStep: `Review the grant and the bucket's purpose. If public access isn't intended, remove the grant. Switching the bucket to "bucket owner enforced" (ACLs disabled) is an option once you've confirmed nothing relies on ACLs.`,
    fixRisk: `Anything relying on the grant stops working; disabling ACLs affects every ACL on the bucket and its objects.`,
  }],
])

const isGuidanceKey = (key: unknown): key is GuidanceKey =>
  typeof key === 'string' && (GUIDANCE_KEYS as readonly string[]).includes(key)

/** The guidance for a key; undefined for a missing or unknown key (the row then shows its recommendation only). */
export function guidanceFor(key: unknown): FixGuidance | undefined {
  return isGuidanceKey(key) ? GUIDANCE.get(key) : undefined
}

/** Shown only with sg_open_web: a public web port can be intended. */
export const WEB_SERVER_HINT = 'Expected for a web server? Accept the risk with a reason.'

// ── Which issue a finding is ──

const isPort = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)
const RECOGNISED = new Set(['tcp', 'udp', 'icmp', 'icmpv6'])

/**
 * A security-group finding's port class, from its evidence. Admin: all
 * protocols (exactly "-1"), or TCP covering 22 or 3389 (the scanner's own rule,
 * which rates these critical). Web: TCP on exactly port 80 or exactly 443. Other:
 * any other recognised protocol and range. A missing, empty or unrecognised
 * protocol, or missing or malformed ports (for TCP and UDP: outside 0–65535 or
 * reversed; ICMP carries type and code there), gives no class.
 */
export function sgPortClass(evidence: unknown): 'sg_open_admin' | 'sg_open_web' | 'sg_open_other' | null {
  if (!evidence || typeof evidence !== 'object') return null
  const { protocol, from_port: from, to_port: to } = evidence as Record<string, unknown>
  if (!isPort(from) || !isPort(to)) return null
  if (protocol === '-1' || protocol === -1) return 'sg_open_admin'
  if (typeof protocol !== 'string') return null
  const numeric = /^\d{1,3}$/.test(protocol) && Number(protocol) <= 255
  if (!RECOGNISED.has(protocol) && !numeric) return null
  if (protocol === 'tcp' || protocol === 'udp') {
    if (from < 0 || to > 65535 || from > to) return null
  }
  if (protocol === 'tcp') {
    if ((from <= 22 && to >= 22) || (from <= 3389 && to >= 3389)) return 'sg_open_admin'
    if ((from === 80 && to === 80) || (from === 443 && to === 443)) return 'sg_open_web'
  }
  return 'sg_open_other'
}

/** The guidance key for an account-level finding (security group or IAM user), or null. */
export function guidanceKeyForAccountFinding(f: AccountSecurityFinding): GuidanceKey | null {
  const e = f.evidence && typeof f.evidence === 'object' ? (f.evidence as unknown as Record<string, unknown>) : null
  if (!e) return null
  if (f.category === 'networking') return sgPortClass(e)
  if (f.category !== 'iam') return null
  if (e.finding_type === 'access_key_stale') return 'iam_key_stale'
  if (e.finding_type !== 'mfa_not_enabled') return null
  const a = e.relevant_aws_attributes && typeof e.relevant_aws_attributes === 'object' ? (e.relevant_aws_attributes as Record<string, unknown>) : {}
  if (a.has_login_profile === true) return 'iam_no_mfa_console'
  if (a.has_login_profile === 'unknown') return 'iam_no_mfa_unknown'
  return null
}

/** S3 finding keys from backend/src/utils/s3FindingKeys.ts. */
const S3_KEYS: Record<string, GuidanceKey> = {
  's3.https_only': 's3_https_only',
  's3.public_access.policy': 's3_public_policy',
  's3.public_access.acl': 's3_public_acl',
}

/** The guidance key for an issue stored on a resource, from its finding key only (never its text), or null. */
export function guidanceKeyForResourceIssue(issue: { findingKey?: unknown }): GuidanceKey | null {
  const key = issue.findingKey
  return typeof key === 'string' && Object.hasOwn(S3_KEYS, key) ? S3_KEYS[key] : null
}

/** The one statement to merge into the bucket's existing policy; the name is escaped by JSON.stringify. */
export function buildHttpsOnlyStatement(bucket: string): string {
  return JSON.stringify({
    Sid: 'DenyInsecureTransport',
    Effect: 'Deny',
    Principal: '*',
    Action: 's3:*',
    Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
    Condition: { Bool: { 'aws:SecureTransport': 'false' } },
  })
}

/** True only for text that is valid JSON for exactly one policy statement (an object with a Sid, not a policy or a list). */
export function isOneStatement(text: unknown): text is string {
  if (typeof text !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(text)
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof (parsed as Record<string, unknown>).Sid === 'string'
      && !Object.hasOwn(parsed, 'Statement') && !Object.hasOwn(parsed, 'Version')
  } catch {
    return false
  }
}
