/**
 * The Services page's fallback at-risk count (used until /services/stats answers):
 * only a known warning or critical status counts. 'unknown' -- a type with no
 * lifecycle state, or one that was not read -- is not a reason for attention.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statusNeedsAttention } from '../statusAttention'

describe('statusNeedsAttention', () => {
  it.each([['warning'], ['critical']])('%s counts', (status) => {
    expect(statusNeedsAttention({ status })).toBe(true)
  })

  it.each([['healthy'], ['unknown'], ['not_applicable'], [null], [undefined]])('%p does not', (status) => {
    expect(statusNeedsAttention({ status })).toBe(false)
  })

  it('a list of buckets, a topic and a VPC with one stopped instance has one service needing attention', () => {
    const services = [
      { type: 's3', status: 'unknown' }, { type: 's3', status: 'unknown' }, { type: 'sns', status: 'unknown' },
      { type: 'vpc', status: 'unknown' }, { type: 'ec2', status: 'warning' }, { type: 'ec2', status: 'healthy' },
    ]
    expect(services.filter(statusNeedsAttention)).toHaveLength(1)
  })
})

describe('the page', () => {
  const source = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8')

  it('no longer counts "anything but healthy" as needing attention', () => {
    expect(source).not.toMatch(/status\s*!==\s*'healthy'/)
    expect(source).toMatch(/displayStats\?\.needs_attention \?\? allServices\.filter\(statusNeedsAttention\)\.length/)
  })
})
