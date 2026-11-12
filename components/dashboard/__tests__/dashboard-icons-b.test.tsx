/**
 * PR-ICONS-b (dashboard-step1.md §D, mock §2, §7, §8): the Dashboard's status
 * icons, the heavier outline stroke, the weekly-email savings header and the
 * data freshness block. Synthetic data only.
 *
 * - Top Risk: error for critical/high, warning for medium, none for low.
 * - DevControl service status: success / warning / error, and a neutral dashed
 *   circle (not a status) while checking. Wording unchanged.
 * - Status tiers on the KPI badges use StatusLabel, never a trend arrow; a real
 *   trend keeps its arrow.
 * - One shared stroke width for the Dashboard's outline category and
 *   navigation icons, and nowhere outside the Dashboard.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { DollarSign } from 'lucide-react'
import {
  InfrastructureIntelligence,
  SERVICE_STATUS_KIND,
  TOP_RISK_STATUS_KIND,
  type ServiceStatusState,
} from '../infrastructure-intelligence'
import { EvidenceBadge, toneStatusKind } from '../evidence-badge'
import { EstimatedSavingsSummary } from '../executive-roi-card'
import { SavingsOpportunities } from '../savings-opportunities'
import { CardArrowLink } from '../card-arrow-link'
import { EvidenceInfo } from '../evidence-info'
import { DashboardMetricCard } from '../dashboard-metric-card'
import { DASHBOARD_ICON_STROKE } from '../icon-stroke'
import { serviceStatusView, SERVICE_STATUS_COPY } from '@/app/(app)/dashboard/dashboardFreshness'
import { estimatedSavingsHeadline, noEstimateHeadline, unestimatedFindingsLine } from '@/lib/savings-basis'

const ROOT = path.resolve(__dirname, '../../..')
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8')

// ── 1a. Top Risk ──

const OPERATIONAL = { value: 'Operational', caption: 'c', operational: true, color: 'var(--text-success)', state: 'operational' as const }
function renderRow(overrides: Partial<ComponentProps<typeof InfrastructureIntelligence>> = {}) {
  return render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={OPERATIONAL} {...overrides} />)
}
const topRiskCard = () => screen.getByTestId('top-risk-card')

describe('Top Risk: filled status icon by severity (mock §8)', () => {
  it('the mapping: error for critical/high, warning for medium, none for low', () => {
    expect(TOP_RISK_STATUS_KIND).toEqual({ critical: 'error', high: 'error', medium: 'warning', low: null })
  })

  it.each([
    ['critical', 'error', 'alert-circle', 'Critical'],
    ['high', 'error', 'alert-circle', 'High'],
    ['medium', 'warning', 'alert-triangle', 'Medium'],
  ])('%s → filled %s icon, aria-hidden; the title and chip text are unchanged', (severity, kind, glyph, chip) => {
    renderRow({ topRisk: `Open SSH to the internet (${severity} severity)`, topRiskStatus: 'identified' })
    const icon = within(topRiskCard()).getByTestId('top-risk-icon')
    expect(icon.getAttribute('data-status-kind')).toBe(kind)
    expect(icon.getAttribute('data-glyph')).toBe(glyph)
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(icon.getAttribute('width')).toBe('20')
    // The card is tinted (--bg-danger / --bg-warning): the on-tint fill (ruling 1).
    expect(icon.getAttribute('data-on-tint')).toBe('true')
    if (kind === 'warning') expect(icon.getAttribute('class')).toContain('fill-[var(--app-color-ink-warning-strong)]')
    else expect(icon.style.fill).toBe('var(--fill-danger)')
    expect(topRiskCard().querySelector('.lucide-triangle-alert, .lucide-alert-triangle')).toBeNull()
    expect(within(topRiskCard()).getByText('Open SSH to the internet')).toBeInTheDocument()
    expect(within(topRiskCard()).getByTestId('top-risk-severity')).toHaveTextContent(chip)
    expect(topRiskCard().getAttribute('data-severity')).toBe(severity)
  })

  it('low → no status icon at all; title and chip unchanged', () => {
    renderRow({ topRisk: 'Unused role (low severity)', topRiskStatus: 'identified' })
    expect(within(topRiskCard()).queryByTestId('top-risk-icon')).toBeNull()
    expect(topRiskCard().querySelector('[data-status-kind]')).toBeNull()
    expect(topRiskCard().querySelector('.lucide-triangle-alert, .lucide-alert-triangle')).toBeNull()
    expect(within(topRiskCard()).getByText('Unused role')).toBeInTheDocument()
    expect(within(topRiskCard()).getByTestId('top-risk-severity')).toHaveTextContent('Low')
  })

  it.each([
    ['none_identified', null, 'No urgent risks identified'],
    ['unavailable', null, 'Risk status unavailable'],
  ] as const)('no severity (%s): no filled status icon; the existing neutral outline icon and text are unchanged', (status, topRisk, text) => {
    renderRow({ topRisk, topRiskStatus: status })
    expect(topRiskCard().querySelector('[data-status-kind]')).toBeNull()
    expect(topRiskCard().querySelector('svg.lucide')).not.toBeNull()
    expect(within(topRiskCard()).getByText(text)).toBeInTheDocument()
  })
})

// ── 1b. DevControl service status ──

const NOW = Date.parse('2026-11-13T01:37:00Z')
const VIEW = {
  operational: serviceStatusView({ status: 'operational', lastUpdate: '2026-11-13T01:37:00.000Z' }, NOW),
  degraded: serviceStatusView({ status: 'degraded', lastUpdate: '' }, NOW),
  unavailable: serviceStatusView({ status: 'disrupted', lastUpdate: '' }, NOW),
  checking: serviceStatusView(undefined, NOW),
}
const renderService = (state: ServiceStatusState) => {
  const v = VIEW[state]
  renderRow({ systemStatus: { value: v.value, caption: v.caption, operational: v.state === 'operational', color: v.color, state: v.state } })
  return screen.getByTestId('system-health-card')
}

describe('DevControl service status: filled status icon per state (mock §2)', () => {
  it('the mapping: success / warning / error, and no status while checking', () => {
    expect(SERVICE_STATUS_KIND).toEqual({ operational: 'success', degraded: 'warning', unavailable: 'error', checking: null })
  })

  it.each([
    ['operational', 'success', 'circle-check', 'Operational'],
    ['degraded', 'warning', 'alert-triangle', 'Degraded'],
    ['unavailable', 'error', 'alert-circle', 'Unavailable'],
  ] as const)('%s → filled %s icon on the card and in the pill; the wording is unchanged', (state, kind, glyph, value) => {
    const card = renderService(state)
    const icon = within(card).getByTestId('system-health-icon')
    expect(icon.getAttribute('data-status-kind')).toBe(kind)
    expect(icon.getAttribute('data-glyph')).toBe(glyph)
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    // Only Operational tints the card; Degraded's warning icon sits on --surface-2 with its own fill.
    expect(icon.getAttribute('data-on-tint')).toBe(state === 'operational' ? 'true' : null)
    if (state === 'degraded') expect(icon.style.fill).toBe('var(--fill-warning)')
    const pill = within(card).getByTestId('system-health-status')
    expect(pill.textContent).toBe(value)
    const pillIcon = pill.querySelector('svg')!
    expect(pillIcon.getAttribute('data-status-kind')).toBe(kind)
    expect(pillIcon.getAttribute('aria-hidden')).toBe('true')
    // StatusLabel: icon first, the text its next sibling.
    expect(pillIcon.nextElementSibling!.textContent).toBe(value)
    // The Activity icon and the coloured dot are gone.
    expect(card.querySelector('.lucide-activity')).toBeNull()
    expect(card.querySelector('span.rounded-full.w-1\\.5')).toBeNull()
    expect(within(card).getByTestId('system-health-caption').textContent).toBe(VIEW[state].caption)
    expect(within(card).getByText('DevControl service status')).toBeInTheDocument()
  })

  it('checking → the neutral dashed circle (not a status), no filled icon, "Checking…" unchanged', () => {
    const card = renderService('checking')
    const icon = within(card).getByTestId('system-health-icon')
    expect(icon.getAttribute('class')).toContain('lucide-circle-dashed')
    expect(icon.getAttribute('data-status-kind')).toBeNull()
    expect(icon.style.color).toBe('var(--text-secondary)')
    expect(card.querySelector('[data-status-kind]')).toBeNull()
    expect(within(card).getByTestId('system-health-status').textContent).toBe('Checking…')
    expect(within(card).getByTestId('system-health-caption').textContent).toBe(SERVICE_STATUS_COPY.checking)
    expect(card.querySelector('.lucide-activity')).toBeNull()
  })
})

// ── 1c. Evidence badges: status tiers vs real trends ──

describe('EvidenceBadge: a status tier uses StatusLabel, a trend keeps its arrow', () => {
  it('toneStatusKind: the tier colour decides the kind; a neutral colour is not a status', () => {
    expect(toneStatusKind('var(--text-success)')).toBe('success')
    expect(toneStatusKind('var(--text-warning)')).toBe('warning')
    expect(toneStatusKind('var(--text-danger)')).toBe('error')
    expect(toneStatusKind('var(--text-secondary)')).toBeUndefined()
    expect(toneStatusKind('var(--text-accent)')).toBeUndefined()
  })

  it.each([
    ['Strong', 'var(--text-success)', 'success', 'circle-check'],
    ['Needs attention', 'var(--text-warning)', 'warning', 'alert-triangle'],
    ['At risk', 'var(--text-danger)', 'error', 'alert-circle'],
  ] as const)('status "%s" → StatusLabel (%s), no trend arrow, text unchanged', (label, color, kind, glyph) => {
    render(<EvidenceBadge label={label} color={color} status={toneStatusKind(color)} testId="b" />)
    const badge = screen.getByTestId('b')
    expect(badge.textContent).toBe(label)
    const icon = badge.querySelector('svg')!
    expect(icon.getAttribute('data-status-kind')).toBe(kind)
    expect(icon.getAttribute('data-glyph')).toBe(glyph)
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    // The chip is on its status tint: warning takes the -strong ink there (ruling 1).
    expect(icon.getAttribute('data-on-tint')).toBe('true')
    expect(icon.getAttribute('class')!.includes('fill-[var(--app-color-ink-warning-strong)]')).toBe(kind === 'warning')
    expect(badge.querySelector('.lucide-trending-up, .lucide-trending-down, .lucide-minus')).toBeNull()
  })

  it('status undefined (a neutral tier like "Unavailable"): no icon at all, text unchanged', () => {
    render(<EvidenceBadge label="Unavailable" color="var(--text-secondary)" status={toneStatusKind('var(--text-secondary)')} testId="b" />)
    expect(screen.getByTestId('b').textContent).toBe('Unavailable')
    expect(screen.getByTestId('b').querySelector('svg')).toBeNull()
  })

  it.each([
    ['up', 'lucide-trending-up'],
    ['down', 'lucide-trending-down'],
    ['flat', 'lucide-minus'],
  ] as const)('a real trend (%s) keeps its arrow and no status icon', (direction, cls) => {
    render(<EvidenceBadge label="-7% vs same days last month" color="var(--text-success)" direction={direction} testId="b" />)
    const badge = screen.getByTestId('b')
    expect(badge.querySelector(`.${cls}`)).not.toBeNull()
    expect(badge.querySelector('[data-status-kind]')).toBeNull()
    expect(badge.textContent).toBe('-7% vs same days last month')
  })

  it('page.tsx passes status for the Security and Posture tiers, and direction only for the spend trends', () => {
    const page = read('app/(app)/dashboard/page.tsx')
    expect(page).toContain("status: toneStatusKind(securityKpi.badge.color), testId: 'security-status'")
    expect(page).toContain("status: toneStatusKind(infraHealthBadge.color), testId: 'posture-status'")
    expect(page).not.toMatch(/securityKpi\.badge\.direction|infraHealthBadge\.direction/)
    // The spend badges (billed comparison, demo) are the only KPI badges with a direction.
    const badgeLines = page.split('\n').filter((l) => /\[\{ label: /.test(l))
    expect(badgeLines.filter((l) => /direction: /.test(l)).map((l) => l.match(/direction: ([\w.]+)/)![1])).toEqual(['spendCard.trend.direction', 'costChange'])
    expect(page).toContain("direction: spendCard.trend.direction, testId: 'spend-change'")
  })
})

// ── 3. Savings header (the weekly email's wording) ──

type SummaryProps = Parameters<typeof EstimatedSavingsSummary>[0]
const BASE: SummaryProps = { monthlySavingsLabel: null, annualSavingsLabel: null, isDemoActive: false, evaluationState: 'evaluated' }
function renderSummary(props: Partial<SummaryProps>) {
  render(<SavingsOpportunities items={[]} evaluationState="evaluated" totalActiveCount={null} summary={<EstimatedSavingsSummary {...BASE} {...props} />} />)
  const card = screen.getByTestId('savings-summary')
  // Every line of the header in order, the annual box last.
  const lines = () => [...card.querySelectorAll('p')].map((p) => p.textContent)
  return { card, lines }
}
const ESTIMATE = { monthlySavingsLabel: '$94.50', annualSavingsLabel: '$1,134.00' }

describe('savings header: the weekly email wording', () => {
  it('the helpers match the email (singular and plural)', () => {
    expect(estimatedSavingsHeadline('$94.50', 1)).toBe('Estimated savings: $94.50/month across 1 open finding. This is a DevControl estimate, not realized savings.')
    expect(estimatedSavingsHeadline('$94.50', 3)).toBe('Estimated savings: $94.50/month across 3 open findings. This is a DevControl estimate, not realized savings.')
    expect(unestimatedFindingsLine(0)).toBeNull()
    expect(unestimatedFindingsLine(1)).toBe('1 more open finding has no dollar estimate yet.')
    expect(unestimatedFindingsLine(2)).toBe('2 more open findings have no dollar estimate yet.')
    expect(noEstimateHeadline(1)).toBe('Estimated savings: 1 open finding; none has a dollar estimate yet.')
    expect(noEstimateHeadline(4)).toBe('Estimated savings: 4 open findings; none has a dollar estimate yet.')
  })

  it('estimate > 0, every finding estimated: the sentence replaces the old caption; figure and annual unchanged', () => {
    const { lines, card } = renderSummary({ ...ESTIMATE, activeCount: 1, estimatedFindings: 1, unestimatedFindings: 0 })
    expect(lines()).toEqual([
      'Estimated monthly savings',
      'Estimated savings: $94.50/month across 1 open finding. This is a DevControl estimate, not realized savings.',
      'Potential annual savings',
      '$1,134.00',
      '(estimated)',
    ])
    expect(card.textContent).toContain('$94.50')
    expect(card.textContent).not.toContain('Based on current optimization opportunities')
    expect(screen.queryByTestId('savings-unestimated-line')).toBeNull()
  })

  it('estimate > 0 with findings that have no estimate: "K more … has/have no dollar estimate yet."', () => {
    const one = renderSummary({ ...ESTIMATE, activeCount: 4, estimatedFindings: 3, unestimatedFindings: 1 })
    expect(one.lines().slice(1, 3)).toEqual([
      'Estimated savings: $94.50/month across 3 open findings. This is a DevControl estimate, not realized savings.',
      '1 more open finding has no dollar estimate yet.',
    ])
  })

  it('mixed (the weekly email\'s order): sentence, then one upper-bound line per type, then K more, then the annual figure', () => {
    const { lines } = renderSummary({ ...ESTIMATE, activeCount: 6, estimatedFindings: 2, unestimatedFindings: 2, ceilingByResourceType: { DynamoDB: 3, S3: 12 } })
    expect(lines()).toEqual([
      'Estimated monthly savings',
      'Estimated savings: $94.50/month across 2 open findings. This is a DevControl estimate, not realized savings.',
      'Plus up to $12.00/month if S3 data qualifies for Standard-IA (upper bound, not included above).',
      'Plus up to $3.00/month if DynamoDB provisioned capacity were cut to its observed peak (upper bound, not included above).',
      '2 more open findings have no dollar estimate yet.',
      'Potential annual savings',
      '$1,134.00',
      '(estimated)',
    ])
  })

  it('green only for the estimate figure: the sentence, K line and ceilings are neutral ink', () => {
    const { card } = renderSummary({ ...ESTIMATE, activeCount: 3, estimatedFindings: 1, unestimatedFindings: 1, ceilingByResourceType: { S3: 12 } })
    const green = [...card.querySelectorAll<HTMLElement>('*')].filter((el) => el.style.color === 'var(--text-success)')
    expect(green.map((el) => el.textContent)).toEqual(['$94.50'])
    for (const id of ['savings-headline', 'savings-unestimated-line', 'savings-ceiling-line']) {
      expect(screen.getByTestId(id).className).toContain('text-ink-muted')
    }
  })

  it('no estimate but open findings: "Estimated savings: N open finding(s); none has …", then the upper-bound lines; never "$0"', () => {
    const { lines, card } = renderSummary({ activeCount: 2, estimatedFindings: 0, unestimatedFindings: 0, ceilingByResourceType: { S3: 12 } })
    expect(lines()).toEqual([
      'Estimated savings: 2 open findings; none has a dollar estimate yet.',
      'Up to $12.00/month if S3 data qualifies for Standard-IA (upper bound).',
    ])
    expect(card.textContent).not.toMatch(/\$0(\.00)?\b/)
    expect(card.querySelector('[style*="--text-success"]')).toBeNull()
    cleanup()
    renderSummary({ activeCount: 1 })
    expect(screen.getByText('Estimated savings: 1 open finding; none has a dollar estimate yet.')).toBeInTheDocument()
  })

  it('an older backend without the counts: the estimate keeps its previous caption (no invented count)', () => {
    const { lines } = renderSummary({ ...ESTIMATE, activeCount: 2 })
    expect(lines()[1]).toBe('Based on current optimization opportunities')
    expect(screen.queryByTestId('savings-headline')).toBeNull()
  })

  it.each([
    ['nothing flagged', { activeCount: 0 }, 'Nothing flagged in the last cost analysis.'],
    ['stats request failed', { statsFailed: true, activeCount: null }, 'Savings couldn’t be loaded.'],
    ['another request failed', { evaluationState: 'unavailable' as const, activeCount: null }, 'Savings couldn’t be loaded.'],
    ['loading', { statsLoading: true, activeCount: null }, 'Loading…'],
  ])('unchanged: %s', (_, props, text) => {
    const { card } = renderSummary(props)
    expect(screen.getByTestId('roi-state').querySelector('p')!.textContent).toBe(text)
    expect(card.textContent).not.toContain('Estimated savings:')
    expect(card.textContent).not.toMatch(/\$\d/)
  })

  it('demo stays the sample figure and caption', () => {
    const { lines } = renderSummary({ isDemoActive: true, monthlySavingsLabel: '$1,922.00', annualSavingsLabel: '$23,064.00', estimatedFindings: 3 })
    expect(lines().slice(0, 2)).toEqual(['Estimated monthly savings (sample)', 'Based on current optimization opportunities'])
  })
})

// ── 2. Shared outline stroke ──

/** Every Dashboard outline category / navigation icon that takes the shared stroke: file → icon tags. */
const STROKE_ICONS: Record<string, string[]> = {
  'components/dashboard/dashboard-metric-card.tsx': ['Icon'],
  'components/dashboard/system-intelligence-card.tsx': ['Icon', 'Gauge'],
  'components/dashboard/posture-evidence.tsx': ['Icon'],
  'components/dashboard/security-compliance-summary.tsx': ['ChevronRight', 'ShieldCheck'],
  'components/dashboard/savings-opportunities.tsx': ['PuzzleIcon'],
  'components/dashboard/engineering-health-card.tsx': ['Code2'],
  'components/dashboard/recent-activity-card.tsx': ['Clock', 'conf.icon'],
  'components/dashboard/resource-checks-section.tsx': ['Server', 'ExternalLink', 'ListChecks'],
  'components/dashboard/recommended-action-card.tsx': ['Zap'],
  'components/dashboard/cost-trends-card.tsx': ['MoreHorizontal'],
  'components/dashboard/cost-trend-chart.tsx': ['Download'],
  'components/dashboard/evidence-info.tsx': ['X', 'Info'],
  'components/dashboard/card-arrow-link.tsx': ['ArrowRight'],
  'components/dashboard/dashboard-hero.tsx': ['Plug', 'Plug'],
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel)
  }
  return out
}

