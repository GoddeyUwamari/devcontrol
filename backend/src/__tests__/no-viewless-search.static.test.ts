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
 * Both ways the SDK offers to Search are checked: `new SearchCommand(input)` and the
 * paginator `paginateSearch(config, input)`. Type casts around the input or the ViewArn
 * value (`as`, `<T>`, `satisfies`, `!`, parentheses) are looked through, so
 * `ViewArn: undefined as unknown as string` is refused like `ViewArn: undefined`
 * (region-access PR 1 review S-1). Any other use of a Resource Explorer export that the
 * scan cannot model (a cast or aliased callee such as `(paginateSearch as any)(...)`, a
 * command held in a variable) is refused in any file that imports Resource Explorer,
 * because its input cannot be checked.
 *
 * Backend source is parsed (helpers/aws-sdk-scan.ts, the same scan the IAM coverage
 * test uses). The frontend and lib/ are checked as text: neither may use the Resource
 * Explorer SDK at all.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { BACKEND_SRC, scanBackendNodes, scanSourceNodes } from './helpers/aws-sdk-scan';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SEARCH_KEY = 'client-resource-explorer-2:SearchCommand';
const PAGINATE_SEARCH_KEY = 'client-resource-explorer-2:paginateSearch';
/** Every way of making a Resource Explorer Search the scan records. */
const SEARCH_KEYS: ReadonlySet<string> = new Set([SEARCH_KEY, PAGINATE_SEARCH_KEY]);
/** Every Resource Explorer command that is not a read (writes, tags, index/view changes). */
const RE_WRITE = /^client-resource-explorer-2:(Create|Delete|Update|Associate|Disassociate|Tag|Untag|Put|Batch)\w*Command$/;

/**
 * The expression under any type-only wrapper: `x as T`, `<T>x`, `x satisfies T`, `x!` and
 * `(x)` all evaluate to `x`, so a cast can neither hide an undefined ViewArn nor a
 * viewless input.
 */
