/**
 * F1 (AWS connect PR D2, review L-6): the page renders a server-supplied
 * Launch stack link only on AWS's console host over https, and a View template
 * link only on S3's https host. Placeholders only.
 */
import { describe, it, expect } from 'vitest'
import { isAwsConsoleLaunchUrl, isS3TemplateUrl, usableLaunchStack } from '../launchStackUrl'

const LAUNCH = 'https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=x'
const TEMPLATE = 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'

describe('isAwsConsoleLaunchUrl', () => {
  it.each([
    ['the regional console', LAUNCH],
    ['the global console', 'https://console.aws.amazon.com/cloudformation/home#/stacks/create/review'],
    ['a GovCloud-style region', 'https://us-gov-west-1.console.aws.amazon.com/cloudformation/home'],
  ])('accepts %s', (_label, url) => {
    expect(isAwsConsoleLaunchUrl(url)).toBe(true)
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
    ['http', 'http://console.aws.amazon.com/cloudformation/home'],
    ['a look-alike suffix', 'https://console.aws.amazon.com.evil.test/cloudformation/home'],
    ['a look-alike path', 'https://evil.test/console.aws.amazon.com/cloudformation/home'],
    ['a look-alike prefix', 'https://evilconsole.aws.amazon.com/cloudformation/home'],
    ['credentials', 'https://user@console.aws.amazon.com/cloudformation/home'],
    ['a port', 'https://console.aws.amazon.com:8443/cloudformation/home'],
    ['another console page', 'https://console.aws.amazon.com/s3/home'],
    ['a relative URL', '/cloudformation/home'],
    ['an empty string', ''],
    ['not a string', 42],
    ['undefined', undefined],
  ])('rejects %s', (_label, url) => {
    expect(isAwsConsoleLaunchUrl(url)).toBe(false)
  })
})

describe('isS3TemplateUrl', () => {
  it.each([
    ['virtual-hosted', TEMPLATE],
    ['path-style', 'https://s3.us-east-1.amazonaws.com/template-bucket/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'],
  ])('accepts %s', (_label, url) => {
    expect(isS3TemplateUrl(url)).toBe(true)
  })

  it.each([
    ['http', TEMPLATE.replace('https:', 'http:')],
    ['a query', `${TEMPLATE}?X-Amz-Signature=x`],
    ['an empty query', `${TEMPLATE}?`],
    ['a fragment', `${TEMPLATE}#x`],
    ['a foreign host', 'https://example.test/t.json'],
    ['a look-alike host', 'https://template-bucket.s3.us-east-1.amazonaws.com.evil.test/t.json'],
    ['javascript:', 'javascript:alert(1)'],
    ['not JSON', TEMPLATE.replace('.json', '.yaml')],
    ['undefined', undefined],
  ])('rejects %s', (_label, url) => {
    expect(isS3TemplateUrl(url)).toBe(false)
  })
})

describe('usableLaunchStack', () => {
  it('passes a valid launchStack through', () => {
    expect(usableLaunchStack({ url: LAUNCH, templateVersion: '1', templateUrl: TEMPLATE })).toEqual({ url: LAUNCH, templateVersion: '1', templateUrl: TEMPLATE })
  })

  it('drops only the template link when the template URL is invalid or absent', () => {
    expect(usableLaunchStack({ url: LAUNCH, templateVersion: '1', templateUrl: 'https://example.test/t.json' })?.templateUrl).toBeNull()
    expect(usableLaunchStack({ url: LAUNCH, templateVersion: '1' })?.templateUrl).toBeNull()
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an invalid link', { url: 'https://example.test/quickcreate', templateVersion: '1', templateUrl: TEMPLATE }],
    ['a non-numeric version', { url: LAUNCH, templateVersion: '1.0.0', templateUrl: TEMPLATE }],
    ['a version with markup', { url: LAUNCH, templateVersion: '<b>1</b>', templateUrl: TEMPLATE }],
  ])('is null for %s', (_label, launchStack) => {
    expect(usableLaunchStack(launchStack as never)).toBeNull()
  })
})
