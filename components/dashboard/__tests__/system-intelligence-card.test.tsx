/**
 * Infrastructure Posture card: Cost / Security / Alert Coverage breakdown of the
 * canonical System Intelligence result.
 *
 * The contract under test: labels are the Infrastructure Posture vocabulary
 * (Cost / Security / Alert Coverage), whatever the backend's component.label
 * says; alert coverage shows its percentage and scope, never a posture grade;
 * fill color comes only from the component's canonical `status`; each
 * component is gated on its OWN `ready` -- and `ready: false` still carries a
 * number (a neutral 50, a preliminary score, an error's 0), so nothing
 * score-derived may render for it. Demo mode hides the whole card.
 * Page placement/order lives in
 * app/(app)/dashboard/__tests__/system-intelligence-card-placement.test.tsx.
 */
import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SystemIntelligenceCard } from '../system-intelligence-card'
import { SECURITY_STATUS_BADGE } from '@/app/(app)/dashboard/securityHealthKpi'
import type { ObservabilityComponentScore, SystemIntelligenceComponentScore, SystemIntelligenceResult } from '@/lib/services/system-intelligence.service'

const component = (overrides: Partial<SystemIntelligenceComponentScore>): SystemIntelligenceComponentScore => ({
  score: 0, label: 'X', detail: '', severity: 'healthy', delta: null, status: 'good', ready: true, state: 'available', reason: null, ...overrides,
})

const observability = (overrides: Partial<ObservabilityComponentScore>): ObservabilityComponentScore => ({
  score: 0, label: 'Observability', detail: '', severity: 'healthy', delta: null, status: 'good', ready: true, state: 'available', reason: null, ...overrides,
})

// Deliberately different statuses per column. Security pairs a high score (82)
// with status 'risk': any color derived from the number would say "good", so a
// danger fill there proves color comes only from the canonical status.
const READY: SystemIntelligenceResult['components'] = {
  cost: component({ label: 'Cost Efficiency', score: 95, status: 'good' }),
  security: component({ label: 'Security Posture', score: 82, status: 'risk' }),
  observability: observability({ score: 55, status: 'warning' }),
}

function renderCard(overrides: Partial<ComponentProps<typeof SystemIntelligenceCard>> = {}) {
  return render(
    <SystemIntelligenceCard isDemoActive={false} components={READY} isLoading={false} statusBadge={SECURITY_STATUS_BADGE} {...overrides} />,
  )
}

const TILE_KEY: Record<string, string> = { Cost: 'cost', Security: 'security', 'Alert Coverage': 'observability' }
/** The tile whose label text is `label`. */
const column = (label: string) => screen.getByTestId(`posture-tile-${TILE_KEY[label]}`)
/** Opens the section's info panel and returns the evidence row for `label`. */
const evidenceRow = (label: string) => {
  if (!screen.queryByRole('dialog')) fireEvent.click(screen.getByRole('button', { name: 'Infrastructure Posture section details' }))
  return within(screen.getByRole('dialog')).getByTestId(`posture-evidence-${TILE_KEY[label]}`)
}
const barIn = (col: HTMLElement) => col.querySelector('[role="progressbar"]') as HTMLElement | null
const fillOf = (bar: HTMLElement) => bar.firstElementChild as HTMLElement

