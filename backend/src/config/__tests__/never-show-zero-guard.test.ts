/**
 * "Never show $0" source guard (founder rulings 2026-11-26,
 * review-logs/never-zero/stage-a.md Addendum 1). CI runs only the backend jest
 * suite, so this guard lives here and scans the frontend too.
 *
 * Fix round 1 (review S-1): the rules are now in never-show-zero-scan.ts and
 * work on the TypeScript syntax tree, not on single lines, so they catch every
 * shape the review found the old line regexes missing: any savings-named
 * variable or local alias (monthlySavings, savings, `const total = ...`),
 * formatter arguments with their own parentheses, JSX "$" followed by {...},
 * expressions split over lines, `|| 0.0` / `?? '0'`, `formatSavings(0)`,
 * potentialSavingsCeiling and per-type maps. Run over the pre-fix base tree
 * (b0a931f1) they find every Stage A path (build.md, "Fix round 1").
 *
 * Over every tracked (and untracked, not ignored) .ts/.tsx/.js/.jsx source
 * file under app/, components/, lib/ and backend/src/ -- tests excluded, the
 * shared helpers INCLUDED -- it fails on a savings amount that is defaulted to
 * zero, formatted or rendered without a guard that proves it is above $0, a
 * formatter called with a literal 0, or a "$0/mo" text. Each finding must be
 * in the reasoned allowlist (never-show-zero-allowlist.ts, with the exact
 * number of findings it covers) or in a file nothing imports; a stale entry, a changed count, or an import of
 * an unimported file fails too.
 *
 * Genuine AWS spend (Cost Explorer amounts, inventory costs) uses other names
 * and keeps its own rules (app/(app)/costs/cost-display.ts), where $0.00 is
 * allowed -- so no real-spend path needs an entry here.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scanSource } from './never-show-zero-scan';
import { ALLOWLIST, UNIMPORTED, checkFiles } from './never-show-zero-allowlist';

const REPO = join(__dirname, '..', '..', '..', '..');
const SCANNED_DIRS = ['app', 'components', 'lib', 'backend/src'];

function sourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...SCANNED_DIRS], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.test\.[jt]sx?$/.test(f));
}

describe('"Never show $0" source guard', () => {
  const files = sourceFiles();
  const read = (file: string): string | null => { try { return readFileSync(join(REPO, file), 'utf8'); } catch { return null; } };

  it('scans the frontend, the backend and the shared helpers', () => {
    expect(files.some((f) => f.startsWith('app/'))).toBe(true);
    expect(files.some((f) => f.startsWith('backend/src/'))).toBe(true);
    for (const f of ['app/(app)/cost-optimization/page.tsx', 'lib/savings-basis.ts', 'lib/utils.ts', 'backend/src/services/estimated-savings.ts', 'backend/src/utils/formatSavingsCurrency.ts']) {
      expect(files).toContain(f);
    }
  });

  it('no savings amount is defaulted to 0 or shown unguarded, except the reasoned allowlist', () => {
    const { offenders, wrongCounts } = checkFiles(files, read);
    expect(offenders).toEqual([]);
    expect(wrongCounts).toEqual([]);
  });

  it('every allowlist and unimported entry carries a reason', () => {
    for (const entries of Object.values(ALLOWLIST)) for (const [, reason] of entries) expect(reason.length).toBeGreaterThan(20);
    for (const reason of Object.values(UNIMPORTED)) expect(reason.length).toBeGreaterThan(20);
  });

  it('a skipped unimported file exists and is still imported by nothing', () => {
    for (const file of Object.keys(UNIMPORTED)) {
      expect(files).toContain(file);
      const moduleName = file.replace(/\.[jt]sx?$/, '').split('/').pop() as string;
      const importer = new RegExp(`(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['"][^'"]*/${moduleName}['"]`);
      const importers = files.filter((f) => f !== file && importer.test(read(f) ?? ''));
      expect({ file, importers }).toEqual({ file, importers: [] });
    }
  });

  describe('catches the shapes it names (self-test)', () => {
    const rules = (code: string, file = 'probe.tsx') => scanSource(file, code).map((f) => f.rule);
    const hit = (code: string, file?: string) => rules(code, file).length > 0;

    it('every Stage A path, in its original pre-fix form (b0a931f1)', () => {
      // CO-1: an alias name the old IDS list lacked, and formatSavingsTotal.
      expect(rules('const monthlySavings = statsAvailable ? stats.totalPotentialSavings : null;\nconst monthlyLabel = monthlySavings === null ? null : formatSavingsTotal(monthlySavings, estimatedFindings);')).toContain('formatter');
      // CO-2 / CO-3 / SD-2 / CS-1 root, in the helper the old guard skipped.
      expect(rules("if (kind === 'estimate') return `${format(rec.potentialSavings)}${suffix}`", 'lib/savings-basis.ts')).toContain('formatter');
      // CO-4 / SD-4: lowActivitySavingsHeadline.
      expect(rules("const figure = `${format(potentialSavings)}/mo if it's no longer needed`", 'lib/finding-display.ts')).toContain('formatter');
      // IN-4: the alias `savings` on an action.
      expect(rules('<span> — save {formatSavingsCurrency(action.savings)}/mo</span>')).toContain('formatter');
      // DB-1 / DB-2: a per-type map read into `total`, formatted through roundCents( ).
      expect(rules('const total = costRecStats?.potentialSavingsByResourceType?.[cat.type]\nconst text = `${formatSavingsCents(roundCents(total))}/mo`')).toContain('formatter');
      // DB-3: a literal "$0/mo" and a formatter of a literal 0.
      expect(rules("const row = { savingsLabel: '$0/mo' }")).toContain('zero-text');
      expect(rules('const label = `${formatSavingsCents(0)}/mo`')).toContain('zero-format');
      // OV-1: a ternary to 0, then the alias `total` formatted.
      const ov1 = rules('const total = Number.isFinite(s.totalPotentialSavings) ? s.totalPotentialSavings : 0\nconst value = `${formatUsd(total)}/mo est.`');
      expect(ov1).toEqual(expect.arrayContaining(['ternary-zero', 'formatter']));
      // RM-1 / RM-2: a reduced sum with `savings` as its name.
      expect(rules("const savings = workflows\n  .filter((w) => w.status === 'completed')\n  .reduce((s, w) => s + Number(w.estimated_savings), 0);\nconst value = `$${savings.toFixed(0)}/mo`")).toContain('dollar-template');
      expect(rules('<span>\n  ${Number(wf.estimated_savings).toFixed(0)}/mo\n</span>')).toContain('dollar-template');
      // AI-1 / AI-2: JSX "$" + {...}, and the {x && ...} leak that renders "0".
      const ai1 = rules('<div>{rec.estimatedSavings && <p>Est. savings: ${rec.estimatedSavings.toLocaleString()}/mo</p>}</div>');
      expect(ai1).toEqual(expect.arrayContaining(['jsx-leak', 'dollar-template']));
      expect(rules('<div>{estimatedSavings && estimatedSavings > 0 && (<p>x</p>)}</div>')).toContain('jsx-leak');
      // IN-1 / IN-2 / IN-3 / EF-1 / SD-1 / CO-1c / DB-4 (already caught before; still caught).
      expect(rules('const intelWaste = isDemoActive ? 1060 : (recommendationStats?.totalPotentialSavings ?? 0)')).toContain('zero-default');
      expect(rules("value: savingsLoading ? '—' : formatSavingsCurrency(savingsStats.totalPotentialSavings),")).toContain('formatter');
      // BE-1: a backend formatter on a row figure.
      expect(rules("return `~${formatSavingsCents(row.potential_savings as string)}/month opportunity`;", 'x.ts')).toContain('formatter');
      // BE-2: formatted inside a guard that is not about the amount.
      expect(rules('if (active > 0) { facts.push(`${formatSavingsCurrency(totalEstimatedMonthlySavings)}/month`); }', 'x.ts')).toContain('formatter');
      // BE-3: split over lines, and a "> 0" guard does not help when the amount is rounded to whole dollars.
      expect(rules("const detail = totalSavings > 0\n  ? `$${Math.round(\n      totalSavings\n    ).toLocaleString()}/mo estimated savings identified`\n  : 'none';", 'x.ts')).toContain('dollar-template');
      // BE-4: a formatter called with a literal zero.
      expect(rules('const value = open.count === 0\n  ? `${formatSavings(0)}/mo`\n  : other;', 'x.ts')).toContain('zero-format');
      // BE-5.
      expect(rules('`Estimated potential savings of ${money(recsWithItems.totalEstimatedMonthlySavings)}/month`', 'x.ts')).toContain('formatter');
    });

    it('the review\'s bypasses (review.md S-1)', () => {
      expect(hit('const x = rec.potentialSavings || 0.0')).toBe(true);
      expect(hit("const x = rec.potentialSavings ?? '0'")).toBe(true);
      expect(hit('formatSavingsCurrency(Number(rec.potentialSavings))')).toBe(true);
      expect(hit('usd.format(rec.potentialSavings)')).toBe(true);
      expect(hit('formatSavingsCurrency(stats.potentialSavingsCeiling)')).toBe(true);
      expect(hit('formatSavingsCurrency(\n  rec.potentialSavings,\n)')).toBe(true);
      expect(hit('const x = rec.potentialSavings\n  || 0')).toBe(true);
      expect(hit('const a = rec.potentialSavings || 0', 'legacy.js')).toBe(true);
      expect(hit('<span>$0.00/month</span>')).toBe(true);
      expect(hit('{formatSavingsCurrency(intelWaste)}/mo active waste')).toBe(true);
      expect(hit('value: `$${savings.estimatedSavings}`')).toBe(true);
      expect(hit('function line(savings = 0) { return savings }')).toBe(true);
    });

    it('a guard counts only when it proves the shown amount is above $0', () => {
      // `x > 0 || y` proves nothing about x (SD-1's original line).
      expect(hit('const estimate = summary.estimatedMonthlySavings\nconst el = <div>{(estimate > 0 || ceiling === 0) && <p>{formatSavingsCurrency(estimate)}</p>}</div>')).toBe(true);
      // A cent formatter prints $0.004 as "$0.00", so x > 0 is not enough without roundCents.
      expect(hit('const t = rec.potentialSavings > 0 ? formatSavingsCents(rec.potentialSavings) : null')).toBe(true);
      // A formatter the guard cannot vouch for (whole dollars, unknown rounding).
      expect(hit('const t = rec.potentialSavings > 0 ? formatUsd(rec.potentialSavings) : null')).toBe(true);
      expect(hit('const t = rec.potentialSavings > 0 ? `$${rec.potentialSavings.toFixed(0)}` : null')).toBe(true);
    });

    it('does not flag the safe shapes', () => {
      expect(hit('const spend = costSummary?.monthlyAwsCost ?? 0')).toBe(false);
      expect(hit('potentialSavings ?? 0.5')).toBe(false);
      expect(hit('const open = (stats.totalPotentialSavings ?? 0) > 0')).toBe(false);
      expect(hit('const t = rec.potentialSavings > 0 ? formatSavingsCurrency(rec.potentialSavings) : null')).toBe(false);
      expect(hit('const savingsShown = monthlySavings !== null && monthlySavings > 0\nconst t = savingsShown ? formatSavingsCurrency(monthlySavings) : null')).toBe(false);
      expect(hit('const t = roundCents(total) > 0 ? formatSavingsCents(roundCents(total)) : null')).toBe(false);
      expect(hit('if (totalEstimatedMonthlySavings > 0) { facts.push(formatSavingsCurrency(totalEstimatedMonthlySavings)) }')).toBe(false);
      expect(hit('const label = formatSavingsFigure(savingsFigure(rec))')).toBe(false);
      expect(hit('const el = <div>{savingsLabel && <p>{savingsLabel}</p>}</div>')).toBe(false);
      expect(hit('const s = i.savings.data\nconst active = s.activeRecommendations ?? 0')).toBe(false);
      expect(hit("const note = 'counts as $0 in spend'")).toBe(false);
      expect(hit('// rec.potentialSavings || 0 in a comment\nconst a = 1')).toBe(false);
      expect(hit('const el = <p>{typeof x.estimatedSavings === "number" && x.estimatedSavings > 0 && <span>${x.estimatedSavings.toLocaleString()}</span>}</p>')).toBe(false);
    });
  });
});
