import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { NON_APP_CLOSURE, SOURCE_FILES, importsOf } from './surface-scope'

// Pages and components already on the app type scale (typography plan T1, T2b, T2c, then one PR per page group) may not drift back: every size and weight comes
// from the role tokens (text-title ... text-label), and text colours are the ink tokens or pass AA on their
// own surface. The full guard for every app file is its own PR (TG); this covers the files moved so far.
// Variants count, bracketed ones included ([&_p]:, data-[state=open]:, group-[.x]:); dark: variants are
// exempt (dark mode is not wired up; typography plan Q3). Inline style colours and sizes count too.
// The Costs group (G2): every page under the Costs routes. A self-check below keeps this list equal to the .tsx
// files in those route folders, so a new Costs page cannot land outside the guard.
const COSTS_ROUTE_DIRS = ['app/(app)/costs/', 'app/(app)/forecast/', 'app/(app)/cost-optimization/']
const COSTS = [
  'app/(app)/cost-optimization/controls/page.tsx',
  'app/(app)/cost-optimization/page.tsx',
  'app/(app)/costs/by-team/page.tsx',
  'app/(app)/costs/efficiency/page.tsx',
  'app/(app)/costs/page.tsx',
  'app/(app)/forecast/page.tsx',
]

// The Infrastructure + Services group (G1), with the last two Costs-dropdown pages (Invoices, AI Reports): every page
// and component in these route folders except the legacy ones below, plus the shared components only these pages use.
// A self-check below keeps this list equal to that, so a new file in these folders cannot land outside the guard.
const G1_ROUTE_DIRS = ['app/(app)/infrastructure/', 'app/(app)/services/', 'app/(app)/invoices/', 'app/(app)/ai-reports/']
const G1_COMPONENTS = [
  'components/aws/discovery-warning-notice.tsx',
  'components/invoices/invoice-actions.tsx',
  'components/invoices/invoice-form-dialog.tsx',
]
// Legacy (flag-off / demo fallback); converted in a later PR. The legacy Infrastructure page is also what the
// Overview renders in demo and sales demo; on the Services page only the shared resource-limit prompt is converted.
const G1_LEGACY = ['app/(app)/infrastructure/page.tsx', 'app/(app)/services/page.tsx', 'app/(app)/services/RegisteredServices.tsx']
const G1 = [
  'app/(app)/infrastructure/new/page.tsx',
  'app/(app)/infrastructure/overview/AccountStrip.tsx',
  'app/(app)/infrastructure/overview/AttentionReview.tsx',
  'app/(app)/infrastructure/overview/CostByService.tsx',
  'app/(app)/infrastructure/overview/InfrastructureOverviewV2.tsx',
  'app/(app)/infrastructure/overview/KpiTiles.tsx',
  'app/(app)/infrastructure/overview/OverviewFooter.tsx',
  'app/(app)/infrastructure/overview/OverviewHeader.tsx',
  'app/(app)/infrastructure/overview/OwnershipGaps.tsx',
  'app/(app)/infrastructure/overview/PlanBanners.tsx',
  'app/(app)/infrastructure/overview/StatusLine.tsx',
  'app/(app)/infrastructure/overview/WhatWeChecked.tsx',
  'app/(app)/services/AddServiceButton.tsx',
  'app/(app)/services/AllResourcesTable.tsx',
  'app/(app)/services/AttentionTable.tsx',
  'app/(app)/services/CoverageStrip.tsx',
  'app/(app)/services/NotCheckedCard.tsx',
  'app/(app)/services/PhaseTwoTag.tsx',
  'app/(app)/services/RegionCoveragePanel.tsx',
  'app/(app)/services/ResourceFocus.tsx',
  'app/(app)/services/ScanTime.tsx',
  'app/(app)/services/ServicesHeader.tsx',
  'app/(app)/services/ServicesOverview.tsx',
  'app/(app)/services/SummaryTiles.tsx',
  'app/(app)/services/UnownedCard.tsx',
  'app/(app)/services/YourServices.tsx',
  'app/(app)/services/new/page.tsx',
  'app/(app)/invoices/page.tsx',
  'app/(app)/invoices/[id]/page.tsx',
  'app/(app)/ai-reports/page.tsx',
  'app/(app)/ai-reports/[id]/page.tsx',
  ...G1_COMPONENTS,
]

// Security V2: every new file in the Security route folder and lib/security, .ts included (the redesign's model and
// helpers are .ts), except the legacy page. A self-check below keeps this list equal to that.
const SECURITY_DIRS = ['app/(app)/security/', 'lib/security/']
const SECURITY_LEGACY = ['app/(app)/security/page.tsx']
const SECURITY = [
  'app/(app)/security/overview/BottomLinks.tsx',
  'app/(app)/security/overview/CopyStatement.tsx',
  'app/(app)/security/overview/DispositionDialog.tsx',
  'app/(app)/security/overview/FindingActions.tsx',
  'app/(app)/security/overview/FindingPanel.tsx',
  'app/(app)/security/overview/FindingsList.tsx',
  'app/(app)/security/overview/Frameworks.tsx',
  'app/(app)/security/overview/ScoreTrend.tsx',
  'app/(app)/security/overview/SecurityChecked.tsx',
  'app/(app)/security/overview/SecurityHeader.tsx',
  'app/(app)/security/overview/SecurityOverviewV2.tsx',
  'app/(app)/security/overview/SecurityTiles.tsx',
  'app/(app)/security/overview/StatusBanner.tsx',
  'app/(app)/security/overview/fixGuidance.ts',
  'app/(app)/security/overview/securityCopy.ts',
  'app/(app)/security/overview/securityModel.ts',
  'app/(app)/security/overview/useFindingDisposition.ts',
  'app/(app)/security/securityV2Flag.ts',
  'lib/security/findingDisplay.ts',
]

// The Security menu pages other than the Security page itself (SM): Anomalies (+ rules), Compliance (the retired
// /compliance redirect, frameworks, SOC 2) and Audit Logs, plus every components/compliance file (only these pages use
// them). A self-check below keeps this list equal to that. The Security page and lib/security are Security V2's.
const SM_ROUTE_DIRS = ['app/(app)/anomalies/', 'app/(app)/compliance/', 'app/(app)/audit-logs/']
const SM_COMPONENT_DIRS = ['components/compliance/']
const SM = [
  'app/(app)/anomalies/page.tsx',
  'app/(app)/anomalies/rules/page.tsx',
  'app/(app)/compliance/page.tsx',
  'app/(app)/compliance/frameworks/page.tsx',
  'app/(app)/compliance/frameworks/soc2/page.tsx',
  'app/(app)/audit-logs/page.tsx',
  'components/compliance/CreateFrameworkModal.tsx',
  'components/compliance/CreateRuleModal.tsx',
  'components/compliance/FrameworkDetailsModal.tsx',
  'components/compliance/ScanResultsModal.tsx',
  'components/compliance/Soc2CustomerEvidenceForm.tsx',
  'components/compliance/Soc2CustomerEvidenceSection.tsx',
  'components/compliance/Soc2ExternalReferenceLink.tsx',
  'components/compliance/Soc2ObservedEvidenceList.tsx',
  'components/compliance/soc2-badges.tsx',
]

// The DevOps pages (DEVOPS): DORA (/app/dora-metrics), Deployments (log, new, detail) and Dependencies, plus every
// components/dependencies file and components/deployments/LiveLogViewer (only these pages use them). The other
// components/deployments files have no importer (typography plan §1.8) and stay out until the unused-component
// cleanup. A self-check below keeps this list equal to that. Observability, monitoring, SLOs and status wait for
// the Observability redesign.
const DEVOPS_ROUTE_DIRS = ['app/(app)/app/dora-metrics/', 'app/(app)/deployments/', 'app/(app)/dependencies/']
const DEVOPS_COMPONENT_DIRS = ['components/dependencies/', 'components/deployments/']
const DEVOPS_UNIMPORTED = [
  'components/deployments/DORAMetricsPreview.tsx',
  'components/deployments/DeploymentAPIExample.tsx',
  'components/deployments/DeploymentBenefits.tsx',
  'components/deployments/DeploymentIntegrations.tsx',
  'components/deployments/DeploymentSetupChecklist.tsx',
  'components/deployments/DeploymentTimelinePreview.tsx',
]
const DEVOPS = [
  'app/(app)/app/dora-metrics/page.tsx',
  'app/(app)/deployments/page.tsx',
  'app/(app)/deployments/new/page.tsx',
  'app/(app)/deployments/[id]/page.tsx',
  'app/(app)/dependencies/page.tsx',
  'components/deployments/LiveLogViewer.tsx',
  'components/dependencies/AddDependencyDialog.tsx',
  'components/dependencies/DependencyGraph.tsx',
  'components/dependencies/DependencyList.tsx',
  'components/dependencies/EnhancedEmptyState.tsx',
  'components/dependencies/ExportMenu.tsx',
  'components/dependencies/FilterSummary.tsx',
  'components/dependencies/ImpactAnalysisView.tsx',
]

// Not converted yet, so never on the strict list: the Security page (Security V2 rebuilds it), G1's legacy files and
// the unimported DevOps previews.
const EXEMPT = [...SECURITY_LEGACY, ...G1_LEGACY, ...DEVOPS_UNIMPORTED]