describe('ready components', () => {
  it('renders each label, score, and its own status word', () => {
    renderCard()
    const expected = [
      ['Cost', '95', 'Strong'],
      ['Security', '82', 'At risk'],
    ]
    for (const [label, score, word] of expected) {
      const col = column(label)
      expect(within(col).getByText(score)).toBeInTheDocument()
      expect(within(col).getByText(word)).toBeInTheDocument()
    }
  })

  it('alert coverage shows its percentage with no posture grade (no Strong / Needs attention / At risk)', () => {
    renderCard()
    const col = column('Alert Coverage')
    expect(within(col).getByText('55%')).toBeInTheDocument()
    for (const word of ['Strong', 'Needs attention', 'At risk']) {
      expect(within(col).queryByText(word)).not.toBeInTheDocument()
    }
  })

  it('status words are the existing SECURITY_STATUS_BADGE wording, not a new scheme', () => {
    expect(SECURITY_STATUS_BADGE.good.label).toBe('Strong')
    expect(SECURITY_STATUS_BADGE.warning.label).toBe('Needs attention')
    expect(SECURITY_STATUS_BADGE.risk.label).toBe('At risk')
  })

  it('each bar width follows its own score (Radix indicator offset = 100 - score)', () => {
    renderCard()
    expect(fillOf(barIn(column('Cost'))!).style.transform).toBe('translateX(-5%)')
    expect(fillOf(barIn(column('Security'))!).style.transform).toBe('translateX(-18%)')
    expect(fillOf(barIn(column('Alert Coverage'))!).style.transform).toBe('translateX(-45%)')
  })

  it('renders the three columns in cost → security → observability order', () => {
    const { container } = renderCard()
    const labels = [...container.querySelectorAll('[data-testid^="posture-tile-"]')].map((t) => t.querySelector('p')?.textContent)
    expect(labels).toEqual(['Cost', 'Security', 'Alert Coverage'])
  })
})

describe('labels are the Infrastructure Posture vocabulary', () => {
  it('backend labels (Cost Efficiency / Security Posture / Observability) are never shown as component names', () => {
    renderCard()
    for (const backendLabel of ['Cost Efficiency', 'Security Posture', 'Observability']) {
      expect(screen.queryByText(backendLabel)).not.toBeInTheDocument()
    }
    expect(barIn(column('Cost'))).toHaveAttribute('aria-label', 'Cost score')
    expect(barIn(column('Alert Coverage'))).toHaveAttribute('aria-label', 'Alert Coverage score')
  })

  it('the card is titled Infrastructure Posture and describes what the composite is built from', () => {
    renderCard()
    expect(screen.getByText('Infrastructure Posture')).toBeInTheDocument()
    expect(screen.getByText('Composite of cost (30%), security (40%), and alert coverage (30%)')).toBeInTheDocument()
    for (const oldName of ['Platform Efficiency Breakdown', 'Infrastructure Health', 'System Score']) {
      expect(screen.queryByText(oldName)).not.toBeInTheDocument()
    }
  })
})

describe('ready gating: each component independently', () => {
  it('ready:false with a real-looking score (50) renders only the placeholder -- no 50, no status word, no bar', () => {
    renderCard({ components: { ...READY, security: component({ label: 'Security Posture', score: 50, status: 'warning', ready: false }) } })
    const col = column('Security')
    expect(within(col).getByText('—')).toBeInTheDocument()
    expect(within(col).getByText('Not yet available')).toBeInTheDocument()
    expect(within(col).queryByText('50')).not.toBeInTheDocument()
    expect(within(col).queryByText('Needs attention')).not.toBeInTheDocument()
    expect(barIn(col)).toBeNull()
    // The other two columns are unaffected.
    expect(within(column('Cost')).getByText('95')).toBeInTheDocument()
    expect(barIn(column('Cost'))).not.toBeNull()
    expect(within(column('Alert Coverage')).getByText('55%')).toBeInTheDocument()
    expect(barIn(column('Alert Coverage'))).not.toBeNull()
  })

  it('ready:false with the error placeholder (score 0, status risk) is gated the same way', () => {
    renderCard({ components: { ...READY, cost: component({ label: 'Cost Efficiency', score: 0, status: 'risk', ready: false }) } })
    const col = column('Cost')
    expect(within(col).getByText('Not yet available')).toBeInTheDocument()
    expect(within(col).queryByText('0')).not.toBeInTheDocument()
    expect(within(col).queryByText('At risk')).not.toBeInTheDocument()
    expect(barIn(col)).toBeNull()
  })

  it('a ready score of 0 is a real score and is shown with its bar (readiness is never inferred from the number)', () => {
    renderCard({ components: { ...READY, observability: observability({ score: 0, status: 'risk', ready: true }) } })
    const col = column('Alert Coverage')
    expect(within(col).getByText('0%')).toBeInTheDocument()
    expect(barIn(col)).not.toBeNull()
  })

  it('all three not ready: the card still renders, with three placeholders and no bars', () => {
    const notReady = (label: string) => component({ label, score: 50, status: 'good', ready: false })
    const { container } = renderCard({ components: { cost: notReady('Cost Efficiency'), security: notReady('Security Posture'), observability: observability({ score: null, ready: false, state: 'unavailable' }) } })
    expect(screen.getByText('Infrastructure Posture')).toBeInTheDocument()
    expect(screen.getAllByText('Not yet available')).toHaveLength(3)
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
    expect(screen.queryByText('50')).not.toBeInTheDocument()
  })
})

