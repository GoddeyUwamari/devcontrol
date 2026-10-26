import { describe, it, expect } from 'vitest'
import type { AccountSecurityFinding } from '@/lib/services/account-security-findings.service'
import { findingWhere, maskKeyId, maskText, resourceWhere, safeTitle, shortArn } from '@/lib/security/findingDisplay'

// Placeholders only: a fake key ID and the all-zero account number.
const ACCOUNT = '000000000000'
const KEY = 'AKIAEXAMPLE000000001'

const finding = (over: Partial<AccountSecurityFinding>): AccountSecurityFinding => ({
  id: 'f-1', organization_id: 'org-1', finding_key: 'k', category: 'iam', severity: 'high', title: '',
  recommendation: '', resource_identifier: '', region: null, status: 'active',
  detected_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-10-23T00:00:00Z', resolved_at: null,
  disposition: null, disposition_actor_id: null, disposition_at: null, disposition_note: null, evidence: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-23T00:00:00Z', derived_status: 'active', framework_mapping: null,
  ...over,
})

const SG = finding({
  category: 'networking', severity: 'critical', region: 'us-east-1',
  title: 'Security group "admin-sg" (sg-0abcdef1234567890) allows SSH (port 22) from anywhere (0.0.0.0/0)',
  resource_identifier: `arn:aws:ec2:us-east-1:${ACCOUNT}:security-group/sg-0abcdef1234567890`,
  evidence: {
    schema_version: 1, security_group_id: 'sg-0abcdef1234567890', security_group_name: 'admin-sg', region: 'us-east-1',
    direction: 'ingress', protocol: 'tcp', from_port: 22, to_port: 22, ip_version: 'v4', cidr: '0.0.0.0/0', detected_at: '2026-10-01T00:00:00Z',
  },
})
const KEY_FINDING = finding({
  title: `IAM user "example-user" has an access key (${KEY}) that is 200 days old`,
  resource_identifier: `arn:aws:iam::${ACCOUNT}:user/example-user`,
  evidence: {
    schema_version: 1, resource_type: 'iam_access_key', resource_identifier: `arn:aws:iam::${ACCOUNT}:user/example-user`,
    resource_name: 'example-user', finding_type: 'access_key_stale',
    relevant_aws_attributes: { access_key_id: KEY, age_in_days: 200, key_status: 'Active' }, detected_at: '2026-10-01T00:00:00Z',
  },
})
const MFA_FINDING = finding({
  title: 'IAM user "path-user" has console access but no MFA device enabled',
  resource_identifier: `arn:aws:iam::${ACCOUNT}:user/team/a/path-user`,
  evidence: {
    schema_version: 1, resource_type: 'iam_user', resource_identifier: `arn:aws:iam::${ACCOUNT}:user/team/a/path-user`,
    resource_name: 'path-user', finding_type: 'mfa_not_enabled',
    relevant_aws_attributes: { has_login_profile: true, mfa_device_count: 0 }, detected_at: '2026-10-01T00:00:00Z',
  },
})

describe('maskKeyId', () => {
  it('shows only the last four characters', () => {
    expect(maskKeyId(KEY)).toBe('…0001')
    expect(maskKeyId('12345678')).toBe('…5678')
  })
  it('shows nothing of a value shorter than 8 characters, or of a missing one', () => {
    expect(maskKeyId('1234567')).toBe('…')
    expect(maskKeyId('')).toBe('…')
    expect(maskKeyId(null)).toBe('…')
    expect(maskKeyId(undefined)).toBe('…')
  })
})

