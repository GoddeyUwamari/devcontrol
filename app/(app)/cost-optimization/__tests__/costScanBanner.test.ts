/**
 * The scan result banner's copy (founder-locked behaviour, Nov 23, Stage A
 * rulings 2, 3, 4, 9) and the Last analysis line's problem part (ruling 1a):
 * every number from the run's own result, zero clauses omitted, plurals right.
 */
import { describe, it, expect } from 'vitest'
import type { CostRunResult } from '@/lib/services/cost-recommendations.service'
import {
  FAILURE_REASON_TEXT,
  couldntRunSentence,
  lastAnalysisProblem,
  resultBannerContent,
  serviceList,
  withoutTrailingTryAgain,
} from '../costScanBanner'
import { coverageCardLine, coverageLine, serviceNamesLine } from '../costOptimizationCopy'

const SIX = ['EC2', 'EBS', 'RDS', 'S3', 'Lambda', 'DynamoDB']

function result(overrides: Partial<CostRunResult> = {}): CostRunResult {
  return {
    id: 'run-placeholder', state: 'completed', completedAt: null, checksTotal: 11, checksRan: 11, failedChecks: [], services: SIX,
    newCount: 0, openCount: 0, stillOpen: 0, message: null, findingsUnchanged: false, ...overrides,
  }
}

describe('GREEN: every check ran', () => {
  it('new findings, with still open from earlier, and the link', () => {
    expect(resultBannerContent(result({ newCount: 3, openCount: 5, stillOpen: 2 }))).toEqual({
      tone: 'success',
      title: 'Cost analysis complete',
      description: '11 checks run across EC2, EBS, RDS, S3, Lambda and DynamoDB · 3 new opportunities found · 2 still open from earlier',
      link: 'See the new opportunities',
    })
  })

  it('one new, nothing else open: singular, and the "still open" clause omitted', () => {
    const content = resultBannerContent(result({ newCount: 1, openCount: 1, stillOpen: 0 }))
    expect(content.description).toBe('11 checks run across EC2, EBS, RDS, S3, Lambda and DynamoDB · 1 new opportunity found')
    expect(content.link).toBe('See the new opportunity')
  })

  it('nothing new, some still open', () => {
    const content = resultBannerContent(result({ newCount: 0, openCount: 4, stillOpen: 4 }))
    expect(content.tone).toBe('success')
    expect(content.description).toBe('11 checks run across EC2, EBS, RDS, S3, Lambda and DynamoDB · No new opportunities · 4 still open from earlier')
    expect(content.link).toBeUndefined()
  })

  it('nothing open at all', () => {
    expect(resultBannerContent(result({ newCount: 0, openCount: 0, stillOpen: 0 })).description)
      .toBe('11 checks run across EC2, EBS, RDS, S3, Lambda and DynamoDB · No opportunities found')
  })

  it('a count the run did not record is left out, never shown as 0', () => {
    const content = resultBannerContent(result({ newCount: null, openCount: null, stillOpen: null }))
    expect(content.description).toBe('11 checks run across EC2, EBS, RDS, S3, Lambda and DynamoDB')
    expect(content.description).not.toMatch(/\b0\b/)
  })

  it('counts come from the run: 1 check, 1 service', () => {
    expect(resultBannerContent(result({ checksTotal: 1, checksRan: 1, services: ['EC2'] })).description)
      .toBe('1 check run across EC2 · No opportunities found')
  })
})

