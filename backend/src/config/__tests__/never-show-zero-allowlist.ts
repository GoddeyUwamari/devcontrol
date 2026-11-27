/**
 * The "Never show $0" guard's reasoned exceptions and the check that applies
 * them (never-show-zero-guard.test.ts). Kept apart from the test so the exact
 * guard verdict can be run over any tree (fix round 1: the pre-fix base tree
 * b0a931f1, review-logs/never-zero/build.md).
 */
import { scanSource, type Finding } from './never-show-zero-scan';

/**
 * Files nothing imports (dead code): skipped while that stays true. The guard
 * test fails as soon as any source file imports one, so it is scanned again.
 */
export const UNIMPORTED: Record<string, string> = {
  'components/cost-optimization/RecommendationDrawer.tsx': 'Stage A §1b: no importer; reads the dead /api/cost-optimization endpoint.',
  'components/infrastructure/CostOptimizationPreview.tsx': 'No importer; static illustrative insights (savings are literal strings).',
  'components/billing/pricing-card.tsx': 'No importer; tier.annualSavings is a plan discount, not a finding.',
};

/**
 * file -> [a substring of the flagged expression (or of its line), why it is allowed, options].
 *   count   the exact number of findings the entry covers (default 1): a new finding that
 *           happens to share the snippet fails instead of being silently allowed (review §7 #1).
 *   within  when the reason is "only inside branch X", a substring of that branch's condition:
 *           the entry applies only while the finding still sits inside it, so the reason is
 *           checked, not just stated (the same text outside the guard is an offender).
 */
export type Entry = [snippet: string, reason: string, options?: { count?: number; within?: string }];
export const ALLOWLIST: Record<string, Entry[]> = {
  'lib/services/cost-recommendations.service.ts': [
    ['potentialSavings: parseFloat(r.potential_savings) || 0,', 'Row mappers (Stage A §1d; one per endpoint): every row is displayed through savingsFigure, where 0 and missing both read "No dollar estimate".', { count: 5 }],
    ['potentialSavingsCeiling: parseFloat(result.potential_savings_ceiling) || 0,', '/stats mapper: every reader shows the ceiling only above $0 (describeSavingsTotal "> 0", Cost Optimization ceilingTotal > 0, Infrastructure inside upper_bound_only).'],
    ['totalPotentialSavings: parseFloat(result.totalPotentialSavings) || 0,', 'POST /analyze result mapper: no surface renders this total (the page reads /stats).'],
  ],
  'lib/savings-basis.ts': [
    ['format(total)', 'describeSavingsTotal: only when total > 0; both callers\' formatters keep cents (formatWholeDollars = formatSavingsCurrency; Infrastructure 2-decimal Intl on a cent-rounded /stats total).', { within: 'total > 0 || (total === 0 && positiveEstimates)' }],
    ['formatSavingsTotal(total, stats.estimatedFindings)', 'describeSavingsTotal: reached only for total 0 with positive estimates, which formatSavingsTotal prints as "<$0.01".', { within: 'total > 0 || (total === 0 && positiveEstimates)' }],
    ['format(stats.potentialSavingsCeiling)', 'Inside "stats.potentialSavingsCeiling > 0"; format keeps cents as above.', { within: 'stats.potentialSavingsCeiling > 0' }],
  ],
  'app/(app)/cost-optimization/HiddenFindings.tsx': [
    ['const estimate = summary?.stillDetected.estimatedMonthlySavings ?? 0;', 'Used only as "estimate > 0" before the amount line is rendered (ruling Q3); 0 renders nothing.'],
    ['const ceiling = summary?.stillDetected.ceilingMonthlySavings ?? 0;', 'Used only as "ceiling > 0" before the ceiling line is rendered; 0 renders nothing.'],
  ],
  'app/(app)/cost-optimization/page.tsx': [
    ['const ceilingTotal = statsAvailable ? stats.potentialSavingsCeiling : 0;', 'Read only by "ceilingTotal > 0 ? formatSavingsCurrency(ceilingTotal) : null" on the next line.'],
  ],
  'app/(app)/costs/efficiency/page.tsx': [
    ['r.savings.toLocaleString()', 'Wasteful-resources table: a real row has savings null (rendered "—"); only the demo rows carry figures, all positive constants.', { within: 'r.savings != null' }],
    ['r.savings', 'Mobile card of the same rows ("Save $X/mo"): real rows null ("Savings —"), demo rows positive constants.', { within: 'r.savings != null' }],
  ],
  'app/(app)/dashboard/page.tsx': [
    ['formatSavingsCents(monthlySavings)', 'Inside savingsShown (monthlySavings > 0); monthlySavings is roundCents\'d (or the demo 1922), so it is at least $0.01.', { count: 2, within: 'savingsShown' }],
    ['formatSavingsCents(annualSavings)', 'Inside savingsShown: annualSavings = roundCents(monthlySavings x 12) with monthlySavings at least $0.01.', { within: 'savingsShown' }],
  ],
  'app/(app)/infrastructure/page.tsx': [
    ['formatSavingsCurrency(totalRecoverable)', 'Rendered only when pricedCount > 0, i.e. at least one estimate above $0 is summed (ruling Q4).', { within: 'pricedCount > 0' }],
    ['formatSavingsTotal(recommendationStats!.totalPotentialSavings, recommendationStats!.estimatedFindings)', 'Only for describeSavingsTotal kind "firm": total above $0, or 0 with positive estimates (formatSavingsTotal prints "<$0.01").', { within: "savingsTotal.kind === 'firm'" }],
    ['formatSavingsCurrency(recommendationStats!.potentialSavingsCeiling)', 'Only for kind "upper_bound_only", which describeSavingsTotal returns only when the ceiling is above $0.', { within: "savingsTotal.kind === 'upper_bound_only'" }],
    ['formatSavingsCurrency(action.savings)', 'Top Actions row: action.savings is a non-"none" savingsFigure amount (above $0); null and sub-cent are the earlier branches.', { count: 2, within: 'action.subCent' }],
  ],
  'app/(marketing)/pricing/page.tsx': [
    ['fmt(savings)', 'Marketing ROI calculator: savings = round(spend x 0.24) from a slider whose minimum is $1,000. Not a finding.', { count: 2 }],
    ['fmt(annual)', 'Same calculator: annual = savings x 12. Not a finding.'],
  ],
  'app/(marketing)/solutions/cost-optimization/page.tsx': [
    ['{useCase.savings}', 'Marketing copy: savings are literal strings ("$8,400/mo"). Not a finding.'],
  ],
  'app/(marketing)/tour/page.tsx': [
    ['{a.savings}', 'Product tour: literal strings ("$340/mo", "Security"). Not a finding.'],
  ],
  'lib/services/forecast.service.ts': [
    ['savings.toLocaleString()', 'Forecast what-if scenario: the user\'s own input, default 500 (`|| 500`). Not a finding.', { count: 3, within: "case 'optimization'" }],
    ['(savings * 12).toLocaleString()', 'Same what-if scenario input.', { within: "case 'optimization'" }],
  ],
  'backend/src/services/scenario-planning.service.ts': [
    ['(params.optimizationSavings || 0) / 30', 'Forecast what-if scenario: the user\'s own input, used as a daily delta in the prediction, not shown as a saving.'],
    ['Cost Optimization (-$${params.optimizationSavings}/mo)', 'What-if scenario name echoing the user\'s own input. Not a finding.'],
    ['saving $${params.optimizationSavings}/month', 'What-if scenario description echoing the user\'s own input. Not a finding.'],
  ],
  'backend/src/controllers/cost-recommendations.controller.ts': [
    ['estimatedSavings: Number(recommendation.potential_savings) || 0,', 'Stored into remediation_workflows.estimated_savings (NOT NULL DEFAULT 0); Remediation shows it through formatPlainSavings (ruling Q5).'],
    ['estimated potential savings of $${stats.total_potential_savings.toFixed(2)}/month.', 'POST /analyze response message: no surface renders it (the frontend analyze() mapper drops it). Founder question Q-D in never-zero/build.md.'],
  ],
  'backend/src/routes/remediation.routes.ts': [
    ['estimatedSavings: Number(estimatedSavings) || 0,', 'Stored into the NOT NULL estimated_savings column; displayed through formatPlainSavings (ruling Q5).'],
  ],
  'backend/src/repositories/weekly-summary.repository.ts': [
    ['(b.detection.potentialSavings ?? 0) - (a.detection.potentialSavings ?? 0)', 'Sort order only; never displayed.', { count: 2 }],
  ],
  'backend/src/services/ai-report-generator.service.ts': [
    ['money(recsWithItems.totalEstimatedMonthlySavings)', 'Reached only when recsPriced (total above $0, a sum of cent-rounded figures): BE-5 guard.', { count: 4, within: 'recsPriced' }],
  ],
  'backend/src/services/cost-optimization.service.ts': [
    ['const modeledSavingsCents = input.modeledMonthlySavings.toFixed(2);', 'F-1 follow-up (never-zero/f1-build.md): the DynamoDB provisioned-capacity saving rounded to cents, the same rounding the description prints. Read only by the "=== \'0.00\'" check and by the figure in its else branch (next entry); never stored.'],
    ['modeledSavingsCents', 'F-1 follow-up: printed only when the rounded saving is not "0.00"; a saving that rounds to $0.00 (exactly 0, or float residue) reads "none, ..." with no dollar amount.', { within: "modeledSavingsCents === '0.00'" }],
  ],
};

