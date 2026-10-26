/**
 * The Dashboard on the app type scale (typography plan T2c, PR 2; founder decisions D2, D3). Source-level, like
 * the sibling dashboard tests: the cards are wired to many hooks, and typography-strict already bans every raw
 * size, so this only pins which role each heading and figure uses.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = (file: string) => readFileSync(join(process.cwd(), 'components/dashboard', file), 'utf-8')

describe('D2: every panel heading is the section role (18 px)', () => {
  it.each([
    ['system-intelligence-card.tsx', '<h3 className="text-section text-ink m-0">{INFRASTRUCTURE_POSTURE_LABEL}</h3>'],
    ['resource-checks-section.tsx', '<h3 className="text-section text-ink m-0">{RESOURCE_CHECKS_TITLE}</h3>'],
    ['security-compliance-summary.tsx', '<h3 className="text-section text-ink">Security Key Findings</h3>'],
    ['savings-opportunities.tsx', '<h3 className="text-section text-ink">Cost-Saving Opportunities</h3>'],
    ['executive-roi-card.tsx', '<h3 className="text-section text-ink">Executive ROI Summary</h3>'],
    ['engineering-health-card.tsx', '<h3 className="text-section text-ink">Engineering Health</h3>'],
    ['recent-activity-card.tsx', '<h3 className="text-section text-ink">Recent Activity</h3>'],
    ['cost-trend-chart.tsx', '<CardTitle className="text-section">AWS Cost Trends</CardTitle>'],
    ['cost-trends-card.tsx', '<h3 className="text-section text-ink">AWS Cost Trends</h3>'],
  ])('%s', (file, heading) => {
    expect(src(file)).toContain(heading)
  })
})

describe('D3: figures', () => {
  it('the 18-24 px figures are the section role with tabular figures (Num)', () => {
    expect(src('savings-opportunities.tsx')).toMatch(/<div className="text-section [^"]*" style=\{\{[^}]*\}\}>\s*<Num>\{savingsLabel\}<\/Num>/)
    expect(src('engineering-health-card.tsx').match(/<div className="text-section text-ink leading-none mb-1\.5"><Num>\{value\}<\/Num><\/div>/g)).toHaveLength(2)
    expect(src('resource-checks-section.tsx')).toMatch(/className="text-section [^"]*" data-testid="resource-checks-value">\s*<Num>\{view\.passing\}<\/Num> .*<Num>\{view\.reporting\}<\/Num>/)
    expect(src('system-intelligence-card.tsx')).toMatch(/`text-section [^`]*`\} data-testid=\{`posture-score-\$\{componentKey\}`\}>\s*<Num>\{d\.scoreText\}<\/Num>/)
    expect(src('executive-roi-card.tsx')).toContain('<p className="text-section tracking-tight" style={{ color: \'var(--text-accent)\' }}><Num>{annualSavingsLabel}</Num></p>')
  })

  it('the KPI row and the ROI figure are the KPI role (30 px) with tabular figures', () => {
    expect(src('dashboard-metric-card.tsx')).toContain('<div className="text-kpi tabular-nums leading-none text-ink">')
    expect(src('executive-roi-card.tsx')).toContain('<div className="text-kpi tabular-nums leading-none mb-1.5"')
  })

  it("the hero heading and subtitle are the page-title and subtitle roles, shared with PageHeader", () => {
    const hero = src('dashboard-hero.tsx')
    expect(hero).toContain("<h1 className={cn(PAGE_TITLE_CLASS, 'mb-2 max-w-xl')}>")
    expect(hero).toContain("<p className={cn(PAGE_SUBTITLE_CLASS, 'max-w-xl')}>")
    expect(hero).not.toMatch(/leading-relaxed/)
  })
})
