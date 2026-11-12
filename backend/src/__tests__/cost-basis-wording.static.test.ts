/**
 * Cost basis wording (dashboard-step1.md §A.2, founder DB-D5): Cost Explorer
 * UnblendedCost by service with no record-type filter already nets credits and
 * refunds into each service; the trend then floors each bucket at $0 per
 * period. "Credits excluded" is false. This scans the shipped source of both
 * workspaces (not tests or fixtures) for the false wording, and pins the one
 * shared trend note.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.join(__dirname, '..', '..', '..');
const ROOTS = ['app', 'components', 'lib', path.join('backend', 'src')];

const FALSE_BASIS = [
  /credits\/refunds excluded/i,
  /credits excluded/i,
  /credits and refunds are excluded/i,
  /credits and refunds are left out/i,
  /before credits and refunds/i,
];

function shippedFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['__tests__', '__fixtures__', 'node_modules', '__snapshots__'].includes(e.name) ? [] : shippedFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('cost basis wording', () => {
  const files = ROOTS.flatMap((r) => shippedFiles(path.join(REPO, r)));

  it('scans both workspaces', () => {
    expect(files.some((f) => f.endsWith(path.join('lib', 'cost-trend-basis.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join('backend', 'src', 'services', 'ai-chat.service.ts')))).toBe(true);
  });

  it('no shipped source says credits are excluded', () => {
    const hits = files.flatMap((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return FALSE_BASIS.filter((re) => re.test(text)).map((re) => `${path.relative(REPO, f)}: ${re}`);
    });
    expect(hits).toEqual([]);
  });

  it('the shared trend note says what the figures are', () => {
    const basis = fs.readFileSync(path.join(REPO, 'lib', 'cost-trend-basis.ts'), 'utf8');
    expect(basis).toContain("export const TREND_TOTALS_NOTE = 'After credits and refunds; amounts below $0 count as $0'");
  });
});
