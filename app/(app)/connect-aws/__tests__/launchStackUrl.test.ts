/**
 * F1 (AWS connect PR D2, review L-6): the page renders a server-supplied
 * Launch stack link only on AWS's us-east-1 console host over https (D2-D7,
 * review L-3), and a View template link only for the template URL rule the
 * server applies, checked against the server's own table (review L-4).
 * Placeholders only.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { isAwsConsoleLaunchUrl, isS3TemplateUrlFor, usableLaunchStack } from '../launchStackUrl'

const LAUNCH = 'https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=x'
const TEMPLATE = 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'
/** The same table backend/src/services/__tests__/launch-stack.test.ts checks isTemplateUrlFor against. */
const TEMPLATE_URL_TABLE = JSON.parse(
  readFileSync(join(process.cwd(), 'backend/src/__tests__/fixtures/launch-stack-template-urls.json'), 'utf8')
) as { cases: Array<{ label: string; url: string; version: string; accepted: boolean }> }

describe('isAwsConsoleLaunchUrl', () => {
  it('accepts the us-east-1 console link the server builds', () => {
    expect(isAwsConsoleLaunchUrl(LAUNCH)).toBe(true)
  })

  it.each([
    ['the global console (the server never builds it)', 'https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review'],
    ['another Region', 'https://eu-west-2.console.aws.amazon.com/cloudformation/home?region=eu-west-2#/stacks/create/review'],
    ['a GovCloud Region', 'https://us-gov-west-1.console.aws.amazon.com/cloudformation/home?region=us-gov-west-1'],
    ['a China Region', 'https://cn-north-1.console.aws.amazon.com/cloudformation/home?region=cn-north-1'],
    ['the us-east-1 host with another region parameter', 'https://us-east-1.console.aws.amazon.com/cloudformation/home?region=eu-west-2'],
    ['the us-east-1 host without a region parameter', 'https://us-east-1.console.aws.amazon.com/cloudformation/home#/stacks/create/review'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
    ['http', 'http://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1'],
    ['a look-alike suffix', 'https://us-east-1.console.aws.amazon.com.evil.test/cloudformation/home?region=us-east-1'],
    ['a look-alike path', 'https://evil.test/us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1'],
    ['a look-alike prefix', 'https://evilus-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1'],
    ['credentials', 'https://user@us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1'],
    ['a port', 'https://us-east-1.console.aws.amazon.com:8443/cloudformation/home?region=us-east-1'],
    ['another console page', 'https://us-east-1.console.aws.amazon.com/s3/home?region=us-east-1'],
    ['a relative URL', '/cloudformation/home?region=us-east-1'],
    ['an empty string', ''],
    ['not a string', 42],
    ['undefined', undefined],
  ])('rejects %s', (_label, url) => {
    expect(isAwsConsoleLaunchUrl(url)).toBe(false)
  })
})

describe('isS3TemplateUrlFor: the server rule, from the shared table (review L-4)', () => {
  it.each(TEMPLATE_URL_TABLE.cases.map((c) => [c.label, c.version, c.accepted, c.url] as const))(
    '%s (version %s): accepted = %s',
    (_label, version, accepted, url) => {
      expect(isS3TemplateUrlFor(url, version)).toBe(accepted)
    }
  )

  it('the table is the shared one, with both outcomes', () => {
    expect(TEMPLATE_URL_TABLE.cases.filter((c) => c.accepted).length).toBeGreaterThanOrEqual(2)
    expect(TEMPLATE_URL_TABLE.cases.filter((c) => !c.accepted).length).toBeGreaterThanOrEqual(40)
  })

  it.each([undefined, null, 42, {}])('rejects a non-string value %j', (value) => {
    expect(isS3TemplateUrlFor(value, '1')).toBe(false)
  })
})

describe('usableLaunchStack', () => {
  it('passes a valid launchStack through', () => {
    expect(usableLaunchStack({ url: LAUNCH, templateVersion: '1', templateUrl: TEMPLATE })).toEqual({ url: LAUNCH, templateVersion: '1', templateUrl: TEMPLATE })
  })

  it('drops only the template link when the template URL is invalid, absent or for another version', () => {
    expect(usableLaunchStack({ url: LAUNCH, templateVersion: '1', templateUrl: 'https://example.test/t.json' })?.templateUrl).toBeNull()
    expect(usableLaunchStack({ url: LAUNCH, templateVersion: '1' })?.templateUrl).toBeNull()
    expect(usableLaunchStack({ url: LAUNCH, templateVersion: '2', templateUrl: TEMPLATE })?.templateUrl).toBeNull()
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an invalid link', { url: 'https://example.test/quickcreate', templateVersion: '1', templateUrl: TEMPLATE }],
    ['a link in another Region', { url: 'https://eu-west-2.console.aws.amazon.com/cloudformation/home?region=eu-west-2', templateVersion: '1', templateUrl: TEMPLATE }],
    ['a non-numeric version', { url: LAUNCH, templateVersion: '1.0.0', templateUrl: TEMPLATE }],
    ['a version with markup', { url: LAUNCH, templateVersion: '<b>1</b>', templateUrl: TEMPLATE }],
  ])('is null for %s', (_label, launchStack) => {
    expect(usableLaunchStack(launchStack as never)).toBeNull()
  })
})
