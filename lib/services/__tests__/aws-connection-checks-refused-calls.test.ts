/**
 * Region-access PR (b):
 * - B4/B7: a refused saved source is kept only with the one action its listing may name (and,
 *   for Resource Explorer, its GetIndex and GetDefaultView calls). Anything else is DROPPED,
 *   never shown as another call (founder ruling Q8). ListResources is never one (Q9).
 * - RC-N1 (region-access PR 1 review): the connect response's permission check goes through
 *   the same allowlist as the saved checks.
 * - The Connect AWS line: GetIndex and GetDefaultView read "AWS refused this call", every
 *   listing (Search included) keeps "AWS refused this listing".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPost = vi.fn()
vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args) },
  handleApiResponse: <T,>(response: { data: { success: boolean; data: T; message?: string } }): T => {
    if (!response.data.success) throw new Error(response.data.message || 'API request failed')
    return response.data.data
  },
}))

import awsAccountsService, { parseConnectionChecks, parsePermissionCheckReport, type ConnectAwsPayload } from '../aws-accounts.service'
import { refusedLine } from '@/app/(app)/connect-aws/connectAwsCopy'

const AT = '2026-11-25T10:00:00.000Z'
const checksWith = (sources: unknown[]) =>
  parseConnectionChecks({
    health: { state: 'ok', lastResult: 'ok', checkedAt: AT, failingSince: null },
    refusedSources: { scannedAt: AT, sources },
  })!.refusedSources!.sources

const ALLOWED: [string, string][] = [
  ['ec2', 'ec2:DescribeInstances'],
  ['ebs', 'ec2:DescribeVolumes'],
  ['rds', 'rds:DescribeDBInstances'],
  ['s3', 's3:ListAllMyBuckets'],
  ['lambda', 'lambda:ListFunctions'],
  ['load-balancer', 'elasticloadbalancing:DescribeLoadBalancers'],
  ['cloudfront', 'cloudfront:ListDistributions'],
  ['resource-explorer', 'resource-explorer-2:Search'],
  ['resource-explorer', 'resource-explorer-2:GetIndex'],
  ['resource-explorer', 'resource-explorer-2:GetDefaultView'],
]

describe('refusedSources: the refused-call allowlist', () => {
  it.each(ALLOWED)('%s / %s is kept', (source, action) => {
    expect(checksWith([{ source, action }])).toEqual([{ source, action }])
  })

  it.each([
    ['ListResources (never called, Q9)', { source: 'resource-explorer', action: 'resource-explorer-2:ListResources' }],
    ['another source\'s action', { source: 'ec2', action: 'resource-explorer-2:GetIndex' }],
    ['a Resource Explorer write', { source: 'resource-explorer', action: 'resource-explorer-2:CreateView' }],
    ['AWS text', { source: 'resource-explorer', action: 'User: arn:aws:sts::123456789012:assumed-role/x/s is not authorized' }],
    ['a bare operation', { source: 'resource-explorer', action: 'GetDefaultView' }],
    ['an unknown source', { source: 'dynamodb', action: 'dynamodb:ListTables' }],
    ['a prototype key as the source', { source: 'constructor', action: 'ec2:DescribeInstances' }],
  ])('%s is dropped, never mapped to a default', (_label, entry) => {
    expect(checksWith([entry, { source: 'ec2', action: 'ec2:DescribeInstances' }])).toEqual([{ source: 'ec2', action: 'ec2:DescribeInstances' }])
  })

  it.each([
    ['null', null],
    ['a string', 'resource-explorer-2:GetIndex'],
    ['a non-string action', { source: 'resource-explorer', action: 7 }],
    ['no action', { source: 'resource-explorer' }],
    ['a non-string source', { source: ['ec2'], action: 'ec2:DescribeInstances' }],
  ])('a malformed entry (%s) is dropped safely', (_label, entry) => {
    expect(checksWith([entry])).toEqual([])
  })

  it('extra fields never pass through', () => {
    expect(checksWith([{ source: 'resource-explorer', action: 'resource-explorer-2:GetIndex', detail: 'AWS text' }])).toEqual([
      { source: 'resource-explorer', action: 'resource-explorer-2:GetIndex' },
    ])
  })
})

describe('the Connect AWS refused line', () => {
  it('GetIndex and GetDefaultView: "AWS refused this call", naming the call', () => {
    expect(refusedLine('Resource Explorer search', 'resource-explorer-2:GetIndex')).toBe(
      "Resource Explorer search (resource-explorer-2:GetIndex): AWS refused this call, so DevControl couldn't read these resources."
    )
    expect(refusedLine('Resource Explorer search', 'resource-explorer-2:GetDefaultView')).toBe(
      "Resource Explorer search (resource-explorer-2:GetDefaultView): AWS refused this call, so DevControl couldn't read these resources."
    )
  })

  it('Search and every listing keep "AWS refused this listing"', () => {
    expect(refusedLine('Resource Explorer search', 'resource-explorer-2:Search')).toBe(
      "Resource Explorer search (resource-explorer-2:Search): AWS refused this listing, so DevControl couldn't read these resources."
    )
    expect(refusedLine('EC2 instances', 'ec2:DescribeInstances')).toBe("EC2 instances (ec2:DescribeInstances): AWS refused this listing, so DevControl couldn't read these resources.")
  })
})

describe('RC-N1: the connect response\'s permission check uses the saved checks\' allowlist', () => {
  beforeEach(() => { mockPost.mockReset() })

  const connectWith = async (permissionCheck: unknown) => {
    mockPost.mockResolvedValue({ data: { success: true, data: { id: 'a1' }, message: 'ok', permissionCheck } })
    return (await awsAccountsService.connect({ roleArn: 'x', externalId: 'y' } as unknown as ConnectAwsPayload)).permissionCheck
  }

  it('the two known refusedAction values on a denied Search are kept', async () => {
    for (const refusedAction of ['resource-explorer-2:GetIndex', 'resource-explorer-2:GetDefaultView']) {
      expect(await connectWith({ checks: [{ action: 'resource-explorer-2:Search', status: 'denied', refusedAction }] })).toEqual({
        checks: [{ action: 'resource-explorer-2:Search', status: 'denied', refusedAction }],
      })
    }
  })

  it('an unknown refusedAction, one on another action or one not denied is dropped; the entry stays', async () => {
    expect(await connectWith({
      checks: [
        { action: 'resource-explorer-2:Search', status: 'denied', refusedAction: 'User: arn:aws:sts::123456789012:x' },
        { action: 's3:ListAllMyBuckets', status: 'denied', refusedAction: 'resource-explorer-2:GetIndex' },
        { action: 'resource-explorer-2:Search', status: 'not_verified', refusedAction: 'resource-explorer-2:GetDefaultView' },
      ],
    })).toEqual({
      checks: [
        { action: 'resource-explorer-2:Search', status: 'denied' },
        { action: 's3:ListAllMyBuckets', status: 'denied' },
        { action: 'resource-explorer-2:Search', status: 'not_verified' },
      ],
    })
  })

  it('entries with no string action or an unknown status are dropped; extra fields never pass', async () => {
    expect(await connectWith({ checks: [{ action: 7, status: 'denied' }, { action: 'ce:GetCostAndUsage', status: 'maybe' }, { action: 'ce:GetCostAndUsage', status: 'verified', extra: 'x' }] }))
      .toEqual({ checks: [{ action: 'ce:GetCostAndUsage', status: 'verified' }] })
  })

  it('absent or malformed: null', async () => {
    expect(await connectWith(undefined)).toBeNull()
    expect(await connectWith('checks')).toBeNull()
    expect(await connectWith({ checks: 'none' })).toBeNull()
    expect(parsePermissionCheckReport(null)).toBeNull()
  })
})
