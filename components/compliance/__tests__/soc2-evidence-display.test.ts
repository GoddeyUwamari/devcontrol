import { describe, it, expect } from 'vitest'
import { evidenceHeading, evidenceResultLine, evidenceResultTitle } from '../soc2-evidence-display'

const ACCOUNT = '123456789012'

describe('evidenceHeading', () => {
  it('reads the ID from the ARN for each known resource type', () => {
    expect(evidenceHeading('ec2', `arn:aws:ec2:us-east-1:${ACCOUNT}:instance/i-1234567890abcdef0`)).toBe('EC2 instance · i-1234567890abcdef0')
    expect(evidenceHeading('ebs', `arn:aws:ec2:us-east-1:${ACCOUNT}:volume/vol-1234567890abcdef0`)).toBe('EBS volume · vol-1234567890abcdef0')
    expect(evidenceHeading('s3', 'arn:aws:s3:::example-bucket')).toBe('S3 bucket · example-bucket')
    expect(evidenceHeading('rds', `arn:aws:rds:us-east-1:${ACCOUNT}:db:example-db`)).toBe('RDS instance · example-db')
    expect(evidenceHeading('aurora', `arn:aws:rds:us-east-1:${ACCOUNT}:cluster:example-cluster`)).toBe('Aurora cluster · example-cluster')
  })

  it('heads IAM user rows by user name and security-group rows by group ID', () => {
    expect(evidenceHeading('iam_user', `arn:aws:iam::${ACCOUNT}:user/example.user`)).toBe('IAM user · example.user')
    expect(evidenceHeading('iam_user', `arn:aws:iam::${ACCOUNT}:user/team/example.user`)).toBe('IAM user · example.user')
    expect(evidenceHeading('security_group', `arn:aws:ec2:us-east-1:${ACCOUNT}:security-group/sg-1234567890abcdef0`))
      .toBe('Security group · sg-1234567890abcdef0')
    // The scanner writes '*' when the account ID is unknown.
    expect(evidenceHeading('security_group', 'arn:aws:ec2:us-east-1:*:security-group/sg-1234567890abcdef0'))
      .toBe('Security group · sg-1234567890abcdef0')
  })

  it('heads an aggregate row (no ARN) "AWS account"', () => {
    expect(evidenceHeading('organization', null)).toBe('AWS account')
  })

  it('falls back to the full identifier for an unexpected ARN or type', () => {
    const odd = `arn:aws:ec2:us-east-1:${ACCOUNT}:snapshot/snap-example`
    expect(evidenceHeading('ec2', odd)).toBe(odd)
    expect(evidenceHeading('s3', 'not-an-arn')).toBe('not-an-arn')
    const role = `arn:aws:iam::${ACCOUNT}:role/example-role`
    expect(evidenceHeading('iam_user', role)).toBe(role)
    const sgOdd = `arn:aws:ec2:us-east-1:${ACCOUNT}:security-group-rule/sgr-example`
    expect(evidenceHeading('security_group', sgOdd)).toBe(sgOdd)
    expect(evidenceHeading('security_group', 'sg-not-an-arn')).toBe('sg-not-an-arn')
  })

  describe('access keys', () => {
    const keyId = 'AKIAIOSFODNN7EXAMPLE'

    it('shows the user and only the last four characters of the key ID', () => {
      const id = `arn:aws:iam::${ACCOUNT}:user/example.user#access-key#${keyId}`
      const heading = evidenceHeading('iam_access_key', id)
      expect(heading).toBe('Access key · example.user · …MPLE')
      expect(heading).not.toContain(keyId)
    })

    it('reads the user name from a user ARN with a path', () => {
      expect(evidenceHeading('iam_access_key', `arn:aws:iam::${ACCOUNT}:user/team/example.user#access-key#${keyId}`))
        .toBe('Access key · example.user · …MPLE')
    })

    it('never shows the full key ID, even when the user part is unexpected', () => {
      const heading = evidenceHeading('iam_access_key', `not-a-user-arn#access-key#${keyId}`)
      expect(heading).toBe('Access key · not-a-user-arn · …MPLE')
      expect(heading).not.toContain(keyId)
    })
  })
})