describe('shortArn', () => {
  it.each([
    [`arn:aws:ec2:us-east-1:${ACCOUNT}:security-group/sg-1`, 'sg-1'],
    [`arn:aws:iam::${ACCOUNT}:user/example-user`, 'example-user'],
    [`arn:aws:iam::${ACCOUNT}:user/team/a/path-user`, 'path-user'],
    ['arn:aws:s3:::example-bucket', 'example-bucket'],
    [`arn:aws:lambda:us-east-1:${ACCOUNT}:function:example-fn`, 'example-fn'],
    [`arn:aws-us-gov:rds:us-gov-west-1:${ACCOUNT}:db:example-db`, 'example-db'],
  ])('%s → %s', (arn, short) => {
    expect(shortArn(arn)).toBe(short)
  })
  it('returns a value that is not an ARN as is', () => {
    expect(shortArn('sg-123')).toBe('sg-123')
    expect(shortArn('example-bucket')).toBe('example-bucket')
  })
  it('never returns the account field, even for an ARN with no resource part', () => {
    expect(shortArn(`arn:aws:iam::${ACCOUNT}`)).toBe('…')
    expect(shortArn(`arn:aws:iam::${ACCOUNT}:`)).toBe('…')
    expect(shortArn(`arn:aws:iam::${ACCOUNT}:/`)).toBe('…')
    expect(shortArn('arn:aws')).toBe('…')
    expect(shortArn(null)).toBe('…')
  })
})

describe('findingWhere', () => {
  it('names a security group by name and id', () => {
    expect(findingWhere(SG)).toEqual({ name: 'admin-sg (sg-0abcdef1234567890)', kind: 'Security group', region: 'us-east-1' })
  })
  it('falls back to the short ARN when a security group has no evidence', () => {
    expect(findingWhere({ ...SG, evidence: null })).toEqual({ name: 'sg-0abcdef1234567890', kind: 'Security group', region: 'us-east-1' })
  })
  it('names an IAM user by name, in "Global"', () => {
    expect(findingWhere(MFA_FINDING)).toEqual({ name: 'path-user', kind: 'IAM user', region: 'Global' })
  })
  it('names an access key by its user and the masked key', () => {
    expect(findingWhere(KEY_FINDING)).toEqual({ name: 'example-user · key …0001', kind: 'IAM user', region: 'Global' })
  })
  it('names a resource by its name, else the short ARN', () => {
    expect(resourceWhere({ resource_name: 'example-bucket', resource_arn: 'arn:aws:s3:::example-bucket', resource_type: 's3', region: 'eu-west-1' }))
      .toEqual({ name: 'example-bucket', kind: 's3', region: 'eu-west-1' })
    expect(resourceWhere({ resource_name: null, resource_arn: `arn:aws:rds:us-east-1:${ACCOUNT}:db:example-db`, resource_type: 'rds', region: 'us-east-1' }).name)
      .toBe('example-db')
  })
})

describe('safeTitle', () => {
  it('rebuilds the stale-key title from evidence with the key masked', () => {
    expect(safeTitle(KEY_FINDING)).toBe('IAM user "example-user" has an access key (…0001) that is 200 days old')
  })
  it('masks a key in a title that has no usable evidence', () => {
    expect(safeTitle({ ...KEY_FINDING, evidence: null })).toBe('IAM user "example-user" has an access key (…0001) that is 200 days old')
  })
  it('shortens an ARN left in a title', () => {
    expect(maskText(`Bucket arn:aws:s3:::example-bucket and role arn:aws:iam::${ACCOUNT}:role/example-role.`))
      .toBe('Bucket example-bucket and role example-role.')
  })
  it('leaves other titles unchanged', () => {
    expect(safeTitle(SG)).toBe(SG.title)
  })
})

describe('no output carries a full key ID or the account number', () => {
  const outputs = [KEY_FINDING, MFA_FINDING, SG, { ...KEY_FINDING, evidence: null }, { ...SG, evidence: null }].flatMap((f) => {
    const w = findingWhere(f)
    return [safeTitle(f), w.name, w.kind, w.region]
  })
  it.each(outputs)('%s', (out) => {
    expect(out).not.toContain(ACCOUNT)
    expect(out).not.toMatch(/(?:AKIA|ASIA)[A-Z0-9]{12,}/)
    expect(out).not.toMatch(/arn:aws/)
  })
})
