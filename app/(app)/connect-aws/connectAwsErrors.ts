/**
 * How a failed connect is shown, decided by the server's stable `code`
 * (backend routes/aws.routes.ts), never by matching its text.
 *
 *   arn                 the Role ARN itself is wrong; shown under the field. Refused before any AWS call.
 *   not_assumable       ROLE_NOT_ASSUMABLE: AWS refused the AssumeRole. The causes can't be told apart,
 *                       so the page lists them (board 6b) instead of the server's text.
 *   aws_unavailable     AWS_UNAVAILABLE: AWS didn't answer.
 *   platform            PLATFORM_AWS_UNAVAILABLE: DevControl's own side.
 *   already_connected   ALREADY_CONNECTED: shown with the page's own text, never the server's.
 *   general             anything else: the server's fixed message, or a safe fallback.
 */
import { ALREADY_CONNECTED_TEXT, GENERIC_ERROR, NETWORK_ERROR } from './connectAwsCopy'

export type ConnectErrorKind = 'arn' | 'not_assumable' | 'aws_unavailable' | 'platform' | 'already_connected' | 'general'

export interface ConnectErrorView {
  kind: ConnectErrorKind
  /** The text to show; null for not_assumable, whose panel is built from the page's own copy. */
  message: string | null
}

const ARN_CODES: ReadonlySet<string> = new Set(['ROLE_ARN_REQUIRED', 'ROLE_ARN_MALFORMED', 'ROLE_NAME_PREFIX'])

export function connectErrorView(err: unknown): ConnectErrorView {
  const response = (err as { response?: { data?: unknown } } | null)?.response
  if (!response) return { kind: 'general', message: NETWORK_ERROR }
  const data = (typeof response.data === 'object' && response.data !== null ? response.data : {}) as { code?: unknown; message?: unknown }
  const code = typeof data.code === 'string' ? data.code : null
  const message = typeof data.message === 'string' && data.message ? data.message : null

  if (code !== null && ARN_CODES.has(code)) return { kind: 'arn', message: message ?? GENERIC_ERROR }
  if (code === 'ROLE_NOT_ASSUMABLE') return { kind: 'not_assumable', message: null }
  if (code === 'AWS_UNAVAILABLE') return { kind: 'aws_unavailable', message: message ?? GENERIC_ERROR }
  if (code === 'PLATFORM_AWS_UNAVAILABLE') return { kind: 'platform', message: message ?? GENERIC_ERROR }
  if (code === 'ALREADY_CONNECTED') return { kind: 'already_connected', message: ALREADY_CONNECTED_TEXT }
  return { kind: 'general', message: message ?? GENERIC_ERROR }
}
