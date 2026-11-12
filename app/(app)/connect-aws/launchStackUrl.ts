/**
 * Checks on the server-supplied CloudFormation links before they go into an
 * href (AWS connect PR E review L-6, PR D2). The backend already builds them
 * only from validated configuration (backend/src/services/launch-stack.ts);
 * this is the page's own check, so a bad or unexpected value never renders.
 *
 * The template-URL rule is the server's rule, line for line (D2 review L-4):
 * both sides are tested against one shared table,
 * backend/src/__tests__/fixtures/launch-stack-template-urls.json.
 * The Region is us-east-1 only (founder decision D2-D7, review L-3).
 */
import type { ConnectInitData } from '@/lib/services/aws-accounts.service'

const LAUNCH_REGION = 'us-east-1'
const CONSOLE_HOST = `${LAUNCH_REGION}.console.aws.amazon.com`
const MAX_TEMPLATE_URL_LENGTH = 1024
const S3_PATH_STYLE_HOST = /^s3\.us-east-1\.amazonaws\.com$/
const S3_VIRTUAL_HOST = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\.s3\.us-east-1\.amazonaws\.com$/
const S3_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/

function parse(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** The CloudFormation console in us-east-1 on AWS's console host, over https, with no credentials or port. */
export function isAwsConsoleLaunchUrl(raw: unknown): boolean {
  const url = parse(raw)
  if (!url) return false
  return url.protocol === 'https:'
    && url.username === '' && url.password === '' && url.port === ''
    && url.hostname === CONSOLE_HOST
    && url.pathname === '/cloudformation/home'
    && url.searchParams.get('region') === LAUNCH_REGION
}

/**
 * The https URL of template version `version` in S3 in us-east-1, with the key
 * ending in exactly /v{n}/devcontrol-role.v{n}.json. The same rule as the
 * server's isTemplateUrlFor.
 */
export function isS3TemplateUrlFor(raw: unknown, version: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_TEMPLATE_URL_LENGTH) return false
  if (raw.includes('?') || raw.includes('#')) return false
  const url = parse(raw)
  if (!url || url.href !== raw) return false
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  if (!SAFE_PATH.test(url.pathname)) return false
  let key: string
  if (S3_PATH_STYLE_HOST.test(url.hostname)) {
    const [, bucket, ...rest] = url.pathname.split('/')
    if (!S3_BUCKET.test(bucket ?? '') || rest.length === 0) return false
    key = `/${rest.join('/')}`
  } else if (S3_VIRTUAL_HOST.test(url.hostname)) {
    key = url.pathname
  } else {
    return false
  }
  const segments = key.split('/').slice(1)
  if (segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  return key.endsWith(`/v${version}/devcontrol-role.v${version}.json`)
}

export type UsableLaunchStack = { url: string; templateVersion: string; templateUrl: string | null }

/**
 * The Launch stack data the page may render, or null (the CloudFormation card
 * then stays hidden and the manual setup shows open). The View template link is
 * dropped on its own when only the template URL fails.
 */
export function usableLaunchStack(launchStack: ConnectInitData['launchStack'] | null | undefined): UsableLaunchStack | null {
  if (!launchStack || !isAwsConsoleLaunchUrl(launchStack.url)) return null
  if (typeof launchStack.templateVersion !== 'string' || !/^[1-9]\d{0,3}$/.test(launchStack.templateVersion)) return null
  return {
    url: launchStack.url,
    templateVersion: launchStack.templateVersion,
    templateUrl: isS3TemplateUrlFor(launchStack.templateUrl, launchStack.templateVersion) ? (launchStack.templateUrl as string) : null,
  }
}
