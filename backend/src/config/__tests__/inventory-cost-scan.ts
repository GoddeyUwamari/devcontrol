/**
 * The scanner behind the inventory-cost source guard (inventory-cost-guard.test.ts,
 * placeholder-costs PR 1). Modelled on the "Never show $0" scanner
 * (never-show-zero-scan.ts): each file is parsed with the TypeScript compiler, so
 * a read split over lines, a SQL template literal and a comment are what the
 * language says they are -- no line regexes.
 *
 * Governing rule: an inventory cost reaches exports, reports, AI context or totals
 * only through the shared rule (services/inventory-cost.ts). So, outside that file
 * and a reasoned allowlist (inventory-cost-allowlist.ts), the guard fails on:
 *
 *   sql-cost      a string or template literal naming the stored cost column
 *                 (`estimated_monthly_cost`) or the alias the rule's own column
 *                 fragment gives it (`stored_monthly_cost`): SQL that sums, orders,
 *                 filters, selects or re-aliases it. Readers select
 *                 inventoryCostColumns() instead, whose text lives in the rule's file.
 *   cost-read     a read of an inventory cost field by name: `r.estimated_monthly_cost`,
 *                 `row['estimated_monthly_cost']`, `costPerMonth`, `monthly_cost`,
 *                 `total_monthly_cost`, `estimatedMonthlyCost`, and the stored figure
 *                 as every PR 1 query result carries it, `stored_monthly_cost`
 *                 (`row.stored_monthly_cost`, `rows[0].stored_monthly_cost`,
 *                 `const { stored_monthly_cost: s } = row`; review fix round S-1),
 *                 which only the rule may read (an identifier, a
 *                 property access, a string-keyed element access, a destructured or
 *                 shorthand property). Declarations are not reads: an interface or
 *                 type member, an object-literal key being written, a variable or
 *                 parameter being declared.
 *   placeholder   any use of a flat-placeholder source: GENERIC_COST_BASELINE,
 *                 estimateEC2Cost / estimateRDSCost / estimateS3Cost / estimateLBCost /
 *                 estimateCloudFrontCost, or the RDS table
 *                 RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ (priced only by
 *                 the rule), other than where it is declared.
 */
import ts from 'typescript';

export type InventoryFinding = { rule: 'sql-cost' | 'cost-read' | 'placeholder'; line: number; lineText: string; nodeText: string };

export const COST_COLUMN = 'estimated_monthly_cost';
/** The alias inventoryCostColumns() gives the stored figure on every PR 1 query result (S-1). */
export const STORED_COST_ALIAS = 'stored_monthly_cost';
/** Text that names the stored figure in SQL: the column, or the rule's alias for it. */
const SQL_COST_NAMES = [COST_COLUMN, STORED_COST_ALIAS];
export const COST_FIELD_NAMES: ReadonlySet<string> = new Set([
  'estimated_monthly_cost',
  STORED_COST_ALIAS,
  'estimatedMonthlyCost',
  'costPerMonth',
  'monthly_cost',
  'total_monthly_cost',
]);
export const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
  'GENERIC_COST_BASELINE',
  'estimateEC2Cost',
  'estimateRDSCost',
  'estimateS3Cost',
  'estimateLBCost',
  'estimateCloudFrontCost',
  'RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ',
]);

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** A name node that declares (not reads) the thing it names. */
function isDeclarationName(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if ((ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) ||
       ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isEnumMember(p) ||
       ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.name === node) return true;
  // An object-literal key being written: `{ estimated_monthly_cost: value }` (the value is scanned on its own).
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  // A destructuring rename's target name (`{ a: estimated_monthly_cost }` declares the local).
  if (ts.isBindingElement(p) && p.name === node && p.propertyName !== undefined) return true;
  return false;
}

export function scanInventorySource(file: string, text: string): InventoryFinding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const lines = text.split('\n');
  const findings: InventoryFinding[] = [];
  const add = (rule: InventoryFinding['rule'], node: ts.Node) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ rule, line: line + 1, lineText: lines[line]?.trim() ?? '', nodeText: node.getText(sf).slice(0, 1000) });
  };

  const visit = (n: ts.Node): void => {
    // sql-cost: the column named in any string or template text.
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) &&
        SQL_COST_NAMES.some((name) => n.text.toLowerCase().includes(name))) {
      // A string used as an element-access key is a cost-read, reported below, not SQL.
      const asKey = ts.isElementAccessExpression(n.parent) && n.parent.argumentExpression === n;
      // An import/export specifier path is not data.
      const isModulePath = ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent);
      if (!asKey && !isModulePath) add('sql-cost', n);
    }

    // cost-read
    if (ts.isIdentifier(n) && COST_FIELD_NAMES.has(n.text) && !isDeclarationName(n)) {
      const p = n.parent;
      const isPropertyName = ts.isPropertyAccessExpression(p) && p.name === n;
      // `obj.estimated_monthly_cost` is reported once, at the property access.
      if (isPropertyName) add('cost-read', p);
      else if (ts.isShorthandPropertyAssignment(p) || ts.isBindingElement(p)) add('cost-read', p);
      else if (!ts.isPropertyAccessExpression(p) && !ts.isQualifiedName(p) && !ts.isTypeReferenceNode(p)) add('cost-read', n);
    }
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && COST_FIELD_NAMES.has(n.argumentExpression.text)) {
      add('cost-read', n);
    }

    // placeholder
    if (ts.isIdentifier(n) && PLACEHOLDER_NAMES.has(n.text) && !isDeclarationName(n)) {
      const p = n.parent;
      add('placeholder', ts.isPropertyAccessExpression(p) && p.name === n ? p : n);
    }

    ts.forEachChild(n, visit);
  };
  visit(sf);
  return findings;
}