const STRICT = [
  'app/(app)/connect-aws/page.tsx',
  'components/dashboard/dashboard-unconnected-preview.tsx',
  'components/ui/typography.tsx',
  // T2b: the shared components.
  'components/ui/alert-dialog.tsx',
  'components/ui/alert.tsx',
  'components/ui/badge.tsx',
  'components/ui/button.tsx',
  'components/ui/card.tsx',
  'components/ui/command.tsx',
  'components/ui/dialog.tsx',
  'components/ui/dropdown-menu.tsx',
  'components/ui/empty-state.tsx',
  'components/ui/error-display.tsx',
  'components/ui/form.tsx',
  'components/ui/input.tsx',
  'components/ui/label.tsx',
  'components/ui/select.tsx',
  'components/ui/severity-badge.tsx',
  'components/ui/table.tsx',
  'components/ui/tabs.tsx',
  'components/ui/textarea.tsx',
  'components/ui/tooltip.tsx',
  // T2c: the app shell.
  'app/(app)/layout.tsx',
  'components/ConnectionIndicator.tsx',
  'components/ai/AIChatWidget.tsx',
  'components/command-palette.tsx',
  'components/demo/DemoBanner.tsx',
  'components/error-boundary.tsx',
  'components/layout/top-nav.tsx',
  'components/navigation/back-button.tsx',
  'components/navigation/breadcrumb.tsx',
  'components/onboarding/welcome-modal.tsx',
  'components/ui/breadcrumb.tsx',
  'components/ui/user-dropdown.tsx',
  // T2c PR 2: the Dashboard.
  'app/(app)/dashboard/page.tsx',
  'components/dashboard/cost-breakdown-barlist.tsx',
  'components/dashboard/cost-trend-chart.tsx',
  'components/dashboard/cost-trends-card.tsx',
  'components/dashboard/dashboard-hero.tsx',
  'components/dashboard/dashboard-metric-card.tsx',
  'components/dashboard/engineering-health-card.tsx',
  'components/dashboard/evidence-badge.tsx',
  'components/dashboard/evidence-info.tsx',
  'components/dashboard/executive-roi-card.tsx',
  'components/dashboard/infrastructure-intelligence.tsx',
  'components/dashboard/posture-evidence.tsx',
  'components/dashboard/recent-activity-card.tsx',
  'components/dashboard/recommended-action-card.tsx',
  'components/dashboard/resource-checks-section.tsx',
  'components/dashboard/savings-opportunities.tsx',
  'components/dashboard/security-compliance-summary.tsx',
  'components/dashboard/system-intelligence-card.tsx',
  // G2: the Costs pages.
  ...COSTS,
  // G1: Infrastructure + Services, Invoices and AI Reports.
  ...G1,
  // Security V2.
  ...SECURITY,
  // SM: the Security menu pages (Anomalies, Compliance, Audit Logs).
  ...SM,
  // DEVOPS: DORA, Deployments and Dependencies.
  ...DEVOPS,
]