describe('evidenceResultLine', () => {
  const encrypted = (value: string, type: string) => `AWS discovery reported is_encrypted=${value} for this ${type} resource.`

  it('words EC2 encryption by what discovery checked: every attached volume', () => {
    expect(evidenceResultLine(encrypted('true', 'ec2'))).toBe('All attached volumes encrypted')
    expect(evidenceResultLine(encrypted('false', 'ec2'))).toBe("An attached volume isn't encrypted")
    expect(evidenceResultLine(encrypted('null (unknown)', 'ec2'))).toBe('Encryption unknown')
  })

  it('words encryption for EBS, S3, RDS and Aurora', () => {
    expect(evidenceResultLine(encrypted('true', 'ebs'))).toBe('Volume encrypted')
    expect(evidenceResultLine(encrypted('true', 's3'))).toBe('Default encryption on')
    expect(evidenceResultLine(encrypted('true', 'rds'))).toBe('Storage encrypted')
    expect(evidenceResultLine(encrypted('true', 'aurora'))).toBe('Storage encrypted')
    expect(evidenceResultLine(encrypted('false', 's3'))).toBe('Not encrypted')
    expect(evidenceResultLine(encrypted('null (unknown)', 'rds'))).toBe('Encryption unknown')
  })

  it('words public exposure and backup presence', () => {
    expect(evidenceResultLine('AWS discovery reported is_public=false for this rds resource.')).toBe('Not publicly accessible')
    expect(evidenceResultLine('AWS discovery reported is_public=true for this ec2 resource.')).toBe('Publicly accessible')
    expect(evidenceResultLine('AWS discovery reported is_public=null (unknown) for this ec2 resource.')).toBe('Public access unknown')
    expect(evidenceResultLine('AWS Backup recovery-point evidence reported has_backup=true for this ec2 resource.')).toBe('Backup recovery point found')
    expect(evidenceResultLine('AWS Backup recovery-point evidence reported has_backup=false for this rds resource.')).toBe('No backup recovery point')
    expect(evidenceResultLine('AWS Backup recovery-point evidence reported has_backup=null (unknown) for this rds resource.')).toBe('Backup status unknown')
  })

  it('words the S3 public-access and account-finding templates', () => {
    expect(evidenceResultLine('The S3 public-access evaluation recorded: "S3 bucket ACL allows public read access".'))
      .toBe('Public access: S3 bucket ACL allows public read access')
    expect(evidenceResultLine(
      'The S3 public-access evaluation recorded no ACL or bucket-policy public-exposure finding for this bucket, and the organization’s most recent discovery job completed successfully.'
    )).toBe('No public ACL or bucket-policy exposure. The latest discovery completed.')
    expect(evidenceResultLine('An active account-level finding exists (finding_key=abc123).')).toBe('Active finding')
    expect(evidenceResultLine('2 active finding(s) of this type exist for the organization.')).toBe('2 active finding(s)')
    expect(evidenceResultLine('Zero active findings of this type, and the organization’s most recent discovery job completed successfully.'))
      .toBe('No active findings. The latest discovery completed.')
  })

  it('moves an active finding\'s finding_key to the tooltip; other rows have none', () => {
    expect(evidenceResultTitle('An active account-level finding exists (finding_key=abc123).')).toBe('abc123')
    expect(evidenceResultTitle('2 active finding(s) of this type exist for the organization.')).toBeUndefined()
    expect(evidenceResultTitle('AWS discovery reported is_public=false for this rds resource.')).toBeUndefined()
  })

  it('leaves every other explanation unchanged', () => {
    for (const unchanged of [
      'aurora resources are discovered via the generic inventory path, which does not populate real encryption evidence for this field.',
      'An earlier scan recorded "x", but the latest scan could not evaluate this check, so it is unverified.',
      'Zero active findings of this type, but the organization’s most recent discovery job did not complete successfully, so absence cannot be trusted as confirmed-clean.',
      'Sample data: AWS discovery reported is_encrypted=true for this ec2 resource.',
      'AWS discovery reported is_encrypted=true for this lambda resource.',
    ]) {
      expect(evidenceResultLine(unchanged)).toBe(unchanged)
    }
  })
})
