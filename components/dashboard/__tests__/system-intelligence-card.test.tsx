/**
 * Platform Efficiency Breakdown card: Cost / Security / Observability breakdown of the
 * canonical System Intelligence result.
 *
 * The contract under test: labels are the backend's component.label verbatim;
 * fill color comes only from the component's canonical `status`; each
 * component is gated on its OWN `ready` -- and `ready: false` still carries a
 * number (a neutral 50, a preliminary score, an error's 0), so nothing
 * score-derived may render for it. Demo mode hides the whole card.
 * Page placement/order lives in
 * app/(app)/dashboard/__tests__/system-intelligence-card-placement.test.tsx.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SystemIntelligenceCard } from '../system-intelligence-card'
import { SECURITY_STATUS_BADGE } from '@/app/(app)/dashboard/securityHealthKpi'
import type { SystemIntelligenceComponentScore, SystemIntelligenceResult } from '@/lib/services/system-intelligence.service'

const component = (overrides: Partial<SystemIntelligenceComponentScore>): SystemIntelligenceComponentScore => ({
  score: 0, label: 'X', detail: '', severity: 'healthy', delta: null, status: 'good', ready: true, ...overrides,
})

// Deliberately different statuses per column. Security pairs a high score (82)
// with status 'risk': any color derived from the number would say "good", so a
// danger fill there proves color comes only from the canonical status.
const READY: SystemIntelligenceResult['components'] = {
  cost: component({ label: 'Cost Efficiency', score: 95, status: 'good' }),
  security: component({ label: 'Security Posture', score: 82, status: 'risk' }),
  observability: component({ label: 'Observability', score: 55, status: 'warning' }),
}

function renderCard(overrides: Partial<ComponentProps<typeof SystemIntelligenceCard>> = {}) {
  return render(
    <SystemIntelligenceCard isDemoActive={false} components={READY} isLoading={false} statusBadge={SECURITY_STATUS_BADGE} {...overrides} />,
  )
}

/** The column whose label text is `label`. */
const column = (label: string) => screen.getByText(label).parentElement as HTMLElement
const barIn = (col: HTMLElement) => col.querySelector('[role="progressbar"]') as HTMLElement | null
const fillOf = (bar: HTMLElement) => bar.firstElementChild as HTMLElement

describe('ready components', () => {
  it('renders each label, score, and its own status word', () => {
    renderCard()
    const expected = [
      ['Cost Efficiency', '95', 'Strong'],
      ['Security Posture', '82', 'At risk'],
      ['Observability', '55', 'Needs attention'],
    ]
    for (const [label, score, word] of expected) {
      const col = column(label)
      expect(within(col).getByText(score)).toBeInTheDocument()
      expect(within(col).getByText(word)).toBeInTheDocument()
    }
  })

  it('status words are the existing SECURITY_STATUS_BADGE wording, not a new scheme', () => {
    expect(SECURITY_STATUS_BADGE.good.label).toBe('Strong')
    expect(SECURITY_STATUS_BADGE.warning.label).toBe('Needs attention')
    expect(SECURITY_STATUS_BADGE.risk.label).toBe('At risk')
  })

  it('each bar width follows its own score (Radix indicator offset = 100 - score)', () => {
    renderCard()
    expect(fillOf(barIn(column('Cost Efficiency'))!).style.transform).toBe('translateX(-5%)')
    expect(fillOf(barIn(column('Security Posture'))!).style.transform).toBe('translateX(-18%)')
    expect(fillOf(barIn(column('Observability'))!).style.transform).toBe('translateX(-45%)')
  })

  it('renders the three columns in cost → security → observability order', () => {
    const { container } = renderCard()
    const labels = [...container.querySelectorAll('.grid > div > p:first-child')].map((p) => p.textContent)
    expect(labels).toEqual(['Cost Efficiency', 'Security Posture', 'Observability'])
  })
})

describe('labels are rendered verbatim from component.label', () => {
  it('an altered backend label is shown exactly, with no hardcoded replacement', () => {
    renderCard({ components: { ...READY, cost: { ...READY.cost, label: 'Custom Cost Efficiency' } } })
    expect(screen.getByText('Custom Cost Efficiency')).toBeInTheDocument()
    expect(screen.queryByText('Cost Efficiency')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Cost$/)).not.toBeInTheDocument()
    expect(barIn(column('Custom Cost Efficiency'))).toHaveAttribute('aria-label', 'Custom Cost Efficiency score')
  })
})

