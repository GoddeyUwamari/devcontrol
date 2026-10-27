/**
 * The AWS SDK commands constructed in non-test backend source, found by
 * parsing each file with the TypeScript compiler. Shared by the static tests
 * that must account for every command (customer-role-iam-coverage,
 * aws-response-classification).
 *
 * A command is keyed `<package>:<exported name>`, e.g.
 * `client-lambda:ListFunctionsCommand`. A paginator is keyed by its own name.
 * Any way of reaching the SDK that the scan does not model is reported in
 * `unmodeled`, and each test fails on it.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export const BACKEND_SRC = path.join(__dirname, '..', '..');

export interface CommandUse {
  key: string;
  site: string;
}

/** A use with the parsed file and the identifier (or member name) that constructs or calls it. */
export interface CommandUseNode extends CommandUse {
  file: string;
  sourceFile: ts.SourceFile;
  node: ts.Node;
}

export interface ScanResult {
  uses: CommandUse[];
  /** Ways of reaching the SDK the scan does not model; each one fails the test. */
  unmodeled: string[];
}

export interface NodeScanResult {
  uses: CommandUseNode[];
  unmodeled: string[];
}

const TRACKED_EXPORT = /Command$|^paginate[A-Z]/;
const SDK_MODULE = /^@aws-sdk\//;

/** The AWS SDK commands constructed in one source file, with their nodes. */
export function scanSourceNodes(fileLabel: string, source: string): NodeScanResult {
  const file = ts.createSourceFile(fileLabel, source, ts.ScriptTarget.Latest, true);
  const uses: CommandUseNode[] = [];
  const unmodeled: string[] = [];
  const at = (node: ts.Node) => `${fileLabel}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  const record = (key: string, node: ts.Node, siteNode: ts.Node = node) =>
    uses.push({ key, site: at(siteNode), file: fileLabel, sourceFile: file, node });
  /** Local name → `<package>:<exported name>`. */
  const tracked = new Map<string, string>();

  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
      && SDK_MODULE.test(statement.moduleSpecifier.text)) {
      unmodeled.push(`${at(statement)}: re-export from ${statement.moduleSpecifier.text}`);
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    if (!SDK_MODULE.test(moduleName)) continue;
    const pkg = moduleName.slice('@aws-sdk/'.length);
    const clause = statement.importClause;
    if (!pkg.startsWith('client-')) {
      unmodeled.push(`${at(statement)}: import from ${moduleName} (only @aws-sdk/client-* is modeled)`);
      continue;
    }
    if (!clause) continue;
    if (clause.name) unmodeled.push(`${at(statement)}: default import from ${moduleName}`);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      unmodeled.push(`${at(statement)}: namespace import from ${moduleName}`);
    } else if (bindings) {
      for (const element of bindings.elements) {
        const exported = (element.propertyName ?? element.name).text;
        if (TRACKED_EXPORT.test(exported)) tracked.set(element.name.text, `${pkg}:${exported}`);
      }
    }
  }

  /** `new (await import('@aws-sdk/client-x')).NameCommand(...)`, the one dynamic-import shape modeled. */
  const dynamicImportConstruction = (call: ts.CallExpression, moduleName: string): { key: string; node: ts.Node } | null => {
    const awaited = call.parent;
    const paren = awaited && ts.isAwaitExpression(awaited) ? awaited.parent : undefined;
    const access = paren && ts.isParenthesizedExpression(paren) ? paren.parent : undefined;
    if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== paren) return null;
    const construction = access.parent;
    if (!ts.isNewExpression(construction) || construction.expression !== access) return null;
    const pkg = moduleName.slice('@aws-sdk/'.length);
    return pkg.startsWith('client-') && /Command$/.test(access.name.text) ? { key: `${pkg}:${access.name.text}`, node: access } : null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const [arg] = node.arguments;
      if ((isRequire || isDynamicImport) && arg && ts.isStringLiteralLike(arg) && SDK_MODULE.test(arg.text)) {
        const constructed = isDynamicImport ? dynamicImportConstruction(node, arg.text) : null;
        if (constructed) record(constructed.key, constructed.node, node);
        else unmodeled.push(`${at(node)}: ${isRequire ? 'require' : 'import()'} of ${arg.text}`);
      }
    }
    if (ts.isIdentifier(node) && tracked.has(node.text)) {
      const parent = node.parent;
      const key = tracked.get(node.text)!;
      const isImportBinding = ts.isImportSpecifier(parent);
      const isConstruction = ts.isNewExpression(parent) && parent.expression === node && /Command$/.test(key);
      const isPaginatorCall = ts.isCallExpression(parent) && parent.expression === node && /:paginate[A-Z]/.test(key);
      const isTypeOnly = ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent);
      if (isConstruction || isPaginatorCall) {
        record(key, node);
      } else if (!isImportBinding && !isTypeOnly) {
        unmodeled.push(`${at(node)}: ${node.text} used other than by new/call`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { uses, unmodeled };
}

/** The AWS SDK commands constructed in one source file. */
export function scanSource(fileLabel: string, source: string): ScanResult {
  const { uses, unmodeled } = scanSourceNodes(fileLabel, source);
  return { uses: uses.map(({ key, site }) => ({ key, site })), unmodeled };
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

/** Every command use in backend/src outside tests; file labels are relative to backend/src. */
export function scanBackendNodes(): NodeScanResult {
  const results = sourceFiles(BACKEND_SRC).map((file) => scanSourceNodes(path.relative(BACKEND_SRC, file), fs.readFileSync(file, 'utf-8')));
  return { uses: results.flatMap((r) => r.uses), unmodeled: results.flatMap((r) => r.unmodeled) };
}

export function scanBackend(): ScanResult {
  const { uses, unmodeled } = scanBackendNodes();
  return { uses: uses.map(({ key, site }) => ({ key, site })), unmodeled };
}
