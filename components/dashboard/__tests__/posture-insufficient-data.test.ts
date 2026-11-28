/**
 * Placeholder-costs fix round 1 (ruling 5): a cost component with no usable AWS Cost Explorer
 * spend has no score and its tile reads "Insufficient data" -- never a neutral 50, never
 * "Not yet available".
 */
import { describe, it, expect } from 'vitest'
import { describePostureComponent, INSUFFICIENT_DATA_TEXT } from '../posture-evidence'
import { SECURITY_STATUS_BADGE } from '@/app/(app)/dashboard/securityHealthKpi'

const base = { label: 'Cost Efficiency', detail: 'Insufficient data', severity: 'medium' as const, delta: null, status: 'warning' as const, ready: true, reason: null }

describe('describePostureComponent: cost with insufficient data', () => {
  it('no score, "Insufficient data"', () => {
    const d = describePostureComponent('cost', { ...base, score: null, insufficientData: true, state: 'unavailable' }, SECURITY_STATUS_BADGE)
    expect(d).toMatchObject({ score: null, scoreText: '—', tier: null, missingText: 'Insufficient data' })
    expect(INSUFFICIENT_DATA_TEXT).toBe('Insufficient data')
  })

  it('a cost score that is missing for another reason keeps "Not yet available"; an error keeps "Could not be retrieved"', () => {
    expect(describePostureComponent('cost', { ...base, score: null, state: 'unavailable' }, SECURITY_STATUS_BADGE).missingText).toBe('Not yet available')
    expect(describePostureComponent('cost', { ...base, score: 0, ready: false, state: 'error' }, SECURITY_STATUS_BADGE).missingText).toBe('Could not be retrieved')
  })

  it('a real cost score is shown as before', () => {
    expect(describePostureComponent('cost', { ...base, score: 96, state: 'available' }, SECURITY_STATUS_BADGE)).toMatchObject({ score: 96, scoreText: '96', missingText: null })
  })
})
