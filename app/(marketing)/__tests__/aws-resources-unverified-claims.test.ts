/**
 * The AWS resources marketing page carried a customer outcome that DevControl
 * cannot substantiate: "$6,200/month in orphaned infrastructure", presented as
 * a quoted, attributed testimonial ("Saved $6,200/month") with headline
 * statistics. It was removed, not relabeled: an invented quote reads as
 * evidence even when marked illustrative.
 *
 * The page also claimed coverage DevControl does not have: discovery reads one
 * aws_accounts row per organization (AWSClientFactory, LIMIT 1) in one region
 * (us-east-1, set when the account is connected), so "every region",
 * "unlimited accounts and regions" and "100% coverage" were false, and
 * "15+ types" / "< 1min" were unsubstantiated. The page now says single region.
 *
 * Same technique as soc2-readiness-messaging.test.ts: scan the page source for
 * the removed claims.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const PAGE = path.resolve(__dirname, '..', 'aws-resources', 'page.tsx')

const REMOVED = [
  '$6,200',
  '6,200/month',
  'Saved $',
  'Monthly waste identified',
  '340 untagged resources',
  'We had no idea we were running',
  '15+',
  '< 1min',
  '100%\', label',
  'Resource coverage across accounts',
  'every region',
  'Every region',
  'unlimited accounts and regions',
  'across all your AWS accounts and regions',
  'Multi-account & multi-region',
  'Multi-Region & Multi-Account',
  'every AWS account and region',
]

describe('app/(marketing)/aws-resources/page.tsx', () => {
  const source = fs.readFileSync(PAGE, 'utf8')

  it.each(REMOVED)('no longer contains "%s"', (phrase) => {
    expect(source).not.toContain(phrase)
  })

  it('carries no attributed testimonial section', () => {
    expect(source).not.toMatch(/SOCIAL PROOF/)
  })

  it('carries no headline statistics bar', () => {
    expect(source).not.toMatch(/BUSINESS IMPACT BAR|impacts\.map/)
  })

  it('states that discovery covers a single region', () => {
    expect(source).toContain('single region (us-east-1 today)')
    expect(source).toContain('Multi-region and multi-account discovery are not available yet.')
  })
})
