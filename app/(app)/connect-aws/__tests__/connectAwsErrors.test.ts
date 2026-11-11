import { describe, it, expect } from 'vitest'
import { connectErrorView } from '../connectAwsErrors'
import { coverageRefetchInterval, SCAN_RUNNING_REFETCH_MS } from '../ConnectedView'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'

const fail = (code: string | undefined, message: string | undefined = `Text for ${code}.`) => ({ response: { status: 400, data: { code, message } } })

describe('connectErrorView: a failed connect is shown by its code', () => {
  it.each(['ROLE_ARN_REQUIRED', 'ROLE_ARN_MALFORMED', 'ROLE_NAME_PREFIX'])('%s is an ARN error with the server text', (code) => {
    expect(connectErrorView(fail(code))).toEqual({ kind: 'arn', message: `Text for ${code}.` })
  })

  it('ROLE_NOT_ASSUMABLE never carries the server text (the page lists the possible causes)', () => {
    expect(connectErrorView(fail('ROLE_NOT_ASSUMABLE', 'SERVER TEXT'))).toEqual({ kind: 'not_assumable', message: null })
  })

  it('AWS_UNAVAILABLE and PLATFORM_AWS_UNAVAILABLE keep their server texts', () => {
    expect(connectErrorView(fail('AWS_UNAVAILABLE'))).toEqual({ kind: 'aws_unavailable', message: 'Text for AWS_UNAVAILABLE.' })
    expect(connectErrorView(fail('PLATFORM_AWS_UNAVAILABLE'))).toEqual({ kind: 'platform', message: 'Text for PLATFORM_AWS_UNAVAILABLE.' })
  })

  it('ALREADY_CONNECTED uses the page text, never the server\'s "Disconnect it first"', () => {
    const view = connectErrorView(fail('ALREADY_CONNECTED', 'This organisation already has a connected AWS account. Disconnect it first.'))
    expect(view).toEqual({ kind: 'already_connected', message: 'This organization already has a connected AWS account.' })
  })

  it.each(['CONNECT_CHECK_IN_PROGRESS', 'CONNECT_CHECK_BUSY', 'CONNECT_STATE_UNAVAILABLE', 'SAVE_FAILED', 'ROLE_NOT_FOUND', 'ROLE_CHECK_FAILED', 'CONNECT_CANCELLED', 'SOMETHING_NEW'])(
    '%s is general, with the server text',
    (code) => {
      expect(connectErrorView(fail(code))).toEqual({ kind: 'general', message: `Text for ${code}.` })
    }
  )

  it('a 403 without a code shows the server text', () => {
    expect(connectErrorView({ response: { status: 403, data: { message: 'Only an organization owner can connect an AWS account' } } }))
      .toEqual({ kind: 'general', message: 'Only an organization owner can connect an AWS account' })
  })

  it('no response: a network message that does not blame the Role ARN', () => {
    expect(connectErrorView(new Error('Network Error'))).toEqual({ kind: 'general', message: "We couldn't reach DevControl. Check your connection and try again." })
  })

  it('a response without a message (an HTML 502): the neutral retry message', () => {
    expect(connectErrorView({ response: { status: 502, data: '<html>' } })).toEqual({ kind: 'general', message: 'Something went wrong while connecting your account. Please try again.' })
    expect(connectErrorView(fail('AWS_UNAVAILABLE', ''))).toEqual({ kind: 'aws_unavailable', message: 'Something went wrong while connecting your account. Please try again.' })
  })
})

describe('coverageRefetchInterval', () => {
  const base = { scan_in_progress: null, last_scan: null } as unknown as ServicesCoverage
  it('polls while a scan runs', () => {
    expect(coverageRefetchInterval({ ...base, scan_in_progress: { since: '2026-01-01T00:00:00Z' } }, false)).toBe(SCAN_RUNNING_REFETCH_MS)
  })
  it('polls right after a connect until the first scan has a job row', () => {
    expect(coverageRefetchInterval(undefined, true)).toBe(SCAN_RUNNING_REFETCH_MS)
    expect(coverageRefetchInterval(base, true)).toBe(SCAN_RUNNING_REFETCH_MS)
    expect(coverageRefetchInterval({ ...base, last_scan: { status: 'completed', started_at: null, completed_at: null, warnings: [] } }, true)).toBe(false)
  })
  it('does not poll otherwise', () => {
    expect(coverageRefetchInterval(base, false)).toBe(false)
    expect(coverageRefetchInterval(undefined, false)).toBe(false)
  })
})