function unwrapTypeOnly(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The Search input: the argument of `new SearchCommand(input)`, the second of `paginateSearch(config, input)`. */
function searchInput(key: string, node: ts.Node): { input: ts.Expression | undefined } | { reason: string } {
  const parent = node.parent;
  if (key === PAGINATE_SEARCH_KEY) {
    if (!ts.isCallExpression(parent) || parent.expression !== node) return { reason: 'not a `paginateSearch(...)` call' };
    return { input: parent.arguments[1] };
  }
  if (!ts.isNewExpression(parent)) return { reason: 'not a `new SearchCommand(...)`' };
  return { input: (parent.arguments ?? [])[0] };
}

/** Why a Search (SearchCommand or paginateSearch) does not name a view, or null when it does. */
function viewlessReason(key: string, node: ts.Node): string | null {
  const found = searchInput(key, node);
  if ('reason' in found) return found.reason;
  if (!found.input) return 'no input';
  const input = unwrapTypeOnly(found.input);
  if (!ts.isObjectLiteralExpression(input)) return 'input is not an object literal (its ViewArn cannot be checked)';
  const viewArn = input.properties.find(
    (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === 'ViewArn'
  );
  if (!viewArn) {
    return input.properties.some(ts.isSpreadAssignment) ? 'input spreads another object (its ViewArn cannot be checked)' : 'no ViewArn';
  }
  if (ts.isPropertyAssignment(viewArn)) {
    const value = unwrapTypeOnly(viewArn.initializer);
    if (value.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(value) && value.text === 'undefined')) return 'ViewArn: undefined';
    if (ts.isVoidExpression(value)) return 'ViewArn: undefined';
    if (value.kind === ts.SyntaxKind.NullKeyword) return 'ViewArn: null';
    if (ts.isStringLiteralLike(value) && value.text === '') return "ViewArn: ''";
  }
  return null;
}

function viewlessSearches(uses: ReturnType<typeof scanBackendNodes>['uses']): string[] {
  return uses
    .filter((use) => SEARCH_KEYS.has(use.key))
    .map((use) => ({ site: use.site, reason: viewlessReason(use.key, use.node) }))
    .filter((r) => r.reason !== null)
    .map((r) => `${r.site}: ${r.reason}`);
}

/** Ways of reaching the SDK the scan cannot model, in files that import Resource Explorer: its input could not be checked. */
function unmodeledResourceExplorerUses(unmodeled: readonly string[], resourceExplorerFiles: ReadonlySet<string>): string[] {
  return unmodeled.filter((entry) => resourceExplorerFiles.has(entry.slice(0, entry.indexOf(':'))));
}

const RE_MODULE = '@aws-sdk/client-resource-explorer-2';

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
    const files = new Set(scan.uses.filter((use) => SEARCH_KEYS.has(use.key)).map((use) => use.file));
    expect([...files].sort()).toEqual([path.join('services', 'connect-permission-check.ts'), path.join('services', 'resourceExplorer.service.ts')]);
  });

  it('every Search in backend source (SearchCommand or paginateSearch) names a ViewArn', () => {
    expect(viewlessSearches(scan.uses)).toEqual([]);
  });

  it('no use of the Resource Explorer SDK that the scan cannot model (a cast or aliased callee, a command in a variable)', () => {
    const resourceExplorerFiles = new Set(
      filesUnder(BACKEND_SRC).filter((file) => fs.readFileSync(file, 'utf-8').includes(RE_MODULE)).map((file) => path.relative(BACKEND_SRC, file))
    );
    expect(resourceExplorerFiles.size).toBeGreaterThan(0);
    expect(unmodeledResourceExplorerUses(scan.unmodeled, resourceExplorerFiles)).toEqual([]);
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
    const header = "import { SearchCommand, CreateViewCommand, CreateIndexCommand, paginateSearch } from '@aws-sdk/client-resource-explorer-2';\n";
    const reasons = (body: string) => viewlessSearches(scanSourceNodes('fixture.ts', header + body).uses);

    it.each([
      ['no ViewArn', "new SearchCommand({ QueryString: '' });", 'no ViewArn'],
      ['ViewArn undefined', "new SearchCommand({ ViewArn: undefined, QueryString: '' });", 'ViewArn: undefined'],
      ['ViewArn empty', "new SearchCommand({ ViewArn: '', QueryString: '' });", "ViewArn: ''"],
      ['an input object', 'const input = {}; new SearchCommand(input);', 'input is not an object literal (its ViewArn cannot be checked)'],
      ['a spread', 'const base = {}; new SearchCommand({ ...base });', 'input spreads another object (its ViewArn cannot be checked)'],
      // S-1: a type cast must not hide an undefined ViewArn or a viewless input.
      ['ViewArn undefined behind `as unknown as string`', "new SearchCommand({ ViewArn: undefined as unknown as string, QueryString: '' });", 'ViewArn: undefined'],
      ['ViewArn undefined behind `!`', "new SearchCommand({ ViewArn: undefined!, QueryString: '' });", 'ViewArn: undefined'],
      ['ViewArn undefined behind `satisfies` and parentheses', "new SearchCommand({ ViewArn: (undefined satisfies unknown) as any, QueryString: '' });", 'ViewArn: undefined'],
      ['ViewArn undefined behind `<string>`', "new SearchCommand({ ViewArn: <string>undefined, QueryString: '' });", 'ViewArn: undefined'],
      ['ViewArn void 0', "new SearchCommand({ ViewArn: void 0, QueryString: '' });", 'ViewArn: undefined'],
      ['ViewArn null behind a cast', "new SearchCommand({ ViewArn: null as unknown as string, QueryString: '' });", 'ViewArn: null'],
      ['ViewArn empty behind a cast', "new SearchCommand({ ViewArn: '' as string, QueryString: '' });", "ViewArn: ''"],
      ['a cast input with no ViewArn', "new SearchCommand({ QueryString: '' } as any);", 'no ViewArn'],
      // S-1: the SDK paginator is a Search too.
      ['paginateSearch with no ViewArn', "paginateSearch({ client }, { QueryString: '' });", 'no ViewArn'],
      ['paginateSearch with no input', 'paginateSearch({ client });', 'no input'],
      ['paginateSearch with ViewArn undefined behind a cast', "paginateSearch({ client }, { ViewArn: undefined as unknown as string, QueryString: '' });", 'ViewArn: undefined'],
      ['paginateSearch with an input object', 'const input = {}; paginateSearch({ client }, input);', 'input is not an object literal (its ViewArn cannot be checked)'],
    ])('%s is refused', (_label, body, reason) => {
      expect(reasons(body)).toEqual([`fixture.ts:2: ${reason}`]);
    });

    it('a Search naming its view passes', () => {
      expect(reasons("const viewArn = 'x'; new SearchCommand({ ViewArn: viewArn, QueryString: '' }); new SearchCommand({ viewArn, ViewArn: viewArn });")).toEqual([]);
    });

    it('a Search naming its view passes through a cast, and so does a paginateSearch naming its view', () => {
      expect(reasons(
        "const viewArn = 'x'; new SearchCommand({ ViewArn: viewArn as string, QueryString: '' } as any); new SearchCommand({ ViewArn: viewArn! });"
        + " paginateSearch({ client }, { ViewArn: viewArn, QueryString: '' });"
      )).toEqual([]);
    });

    it.each([
      ['a cast callee', '(paginateSearch as any)({ client });'],
      ['a non-null callee', 'paginateSearch!({ client }, {});'],
      ['a command held in a variable', "const S = SearchCommand; new S({ QueryString: '' });"],
    ])('%s cannot be checked, so it is refused', (_label, body) => {
      const unmodeled = scanSourceNodes('fixture.ts', header + body).unmodeled;
      expect(unmodeledResourceExplorerUses(unmodeled, new Set(['fixture.ts']))).toHaveLength(1);
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