describe('ready gating: each component independently', () => {
  it('ready:false with a real-looking score (50) renders only the placeholder -- no 50, no status word, no bar', () => {
    renderCard({ components: { ...READY, security: component({ label: 'Security Posture', score: 50, status: 'warning', ready: false }) } })
    const col = column('Security Posture')
    expect(within(col).getByText('—')).toBeInTheDocument()
    expect(within(col).getByText('Not yet available')).toBeInTheDocument()
    expect(within(col).queryByText('50')).not.toBeInTheDocument()
    expect(within(col).queryByText('Needs attention')).not.toBeInTheDocument()
    expect(barIn(col)).toBeNull()
    // The other two columns are unaffected.
    expect(within(column('Cost Efficiency')).getByText('95')).toBeInTheDocument()
    expect(barIn(column('Cost Efficiency'))).not.toBeNull()
    expect(within(column('Observability')).getByText('55')).toBeInTheDocument()
    expect(barIn(column('Observability'))).not.toBeNull()
  })

  it('ready:false with the error placeholder (score 0, status risk) is gated the same way', () => {
    renderCard({ components: { ...READY, cost: component({ label: 'Cost Efficiency', score: 0, status: 'risk', ready: false }) } })
    const col = column('Cost Efficiency')
    expect(within(col).getByText('Not yet available')).toBeInTheDocument()
    expect(within(col).queryByText('0')).not.toBeInTheDocument()
    expect(within(col).queryByText('At risk')).not.toBeInTheDocument()
    expect(barIn(col)).toBeNull()
  })

  it('a ready score of 0 is a real score and is shown with its bar (readiness is never inferred from the number)', () => {
    renderCard({ components: { ...READY, observability: component({ label: 'Observability', score: 0, status: 'risk', ready: true }) } })
    const col = column('Observability')
    expect(within(col).getByText('0')).toBeInTheDocument()
    expect(within(col).getByText('At risk')).toBeInTheDocument()
    expect(barIn(col)).not.toBeNull()
  })

  it('all three not ready: the card still renders, with three placeholders and no bars', () => {
    const notReady = (label: string) => component({ label, score: 50, status: 'good', ready: false })
    const { container } = renderCard({ components: { cost: notReady('Cost Efficiency'), security: notReady('Security Posture'), observability: notReady('Observability') } })
    expect(screen.getByText('Platform Efficiency Breakdown')).toBeInTheDocument()
    expect(screen.getAllByText('Not yet available')).toHaveLength(3)
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
    expect(screen.queryByText('50')).not.toBeInTheDocument()
  })
})

describe('demo mode', () => {
  it('the entire card is absent -- no heading, labels, bars, or values', () => {
    const { container } = renderCard({ isDemoActive: true })
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Platform Efficiency Breakdown')).not.toBeInTheDocument()
  })
})

describe('loading and unavailable', () => {
  it('loading: skeletons only, no labels, scores, or bars', () => {
    const { container } = renderCard({ isLoading: true })
    expect(screen.getByText('Platform Efficiency Breakdown')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('Cost Efficiency')).not.toBeInTheDocument()
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
  })

  it('loaded with no data (failed request): a neutral "Unavailable" line, never invented labels or scores', () => {
    const { container } = renderCard({ components: undefined })
    expect(screen.getByText('— · Unavailable')).toBeInTheDocument()
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
  })
})

describe('accessibility', () => {
  it('every ready bar carries label, value range, and a text value including the status word', () => {
    renderCard()
    const expected: [string, number, string][] = [
      ['Cost Efficiency', 95, 'Strong'],
      ['Security Posture', 82, 'At risk'],
      ['Observability', 55, 'Needs attention'],
    ]
    for (const [label, score, word] of expected) {
      const bar = screen.getByRole('progressbar', { name: `${label} score` })
      expect(bar).toHaveAttribute('aria-valuenow', String(score))
      expect(bar).toHaveAttribute('aria-valuemin', '0')
      expect(bar).toHaveAttribute('aria-valuemax', '100')
      expect(bar).toHaveAttribute('aria-valuetext', `${score} of 100, ${word}`)
    }
  })
})

describe('coloring and track', () => {
  it('fill color comes from status only: good → --fill-success, warning → --fill-warning, risk → --fill-danger', () => {
    renderCard()
    const fill = (label: string) => fillOf(barIn(column(label))!).className
    expect(fill('Cost Efficiency')).toContain('bg-[color:var(--fill-success)]')
    expect(fill('Security Posture')).toContain('bg-[color:var(--fill-danger)]') // score 82, status risk
    expect(fill('Observability')).toContain('bg-[color:var(--fill-warning)]')
    for (const label of ['Cost Efficiency', 'Security Posture', 'Observability']) {
      expect(fill(label)).not.toContain('bg-primary') // the primitive's default fill is overridden
    }
  })

  it('the track uses var(--border) at ~6px (h-1.5), replacing the primitive defaults', () => {
    renderCard()
    const bar = barIn(column('Cost Efficiency'))!
    expect(bar.className).toContain('bg-[color:var(--border)]')
    expect(bar.className).toContain('h-1.5')
    expect(bar.className).not.toContain('bg-secondary')
    expect(bar.className).not.toContain('h-4')
    expect(bar.className).not.toContain('surface-1')
  })
})

describe('responsive structure', () => {
  it('one column on mobile, three from the sm breakpoint up', () => {
    const { container } = renderCard()
    const grid = container.querySelector('.grid') as HTMLElement
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('sm:grid-cols-3')
    expect(grid.children).toHaveLength(3)
  })
})
