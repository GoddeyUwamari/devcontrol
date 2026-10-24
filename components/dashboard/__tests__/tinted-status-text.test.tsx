/**
 * Status text on a status tint (typography plan T1): wherever the Dashboard puts success, warning or
 * danger text on its own --bg-* tint, the text is the -strong ink (green-800, amber-800, red-800), which
 * keeps 4.5:1 on those tints; the base --text-* colours stay for text on white. The tint itself, and the
 * colour keys callers pass, are unchanged.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import postcss from 'postcss'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { contrast } from '@/app/__tests__/contrast'
import { EvidenceBadge, toneBackground, toneText } from '../evidence-badge'
import { SecurityComplianceSummary } from '../security-compliance-summary'
import { SavingsOpportunities } from '../savings-opportunities'
import { InfrastructureIntelligence } from '../infrastructure-intelligence'
import { DashboardHero } from '../dashboard-hero'

const STRONG = {
  success: 'var(--app-color-ink-success-strong)',
  warning: 'var(--app-color-ink-warning-strong)',
  danger: 'var(--app-color-ink-danger-strong)',
}

describe('toneText', () => {
  it('maps each status colour to its -strong ink, and leaves every other colour as it is', () => {
    expect(toneText('var(--text-success)')).toBe(STRONG.success)
    expect(toneText('var(--text-warning)')).toBe(STRONG.warning)
    expect(toneText('var(--text-danger)')).toBe(STRONG.danger)
    for (const other of ['var(--text-accent)', 'var(--text-secondary)', '#1D4ED8']) expect(toneText(other)).toBe(other)
  })

  it('each -strong ink meets 4.5:1 on its own tint and on the page and card surfaces', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
    const rootStart = css.indexOf(':root {\n  --surface-1')
    const root = Object.fromEntries([...css.slice(rootStart, css.indexOf('}', rootStart)).matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]))
    const palette: Record<string, string> = {}
    postcss
      .parse(readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8'))
      .walkDecls(/^--color-[a-z]+-\d+$/, (decl) => void (palette[decl.prop.slice('--color-'.length)] = decl.value))
    for (const tone of ['success', 'warning', 'danger'] as const) {
      const m = css.match(new RegExp(`--app-color-ink-${tone}-strong: var\\(--color-([a-z]+-\\d+)\\);`))
      expect(m, tone).not.toBeNull()
      const fg = palette[m![1]]
      for (const bg of [`--bg-${tone}`, '--surface-1', '--surface-2']) {
        expect(contrast(fg, root[bg]), `${tone}-strong on ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('the tinted Dashboard sites use the -strong ink', () => {
  it.each([
    ['var(--text-success)', 'var(--bg-success)', STRONG.success],
    ['var(--text-warning)', 'var(--bg-warning)', STRONG.warning],
    ['var(--text-danger)', 'var(--bg-danger)', STRONG.danger],
  ])('EvidenceBadge %s: -strong text on the same tint', (color, background, text) => {
    render(<EvidenceBadge label="Chip" color={color} testId="chip" />)
    const chip = screen.getByTestId('chip')
    expect(chip.style.color).toBe(text)
    expect(chip.style.background).toBe(background)
    expect(toneBackground(color)).toBe(background)
  })

  it('EvidenceBadge: a neutral chip keeps its colour', () => {
    render(<EvidenceBadge label="Partial" color="var(--text-secondary)" testId="chip" />)
    expect(screen.getByTestId('chip').style.color).toBe('var(--text-secondary)')
  })

  it('Security Key Findings: the critical, high and medium chips', () => {
    render(
      <SecurityComplianceSummary
        findingCounts={{ critical: 1, high: 2, medium: 3, low: 4 }}
        riskDataLoading={false}
        resourceComplianceStatus="Not yet evaluated"
        soc2Subtext="0 of 6 criteria evaluated"
        soc2Loading={false}
        customFrameworksSubtext="No custom frameworks yet"
        customFrameworksLoading={false}
      />
    )
    const chip = (label: string) => screen.getAllByText(label).find((n) => n.tagName === 'SPAN') as HTMLElement
    expect(chip('Critical').style.color).toBe(STRONG.danger)
    expect(chip('High').style.color).toBe(STRONG.warning)
    expect(chip('Medium').style.color).toBe(STRONG.warning)
    expect(chip('Low').style.color).toBe('var(--text-secondary)')
  })

  it('Cost-Saving Opportunities: the priority chip', () => {
    render(
      <SavingsOpportunities
        items={[{ type: 'EBS', title: 'Optimize EBS volumes', description: 'Unattached volumes', count: 1, savingsLabel: '$1.00/mo', priorityBadge: { label: 'Medium priority', color: 'var(--text-warning)', background: 'var(--bg-warning)' } }]}
        evaluationState="evaluated"
        totalActiveCount={1}
      />
    )
    const chip = screen.getByText('Medium priority')
    expect(chip.style.color).toBe(STRONG.warning)
    expect(chip.style.background).toBe('var(--bg-warning)')
  })

  it.each([
    ['critical', STRONG.danger],
    ['medium', STRONG.warning],
  ])('Top Risk (%s): the title on the tinted card', (severity, text) => {
    render(<InfrastructureIntelligence topRisk={`Some finding (${severity} severity)`} topRiskStatus="identified" aiSummaryLoading={false} systemStatus={{ value: 'Operational', caption: 'x', operational: true, color: 'var(--text-success)', dotColor: 'green' } as never} />)
    const card = screen.getByTestId('top-risk-card')
    expect(within(card).getByText('Top Risk').style.color).toBe(text)
  })

  it('the connected AWS pill', () => {
    render(<DashboardHero awsConnection="connected" canConnectAws orgName="Org" lastSynced={null} />)
    const aws = screen.getByTestId('provider-pill-aws')
    expect(aws.style.color).toBe(STRONG.success)
    expect(aws.style.background).toBe('var(--bg-success)')
  })
})
