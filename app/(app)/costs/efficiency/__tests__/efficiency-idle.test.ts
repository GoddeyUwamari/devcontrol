/**
 * /costs/efficiency: a resource is "not running" (and its cost "idle") only when it
 * was observed stopped or pending. A null status -- an S3 bucket, an SNS topic or a
 * VPC has no lifecycle state; another type's may not have been read -- is never idle.
 * The page used to treat anything that was not 'running' as idle.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isNotRunning } from '../idle'

const row = (resourceType: string, status: string | null, costPerMonth = 10) => ({ resourceType, status, costPerMonth }) as never

describe('isNotRunning', () => {
  it.each([['stopped'], ['pending']])('%s is not running', (status) => {
    expect(isNotRunning({ status } as never)).toBe(true)
  })

  it.each([['running'], [null], [undefined], ['not_applicable'], ['unknown'], ['terminated']])('%p is not counted as idle', (status) => {
    expect(isNotRunning({ status } as never)).toBe(false)
  })

  it.each([['available'], ['in-use']])('an EBS volume that is %s (unattached / attached) is not idle', (status) => {
    expect(isNotRunning({ resourceType: 'ebs', status } as never)).toBe(false)
  })

  it('S3, SNS and VPC rows (no lifecycle state) never count as idle', () => {
    const inventory = [row('s3', null, 5), row('sns', null, 0.5), row('vpc', null, 0), row('ec2', 'stopped', 40), row('ec2', 'running', 60)]
    const idle = (inventory as Array<{ resourceType: string; costPerMonth: number }>).filter((r) => isNotRunning(r as never))
    expect(idle.map((r) => r.resourceType)).toEqual(['ec2'])
    // Idle cost is the stopped instance alone, not the buckets, topic and VPC with it.
    expect(idle.reduce((sum, r) => sum + r.costPerMonth, 0)).toBe(40)
  })
})

describe('the page uses it for both the idle cost and the "Resource not running" label', () => {
  const source = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8')

  it('never treats "anything but running" as idle', () => {
    expect(source).not.toMatch(/status\s*!==\s*'running'/)
  })

  it('computes idle cost and the issue label through isNotRunning', () => {
    expect(source).toMatch(/resources\.filter\(isNotRunning\)/)
    expect(source).toMatch(/isNotRunning\(r\) \? 'Resource not running'/)
  })
})