describe('observability evidence state', () => {
  const PARTIAL_REASON = 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.'

  it('partial: the score is shown with a visible "Partial" label and the backend reason', () => {
    renderCard({ components: { ...READY, observability: observability({ score: 0, status: 'risk', state: 'partial', reason: PARTIAL_REASON }) } })
    const col = column('Alert Coverage')
    expect(within(col).getByText('0%')).toBeInTheDocument()
    expect(within(col).getByText('Partial')).toBeInTheDocument()
    // The reason is behind the info button, not a paragraph on the tile.
    expect(within(col).queryByText(PARTIAL_REASON)).not.toBeInTheDocument()
    expect(within(evidenceRow('Alert Coverage')).getByText(PARTIAL_REASON)).toBeInTheDocument()
    expect(barIn(col)).toHaveAttribute('aria-valuetext', '0% alert coverage, partial')
  })

  it('error: score null renders "Could not be retrieved" -- never 0 and no bar', () => {
    renderCard({ components: { ...READY, observability: observability({ score: null, ready: false, status: 'risk', state: 'error', reason: 'the connected AWS role could not be assumed' }) } })
    const col = column('Alert Coverage')
    expect(within(col).getByText('Could not be retrieved')).toBeInTheDocument()
    expect(within(col).queryByText('0')).not.toBeInTheDocument()
    expect(within(col).queryByText('0%')).not.toBeInTheDocument()
    expect(barIn(col)).toBeNull()
  })

  it('a null score is never rendered even if ready were true', () => {
    renderCard({ components: { ...READY, observability: observability({ score: null, ready: true, state: 'unavailable' }) } })
    const col = column('Alert Coverage')
    expect(within(col).getByText('Not yet available')).toBeInTheDocument()
    expect(barIn(col)).toBeNull()
  })

  it('available cost and security never show a partial label', () => {
    renderCard({ components: { ...READY, observability: observability({ score: 55, status: 'warning', state: 'partial', reason: PARTIAL_REASON }) } })
    expect(screen.getAllByText('Partial')).toHaveLength(1)
  })
})

