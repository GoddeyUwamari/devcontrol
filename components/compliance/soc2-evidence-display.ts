/**
 * Display-only wording for an AWS-observed SOC 2 evidence row: a "<Type> · <ID>" heading
 * and a plain result line. Nothing here changes what is stored or returned; the full
 * identifier stays available on the row, and anything this file does not recognise is
 * shown as it came from the API.
 */

const ARN = /^arn:[\w-]+:[\w-]+:[^:]*:[^:]*:(.+)$/

/** The resource part of an ARN (everything after the account field), or null. */
function arnResource(arn: string): string | null {
  return ARN.exec(arn)?.[1] ?? null
}

/** Resource type -> heading label, and how its ID is read from the ARN's resource part. */
const HEADINGS: Record<string, { label: string; id: RegExp }> = {
  ec2: { label: 'EC2 instance', id: /^instance\/(i-[\w-]+)$/ },
  ebs: { label: 'EBS volume', id: /^volume\/(vol-[\w-]+)$/ },
  s3: { label: 'S3 bucket', id: /^([^/:]+)$/ },
  rds: { label: 'RDS instance', id: /^db:(.+)$/ },
  aurora: { label: 'Aurora cluster', id: /^cluster:(.+)$/ },
}

const ACCESS_KEY = /^(.*)#access-key#(.+)$/

/**
 * "<Type> · <ID>". Aggregate rows (no ARN) are "AWS account". An access key (CC6.3's
 * synthetic `<user ARN>#access-key#<key ID>`) shows only the key ID's last four
 * characters, never the whole ID. Any other shape falls back to the full identifier.
 */
export function evidenceHeading(resourceType: string, resourceArn: string | null): string {
  if (resourceArn === null) return 'AWS account'

  if (resourceType === 'iam_access_key') {
    const key = ACCESS_KEY.exec(resourceArn)
    if (key) {
      const [, userPart, keyId] = key
      // An unexpected user part is shown whole; the key ID is masked either way.
      const userName = /^user\/(?:.*\/)?([^/]+)$/.exec(arnResource(userPart) ?? '')?.[1] ?? userPart
      return `Access key · ${userName} · …${keyId.slice(-4)}`
    }
    return resourceArn
  }

  const heading = HEADINGS[resourceType]
  const resource = arnResource(resourceArn)
  const id = heading && resource ? heading.id.exec(resource)?.[1] : undefined
  return heading && id ? `${heading.label} · ${id}` : resourceArn
}

type FieldValue = 'true' | 'false' | 'null (unknown)'

/** CC6.1's encrypted wording differs by resource type; unencrypted and unknown do not (except EC2's). */
function encryptionLine(value: FieldValue, resourceType: string): string | null {
  if (value === 'null (unknown)') return 'Encryption unknown'
  if (resourceType === 'ec2') return value === 'true' ? 'All attached volumes encrypted' : "An attached volume isn't encrypted"
  if (value === 'false') return 'Not encrypted'
  return { ebs: 'Volume encrypted', s3: 'Default encryption on', rds: 'Storage encrypted', aurora: 'Storage encrypted' }[resourceType] ?? null
}

const PUBLIC_LINES: Record<FieldValue, string> = {
  true: 'Publicly accessible',
  false: 'Not publicly accessible',
  'null (unknown)': 'Public access unknown',
}

const BACKUP_LINES: Record<FieldValue, string> = {
  true: 'Backup recovery point found',
  false: 'No backup recovery point',
  'null (unknown)': 'Backup status unknown',
}

// The backend's explanation templates (backend/src/services/soc2-evidence.service.ts) that have plain wording.
const ENCRYPTED = /^AWS discovery reported is_encrypted=(true|false|null \(unknown\)) for this (\w+) resource\.$/
const PUBLIC = /^AWS discovery reported is_public=(true|false|null \(unknown\)) for this \w+ resource\.$/
const BACKUP = /^AWS Backup recovery-point evidence reported has_backup=(true|false|null \(unknown\)) for this \w+ resource\.$/
const S3_PUBLIC_FINDING = /^The S3 public-access evaluation recorded: "(.*)"\.$/
const ACTIVE_FINDING = /^An active account-level finding exists \(finding_key=(.+)\)\.$/
const ACTIVE_COUNT = /^(\d+) active finding\(s\) of this type exist for the organization\.$/
const S3_NO_PUBLIC_FINDING =
  'The S3 public-access evaluation recorded no ACL or bucket-policy public-exposure finding for this bucket, and the organization’s most recent discovery job completed successfully.'
const NO_ACTIVE_FINDINGS = 'Zero active findings of this type, and the organization’s most recent discovery job completed successfully.'

/** The plain result line for an evidence row; the explanation itself when it has no plain wording. */
export function evidenceResultLine(explanation: string): string {
  let m: RegExpExecArray | null
  if ((m = ENCRYPTED.exec(explanation))) return encryptionLine(m[1] as FieldValue, m[2]) ?? explanation
  if ((m = PUBLIC.exec(explanation))) return PUBLIC_LINES[m[1] as FieldValue]
  if ((m = BACKUP.exec(explanation))) return BACKUP_LINES[m[1] as FieldValue]
  if ((m = S3_PUBLIC_FINDING.exec(explanation))) return `Public access: ${m[1]}`
  if ((m = ACTIVE_FINDING.exec(explanation))) return `Active finding: ${m[1]}`
  if ((m = ACTIVE_COUNT.exec(explanation))) return `${m[1]} active finding(s)`
  if (explanation === S3_NO_PUBLIC_FINDING) return 'No public ACL or bucket-policy exposure. The latest discovery completed.'
  if (explanation === NO_ACTIVE_FINDINGS) return 'No active findings. The latest discovery completed.'
  return explanation
}