const covers = (f: Finding, [snippet, , options]: Entry, onlyNode: boolean) =>
  (onlyNode ? f.nodeText.includes(snippet) : f.lineText.includes(snippet) || f.nodeText.includes(snippet))
  && (options?.within === undefined || f.conditions.some((c) => c.includes(options.within as string)));

/**
 * Every finding not covered by the allowlist (`file:line [rule] expression`), and every allowlist
 * entry whose number of findings is not the stated count (stale entries included). Files in
 * UNIMPORTED are skipped; the test checks separately that nothing imports them.
 */
export function checkFiles(files: readonly string[], read: (file: string) => string | null): { offenders: string[]; wrongCounts: string[] } {
  const offenders: string[] = [];
  const used = new Map<string, number>();
  for (const file of files) {
    if (UNIMPORTED[file]) continue;
    const text = read(file);
    if (text === null) continue;
    for (const f of scanSource(file, text)) {
      // The flagged expression first, so two findings on one line meet their own entries.
      const entries = ALLOWLIST[file] ?? [];
      const entry = entries.find((e) => covers(f, e, true)) ?? entries.find((e) => covers(f, e, false));
      if (entry) used.set(`${file}\u0000${entry[0]}`, (used.get(`${file}\u0000${entry[0]}`) ?? 0) + 1);
      else offenders.push(`${file}:${f.line} [${f.rule}] ${f.nodeText.slice(0, 160)}`);
    }
  }
  const wrongCounts = Object.entries(ALLOWLIST).flatMap(([file, entries]) => entries
    .filter(([snippet, , options]) => (used.get(`${file}\u0000${snippet}`) ?? 0) !== (options?.count ?? 1))
    .map(([snippet, , options]) => `${file}: ${snippet} (expected ${options?.count ?? 1}, found ${used.get(`${file}\u0000${snippet}`) ?? 0})`));
  return { offenders, wrongCounts };
}
