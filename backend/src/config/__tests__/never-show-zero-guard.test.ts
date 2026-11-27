/**
 * "Never show $0" source guard (founder rulings 2026-11-26,
 * review-logs/never-zero/stage-a.md Addendum 1). CI runs only the backend jest
 * suite, so this guard lives here and scans the frontend too.
 *
 * Over every tracked (and untracked, not ignored) .ts/.tsx source file under
 * app/, components/, lib/ and backend/src/ -- tests excluded -- it fails when
 * a savings value is:
 *   - defaulted to zero: `<savings identifier> ... || 0` or `?? 0`;
 *   - formatted outside the shared helpers: a currency formatter called on a
 *     savings identifier, `<savings identifier>.toFixed(`, or a `$${...}`
 *     template built from one.
 * The one rule and its wording live in lib/savings-basis.ts (frontend) and
 * backend/src/services/estimated-savings.ts (backend mirror); those files and
 * the formatter files are not scanned.
 *
 * The savings identifiers are savings-only names: genuine AWS spend
 * (Cost Explorer amounts, inventory costs) uses other names and keeps its own
 * rules (app/(app)/costs/cost-display.ts), where $0.00 is allowed -- so no
 * real-spend path needs an allowlist entry here. Every entry below is a
 * reasoned exception: the value is guarded above $0 before it is formatted,
 * or the 0 is never displayed. A stale entry (its line no longer exists)
 * fails too.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO = join(__dirname, '..', '..', '..', '..');
const SCANNED_DIRS = ['app', 'components', 'lib', 'backend/src'];
const HELPER_FILES = new Set([
  'lib/savings-basis.ts',
  'lib/utils.ts',
  'backend/src/services/estimated-savings.ts',
  'backend/src/utils/formatSavingsCurrency.ts',
]);

const IDS = '(?:potentialSavings|totalPotentialSavings|potential_savings|total_potential_savings|estimatedMonthlySavings|estimated_savings|estimatedSavings|totalRecoverable|intelWaste|totalEstimatedMonthlySavings|monthlySavingsCeiling|savingsCeiling)';
const RULES: Array<{ id: string; pattern: RegExp }> = [
  { id: 'zero-default', pattern: new RegExp(`\\b${IDS}\\b[^;\\n]{0,60}?(?:\\|\\||\\?\\?)\\s*0(?![.\\d])`) },
  { id: 'formatter', pattern: new RegExp(`\\b(?:formatSavingsCurrency|formatSavingsCents|formatSavings|formatUsd|formatMoney|formatCurrency|money)\\(\\s*[^()\\n]{0,80}?\\b${IDS}\\b`) },
  { id: 'toFixed', pattern: new RegExp(`\\b${IDS}\\b[^;\\n]{0,40}?\\.toFixed\\(`) },
  { id: 'template', pattern: new RegExp(`\\$\\$\\{[^}\\n]{0,80}?\\b${IDS}\\b`) },
];

/** file -> [a substring of the allowed line, why it is allowed]. */
const ALLOWLIST: Record<string, Array<[string, string]>> = {
  'lib/services/cost-recommendations.service.ts': [
    ['potentialSavings: parseFloat(r.potential_savings) || 0,', 'Row mapper (Stage A §1d): every row is displayed through savingsFigure, where 0 and missing both read "No dollar estimate".'],
    ['totalPotentialSavings: parseFloat(result.totalPotentialSavings) || 0,', 'POST /analyze result mapper: no surface renders this total (the page reads /stats).'],
  ],
  'app/(app)/cost-optimization/HiddenFindings.tsx': [
    ['const estimate = summary?.stillDetected.estimatedMonthlySavings ?? 0;', 'Used only as "estimate > 0" before the amount line is rendered (ruling Q3); 0 renders nothing.'],
  ],
  'app/(app)/remediation/page.tsx': [
    ["formatPlainSavings(workflow.estimated_savings, (v) => `$${v.toFixed(2)}`)", 'The formatter passed to formatPlainSavings, which calls it only for an amount above $0.'],
  ],
  'app/(app)/infrastructure/page.tsx': [
    ['{formatSavingsCurrency(totalRecoverable)}/mo recoverable from {pricedCount} priced chang', 'Rendered only when pricedCount > 0, i.e. at least one estimate above $0 is summed (ruling Q4).'],
  ],
  'backend/src/controllers/cost-recommendations.controller.ts': [
    ['estimatedSavings: Number(recommendation.potential_savings) || 0,', 'Stored into remediation_workflows.estimated_savings (NOT NULL DEFAULT 0); Remediation shows it through formatPlainSavings (ruling Q5).'],
    ['estimated potential savings of $${stats.total_potential_savings.toFixed(2)}/month.', 'POST /analyze response message: no surface renders it (the frontend analyze() mapper drops it). Founder question in never-zero/build.md.'],
  ],
  'backend/src/routes/remediation.routes.ts': [
    ['estimatedSavings: Number(estimatedSavings) || 0,', 'Stored into the NOT NULL estimated_savings column; displayed through formatPlainSavings (ruling Q5).'],
  ],
  'backend/src/repositories/weekly-summary.repository.ts': [
    ['(b.detection.potentialSavings ?? 0) - (a.detection.potentialSavings ?? 0)', 'Sort order only; never displayed.'],
  ],
  'backend/src/services/ai-report-generator.service.ts': [
    ['(estimated potential savings of ${money(recsWithItems.totalEstimatedMonthlySavings)}/month for ${theseListed', 'Reached only when recsPriced (total above $0): BE-5 guard.'],
    ['(estimated potential savings of ${money(recsWithItems.totalEstimatedMonthlySavings)}/month; a DevControl', 'Reached only when recsPriced (total above $0): BE-5 guard.'],
    ['`Estimated potential savings of ${money(recsWithItems.totalEstimatedMonthlySavings)}/month from ${topOf', 'Reached only when recsPriced (total above $0): BE-5 guard.'],
    ['`Estimated potential savings of ${money(recsWithItems.totalEstimatedMonthlySavings)}/month from low-activity', 'Reached only when recsPriced (total above $0): BE-5 guard.'],
  ],
  'backend/src/services/ai-summary.service.ts': [
    ['`${formatSavingsCurrency(totalEstimatedMonthlySavings)}/month (a DevControl estimate', 'Inside "totalEstimatedMonthlySavings > 0" (ruling Q6, BE-2).'],
  ],
};

function sourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...SCANNED_DIRS], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').filter((f) =>
    /\.(ts|tsx)$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.test\.tsx?$/.test(f) && !HELPER_FILES.has(f));
}

describe('"Never show $0" source guard', () => {
  const files = sourceFiles();

  it('scans the frontend and the backend', () => {
    expect(files.some((f) => f.startsWith('app/'))).toBe(true);
    expect(files.some((f) => f.startsWith('backend/src/'))).toBe(true);
    expect(files).toContain('app/(app)/cost-optimization/page.tsx');
  });

  it('no savings value is defaulted to 0 or formatted outside the helpers, except the reasoned allowlist', () => {
    const offenders: string[] = [];
    const used = new Set<string>();
    for (const file of files) {
      let text: string;
      try { text = readFileSync(join(REPO, file), 'utf8'); } catch { continue; }
      text.split('\n').forEach((line, i) => {
        for (const rule of RULES) {
          if (!rule.pattern.test(line)) continue;
          const allowed = (ALLOWLIST[file] ?? []).find(([snippet]) => line.includes(snippet));
          if (allowed) used.add(`${file}\u0000${allowed[0]}`);
          else offenders.push(`${file}:${i + 1} [${rule.id}] ${line.trim().slice(0, 160)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
    const stale = Object.entries(ALLOWLIST).flatMap(([file, entries]) =>
      entries.filter(([snippet]) => !used.has(`${file}\u0000${snippet}`)).map(([snippet]) => `${file}: ${snippet}`));
    expect(stale).toEqual([]);
  });

  it('every allowlist entry carries a reason', () => {
    for (const entries of Object.values(ALLOWLIST)) for (const [, reason] of entries) expect(reason.length).toBeGreaterThan(20);
  });

  it('catches the patterns it names (self-test on synthetic lines)', () => {
    const hit = (line: string) => RULES.some((rule) => rule.pattern.test(line));
    expect(hit('const x = stats?.totalPotentialSavings ?? 0')).toBe(true);
    expect(hit('savings: r.potentialSavings || 0,')).toBe(true);
    expect(hit('{formatSavingsCurrency(intelWaste)}/mo active waste')).toBe(true);
    expect(hit('${Number(wf.estimated_savings).toFixed(0)}/mo')).toBe(true);
    expect(hit('value: `$${savings.estimatedSavings}`')).toBe(true);
    expect(hit('const spend = costSummary?.monthlyAwsCost ?? 0')).toBe(false);
    expect(hit('potentialSavings ?? 0.5')).toBe(false);
  });
});
