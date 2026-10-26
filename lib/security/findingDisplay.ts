/**
 * How a security finding names what it is about, without printing a full
 * access key ID or an ARN (which carries the AWS account number). Pure, so each
 * rule is tested without rendering (security-page-plan.md §8).
 *
 * - A key ID is shown as its last four characters only.
 * - An ARN is shown as its last resource segment; the account field is never
 *   returned, and an ARN without a resource part shows as "…".
 * - Titles are rebuilt from evidence where the stored title embeds a key ID,
 *   and any key-shaped token or ARN left in other titles is shortened.
 */
import type { AccountSecurityFinding } from '@/lib/services/account-security-findings.service'

export const HIDDEN = '…'

/** "…" + the last 4 characters; anything shorter than 8 characters (or missing) shows as "…" only. */
export function maskKeyId(id: string | null | undefined): string {
  if (typeof id !== 'string' || id.length < 8) return HIDDEN
  return `${HIDDEN}${id.slice(-4)}`
}

/**
 * The last segment of an ARN's resource part: `security-group/sg-1` → `sg-1`,
 * `user/path/name` → `name`, `arn:aws:s3:::bucket` → `bucket`. A value that is
 * not an ARN is returned as is.
 */
export function shortArn(value: string | null | undefined): string {
  if (typeof value !== 'string') return HIDDEN
  if (!value.startsWith('arn:')) return value
  // arn:partition:service:region:account:resource (the resource part may itself contain ':').
  const parts = value.split(':')
  if (parts.length < 6) return HIDDEN
  const segments = parts.slice(5).join(':').split(/[/:]/).filter((s) => s.length > 0)
  return segments.length > 0 ? segments[segments.length - 1] : HIDDEN
}

export interface FindingWhere {
  name: string
  kind: string
  /** The finding's region, or "Global" for IAM. */
  region: string
}

const GLOBAL = 'Global'

function evidenceOf(f: AccountSecurityFinding): Record<string, unknown> | null {
  return f.evidence && typeof f.evidence === 'object' ? (f.evidence as unknown as Record<string, unknown>) : null
}

function attributesOf(e: Record<string, unknown> | null): Record<string, unknown> {
  const a = e?.relevant_aws_attributes
  return a && typeof a === 'object' ? (a as Record<string, unknown>) : {}
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** What an account-level finding is about: a security group, an IAM user, or a user's access key. */
export function findingWhere(f: AccountSecurityFinding): FindingWhere {
  const e = evidenceOf(f)
  if (f.category === 'networking') {
    const id = text(e?.security_group_id)
    const name = text(e?.security_group_name)
    const label = id && name && name !== id ? `${name} (${id})` : id ?? name ?? shortArn(f.resource_identifier)
    return { name: label, kind: 'Security group', region: f.region ?? text(e?.region) ?? GLOBAL }
  }
  const user = text(e?.resource_name) ?? shortArn(f.resource_identifier)
  if (e?.finding_type === 'access_key_stale') {
    return { name: `${user} · key ${maskKeyId(text(attributesOf(e).access_key_id))}`, kind: 'IAM user', region: GLOBAL }
  }
  return { name: user, kind: 'IAM user', region: GLOBAL }
}

export interface ResourceRef {
  resource_name: string | null
  resource_arn: string | null | undefined
  resource_type: string
  region: string | null
}

/** What a resource finding is about: its name, else the short form of its ARN. */
export function resourceWhere(r: ResourceRef): FindingWhere {
  return { name: text(r.resource_name) ?? shortArn(r.resource_arn), kind: r.resource_type, region: text(r.region) ?? GLOBAL }
}

const KEY_TOKEN = /\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g
const ARN_TOKEN = /arn:aws[\w-]*:[^\s"'()<>,]*/g

/** Any key-shaped token or ARN in free text, shortened (defence in depth for stored titles). */
export function maskText(value: string): string {
  return value.replace(KEY_TOKEN, (k) => maskKeyId(k)).replace(ARN_TOKEN, (a) => shortArn(a))
}

/** A finding's title with no full key ID or ARN in it. */
export function safeTitle(f: AccountSecurityFinding): string {
  const e = evidenceOf(f)
  if (e?.finding_type === 'access_key_stale') {
    const a = attributesOf(e)
    const user = text(e.resource_name) ?? shortArn(f.resource_identifier)
    const age = typeof a.age_in_days === 'number' && Number.isFinite(a.age_in_days) ? a.age_in_days : null
    if (age !== null) return `IAM user "${user}" has an access key (${maskKeyId(text(a.access_key_id))}) that is ${age} days old`
  }
  return maskText(f.title)
}
