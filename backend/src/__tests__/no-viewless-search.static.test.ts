/**
 * Region-access PR 1: no Resource Explorer Search without a ViewArn, and nothing that
 * creates or changes Resource Explorer, anywhere in non-test source.
 *
 * A Search with no ViewArn is authorized by AWS against no view. The customer role's
 * Search grant names view/* ARNs only, so in a region with an index but no default view
 * AWS refuses it with a 403 that is indistinguishable from a real refusal; the scan then
 * said "AWS refused our read role" (region-access stage-a.md, Addendum 1). Every Search
 * must name the region's default view (GetDefaultView) explicitly.
 *
 * DevControl is read-only: it never creates an index or a view (a customer's Resource
 * Explorer setup is theirs), so no CreateIndex, CreateView or other write command may
 * be constructed.
 *
 * Backend source is parsed (helpers/aws-sdk-scan.ts, the same scan the IAM coverage
 * test uses). The frontend and lib/ are checked as text: neither may use the Resource
 * Explorer SDK at all.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { scanBackendNodes, scanSourceNodes } from './helpers/aws-sdk-scan';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SEARCH_KEY = 'client-resource-explorer-2:SearchCommand';
/** Every Resource Explorer command that is not a read (writes, tags, index/view changes). */
const RE_WRITE = /^client-resource-explorer-2:(Create|Delete|Update|Associate|Disassociate|Tag|Untag|Put|Batch)\w*Command$/;

/** Why a constructed SearchCommand does not name a view, or null when it does. */
function viewlessReason(node: ts.Node): string | null {
  const construction = node.parent;
  if (!ts.isNewExpression(construction)) return 'not a `new SearchCommand(...)`';
  const [input] = construction.arguments ?? [];
  if (!input) return 'no input';
  if (!ts.isObjectLiteralExpression(input)) return 'input is not an object literal (its ViewArn cannot be checked)';
  const viewArn = input.properties.find(
    (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === 'ViewArn'
  );
  if (!viewArn) {
    return input.properties.some(ts.isSpreadAssignment) ? 'input spreads another object (its ViewArn cannot be checked)' : 'no ViewArn';
  }
  if (ts.isPropertyAssignment(viewArn)) {
    const value = viewArn.initializer;
    if (value.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(value) && value.text === 'undefined')) return 'ViewArn: undefined';
    if (value.kind === ts.SyntaxKind.NullKeyword) return 'ViewArn: null';
    if (ts.isStringLiteralLike(value) && value.text === '') return "ViewArn: ''";
  }
  return null;
}

function viewlessSearches(uses: ReturnType<typeof scanBackendNodes>['uses']): string[] {
  return uses
    .filter((use) => use.key === SEARCH_KEY)
    .map((use) => ({ site: use.site, reason: viewlessReason(use.node) }))
    .filter((r) => r.reason !== null)
    .map((r) => `${r.site}: ${r.reason}`);
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : filesUnder(full);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.test\.|__tests__/.test(full) ? [full] : [];
  });
}

describe('Resource Explorer: no Search without a ViewArn (region-access PR 1)', () => {
  const scan = scanBackendNodes();

  it('the scan finds the Search call sites it must check (the discovery search and the Connect probe)', () => {
    const files = new Set(scan.uses.filter((use) => use.key === SEARCH_KEY).map((use) => use.file));
    expect([...files].sort()).toEqual([path.join('services', 'connect-permission-check.ts'), path.join('services', 'resourceExplorer.service.ts')]);
  });

  it('every SearchCommand in backend source names a ViewArn', () => {
    expect(viewlessSearches(scan.uses)).toEqual([]);
  });

  it('no Resource Explorer write (CreateIndex, CreateView, ...) is constructed anywhere in backend source', () => {
    expect(scan.uses.filter((use) => RE_WRITE.test(use.key)).map((use) => `${use.site}: ${use.key}`)).toEqual([]);
  });

  it('the frontend, lib/ and scripts/ do not use the Resource Explorer SDK', () => {
    const hits = ['app', 'lib', 'components', 'scripts']
      .flatMap((dir) => filesUnder(path.join(REPO_ROOT, dir)))
      .filter((file) => fs.readFileSync(file, 'utf-8').includes('client-resource-explorer-2'))
      .map((file) => path.relative(REPO_ROOT, file));
    expect(hits).toEqual([]);
  });

  describe('the guard itself catches what it must (fixtures, not repository code)', () => {
    const header = "import { SearchCommand, CreateViewCommand, CreateIndexCommand } from '@aws-sdk/client-resource-explorer-2';\n";
    const reasons = (body: string) => viewlessSearches(scanSourceNodes('fixture.ts', header + body).uses);

    it.each([
      ['no ViewArn', "new SearchCommand({ QueryString: '' });", 'no ViewArn'],
      ['ViewArn undefined', "new SearchCommand({ ViewArn: undefined, QueryString: '' });", 'ViewArn: undefined'],
      ['ViewArn empty', "new SearchCommand({ ViewArn: '', QueryString: '' });", "ViewArn: ''"],
      ['an input object', 'const input = {}; new SearchCommand(input);', 'input is not an object literal (its ViewArn cannot be checked)'],
      ['a spread', 'const base = {}; new SearchCommand({ ...base });', 'input spreads another object (its ViewArn cannot be checked)'],
    ])('%s is refused', (_label, body, reason) => {
      expect(reasons(body)).toEqual([`fixture.ts:2: ${reason}`]);
    });

    it('a Search naming its view passes', () => {
      expect(reasons("const viewArn = 'x'; new SearchCommand({ ViewArn: viewArn, QueryString: '' }); new SearchCommand({ viewArn, ViewArn: viewArn });")).toEqual([]);
    });

    it('CreateIndex and CreateView are writes', () => {
      const uses = scanSourceNodes('fixture.ts', header + 'new CreateIndexCommand({}); new CreateViewCommand({ ViewName: "v" });').uses;
      expect(uses.filter((use) => RE_WRITE.test(use.key)).map((use) => use.key).sort()).toEqual([
        'client-resource-explorer-2:CreateIndexCommand',
        'client-resource-explorer-2:CreateViewCommand',
      ]);
    });
  });
});
