/**
 * Checks on the server-supplied CloudFormation links before they go into an
 * href (AWS connect PR E review L-6, PR D2). The backend already builds them
 * only from validated configuration (backend/src/services/launch-stack.ts);
 * this is the page's own check, so a bad or unexpected value never renders.
 */
import type { ConnectInitData } from '@/lib/services/aws-accounts.service'

const REGION = '[a-z]{2}(?:-gov)?-[a-z]+-\\d'
const CONSOLE_HOST = new RegExp(`^(?:${REGION}\\.)?console\\.aws\\.amazon\\.com$`)
const S3_PATH_STYLE_HOST = new RegExp(`^s3\\.${REGION}\\.amazonaws\\.com$`)
const S3_VIRTUAL_HOST = new RegExp(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\\.s3\\.${REGION}\\.amazonaws\\.com$`)

function parse(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** The CloudFormation console on AWS's console host, over https, with no credentials or port. */
export function isAwsConsoleLaunchUrl(raw: unknown): boolean {
  const url = parse(raw)
  if (!url) return false
  return url.protocol === 'https:'
    && url.username === '' && url.password === '' && url.port === ''
    && CONSOLE_HOST.test(url.hostname)
    && url.pathname === '/cloudformation/home'
}

/** A template object on S3's https host (the documented forms), with no credentials, port, query or fragment. */
export function isS3TemplateUrl(raw: unknown): boolean {
  const url = parse(raw)
  if (!url) return false
  return url.protocol === 'https:'
    && url.username === '' && url.password === '' && url.port === ''
    && url.search === '' && url.hash === '' && !String(raw).includes('?') && !String(raw).includes('#')
    && (S3_PATH_STYLE_HOST.test(url.hostname) || S3_VIRTUAL_HOST.test(url.hostname))
    && url.pathname.endsWith('.json')
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
    templateUrl: isS3TemplateUrl(launchStack.templateUrl) ? (launchStack.templateUrl as string) : null,
  }
}
