/**
 * Display vocabulary for the System Intelligence composite. Presentation only:
 * these helpers map the backend's existing status/score/partial fields to
 * words, and never compute a score, threshold, or state.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  costComponentCaption,
  INFRASTRUCTURE_POSTURE_LABEL,
  POSTURE_COMPONENT_LABELS,
  POSTURE_STATUS_LABELS,
  postureCompositionCaption,
  posturePartialCaption,
  postureStatusLabel,
} from '../infrastructure-posture'
import type { SystemIntelligenceResult } from '../services/system-intelligence.service'
import { SECURITY_STATUS_BADGE } from '@/app/(app)/dashboard/securityHealthKpi'

const component = (score: number) => ({ score, label: 'x', detail: '', severity: 'medium' as const, delta: null, status: 'warning' as const, ready: true, state: 'available' as const, reason: null })
const components = (obs: Partial<SystemIntelligenceResult['components']['observability']> = {}): SystemIntelligenceResult['components'] => ({
  cost: component(96),
  security: component(57),
  observability: { ...component(0), state: 'partial', reason: 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered).', ...obs },
})

describe('names', () => {
  it('the composite is "Infrastructure Posture" with Cost / Security / Alert Coverage components', () => {
    expect(INFRASTRUCTURE_POSTURE_LABEL).toBe('Infrastructure Posture')
    expect(POSTURE_COMPONENT_LABELS).toEqual({ cost: 'Cost', security: 'Security', observability: 'Alert Coverage' })
  })
})

describe('postureStatusLabel -- display words for the existing canonical status', () => {
  it.each([
    ['Healthy', 'Strong'],
    ['Stable', 'Stable'],
    ['Degraded', 'Needs attention'],
    ['At Risk', 'Weak'],
  ])('%s -> %s', (status, label) => {
    expect(postureStatusLabel(status)).toBe(label)
  })

  it('the four existing tiers keep four distinct labels, top to bottom: Strong, Stable, Needs attention, Weak', () => {
    const labels = ['Healthy', 'Stable', 'Degraded', 'At Risk'].map(postureStatusLabel)
    expect(labels).toEqual(['Strong', 'Stable', 'Needs attention', 'Weak'])
    expect(new Set(labels).size).toBe(4)
    expect(Object.keys(POSTURE_STATUS_LABELS)).toHaveLength(4)
  })

  it('does not change the unrelated Security Posture "At risk" badge', () => {
    expect(SECURITY_STATUS_BADGE.risk.label).toBe('At risk')
  })

  it('Pending, null, and unknown values have no label (no state is invented)', () => {
    expect(postureStatusLabel('Pending')).toBeNull()
    expect(postureStatusLabel(null)).toBeNull()
    expect(postureStatusLabel(undefined)).toBeNull()
    expect(postureStatusLabel('good')).toBeNull()
  })

  it('never uses a health word', () => {
    for (const s of ['Healthy', 'Stable', 'Degraded', 'At Risk']) {
      expect(postureStatusLabel(s)).not.toMatch(/health|degraded/i)
    }
  })

  it('maps words only: no score thresholds live in this module', () => {
    // Comments may quote the backend's thresholds; code may not apply any.
    const code = readFileSync(join(__dirname, '../infrastructure-posture.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/>=\s*\d|<=\s*\d|[<>]\s*\d{2}/)
  })
})

describe('postureCompositionCaption', () => {
  it('uses the runtime component scores', () => {
    expect(postureCompositionCaption(components())).toBe('Composite · Cost 96 · Security 57 · Alert coverage 0')
  })

  it('is null when any component has no score, or there are no components', () => {
    expect(postureCompositionCaption(components({ score: null }))).toBeNull()
    expect(postureCompositionCaption(undefined)).toBeNull()
  })
})

describe('posturePartialCaption', () => {
  const ALERT = 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered).'
  const base = { composite_state: 'partial' as const, composite_reason: `Alert Coverage: ${ALERT}`, components: components() }

  it('shows the backend composite reason as-is', () => {
    expect(posturePartialCaption(base)).toBe(`Partial · Alert Coverage: ${ALERT}`)
  })

  it('a cost limitation is not attributed to Alert Coverage, even while Alert Coverage is also partial', () => {
    const reason = `Cost: Anomaly checks not yet active. Alert Coverage: ${ALERT}`
    const caption = posturePartialCaption({ ...base, composite_reason: reason })
    expect(caption).toBe(`Partial · ${reason}`)
    expect(caption).toContain('Cost: Anomaly checks not yet active.')
  })

  it('falls back to a generic reason when the backend gave none', () => {
    expect(posturePartialCaption({ ...base, composite_reason: null })).toBe('Partial · built on incomplete evidence')
  })

  it('is null unless the backend marked the composite partial', () => {
    expect(posturePartialCaption({ ...base, composite_state: 'available' })).toBeNull()
    expect(posturePartialCaption({ ...base, composite_state: null })).toBeNull()
    expect(posturePartialCaption(null)).toBeNull()
  })
})

describe('costComponentCaption: the Cost tile\'s one caption, from costSource and the backend\'s fixed limitation sentences', () => {
  const ESTIMATED_REASON = 'Based on monthly run-rate estimate from resource inventory. Anomaly checks not yet active.'

  it('run-rate estimate + anomaly checks off', () => {
    expect(costComponentCaption({ costSource: 'estimated', reason: ESTIMATED_REASON })).toBe('Monthly run-rate estimate · anomaly checks not yet active')
  })

  it('actual spend is labeled as Cost Explorer-based, never as an estimate', () => {
    expect(costComponentCaption({ costSource: 'actual', reason: 'Anomaly checks not yet active.' })).toBe('Based on AWS Cost Explorer spend · anomaly checks not yet active')
  })

  it('insufficient spend data is carried; unknown sentences are never put on the face', () => {
    expect(costComponentCaption({ costSource: undefined, reason: 'Insufficient spend data to assess cost efficiency. Anomaly checks not yet active.' })).toBe('Insufficient spend data · anomaly checks not yet active')
    expect(costComponentCaption({ costSource: undefined, reason: 'Some new limitation the backend adds later.' })).toBeNull()
    // Whole sentences only: a mention inside another sentence is not a match.
    expect(costComponentCaption({ costSource: undefined, reason: 'Something else. Anomaly checks not yet active.' })).toBe('Anomaly checks not yet active')
    expect(costComponentCaption({ costSource: undefined, reason: 'Note: Anomaly checks not yet active.' })).toBeNull()
    expect(costComponentCaption({ costSource: undefined, reason: 'Anomaly checks not yet active soon.' })).toBeNull()
  })

  it('nothing known: null, never a fabricated caption', () => {
    expect(costComponentCaption(undefined)).toBeNull()
    expect(costComponentCaption({ costSource: undefined, reason: null })).toBeNull()
  })
})
