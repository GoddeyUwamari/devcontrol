/**
 * Dashboard navigation/interaction consistency: every chevron or arrow that
 * implies navigation belongs to a real link to an existing page, and elements
 * with no truthful destination render no navigation affordance at all.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// vi.hoisted: vi.mock factories are hoisted above plain top-level consts.
const { push, toastInfo } = vi.hoisted(() => ({ push: vi.fn(), toastInfo: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { info: toastInfo } }))

import { SecurityComplianceSummary } from '../security-compliance-summary'
import { DashboardHero } from '../dashboard-hero'
import { EngineeringHealthCard } from '../engineering-health-card'
import { InfrastructureIntelligence } from '../infrastructure-intelligence'
import { CostBreakdownBarList } from '../cost-breakdown-barlist'

const chevronsIn = (el: Element) => el.querySelectorAll('svg.lucide-chevron-right')

describe('Security Key Findings', () => {
  const renderSummary = () =>
    render(
      <SecurityComplianceSummary
        findingCounts={{ critical: 1, high: 2, medium: 3, low: 4 }}
        riskDataLoading={false}
        complianceBreakdown="9 critical"
        soc2Subtext="6 of 6 criteria evaluated"
        soc2Loading={false}
        customFrameworksSubtext="1 framework configured"
        customFrameworksLoading={false}
      />
    )

  it('"View all" goes to the findings section, not the top of /security', () => {
    renderSummary()
    expect(screen.getByText('View all →').closest('a')!.getAttribute('href')).toBe('/security#findings')
  })

  it('every severity row links to /security#findings and shows a chevron', () => {
    renderSummary()
    for (const text of ['1 critical finding', '2 high findings', '3 medium findings', '4 low findings']) {
      const link = screen.getByText(text).closest('a')
      expect(link, text).not.toBeNull()
      expect(link!.getAttribute('href')).toBe('/security#findings')
      expect(chevronsIn(link!)).toHaveLength(1)
    }
  })

  it('SOC 2 readiness links to /compliance/frameworks/soc2', () => {
    renderSummary()
    expect(screen.getByText('SOC 2 readiness').closest('a')!.getAttribute('href')).toBe('/compliance/frameworks/soc2')
  })

  it('Custom frameworks links to /compliance/frameworks', () => {
    renderSummary()
    expect(screen.getByText('Custom frameworks').closest('a')!.getAttribute('href')).toBe('/compliance/frameworks')
  })

  it('Resource compliance has no link and no chevron (no page exposes per-resource compliance issues)', () => {
    renderSummary()
    const headline = screen.getByText('Resource compliance')
    expect(headline.closest('a')).toBeNull()
    const row = headline.closest('div.flex')!
    expect(chevronsIn(row)).toHaveLength(0)
  })

  it('keeps one divider per row: linked rows carry it on the <a>, not on the inner div', () => {
    renderSummary()
    const link = screen.getByText('SOC 2 readiness').closest('a')!
    expect(link.className).toMatch(/border-b border-border last:border-b-0/)
    expect((link.firstElementChild as HTMLElement).className).not.toMatch(/border-b/)
    const plainRow = screen.getByText('Resource compliance').closest('div.flex')!
    expect(plainRow.className).toMatch(/border-b border-border last:border-b-0/)
  })
})

describe('AWS Account Connected pill', () => {
  it('is a status indicator with no chevron and no link', () => {
    render(<DashboardHero isAwsConnected orgName="Org" lastSynced={null} />)
    const pill = screen.getByText('AWS Account Connected')
    expect(pill.closest('a')).toBeNull()
    expect(chevronsIn(pill.parentElement!)).toHaveLength(0)
  })
})

describe('Engineering Health', () => {
  it('uses the text arrow "→" like the other dashboard text links, not an ArrowRight icon', () => {
    const { container } = render(<EngineeringHealthCard isDemoActive={false} doraRows={[]} />)
    expect(screen.getByText('View details →').closest('a')!.getAttribute('href')).toBe('/app/dora-metrics')
    expect(screen.getByText('Connect CI/CD →').closest('a')!.getAttribute('href')).toBe('/deployments')
    expect(container.querySelectorAll('svg.lucide-arrow-right')).toHaveLength(0)
  })
})

describe('System Status arrow', () => {
  it('is a 14px ArrowRight, matching the KPI card arrows', () => {
    render(
      <InfrastructureIntelligence
        topRisk={null}
        aiSummaryLoading={false}
        systemStatus={{ label: 'All systems operational', color: 'green', background: 'white', dotColor: 'green' }}
        isLive
      />
    )
    const card = screen.getByText('System Status').closest('a')!
    const arrows = card.querySelectorAll('svg.lucide-arrow-right')
    expect(arrows).toHaveLength(1)
    expect(arrows[0].getAttribute('width')).toBe('14')
    expect(chevronsIn(card)).toHaveLength(0)
  })
})

describe('Demo cost breakdown', () => {
  it('category rows are plain content: not buttons, no chevron, and clicking them neither navigates nor toasts', () => {
    const { container } = render(
      <CostBreakdownBarList
        data={[
          { name: 'Compute (EC2, Lambda, ECS)', value: 600, change: 5, color: '#7C3AED' },
          { name: 'Storage (S3, EBS)', value: 400, change: -3, color: '#059669' },
        ]}
        totalCost={1000}
      />
    )
    // The name appears in both the bar list and the detailed rows -- check every occurrence.
    const occurrences = screen.getAllByText('Compute (EC2, Lambda, ECS)')
    for (const el of occurrences) {
      expect(el.closest('button')).toBeNull()
      expect(el.closest('a')).toBeNull()
      fireEvent.click(el)
    }
    expect(push).not.toHaveBeenCalled()
    expect(toastInfo).not.toHaveBeenCalled()
    expect(chevronsIn(container)).toHaveLength(0)
    expect(screen.queryByText(/Click any category/)).toBeNull()
  })
})