describe('one shared stroke width for the Dashboard outline icons', () => {
  it('is 2.25: slightly heavier than lucide\'s default 2', () => {
    expect(DASHBOARD_ICON_STROKE).toBe(2.25)
  })

  it.each(Object.entries(STROKE_ICONS))('%s: each listed icon uses DASHBOARD_ICON_STROKE, and only those', (file, icons) => {
    const src = read(file)
    for (const icon of icons) {
      const tag = icon.replace('.', '\\.')
      expect(src, `${file} <${icon}>`).toMatch(new RegExp(`<${tag}\\b[^>]*strokeWidth=\\{DASHBOARD_ICON_STROKE\\}`))
    }
    expect(src.match(/strokeWidth=\{DASHBOARD_ICON_STROKE\}/g)).toHaveLength(icons.length)
    expect(src).toContain("from './icon-stroke'")
  })

  it('nothing outside the Dashboard imports or applies it, and no file hard-codes 2.25', () => {
    const users = ['app', 'components', 'lib', 'hooks']
      .filter((d) => fs.existsSync(path.join(ROOT, d)))
      .flatMap((d) => walk(d))
      .filter((f) => !f.includes('__tests__'))
      .filter((f) => /icon-stroke|DASHBOARD_ICON_STROKE/.test(read(f)))
      .sort()
    expect(users).toEqual(['components/dashboard/icon-stroke.ts', ...Object.keys(STROKE_ICONS)].sort())
    const hardCoded = ['app', 'components'].flatMap((d) => walk(d)).filter((f) => !f.includes('__tests__') && /strokeWidth=\{2\.25\}/.test(read(f)))
    expect(hardCoded).toEqual([])
  })

  it('renders as stroke-width 2.25 on the header icon, the info button and the arrow link; a trend arrow keeps 2', () => {
    render(
      <>
        <DashboardMetricCard icon={DollarSign} iconColor="var(--text-success)" iconBackground="var(--bg-success)" label="Spend" value="$1" link={{ href: '/costs', label: 'Open costs' }} />
        <EvidenceInfo about="Spend"><p>x</p></EvidenceInfo>
        <CardArrowLink href="/security" label="Open top risk" />
        <EvidenceBadge label="-7%" color="var(--text-success)" direction="down" testId="trend" />
      </>,
    )
    const stroke = (sel: string) => document.querySelector(sel)!.getAttribute('stroke-width')
    expect(stroke('.lucide-dollar-sign')).toBe('2.25')
    expect(stroke('.lucide-info')).toBe('2.25')
    expect(stroke('.lucide-arrow-right')).toBe('2.25')
    expect(within(screen.getByTestId('trend')).getByText('-7%').parentElement!.querySelector('svg')!.getAttribute('stroke-width')).toBe('2')
  })
})