describe('cost evidence state', () => {
  const COST_REASON = 'Insufficient spend data to assess cost efficiency. Spend based on inventory estimate, not AWS Cost Explorer billing. Anomaly checks not yet active.'
  const ALERT_REASON = 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered).'

  it('partial cost keeps its score and status word, and shows "Partial" with every one of its own reasons', () => {
    renderCard({ components: { ...READY, cost: component({ label: 'Cost Efficiency', score: 50, status: 'risk', state: 'partial', reason: COST_REASON }) } })
    const col = column('Cost')
    expect(within(col).getByText('50')).toBeInTheDocument()
    expect(within(col).getByText('At risk')).toBeInTheDocument()
    expect(within(col).getByText('Partial')).toBeInTheDocument()
    expect(barIn(col)).toHaveAttribute('aria-valuetext', '50 of 100, At risk, partial')
    const row = evidenceRow('Cost')
    expect(within(row).getByText(COST_REASON)).toBeInTheDocument()
    expect(within(row).getByText('50 · At risk')).toBeInTheDocument()
    expect(within(row).getByText('Partial')).toBeInTheDocument()
  })

  it('cost partiality is shown under Cost, never under Alert Coverage -- each column carries only its own reason', () => {
    renderCard({
      components: {
        ...READY,
        cost: component({ label: 'Cost Efficiency', score: 95, status: 'good', state: 'partial', reason: 'Anomaly checks not yet active.' }),
        observability: observability({ score: 0, status: 'risk', state: 'partial', reason: ALERT_REASON }),
      },
    })
    expect(within(column('Security')).queryByText('Partial')).not.toBeInTheDocument()
    expect(screen.getAllByText('Partial')).toHaveLength(2)
    const cost = evidenceRow('Cost')
    const alert = evidenceRow('Alert Coverage')
    expect(within(cost).getByText('Anomaly checks not yet active.')).toBeInTheDocument()
    expect(within(cost).queryByText(ALERT_REASON)).not.toBeInTheDocument()
    expect(within(alert).getByText(ALERT_REASON)).toBeInTheDocument()
    expect(within(alert).queryByText(/Anomaly checks/)).not.toBeInTheDocument()
    expect(within(evidenceRow('Security')).queryByText('Partial')).not.toBeInTheDocument()
  })

  it('a cost error renders "Could not be retrieved", not partial and not its 0', () => {
    renderCard({ components: { ...READY, cost: component({ label: 'Cost Efficiency', score: 0, status: 'risk', ready: false, state: 'error', reason: 'The cost score could not be computed.' }) } })
    const col = column('Cost')
    expect(within(col).getByText('Could not be retrieved')).toBeInTheDocument()
    expect(within(col).queryByText('Partial')).not.toBeInTheDocument()
    expect(barIn(col)).toBeNull()
  })
})

describe('demo mode', () => {
  it('the entire card is absent -- no heading, labels, bars, or values', () => {
    const { container } = renderCard({ isDemoActive: true })
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Infrastructure Posture')).not.toBeInTheDocument()
  })
})

describe('loading and unavailable', () => {
  it('loading: skeletons only, no labels, scores, or bars', () => {
    const { container } = renderCard({ isLoading: true })
    expect(screen.getByText('Infrastructure Posture')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('Cost')).not.toBeInTheDocument()
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
      ['Cost', 95, '95 of 100, Strong'],
      ['Security', 82, '82 of 100, At risk'],
      ['Alert Coverage', 55, '55% alert coverage'],
    ]
    for (const [label, score, text] of expected) {
      const bar = screen.getByRole('progressbar', { name: `${label} score` })
      expect(bar).toHaveAttribute('aria-valuenow', String(score))
      expect(bar).toHaveAttribute('aria-valuemin', '0')
      expect(bar).toHaveAttribute('aria-valuemax', '100')
      expect(bar).toHaveAttribute('aria-valuetext', text)
    }
  })
})

describe('coloring and track', () => {
  it('fill color comes from status only: good → --fill-success, warning → --fill-warning, risk → --fill-danger', () => {
    renderCard()
    const fill = (label: string) => fillOf(barIn(column(label))!).className
    expect(fill('Cost')).toContain('bg-[color:var(--fill-success)]')
    expect(fill('Security')).toContain('bg-[color:var(--fill-danger)]') // score 82, status risk
    expect(fill('Alert Coverage')).toContain('bg-[color:var(--fill-warning)]')
    for (const label of ['Cost', 'Security', 'Alert Coverage']) {
      expect(fill(label)).not.toContain('bg-primary') // the primitive's default fill is overridden
    }
  })

  it('the track uses var(--border) at ~6px (h-1.5), replacing the primitive defaults', () => {
    renderCard()
    const bar = barIn(column('Cost'))!
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
    const grid = container.querySelector('[data-testid="posture-tile-cost"]')!.parentElement as HTMLElement
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('sm:grid-cols-3')
    expect(grid.children).toHaveLength(3)
  })
})