describe('AMBER: some checks couldn\'t run', () => {
  it('one reason', () => {
    expect(resultBannerContent(result({ state: 'partial', checksRan: 9, failedChecks: [{ reason: 'permissions', count: 2 }] }))).toEqual({
      tone: 'warning',
      title: 'Cost analysis completed with gaps',
      description: "9 of 11 checks ran. 2 checks couldn't run because of missing permissions. Findings from the completed checks are up to date.",
    })
  })

  it('one check: singular', () => {
    expect(resultBannerContent(result({ state: 'partial', checksRan: 10, failedChecks: [{ reason: 'timeout', count: 1 }] })).description)
      .toBe("10 of 11 checks ran. 1 check couldn't run because of a timeout. Findings from the completed checks are up to date.")
  })

  it('ruling 2: two reasons, largest first', () => {
    expect(couldntRunSentence([{ reason: 'timeout', count: 1 }, { reason: 'rate_limited', count: 2 }], 3))
      .toBe("2 checks couldn't run because of AWS rate limiting and 1 because of a timeout.")
  })

  it('ruling 2: at most two reasons, then "and other reasons"', () => {
    expect(couldntRunSentence([
      { reason: 'error', count: 1 },
      { reason: 'permissions', count: 3 },
      { reason: 'too_many_resources', count: 2 },
      { reason: 'timeout', count: 1 },
    ], 7)).toBe("3 checks couldn't run because of missing permissions, 2 because of too many resources to list, and other reasons.")
  })

  it('a run recorded before reasons existed: the count only', () => {
    expect(couldntRunSentence([], 2)).toBe("2 checks couldn't run.")
  })

  it('ruling 3: the reason wording', () => {
    expect(FAILURE_REASON_TEXT).toEqual({
      permissions: 'missing permissions',
      rate_limited: 'AWS rate limiting',
      timeout: 'a timeout',
      too_many_resources: 'too many resources to list',
      error: 'an unexpected error',
    })
  })
})

describe('RED: the scan itself failed', () => {
  it('ruling 4: the unchanged sentence only when the server vouches for it; ruling 9: no trailing "Try again."', () => {
    expect(resultBannerContent(result({ state: 'failed', message: 'None of the cost checks could complete. Try again.', findingsUnchanged: true }))).toEqual({
      tone: 'danger',
      title: "Cost analysis didn't finish",
      description: "None of the cost checks could complete. Your existing findings haven't changed.",
      retry: true,
    })
    expect(resultBannerContent(result({ state: 'failed', message: 'The analysis did not complete due to an unexpected error.', findingsUnchanged: false })).description)
      .toBe('The analysis did not complete due to an unexpected error.')
  })

  it('interrupted: "Run it again." dropped too, never the unchanged claim', () => {
    expect(resultBannerContent(result({ state: 'interrupted', message: 'The analysis was interrupted before it finished. Run it again.', findingsUnchanged: false })).description)
      .toBe('The analysis was interrupted before it finished.')
  })

  it('no message: a fixed fallback', () => {
    expect(resultBannerContent(result({ state: 'failed', message: null })).description).toBe("The analysis didn't complete.")
  })

  it('a reason that is more than "Try again." keeps its words', () => {
    expect(withoutTrailingTryAgain('A scan is already running for this AWS account. Try again in a few minutes.'))
      .toBe('A scan is already running for this AWS account. Try again in a few minutes.')
  })
})

describe('the Last analysis line (ruling 1a)', () => {
  it.each([
    [{ key: 'partial' as const, failedChecks: 2 }, "2 checks couldn't run"],
    [{ key: 'partial' as const, failedChecks: 1 }, "1 check couldn't run"],
    [{ key: 'partial' as const, failedChecks: null }, "some checks couldn't run"],
    [{ key: 'failed' as const, failedChecks: null }, "didn't finish"],
    [{ key: 'interrupted' as const, failedChecks: null }, "didn't finish"],
    [{ key: 'completed_new' as const, failedChecks: 0 }, null],
    [{ key: 'running' as const, failedChecks: null }, null],
  ])('%j → %s', (scan, expected) => {
    expect(lastAnalysisProblem(scan)).toBe(expected)
  })
})

describe('coverage copy (ruling 6): never the catalog total', () => {
  it('the card, its services and the expanded text', () => {
    expect(coverageCardLine(11)).toBe('AWS cost optimization · 11 active checks')
    expect(coverageCardLine(1)).toBe('AWS cost optimization · 1 active check')
    expect(serviceNamesLine(SIX)).toBe('EC2 · EBS · RDS · S3 · Lambda · DynamoDB')
    expect(coverageLine(11, SIX)).toBe('11 active checks across EC2 · EBS · RDS · S3 · Lambda · DynamoDB')
  })

  it('serviceList joins with commas and "and"', () => {
    expect(serviceList([])).toBe('')
    expect(serviceList(['EC2'])).toBe('EC2')
    expect(serviceList(['EC2', 'EBS'])).toBe('EC2 and EBS')
  })
})