// Any chain of variants except dark:, including arbitrary ones: md:, hover:, [&_p]:, data-[state=open]:.
const VARIANT = '(?:[\\w-]+(?:-\\[[^\\]\\s]*\\])?|\\[[^\\]\\s]*\\])'
const V = `(?<![\\w:\\]-])(?:(?!dark:)${VARIANT}:)*`
const RULES: Record<string, RegExp> = {
  'Tailwind size scale (use a role token)': new RegExp(`${V}text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\\w-])`, 'g'),
  'arbitrary font size': new RegExp(`${V}text-\\[(?:\\d|\\.\\d|calc|clamp|length:)[^\\]]*\\]`, 'g'),
  'bold weight (roles carry 600)': new RegExp(`${V}font-(?:bold|extrabold|black)(?![\\w-])`, 'g'),
  'arbitrary text property': new RegExp(`${V}\\[(?:font-size|font-weight|font-family|line-height|letter-spacing|color|opacity|-webkit-text-fill-color):[^\\]]*\\]`, 'g'),
  // A bare TypeScript type (`color: string` in an interface) is a declaration, not a style.
  'inline text style': /(?<![\w[-])(?:fontSize|fontFamily|fontWeight|lineHeight|letterSpacing|color|opacity|WebkitTextFillColor)\s*:\s*(?:'[^']*'|"[^"]*"|`[^`]*`|(?!(?:string|number)(?![\w.$(]))[\w.$]+(?:\([^)]*\))?)/g,
  'text colour below AA on light surfaces': new RegExp(
    `${V}text-(?:(?:slate|gray|zinc|neutral|stone)-(?:50|100|200|300|400|500)|(?:green|emerald|teal|cyan|lime|amber|yellow|orange)-(?:300|400|500|600)|(?:red|blue|sky|rose|pink)-(?:300|400|500)|red-600)(?:\\/\\d+)?(?![\\w-])`,
    'g'
  ),
  // var() included: a class names an ink token (text-ink-muted, ...); the app's colour variables are only
  // allowed as inline values (APP_COLOUR_VARS).
  'arbitrary text colour': new RegExp(`${V}text-\\[(?:#|rgb|hsl|oklch|color:|var\\()[^\\]]*\\]`, 'g'),
  'opacity on content': new RegExp(`${V}opacity-\\d+(?![\\w-])`, 'g'),
}

/**
 * The app's colour variables that may be an inline text colour as a plain literal (`color: 'var(--name)'`), without
 * an exception of their own (founder decision D6, T2c PR 2). Each is checked for AA where the app uses it. Anything
 * else inline (hex, other variables, values chosen at runtime) still needs a reviewed, counted exception below.
 */
const APP_COLOUR_VARS: Record<string, string> = {
  '--text-success': 'ink-success (green-700) on the app surface; app-surface-tokens checks it on white and the 50 tints.',
  '--text-warning': 'ink-warning (amber-700) on the app surface; app-surface-tokens checks it on white and the 50 tints.',
  '--text-danger': 'ink-danger (red-700) on the app surface; app-surface-tokens checks it on white and the 50 tints.',
  '--text-accent': 'The accent (violet-600, 5.7:1 on white), kept by founder decision D5; on its own --bg-accent tint it is checked in dashboard-unconnected-preview.test.tsx.',
  '--text-secondary': 'gray-600 (7.6:1 on white); also the neutral tone key that evidence-badge maps. As a class it is text-ink-muted instead.',
  '--app-color-ink-success-strong': "T1's -strong status ink (green-800) for text on the --bg-success tint.",
  '--app-color-ink-warning-strong': "T1's -strong status ink (amber-800) for text on the --bg-warning tint.",
  '--app-color-ink-danger-strong': "T1's -strong status ink (red-800) for text on the --bg-danger tint.",
}
const isAppColourVar = (inlineStyle: string) => {
  const m = inlineStyle.match(/^color: (['"])var\((--[\w-]+)\)\1$/)
  return m !== null && Object.hasOwn(APP_COLOUR_VARS, m[2])
}

/**
 * Reviewed exceptions: each names the exact class or style, how many times it may occur (an extra
 * occurrence fails, and so does a missing one), and why it is fine. `variant` is the exact variant chain
 * the class carries (for example 'disabled:'); without one, only the bare class is allowed.
 */
const ALLOWED: { file: string; match: string; variant?: string; rule: string; count: number; reason: string }[] = [
  {
    file: 'app/(app)/connect-aws/page.tsx',
    match: 'text-slate-200',
    rule: 'text colour below AA on light surfaces',
    count: 2,
    reason: 'Light text on the dark code blocks: the trust policy and the inline policy sit on bg-slate-900, well above 4.5:1.',
  },
  {
    file: 'components/dashboard/dashboard-unconnected-preview.tsx',
    match: 'text-[#D6D3E8]',
    rule: 'arbitrary text colour',
    count: 1,
    reason: 'The band is dark in both themes (#1A1730); dashboard-unconnected-preview.test.tsx checks this line is at least 4.5:1 on it.',
  },
  {
    file: 'components/dashboard/dashboard-unconnected-preview.tsx',
    match: 'text-[#1A1730]',
    rule: 'arbitrary text colour',
    count: 1,
    reason: "The band's white button: dark text on white, checked in dashboard-unconnected-preview.test.tsx.",
  },
  // T2b: the shared components (reviewed exceptions, typography plan T2b).
  { file: 'components/ui/button.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/input.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/input.tsx', match: 'text-sm', variant: 'file:', rule: 'Tailwind size scale (use a role token)', count: 1, reason: "The native file-picker button's label (file:), 14 px like the field; left as it is by founder decision (no visible change)." },
  { file: 'components/ui/textarea.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/select.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/select.tsx', match: 'opacity-50', variant: 'data-[disabled]:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/select.tsx', match: 'opacity-50', rule: 'opacity on content', count: 1, reason: "The trigger's decorative chevron icon (an svg, not text); founder decision: kept, no visible change." },
  { file: 'components/ui/label.tsx', match: 'opacity-50', variant: 'group-data-[disabled=true]:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/label.tsx', match: 'opacity-50', variant: 'peer-disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/tabs.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/dropdown-menu.tsx', match: 'opacity-50', variant: 'data-[disabled]:', rule: 'opacity on content', count: 3, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24). Item, checkbox item and radio item.' },
  { file: 'components/ui/command.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/command.tsx', match: 'opacity-50', variant: 'data-[disabled=true]:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/command.tsx', match: 'opacity-50', rule: 'opacity on content', count: 1, reason: "The input's decorative search icon (an svg, not text); founder decision: kept, no visible change." },
  { file: 'components/ui/dialog.tsx', match: 'opacity-70', rule: 'opacity on content', count: 1, reason: "The close button, whose only visible content is the X icon (its name is sr-only text); founder decision: kept, no visible change." },
  { file: 'components/ui/dialog.tsx', match: 'opacity-100', variant: 'hover:', rule: 'opacity on content', count: 1, reason: "The same close button at full opacity on hover; founder decision: kept, no visible change." },
  { file: 'components/ui/error-display.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 2, reason: 'The aria-hidden error icon on its red-50 tint (server/auth/permission and default schemes): an icon, not text; founder decision: kept.' },
  { file: 'components/ui/error-display.tsx', match: 'text-orange-600', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The aria-hidden error icon on its orange-50 tint (network/timeout/offline): an icon, not text; founder decision: kept.' },
  // T2c: the app shell (reviewed exceptions, typography plan T2c).
  { file: 'components/layout/top-nav.tsx', match: 'text-xl', rule: 'Tailwind size scale (use a role token)', count: 2, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Desktop: the DC monogram and the DevControl wordmark.' },
  { file: 'components/layout/top-nav.tsx', match: 'font-bold', rule: 'bold weight (roles carry 600)', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Desktop: the DC monogram.' },
  { file: 'components/layout/top-nav.tsx', match: 'fontWeight: 700', rule: 'inline text style', count: 3, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar wordmark, phone bar monogram, and the DevControl name heading the phone drawer.' },
  { file: 'components/layout/top-nav.tsx', match: "fontSize: '1.2rem'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar wordmark.' },
  { file: 'components/layout/top-nav.tsx', match: "color: '#1e1b4b'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar wordmark (indigo-black on white, 16:1).' },
  { file: 'components/layout/top-nav.tsx', match: "letterSpacing: '-0.01em'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar wordmark.' },
  { file: 'components/layout/top-nav.tsx', match: "color: '#fff'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar monogram: white on its blue-to-indigo gradient tile.' },
  { file: 'components/layout/top-nav.tsx', match: "fontSize: '13px'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar monogram.' },
  { file: 'components/layout/top-nav.tsx', match: "fontSize: '1rem'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). The DevControl name heading the phone drawer.' },
  { file: 'components/layout/top-nav.tsx', match: "color: '#0F172A'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). The DevControl name heading the phone drawer (slate-900).' },
  { file: 'components/layout/top-nav.tsx', match: "color: '#94A3B8'", rule: 'inline text style', count: 1, reason: "The drawer sections' decorative chevron icon (an svg, not text); kept, no visible change (typography plan T2c)." },
  { file: 'components/layout/top-nav.tsx', match: 'text-base', rule: 'Tailwind size scale (use a role token)', count: 2, reason: 'Top-level nav labels 16 px, founder decision Oct 26: the desktop top-level links and dropdown triggers (16/24, the size before #254). Menu items stay text-ui, descriptions text-meta.' },
  // T2c PR 2: the Dashboard (reviewed exceptions, founder decision D6). Colours chosen at runtime, chart fills and icons.
  { file: 'app/(app)/dashboard/page.tsx', match: 'color: SERVICE_COLORS', rule: 'inline text style', count: 5, reason: "Demo-only cost breakdown data: each category's swatch and bar colour (fills, not text). Demo mode is permanently off." },
  { file: 'app/(app)/dashboard/page.tsx', match: 'color: spendCard.trend.color', rule: 'inline text style', count: 1, reason: "The Spend KPI's comparison badge colour, a status colour chosen at runtime from the app's listed colour variables (APP_COLOUR_VARS); evidence-badge puts it on its tint with the -strong ink." },
  { file: 'app/(app)/dashboard/page.tsx', match: 'color: costDeltaColor', rule: 'inline text style', count: 1, reason: "The demo Spend badge colour, a status colour chosen at runtime from the app's listed colour variables (APP_COLOUR_VARS)." },
  { file: 'app/(app)/dashboard/page.tsx', match: 'color: securityKpi.badge.color', rule: 'inline text style', count: 1, reason: "The Security Posture badge colour, a status colour chosen at runtime from the app's listed colour variables (APP_COLOUR_VARS)." },
  { file: 'app/(app)/dashboard/page.tsx', match: 'color: infraHealthBadge.color', rule: 'inline text style', count: 1, reason: "The Infrastructure Posture badge colour, a status colour chosen at runtime from the app's listed colour variables (APP_COLOUR_VARS)." },
  { file: 'app/(app)/dashboard/page.tsx', match: 'color: statusConf.color', rule: 'inline text style', count: 1, reason: "DevControl System Health's status colour, a status colour chosen at runtime from the app's listed colour variables (APP_COLOUR_VARS)." },
  { file: 'components/dashboard/cost-breakdown-barlist.tsx', match: 'color: item.color', rule: 'inline text style', count: 1, reason: "Demo-only: each category's swatch and bar colour passed through (fills, not text)." },
  { file: 'components/dashboard/cost-trend-chart.tsx', match: "color: '#3b82f6'", rule: 'inline text style', count: 1, reason: 'Chart series colour (Compute): bar/area fill and legend swatch, not text.' },
  { file: 'components/dashboard/cost-trend-chart.tsx', match: "color: '#10b981'", rule: 'inline text style', count: 1, reason: 'Chart series colour (Storage): bar/area fill and legend swatch, not text.' },
  { file: 'components/dashboard/cost-trend-chart.tsx', match: "color: '#8b5cf6'", rule: 'inline text style', count: 1, reason: 'Chart series colour (Database): bar/area fill and legend swatch, not text.' },
  { file: 'components/dashboard/cost-trend-chart.tsx', match: "color: '#f59e0b'", rule: 'inline text style', count: 1, reason: 'Chart series colour (Network): bar/area fill and legend swatch, not text.' },
  { file: 'components/dashboard/cost-trend-chart.tsx', match: "color: '#6b7280'", rule: 'inline text style', count: 1, reason: 'Chart series colour (Other): bar/area fill and legend swatch, not text.' },
  { file: 'components/dashboard/cost-trend-chart.tsx', match: 'color: item.color', rule: 'inline text style', count: 1, reason: 'Per-service chart series colour from the API (fills and legend swatches, not text).' },
  { file: 'components/dashboard/dashboard-metric-card.tsx', match: 'color: iconColor', rule: 'inline text style', count: 1, reason: "The KPI card's decorative icon (aria-hidden svg, not text), coloured by the caller with an app colour variable." },
  { file: 'components/dashboard/engineering-health-card.tsx', match: 'color: delta.good', rule: 'inline text style', count: 1, reason: 'Demo-only DORA delta: ternary between var(--text-success) and var(--text-danger), both in APP_COLOUR_VARS.' },
  { file: 'components/dashboard/evidence-badge.tsx', match: 'color: toneText(color)', rule: 'inline text style', count: 1, reason: "The chip's text: the -strong ink for success/warning/danger on their tints, or the caller's listed variable (toneText)." },
  { file: 'components/dashboard/infrastructure-intelligence.tsx', match: 'color: NEUTRAL_COLOR', rule: 'inline text style', count: 2, reason: 'The low-severity and no-risk tone: NEUTRAL_COLOR is var(--text-secondary), in APP_COLOUR_VARS.' },
  { file: 'components/dashboard/infrastructure-intelligence.tsx', match: 'color: style.color', rule: 'inline text style', count: 1, reason: "Top Risk's decorative alert icon (aria-hidden svg), coloured by the severity tone." },
  { file: 'components/dashboard/infrastructure-intelligence.tsx', match: 'color: severity', rule: 'inline text style', count: 1, reason: 'The Top Risk title: toneText(severity colour) (-strong ink on the tint) or var(--foreground) when there is no severity.' },
  { file: 'components/dashboard/infrastructure-intelligence.tsx', match: 'color: systemStatus.color', rule: 'inline text style', count: 2, reason: "DevControl System Health's icon (aria-hidden svg) and status pill text, a status colour chosen at runtime from the app's listed colour variables (APP_COLOUR_VARS)." },
  { file: 'components/dashboard/recent-activity-card.tsx', match: "color: '#1D4ED8'", rule: 'inline text style', count: 1, reason: "The score event's icon colour (blue-700, an svg icon on #EFF6FF; 6.2:1)." },
  { file: 'components/dashboard/recent-activity-card.tsx', match: 'color: conf.color', rule: 'inline text style', count: 1, reason: "Each event's icon (an svg, not text), coloured from EVENT_CONFIG." },
  { file: 'components/dashboard/resource-checks-section.tsx', match: 'color: iconColor', rule: 'inline text style', count: 1, reason: "The summary's decorative status icon (aria-hidden svg), success/issue/neutral tone." },
  { file: 'components/dashboard/savings-opportunities.tsx', match: 'color: count', rule: 'inline text style', count: 1, reason: 'Each savings figure: count > 0 ? var(--text-success) : var(--text-secondary), both in APP_COLOUR_VARS.' },
  { file: 'components/dashboard/savings-opportunities.tsx', match: 'color: toneText(priorityBadge.color)', rule: 'inline text style', count: 1, reason: "The priority chip's text: the -strong ink on its tint, or var(--text-secondary) for Low (toneText)." },
  { file: 'components/dashboard/security-compliance-summary.tsx', match: "color: '#1D4ED8'", rule: 'inline text style', count: 1, reason: 'The Info severity chip (blue-700 on #EFF6FF, 6.2:1); passed through toneText unchanged.' },
  { file: 'components/dashboard/security-compliance-summary.tsx', match: 'color: toneText(badge.color)', rule: 'inline text style', count: 1, reason: "Each finding's severity chip text: the -strong ink on its tint (toneText)." },
  { file: 'components/dashboard/cost-trend-chart.tsx', match: 'opacity-40', rule: 'opacity on content', count: 1, reason: "A legend entry whose series is toggled off: a state, not quieter text; kept, no visible change (D6)." },
  { file: 'components/dashboard/cost-trend-chart.tsx', match: 'opacity-60', variant: 'hover:', rule: 'opacity on content', count: 1, reason: "The same toggled-off legend entry on hover; kept, no visible change (D6)." },
  // G2: the Costs pages (reviewed exceptions). Decorative icons, chart series colours, class names held in a
  // `color` key, disabled-state dimming and the narrow chart axes kept at their size (founder decision, Oct 26).
  { file: 'app/(app)/costs/page.tsx', match: 'opacity: 0', rule: 'inline text style', count: 1, reason: "The end frame of the ping keyframes in the page's <style> tag (the anomaly dot's ring animation), not a style on content." },
  { file: 'app/(app)/costs/page.tsx', match: 'opacity-40', rule: 'opacity on content', count: 1, reason: "The anomaly dot's animated ping ring: an empty decorative div with no text; kept, no visible change." },
  { file: 'app/(app)/costs/page.tsx', match: "color: 'text-slate-900'", rule: 'inline text style', count: 1, reason: "Not a style: the chart summary's `color` key holds a class name (slate-900, the spend figure)." },
  { file: 'app/(app)/costs/page.tsx', match: 'color: growthRate', rule: 'inline text style', count: 1, reason: "Not a style: the Month-over-Month `color` key holds class names (text-ink-muted/-danger/-success) chosen at runtime." },
  { file: 'app/(app)/costs/page.tsx', match: "color: 'text-ink-muted'", rule: 'inline text style', count: 1, reason: "Not a style: the Active Recommendations `color` key holds the text-ink-muted class name." },
  { file: 'app/(app)/costs/page.tsx', match: "color: 'text-ink-success'", rule: 'inline text style', count: 1, reason: "Not a style: the savings `color` key holds the text-ink-success class name." },
  { file: 'app/(app)/costs/page.tsx', match: "color: '#3B82F6'", rule: 'inline text style', count: 1, reason: 'Chart series colour (Compute): the top-drivers swatch, not text.' },
  { file: 'app/(app)/costs/page.tsx', match: "color: '#8B5CF6'", rule: 'inline text style', count: 1, reason: 'Chart series colour (Database): the top-drivers swatch, not text.' },
  { file: 'app/(app)/costs/page.tsx', match: "color: '#06B6D4'", rule: 'inline text style', count: 1, reason: 'Chart series colour (Storage): the top-drivers swatch, not text.' },
  { file: 'app/(app)/costs/page.tsx', match: "color: '#0F172A'", rule: 'inline text style', count: 2, reason: 'Chart series colour (Actual spend): the legend line stroke, not text (demo and real legends).' },
  { file: 'app/(app)/costs/page.tsx', match: "color: '#7C3AED'", rule: 'inline text style', count: 1, reason: 'Chart series colour (AI forecast, demo only): the legend line stroke, not text.' },
  { file: 'app/(app)/costs/page.tsx', match: 'fontSize: 10', rule: 'inline text style', count: 2, reason: 'Spend trend Y axis ticks ($x.xk) on a fixed width={48} axis: 12 px would crowd it, so the size stays 10 and the colour is CHART_TICK (founder decision, Oct 26). Demo and real charts.' },
  { file: 'app/(app)/costs/page.tsx', match: 'fontSize: 9', rule: 'inline text style', count: 3, reason: 'Demo-only spend chart: three event labels (Apr 8, 14, 18) placed a few days apart inside the plot; at 12 px they would overlap, so they stay 9 px. Demo mode is permanently off.' },
  { file: 'app/(app)/costs/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 2, reason: 'Decorative icons (svg, not text): the query box search icon and the chart loading spinner; kept, no visible change.' },
  { file: 'app/(app)/costs/by-team/page.tsx', match: "color: '#7C3AED'", rule: 'inline text style', count: 2, reason: "Decorative KPI icons (svg, not text): the demo Total Monthly Spend icon's colour key and the spend card's dollar icon." },
  { file: 'app/(app)/costs/by-team/page.tsx', match: "color: '#4f8ef7'", rule: 'inline text style', count: 1, reason: "Demo-only KPI icon and its tile tint (svg and background, not text). Demo mode is permanently off." },
  { file: 'app/(app)/costs/by-team/page.tsx', match: "color: '#38c9a0'", rule: 'inline text style', count: 1, reason: "Demo-only KPI icon and its tile tint (svg and background, not text). Demo mode is permanently off." },
  { file: 'app/(app)/costs/by-team/page.tsx', match: "color: '#e05d2e'", rule: 'inline text style', count: 1, reason: "Demo-only KPI icon and its tile tint (svg and background, not text). Demo mode is permanently off." },
  { file: 'app/(app)/costs/by-team/page.tsx', match: 'fontSize: 11', rule: 'inline text style', count: 1, reason: 'Demo-only team bar chart: category names (up to 20 characters) on a fixed width={130} Y axis; 12 px would crowd it, so the size stays 11 (slate-600 already). Founder decision, Oct 26.' },
  { file: 'app/(app)/costs/by-team/page.tsx', match: 'text-slate-300', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The decorative Users icon above the "not available yet" message (svg, not text); kept, no visible change.' },
  { file: 'app/(app)/costs/efficiency/page.tsx', match: 'color: QUADRANT_COLORS', rule: 'inline text style', count: 1, reason: 'Scatter tooltip: the quadrant name in its series colour, chosen at runtime and shared with the chart fills. A separate text palette is a colour change, not a role swap; left for a later pass.' },
  { file: 'app/(app)/costs/efficiency/page.tsx', match: 'color: efficiencyColor(r.efficiency)', rule: 'inline text style', count: 1, reason: "Demo-only efficiency % in the wasteful-resources table, in the same runtime colour as its bar. Demo mode is permanently off." },
  { file: 'app/(app)/costs/efficiency/page.tsx', match: 'color: isDemoActive', rule: 'inline text style', count: 1, reason: "Efficiency score by service: demo shows the score in its bar's runtime colour; real accounts show a muted '—' (#9ca3af). Left with the quadrant colours for a later pass." },
  { file: 'app/(app)/forecast/page.tsx', match: 'fontWeight: 600', rule: 'inline text style', count: 1, reason: "The chart's 'Today' marker label: SVG text that can't take a class, at the label role's 600 (it was bold) with CHART_TICK's size and a red-700 fill." },
  { file: 'app/(app)/forecast/page.tsx', match: "color: '#534AB7'", rule: 'inline text style', count: 1, reason: "Forecast driver bar colour (Compute): a bar fill, not text." },
  { file: 'app/(app)/forecast/page.tsx', match: "color: '#1D9E75'", rule: 'inline text style', count: 1, reason: "Forecast driver bar colour (Storage): a bar fill, not text." },
  { file: 'app/(app)/forecast/page.tsx', match: "color: '#7F77DD'", rule: 'inline text style', count: 1, reason: "Forecast driver bar colour (Database): a bar fill, not text." },
  { file: 'app/(app)/forecast/page.tsx', match: "color: '#BA7517'", rule: 'inline text style', count: 1, reason: "Forecast driver bar colour (Network): a bar fill, not text." },
  { file: 'app/(app)/forecast/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The decorative Brain icon in the no-data state (svg, not text); kept, no visible change.' },
  { file: 'app/(app)/cost-optimization/page.tsx', match: "color: 'bg-red-500'", rule: 'inline text style', count: 1, reason: "Not a style: the severity breakdown's `color` key holds the High bar's background class." },
  { file: 'app/(app)/cost-optimization/page.tsx', match: "color: 'bg-amber-500'", rule: 'inline text style', count: 1, reason: "Not a style: the severity breakdown's `color` key holds the Medium bar's background class." },
  { file: 'app/(app)/cost-optimization/page.tsx', match: "color: 'bg-slate-400'", rule: 'inline text style', count: 1, reason: "Not a style: the severity breakdown's `color` key holds the Low bar's background class." },
  { file: 'app/(app)/cost-optimization/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 4, reason: 'Decorative icons (svg, not text): the empty-state CloudOff and two Clock icons, and the rule list Server icon; kept, no visible change.' },
  { file: 'app/(app)/cost-optimization/page.tsx', match: 'text-red-500', rule: 'text colour below AA on light surfaces', count: 1, reason: "The failed-analysis empty state's decorative alert icon (svg, not text); kept, no visible change." },
  { file: 'app/(app)/cost-optimization/page.tsx', match: 'opacity-60', variant: 'disabled:', rule: 'opacity on content', count: 2, reason: 'Disabled-state dimming on the Resolve and Dismiss buttons, kept until the solid disabled style lands in its own PR (founder decision, Oct 24).' },
  { file: 'app/(app)/cost-optimization/controls/page.tsx', match: 'text-gray-400', rule: 'text colour below AA on light surfaces', count: 1, reason: "The Enterprise gate's decorative Lock icon (svg, not text); kept, no visible change." },
  { file: 'app/(app)/cost-optimization/controls/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 1, reason: "The info line's decorative sliders icon (svg, not text); kept, no visible change." },
  { file: 'app/(app)/cost-optimization/controls/page.tsx', match: 'text-red-400', rule: 'text colour below AA on light surfaces', count: 1, reason: "The load-error state's decorative alert icon (svg, not text); kept, no visible change." },
  { file: 'app/(app)/cost-optimization/controls/page.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 2, reason: 'Disabled-state dimming on the Save and Reset buttons, kept until the solid disabled style lands in its own PR (founder decision, Oct 24).' },
  { file: 'components/ui/breadcrumb.tsx', match: 'text-gray-400', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The decorative chevron icon between steps (an svg, not text); kept, no visible change (typography plan T2c).' },
  { file: 'components/error-boundary.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 1, reason: "The fallback's alert icon on its red-100 circle: an icon, not text; kept like the error-display icons (typography plan T2b, T2c)." },
  // G1: Infrastructure + Services.
  { file: 'app/(app)/infrastructure/overview/OverviewHeader.tsx', match: 'opacity-60', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming on the Sync button (one class string for the phone and desktop copies), kept until the solid disabled style lands in its own PR (founder decision, Oct 24).' },
  { file: 'app/(app)/infrastructure/overview/PlanBanners.tsx', match: 'text-lg', rule: 'Tailwind size scale (use a role token)', count: 1, reason: "The resource-limit prompt's decorative warning emoji, the same as the legacy page's; kept, no visible change." },
  { file: 'app/(app)/infrastructure/new/page.tsx', match: 'text-[#635BFF]', rule: 'arbitrary text colour', count: 1, reason: "The card header's decorative Server icon (svg, not text) on its own tint; kept, no visible change." },
  { file: 'app/(app)/infrastructure/new/page.tsx', match: 'text-base', rule: 'Tailwind size scale (use a role token)', count: 4, reason: "16 px input text on the AWS Resource ID and Monthly Cost inputs (both branches of each error ternary): kept so iOS Safari doesn't zoom the page on focus; the Input default is text-ui (14)." },
  { file: 'app/(app)/services/new/page.tsx', match: 'text-[#635BFF]', rule: 'arbitrary text colour', count: 1, reason: "The card header's decorative Layers icon (svg, not text) on its own tint; kept, no visible change." },
  { file: 'app/(app)/services/new/page.tsx', match: 'text-base', rule: 'Tailwind size scale (use a role token)', count: 8, reason: "16 px text on the Name, Owner Email, GitHub URL and Description fields (both branches of each error ternary): kept so iOS Safari doesn't zoom the page on focus; the Input and Textarea default is text-ui (14)." },
  { file: 'app/(app)/services/ServicesHeader.tsx', match: 'opacity-70', rule: 'opacity on content', count: 1, reason: 'Busy dimming on Auto Discover while it is disabled (scanning, or a scan already running), kept until the solid disabled style lands in its own PR (founder decision, Oct 24).' },
  { file: 'app/(app)/services/AddServiceButton.tsx', match: 'opacity-50', rule: 'opacity on content', count: 1, reason: 'The disabled + Add Service button shown to members and viewers, kept until the solid disabled style lands in its own PR (founder decision, Oct 24).' },
  { file: 'app/(app)/services/AllResourcesTable.tsx', match: 'text-slate-500', rule: 'text colour below AA on light surfaces', count: 4, reason: 'Decorative icons (svg, not text): the loading RefreshCw and the Layers and SearchX empty-state icons; kept, no visible change.' },
  { file: 'app/(app)/services/AllResourcesTable.tsx', match: 'opacity-60', rule: 'opacity on content', count: 2, reason: "The table's dimming while the next page or filter is loading (state.dimmed, a loading state), and the disabled Phase 2 'Service' group-by button; kept until the solid disabled style lands in its own PR." },
  { file: 'app/(app)/services/AllResourcesTable.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 2, reason: 'Disabled-state dimming on the Previous and Next page buttons, kept until the solid disabled style lands in its own PR (founder decision, Oct 24).' },
  { file: 'app/(app)/services/UnownedCard.tsx', match: 'opacity-60', rule: 'opacity on content', count: 1, reason: "The disabled Phase 2 'Assign owner' button, kept until the solid disabled style lands in its own PR (founder decision, Oct 24)." },
  { file: 'app/(app)/services/YourServices.tsx', match: 'opacity-60', rule: 'opacity on content', count: 1, reason: "The disabled Phase 2 'Map resources to services' button, kept until the solid disabled style lands in its own PR (founder decision, Oct 24)." },
  // G1: Invoices and AI Reports.
  { file: 'app/(app)/invoices/page.tsx', match: 'opacity-60', rule: 'opacity on content', count: 2, reason: 'Disabled dimming on the Export button with no invoices, and on the status tabs while there is no billing data (pointer-events-none); kept until the solid disabled style lands in its own PR.' },
  { file: 'app/(app)/invoices/page.tsx', match: 'text-slate-300', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The loading state\'s decorative RefreshCw icon (svg, not text); kept, no visible change.' },
  { file: 'app/(app)/invoices/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 2, reason: 'The two empty states\' decorative FileText icons (svg, not text); kept, no visible change.' },
  { file: 'app/(app)/invoices/page.tsx', match: 'text-base', rule: 'Tailwind size scale (use a role token)', count: 1, reason: "The billing-error notice's decorative warning emoji; kept, no visible change." },
  { file: 'components/invoices/invoice-form-dialog.tsx', match: 'text-red-500', rule: 'text colour below AA on light surfaces', count: 1, reason: "The line item's decorative Trash2 remove icon (svg, not text; the button has its own label); kept, no visible change." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'opacity-70', rule: 'opacity on content', count: 2, reason: "Busy dimming on the confirm dialog's Delete button while deleting, and on Generate Executive Summary while a report generates; kept until the solid disabled style lands in its own PR." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'opacity-60', rule: 'opacity on content', count: 1, reason: "Busy dimming on the Available Reports 'Generate →' buttons while another report generates; kept until the solid disabled style lands in its own PR." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'opacity-90', variant: 'hover:', rule: 'opacity on content', count: 1, reason: "Hover feedback on the 'Generate →' buttons (white text on the report-type fill), not resting content; kept, no visible change." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'text-lg', rule: 'Tailwind size scale (use a role token)', count: 1, reason: "The Pro-plan banner's decorative warning emoji; kept, no visible change." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'text-3xl', rule: 'Tailwind size scale (use a role token)', count: 1, reason: "The empty state's decorative sparkles emoji; kept, no visible change." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 1, reason: "Recommended Next's decorative Shield icon (svg, not text) on its red-50 tile; kept, no visible change." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'text-slate-300', rule: 'text colour below AA on light surfaces', count: 1, reason: "The loading state's decorative RefreshCw icon (svg, not text); kept, no visible change." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 1, reason: "The report menu's decorative Download icon (svg, not text); kept, no visible change." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'text-red-500', rule: 'text colour below AA on light surfaces', count: 1, reason: "The report menu's decorative Trash2 icon (svg, not text); kept, no visible change." },
  ...["'#16A34A'", "'#DC2626'", "'#2563EB'", "'#7C3AED'"].map((hex) => ({ file: 'app/(app)/ai-reports/page.tsx', match: `color: ${hex}`, rule: 'inline text style', count: 1, reason: 'A report-type colour key (typeConfig): the icon colour and the type pill text on its own tint. Kept: a colour change, not a role swap, is out of scope (listed as unconverted in the G1 report).' })),
  { file: 'app/(app)/ai-reports/page.tsx', match: "color : '#7C3AED'", rule: 'inline text style', count: 1, reason: "Not a text colour: the Generate button's background ternary (`tc.color : '#7C3AED'`) reads as `color :` to the rule." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'color: badgeColor', rule: 'inline text style', count: 1, reason: "Available Reports badge text in its listed colour key (#059669, #475569 or #7C3AED on its own tint); kept, listed as unconverted in the G1 report." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'color: lastTypeConfig.color', rule: 'inline text style', count: 1, reason: "Last Outcome's type pill text in the report-type colour key; kept, listed as unconverted in the G1 report." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'color: tc.color', rule: 'inline text style', count: 2, reason: "Report Activity's per-type count chips and the Available Reports icon boxes, in the report-type colour key; kept, listed as unconverted in the G1 report." },
  { file: 'app/(app)/ai-reports/page.tsx', match: 'color: type.color', rule: 'inline text style', count: 2, reason: "Recent Reports' icon box and type pill, in the report-type colour key; kept, listed as unconverted in the G1 report." },
  { file: 'app/(app)/ai-reports/[id]/page.tsx', match: 'text-slate-300', rule: 'text colour below AA on light surfaces', count: 1, reason: "The error state's decorative AlertCircle icon (svg, not text); kept, no visible change." },
  { file: 'app/(app)/ai-reports/[id]/page.tsx', match: "color: '#16A34A'", rule: 'inline text style', count: 2, reason: 'The Cost report-type colour key and the low-impact key (icon colour and pill text on its own tint); kept, listed as unconverted in the G1 report.' },
  { file: 'app/(app)/ai-reports/[id]/page.tsx', match: "color: '#DC2626'", rule: 'inline text style', count: 2, reason: 'The Security report-type colour key and the high-impact key (icon colour and pill text on its own tint); kept, listed as unconverted in the G1 report.' },
  { file: 'app/(app)/ai-reports/[id]/page.tsx', match: "color: '#2563EB'", rule: 'inline text style', count: 1, reason: 'The Infrastructure report-type colour key (icon colour and pill text on its own tint); kept, listed as unconverted in the G1 report.' },
  { file: 'app/(app)/ai-reports/[id]/page.tsx', match: "color: '#7C3AED'", rule: 'inline text style', count: 1, reason: 'The Executive report-type colour key (icon colour and pill text on its own tint); kept, listed as unconverted in the G1 report.' },
  { file: 'app/(app)/ai-reports/[id]/page.tsx', match: "color: '#D97706'", rule: 'inline text style', count: 1, reason: 'The medium-impact colour key (recommendation pill text on its own tint); kept, listed as unconverted in the G1 report.' },
  { file: 'app/(app)/ai-reports/[id]/page.tsx', match: 'color: type.color', rule: 'inline text style', count: 2, reason: "The header's icon box and type pill, in the report-type colour key; kept, listed as unconverted in the G1 report." },
  { file: 'app/(app)/ai-reports/[id]/page.tsx', match: 'color: impact.color', rule: 'inline text style', count: 1, reason: "A recommendation's impact pill text in its impact colour key; kept, listed as unconverted in the G1 report." },
  // SM: the Security menu pages (reviewed exceptions). Status colour keys that also colour tints, rings, bars or
  // toggles; decorative icons, glyphs and dividers; disabled-state dimming (the "Disabled" badge and the solid disabled
  // style are deferred); and one fixed-width table column kept at its size.
  { file: 'app/(app)/anomalies/page.tsx', match: 'text-lg', rule: 'Tailwind size scale (use a role token)', count: 1, reason: 'The decorative ⚠️ emoji in the Pro-plan banner (as on AI Reports and the Infrastructure limit prompt).' },
  { file: 'app/(app)/anomalies/page.tsx', match: "color: '#DC2626'", rule: 'inline text style', count: 1, reason: 'severityConfig.critical: the severity colour key (chip text on its own #FEF2F2 tint and border); kept unchanged.' },
  { file: 'app/(app)/anomalies/page.tsx', match: "color: '#D97706'", rule: 'inline text style', count: 1, reason: 'severityConfig.warning: the severity colour key (chip text on its own #FFFBEB tint and border); kept unchanged.' },
  { file: 'app/(app)/anomalies/page.tsx', match: "color: '#64748B'", rule: 'inline text style', count: 1, reason: 'severityConfig.info: the severity colour key (chip text on its own #F8FAFC tint and border); kept unchanged.' },
  { file: 'app/(app)/anomalies/page.tsx', match: 'color: sev.color', rule: 'inline text style', count: 1, reason: "An anomaly's severity chip, in the severityConfig key with its tint background." },
  { file: 'app/(app)/anomalies/page.tsx', match: 'color: sc', rule: 'inline text style', count: 1, reason: "A custom rule's severity pill, in the rule severity key (sc) with its tint (sb)." },
  { file: 'app/(app)/anomalies/page.tsx', match: 'color: rule.enabled', rule: 'inline text style', count: 1, reason: 'The rule toggle icon: violet when on, slate-400 when off; the colour shows the toggle state.' },
  { file: 'app/(app)/anomalies/page.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 1, reason: "The insight banner's decorative AlertTriangle icon in its red tint box (svg, not text)." },
  { file: 'app/(app)/anomalies/page.tsx', match: 'text-slate-200', rule: 'text colour below AA on light surfaces', count: 3, reason: 'Decorative "|" dividers in the status bar, the filter row and the bulk-action bar.' },
  { file: 'app/(app)/anomalies/page.tsx', match: 'text-slate-300', rule: 'text colour below AA on light surfaces', count: 3, reason: 'The decorative loading icon, and the two "|" dividers in the confidence/deviation line.' },
  { file: 'app/(app)/anomalies/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 4, reason: "Decorative icons: the two empty states' AlertCircle, the icon-only row menu button (MoreHorizontal) and View Details' ChevronDown." },
  { file: 'app/(app)/anomalies/page.tsx', match: 'text-amber-500', rule: 'text colour below AA on light surfaces', count: 2, reason: 'Decorative AlertCircle icons in the Unassigned pill and the Impact row.' },
  { file: 'app/(app)/anomalies/page.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 2, reason: 'Resolve selected / Ignore selected while nothing is selected; the solid disabled style is deferred.' },
  { file: 'app/(app)/anomalies/page.tsx', match: 'opacity-60', rule: 'opacity on content', count: 1, reason: 'A disabled custom rule row; the "Disabled" badge change (plan §1.6, H3) is deferred.' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: "color: '#DC2626'", rule: 'inline text style', count: 2, reason: 'SEVERITY_CONFIG.critical (pill text on its own tint and border) and the Critical Rules KPI value in the same severity colour; kept unchanged.' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: "color: '#D97706'", rule: 'inline text style', count: 2, reason: 'SEVERITY_CONFIG.warning (pill text on its own tint and border) and the Warning Rules KPI value in the same severity colour; kept unchanged.' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: "color: '#64748B'", rule: 'inline text style', count: 1, reason: 'SEVERITY_CONFIG.info (pill text on its own tint and border); kept unchanged.' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: "color: '#1e1b4b'", rule: 'inline text style', count: 1, reason: 'The Total Rules KPI value in the KPI colour key (indigo-950, 15:1 on white); kept unchanged with the rest of the key.' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: "color: '#059669'", rule: 'inline text style', count: 1, reason: 'The Active Rules KPI value (30 px) in the KPI colour key; kept unchanged.' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: 'color: sev.color', rule: 'inline text style', count: 1, reason: "A rule's severity pill, in SEVERITY_CONFIG with its tint background and border." },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: 'text-xl', rule: 'Tailwind size scale (use a role token)', count: 1, reason: 'The create form\'s "×" close glyph (an icon character on an icon-only button).' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 2, reason: 'Icon-only buttons: the form\'s "×" close glyph and the Trash2 delete button.' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: 'text-red-500', variant: 'hover:', rule: 'text colour below AA on light surfaces', count: 1, reason: 'Hover feedback on the icon-only Trash2 delete button (not resting text).' },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: 'text-gray-400', rule: 'text colour below AA on light surfaces', count: 1, reason: "The Enterprise gate's decorative Lock icon." },
  { file: 'app/(app)/anomalies/rules/page.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 3, reason: 'Create Rule while saving, Enable/Disable while toggling and Delete while deleting; the solid disabled style is deferred.' },
  { file: 'app/(app)/compliance/frameworks/page.tsx', match: 'color: isDemoActive', rule: 'inline text style', count: 1, reason: "The compliance score ring's centre label, in the same colour as the ring stroke (amber in demo, slate-400 for N/A)." },
  { file: 'app/(app)/compliance/frameworks/page.tsx', match: "color: 'red'", rule: 'inline text style', count: 1, reason: "Not a style: a Priority Actions row's `color` key holds a tone name." },
  { file: 'app/(app)/compliance/frameworks/page.tsx', match: "color: 'amber'", rule: 'inline text style', count: 1, reason: "Not a style: a Priority Actions row's `color` key holds a tone name." },
  { file: 'app/(app)/compliance/frameworks/page.tsx', match: "color: 'slate'", rule: 'inline text style', count: 1, reason: "Not a style: a Priority Actions row's `color` key holds a tone name." },
  { file: 'app/(app)/compliance/frameworks/page.tsx', match: 'color: statusColor', rule: 'inline text style', count: 2, reason: "A framework's status pill (on its own tint) and its % beside the progress bar filled with the same colour." },
  { file: 'app/(app)/compliance/frameworks/page.tsx', match: 'color: fw.badgeColor', rule: 'inline text style', count: 1, reason: "A framework card's badge, in the framework badge key with its badgeBg tint." },
  { file: 'app/(app)/compliance/frameworks/page.tsx', match: 'text-slate-300', rule: 'text colour below AA on light surfaces', count: 2, reason: 'Decorative spinning RefreshCw loading icons (frameworks, evaluations).' },
  { file: 'app/(app)/compliance/frameworks/page.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Sync Security Hub while syncing; the solid disabled style is deferred.' },
  { file: 'components/compliance/FrameworkDetailsModal.tsx', match: 'text-gray-400', rule: 'text colour below AA on light surfaces', count: 1, reason: "The empty state's decorative AlertTriangle icon." },
  { file: 'components/compliance/FrameworkDetailsModal.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The icon-only delete-rule button (Trash2 icon).' },
  { file: 'components/compliance/FrameworkDetailsModal.tsx', match: 'opacity-60', rule: 'opacity on content', count: 1, reason: 'A disabled rule card; the "Disabled" badge change (plan §1.6, H3) is deferred.' },
  { file: 'components/compliance/ScanResultsModal.tsx', match: 'text-green-600', rule: 'text colour below AA on light surfaces', count: 2, reason: "Status icons: a passed finding's CheckCircle2 and the passed-list CheckCircle2." },
  { file: 'components/compliance/ScanResultsModal.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 1, reason: "Status icon: a failed finding's XCircle." },
  { file: 'components/compliance/ScanResultsModal.tsx', match: 'text-orange-600', rule: 'text colour below AA on light surfaces', count: 1, reason: "Status icon: a warning finding's AlertCircle." },
  { file: 'components/compliance/ScanResultsModal.tsx', match: 'text-gray-400', rule: 'text colour below AA on light surfaces', count: 2, reason: "A skipped finding's SkipForward icon, and the decorative \"•\" separator in the passed list." },
  { file: 'app/(app)/audit-logs/page.tsx', match: 'text-xs', rule: 'Tailwind size scale (use a role token)', count: 1, reason: "The desktop table's IP cell kept at 12 px: a fixed 120px mono column with no truncation, where 13 px would fill about 117 of 120px." },
  { file: 'app/(app)/audit-logs/page.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The decorative "⚠" glyph in the anomaly notice\'s red tint icon box.' },
  { file: 'app/(app)/audit-logs/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The decorative "⌕" search glyph inside the search field.' },
  { file: 'app/(app)/audit-logs/page.tsx', match: 'text-slate-300', rule: 'text colour below AA on light surfaces', count: 3, reason: 'The decorative loading icon, and the disabled Previous/Next pager text: colour is their only disabled cue (the solid disabled style is deferred).' },
  { file: 'app/(app)/audit-logs/page.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 2, reason: 'Export and the search field while there are no logs; the solid disabled style is deferred.' },
  // DEVOPS
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: "color: '#059669'", rule: 'inline text style', count: 1, reason: 'tierStyle elite: the tier key also colours the pill tint, the KPI card top border and the demo sparkline; kept (listed for the colour/TG PR).' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: "color: '#2563EB'", rule: 'inline text style', count: 1, reason: 'tierStyle high: the tier key also colours the pill tint, the KPI card top border and the demo sparkline; kept.' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: "color: '#D97706'", rule: 'inline text style', count: 1, reason: 'tierStyle medium: the tier key also colours the pill tint, the KPI card top border and the demo sparkline; kept (listed for the colour/TG PR).' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: "color: '#DC2626'", rule: 'inline text style', count: 1, reason: 'tierStyle low: the tier key also colours the pill tint, the KPI card top border and the demo sparkline; kept.' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: 'color: dataStateColor', rule: 'inline text style', count: 1, reason: 'The header data-state line: the same colour fills its status dot beside it; kept (listed for the colour/TG PR).' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: 'color: isDemoActive', rule: 'inline text style', count: 1, reason: 'The demo score ring centre label, in the same colour as the ring stroke.' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: 'color: row.ts.color', rule: 'inline text style', count: 2, reason: 'The benchmark table: the tier pill (on its tier tint) and the "You" row values in the same tier colour.' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: "color: '#94A3B8'", rule: 'inline text style', count: 1, reason: 'The N/A tier fallback: also the KPI card top border; kept (the N/A pill contrast is listed for the colour/TG PR).' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: 'color: ts.color', rule: 'inline text style', count: 3, reason: 'Tier pills on their tier tint: the KPI card pill and the Service Breakdown pills (desktop and phone).' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: 'text-slate-500', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The real-summary decorative Activity icon in its tile.' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 2, reason: 'Export CSV / Download PDF without exportable data; the solid disabled style is deferred.' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: 'text-xs', rule: 'Tailwind size scale (use a role token)', count: 1, reason: 'Dense table: the benchmark grid cells (fixed 110px tier column plus four columns, about 50px each on a phone) stay at 12 px.' },
  { file: 'app/(app)/app/dora-metrics/page.tsx', match: 'text-xl', rule: 'Tailwind size scale (use a role token)', count: 1, reason: 'The decorative 🔒 emoji in the Enterprise benchmark gate.' },
  { file: 'app/(app)/deployments/page.tsx', match: 'text-lg', rule: 'Tailwind size scale (use a role token)', count: 1, reason: 'The decorative ⚠️ emoji in the deployment-limit upgrade prompt.' },
  { file: 'app/(app)/deployments/page.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 3, reason: "Status icons: the error banner's AlertTriangle and the failed row's XCircle (phone and desktop)." },
  { file: 'app/(app)/deployments/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 4, reason: 'Decorative: the loading RefreshCw and empty-state Rocket icons, the aria-hidden "…" page gap, and the icon-only modal close button (X).' },
  { file: 'app/(app)/deployments/page.tsx', match: 'color: statusColor', rule: 'inline text style', count: 3, reason: 'Not a style once (destructuring color from lib/deployments/status); twice the status pill on its own tint (phone, desktop).' },
  { file: 'app/(app)/deployments/page.tsx', match: 'color: envColor', rule: 'inline text style', count: 2, reason: 'The environment pill on its own tint (phone, desktop); kept (listed for the colour/TG PR).' },
  { file: 'app/(app)/deployments/page.tsx', match: 'opacity-40', variant: 'disabled:', rule: 'opacity on content', count: 2, reason: 'Previous / Next at the first or last page; the solid disabled style is deferred.' },
  { file: 'app/(app)/deployments/new/page.tsx', match: 'text-[#635BFF]', rule: 'arbitrary text colour', count: 1, reason: 'The decorative Rocket icon in the form card title.' },
  { file: 'app/(app)/deployments/new/page.tsx', match: 'text-base', rule: 'Tailwind size scale (use a role token)', count: 2, reason: 'The Deployed By input keeps its 16 px text (one class per branch of the error ternary).' },
  { file: 'components/deployments/LiveLogViewer.tsx', match: 'text-green-400', rule: 'text colour below AA on light surfaces', count: 1, reason: 'Log text on the black terminal surface (light on dark).' },
  { file: 'components/deployments/LiveLogViewer.tsx', match: 'text-gray-500', rule: 'text colour below AA on light surfaces', count: 2, reason: 'The placeholder and timestamps inside the black terminal surface, not on a light one.' },
  { file: 'app/(app)/dependencies/page.tsx', match: 'text-amber-600', rule: 'text colour below AA on light surfaces', count: 1, reason: "The slow-load notice's aria-hidden Clock icon." },
  { file: 'app/(app)/dependencies/page.tsx', match: 'text-slate-400', rule: 'text colour below AA on light surfaces', count: 1, reason: "The details panel's icon-only close button (X)." },
  { file: 'components/dependencies/DependencyGraph.tsx', match: 'color: edge.data', rule: 'inline text style', count: 1, reason: "Not text: the edge arrow marker's colour (critical red, standard grey)." },
  { file: 'components/dependencies/DependencyGraph.tsx', match: 'fontSize: 12', rule: 'inline text style', count: 1, reason: 'React Flow edge labels are SVG text that takes labelStyle, not a class: 10 -> 12 px (founder decision, DevOps group).' },
  { file: 'components/dependencies/DependencyGraph.tsx', match: 'fontWeight: edge.data', rule: 'inline text style', count: 1, reason: "React Flow edge label weight: critical edges 600 (was 'bold'), others normal (founder decision, DevOps group)." },
  { file: 'components/dependencies/DependencyGraph.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 1, reason: "The graph error state's aria-hidden AlertCircle icon." },
  { file: 'components/dependencies/ImpactAnalysisView.tsx', match: 'text-orange-600', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The Downstream Dependents card title ArrowDown icon.' },
]

type Finding = { rule: string; match: string; variant: string; line: number }

function findingsIn(source: string): Finding[] {
  const out: Finding[] = []
  for (const [rule, re] of Object.entries(RULES)) {
    for (const m of source.matchAll(re)) {
      // Classes are reported without their variants, which are kept apart; inline styles with their spacing
      // normalised.
      const variant = rule === 'inline text style' ? '' : (m[0].match(new RegExp(`^(?:${VARIANT}:)+`))?.[0] ?? '')
      const match = rule === 'inline text style' ? m[0].replace(/\s+/g, ' ') : m[0].slice(variant.length)
      if (rule === 'inline text style' && isAppColourVar(match)) continue
      out.push({ rule, match, variant, line: source.slice(0, m.index).split('\n').length })
    }
  }
  return out
}

const findings = (file: string) => findingsIn(readFileSync(join(process.cwd(), file), 'utf8'))
const covers = (entry: (typeof ALLOWED)[number], f: Finding) =>
  entry.match === f.match && entry.rule === f.rule && (entry.variant ?? '') === f.variant

describe('strict typography for the pages on the app type scale', () => {
  it('the rules catch each kind of drift (self-check)', () => {
    // Assembled at runtime so Tailwind's scan of this file does not generate these utilities.
    const t = 'text'
    const bad: [string, string][] = [
      [`${t}-sm`, 'Tailwind size scale (use a role token)'],
      [`md:${t}-2xl`, 'Tailwind size scale (use a role token)'],
      [`${t}-[13px]`, 'arbitrary font size'],
      [`${t}-[0.75rem]`, 'arbitrary font size'],
      ['font-bold', 'bold weight (roles carry 600)'],
      ['style={{ fontSize: 12 }}', 'inline text style'],
      ["style={{ color: '#94A3B8' }}", 'inline text style'],
      ["style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}", 'inline text style'],
      ['style={{ lineHeight: 1.1 }}', 'inline text style'],
      ['style={{ color: stringTone }}', 'inline text style'],
      ['style={{ color: string.tone }}', 'inline text style'],
      ['style={{ fontSize: numberSize }}', 'inline text style'],
      [`[&_p]:${t}-sm`, 'Tailwind size scale (use a role token)'],
      [`data-[state=open]:${t}-xs`, 'Tailwind size scale (use a role token)'],
      [`[&_span]:${t}-[13px]`, 'arbitrary font size'],
      [['group-[.is-x]', 'font-bold'].join(':'), 'bold weight (roles carry 600)'],
      [`[&>p]:${t}-slate-400`, 'text colour below AA on light surfaces'],
      [['[font-size', '12px]'].join(':'), 'arbitrary text property'],
      [['md:[color', '#999]'].join(':'), 'arbitrary text property'],
      [`${t}-slate-500`, 'text colour below AA on light surfaces'],
      [`hover:${t}-gray-400`, 'text colour below AA on light surfaces'],
      [`${t}-green-600`, 'text colour below AA on light surfaces'],
      [`${t}-red-600`, 'text colour below AA on light surfaces'],
      [`${t}-[#047857]`, 'arbitrary text colour'],
      [`${t}-[var(--text-secondary)]`, 'arbitrary text colour'],
      [`hover:${t}-[var(--text-accent)]`, 'arbitrary text colour'],
      ['opacity-70', 'opacity on content'],
    ]
    for (const [cls, rule] of bad) {
      const re = new RegExp(RULES[rule].source)
      expect(`className="${cls}"`, `${cls} -> ${rule}`).toMatch(re)
    }
    const fine = [`${t}-ui`, `${t}-ink-muted`, `${t}-slate-600`, `${t}-green-700`, `dark:${t}-[var(--text-secondary)]`, `dark:${t}-slate-400`, `[&_p]:${t}-ui`, 'font-semibold', 'disabled:cursor-not-allowed', "style={{ background: 'var(--bg-accent)' }}", '{ label: string; color: string }', '{ fontSize: number }']
    for (const cls of fine) {
      for (const [rule, re] of Object.entries(RULES)) expect(`className="${cls}"`, `${cls} vs ${rule}`).not.toMatch(new RegExp(re.source))
    }
  })

  it.each(STRICT)('%s has no drift outside the reviewed exceptions', (file) => {
    const all = findings(file)
    const unexpected = all.filter((f) => !ALLOWED.some((a) => a.file === file && covers(a, f)))
    expect(unexpected.map((f) => `${file}:${f.line} ${f.variant}${f.match} (${f.rule})`)).toEqual([])
    // An allowed class or style may occur exactly as often as reviewed: one more is drift too.
    for (const entry of ALLOWED.filter((a) => a.file === file)) {
      const found = all.filter((f) => covers(entry, f))
      expect(found.map((f) => `${file}:${f.line} ${f.variant}${f.match}`), `${entry.variant ?? ''}${entry.match} may occur ${entry.count}x`).toHaveLength(entry.count)
    }
  })

  it("only the app's listed colour variables pass as plain inline colours (self-check)", () => {
    expect(findingsIn("style={{ color: 'var(--text-success)' }}")).toEqual([])
    expect(findingsIn('style={{ color: "var(--app-color-ink-danger-strong)" }}')).toEqual([])
    const flagged = [
      "style={{ color: 'var(--bg-success)' }}",
      "style={{ color: 'var(--text-secondary-x)' }}",
      "style={{ color: 'var(--text-accent, #000)' }}",
      'style={{ color: tone.color }}',
      "style={{ color: '#7C3AED' }}",
    ]
    for (const style of flagged) expect(findingsIn(style).map((f) => f.rule), style).toContain('inline text style')
    expect(Object.keys(APP_COLOUR_VARS)).toHaveLength(8)
  })

  it('an exception covers only its own variant chain (self-check)', () => {
    const entry = { file: 'x', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: '' }
    const [disabled, bare, hover] = findingsIn('className="disabled:opacity-50 opacity-50 hover:opacity-50"')
    expect([disabled.variant, bare.variant, hover.variant]).toEqual(['disabled:', '', 'hover:'])
    expect([covers(entry, disabled), covers(entry, bare), covers(entry, hover)]).toEqual([true, false, false])
    expect(covers({ ...entry, variant: undefined }, bare)).toBe(true)
    expect(covers({ ...entry, variant: undefined }, disabled)).toBe(false)
  })

  it('the Costs additions are exactly the pages in the Costs route folders, each listed once', () => {
    const routePages = SOURCE_FILES.filter((f) => f.endsWith('.tsx') && COSTS_ROUTE_DIRS.some((d) => f.startsWith(d)))
    expect([...COSTS].sort()).toEqual(routePages)
    for (const file of COSTS) expect(STRICT.filter((f) => f === file), file).toHaveLength(1)
    expect(new Set(STRICT).size, 'no file is listed twice').toBe(STRICT.length)
  })

  it('the G1 additions are exactly the Infrastructure, Services, Invoices and AI Reports files minus the legacy ones, plus their shared components, each listed once', () => {
    const routeFiles = SOURCE_FILES.filter((f) => f.endsWith('.tsx') && G1_ROUTE_DIRS.some((d) => f.startsWith(d)))
    expect([...G1].sort()).toEqual([...routeFiles.filter((f) => !G1_LEGACY.includes(f)), ...G1_COMPONENTS].sort())
    // Each legacy entry is a real file in those folders, so a stale entry can't stand in for a missing one.
    for (const file of G1_LEGACY) expect(routeFiles, file).toContain(file)
    for (const file of G1) expect(STRICT.filter((f) => f === file), file).toHaveLength(1)
    expect(G1.filter((f) => COSTS.includes(f)), 'no file is in two groups').toEqual([])
  })

  it('the Security additions are exactly the .ts and .tsx files in the Security folders minus the legacy page, each listed once', () => {
    const securityFiles = SOURCE_FILES.filter((f) => /\.tsx?$/.test(f) && SECURITY_DIRS.some((d) => f.startsWith(d)))
    expect([...SECURITY].sort()).toEqual(securityFiles.filter((f) => !SECURITY_LEGACY.includes(f)))
    for (const file of SECURITY_LEGACY) expect(securityFiles, file).toContain(file)
    for (const file of SECURITY) expect(STRICT.filter((f) => f === file), file).toHaveLength(1)
    expect(SECURITY.filter((f) => COSTS.includes(f) || G1.includes(f)), 'no file is in two groups').toEqual([])
  })

  it('the SM additions are exactly the Anomalies, Compliance and Audit Logs files plus components/compliance, each listed once', () => {
    const smFiles = SOURCE_FILES.filter((f) => f.endsWith('.tsx') && [...SM_ROUTE_DIRS, ...SM_COMPONENT_DIRS].some((d) => f.startsWith(d)))
    expect([...SM].sort()).toEqual([...smFiles].sort())
    for (const file of SM) expect(STRICT.filter((f) => f === file), file).toHaveLength(1)
    expect(SM.filter((f) => COSTS.includes(f) || G1.includes(f)), 'no file is in two groups').toEqual([])
    // The Security page and lib/security belong to Security V2 and stay out of this group.
    expect(SM.filter((f) => f.startsWith('app/(app)/security/') || f.startsWith('lib/security/'))).toEqual([])
  })

  it('the DEVOPS additions are exactly the DORA, Deployments and Dependencies files plus their components, minus the unimported previews, each listed once', () => {
    const devopsFiles = SOURCE_FILES.filter((f) => f.endsWith('.tsx') && [...DEVOPS_ROUTE_DIRS, ...DEVOPS_COMPONENT_DIRS].some((d) => f.startsWith(d)))
    expect([...DEVOPS].sort()).toEqual(devopsFiles.filter((f) => !DEVOPS_UNIMPORTED.includes(f)).sort())
    // Each exclusion is a real file in those folders that nothing imports, so it can't hide a live component.
    for (const file of DEVOPS_UNIMPORTED) {
      expect(devopsFiles, file).toContain(file)
      expect(SOURCE_FILES.filter((f) => importsOf(f).includes(file)), `${file} importers`).toEqual([])
    }
    // The components are used only by these pages (or by each other), so converting them changes no other page.
    for (const file of DEVOPS.filter((f) => f.startsWith('components/'))) {
      expect(SOURCE_FILES.filter((f) => importsOf(f).includes(file) && !DEVOPS.includes(f)), `${file} importers`).toEqual([])
    }
    for (const file of DEVOPS) expect(STRICT.filter((f) => f === file), file).toHaveLength(1)
    expect(DEVOPS.filter((f) => COSTS.includes(f) || G1.includes(f) || SECURITY.includes(f) || SM.includes(f)), 'no file is in two groups').toEqual([])
    expect(new Set(STRICT).size, 'no file is listed twice').toBe(STRICT.length)
  })

  it('files outside the converted groups stay exempt', () => {
    for (const file of EXEMPT) {
      expect(SOURCE_FILES, file).toContain(file)
      expect(STRICT, file).not.toContain(file)
    }
    // Marketing and sign-in code (the non-app closure) and the frozen marketing-ui copies are never app-guarded.
    expect(STRICT.filter((f) => NON_APP_CLOSURE.has(f) || f.startsWith('components/marketing-ui/') || f.startsWith('components/landing/'))).toEqual([])
    // connect-aws is guarded since T1 and stays out of the page-group lists.
    expect(COSTS).not.toContain('app/(app)/connect-aws/page.tsx')
  })

  it('every raw size, weight, colour and opacity class the plan replaces is a finding (banned-class table)', () => {
    // Assembled at runtime so Tailwind's scan of this file does not generate these utilities.
    const t = 'text'
    const banned: [string, string][] = [
      ...['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'].map((n): [string, string] => [`${t}-${n}`, 'Tailwind size scale (use a role token)']),
      ...['9px', '10px', '11px', '12px', '13px', '26px', '0.65rem', '0.75rem', '.82rem', 'calc(1rem+2px)', 'clamp(1rem,2vw,2rem)', 'length:12px'].map((n): [string, string] => [`${t}-[${n}]`, 'arbitrary font size']),
      ...['bold', 'extrabold', 'black'].map((w): [string, string] => [`font-${w}`, 'bold weight (roles carry 600)']),
      ...['font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'color', 'opacity'].map((p): [string, string] => [`[${p}:1]`, 'arbitrary text property']),
      ...["fontSize: 11", "fontSize: '12px'", "fontWeight: 700", "fontFamily: 'monospace'", 'lineHeight: 1.4', "letterSpacing: '0.07em'", "color: '#6b7280'", 'opacity: 0.6'].map((st): [string, string] => [`style={{ ${st} }}`, 'inline text style']),
      ...['slate', 'gray', 'zinc', 'neutral', 'stone'].flatMap((h) => ['50', '100', '200', '300', '400', '500'].map((n): [string, string] => [`${t}-${h}-${n}`, 'text colour below AA on light surfaces'])),
      ...['green', 'emerald', 'teal', 'cyan', 'lime', 'amber', 'yellow', 'orange'].flatMap((h) => ['300', '400', '500', '600'].map((n): [string, string] => [`${t}-${h}-${n}`, 'text colour below AA on light surfaces'])),
      ...['red', 'blue', 'sky', 'rose', 'pink'].flatMap((h) => ['300', '400', '500'].map((n): [string, string] => [`${t}-${h}-${n}`, 'text colour below AA on light surfaces'])),
      [`${t}-red-600`, 'text colour below AA on light surfaces'],
      [`${t}-slate-400/80`, 'text colour below AA on light surfaces'],
      ...['#6b7280', 'rgb(1,2,3)', 'hsl(1,2%,3%)', 'oklch(0.5_0.1_200)', 'var(--text-secondary)'].map((c): [string, string] => [`${t}-[${c}]`, 'arbitrary text colour']),
      ...['40', '50', '60', '70', '80', '90'].map((n): [string, string] => [`opacity-${n}`, 'opacity on content']),
    ]
    for (const [cls, rule] of banned) {
      expect(findingsIn(`className="${cls}"`).map((f) => f.rule), cls).toContain(rule)
      expect(findingsIn(`className="sm:${cls}"`).map((f) => f.rule), `sm:${cls}`).toContain(rule)
    }
    // The role and ink tokens that replace them are not findings.
    const roles = ['title', 'subtitle', 'section', 'card-title', 'body', 'ui', 'meta', 'label', 'kpi'].map((r) => `${t}-${r}`)
    const inks = ['', '-body', '-muted', '-success', '-warning', '-danger', '-info', '-accent', '-success-strong'].map((i) => `${t}-ink${i}`)
    expect(findingsIn(`className="${[...roles, ...inks, 'font-semibold', 'font-medium', 'font-normal', 'tabular-nums', 'pt-page-top'].join(' ')}"`)).toEqual([])
  })

  it('every exception names a strict file, a count of at least 1 and a reason', () => {
    for (const entry of ALLOWED) {
      expect(STRICT, entry.file).toContain(entry.file)
      expect(entry.count, entry.match).toBeGreaterThanOrEqual(1)
      expect(entry.reason.length, entry.match).toBeGreaterThan(20)
    }
  })
})
