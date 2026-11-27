/**
 * The scanner behind the "Never show $0" source guard
 * (never-show-zero-guard.test.ts). Kept apart from the test so the same rules
 * can be run over any tree (fix round 1, S-1: the rules were proven against
 * the pre-fix base tree, see review-logs/never-zero/build.md).
 *
 * It parses each file with the TypeScript compiler, so an expression split over
 * several lines, nested parentheses, JSX text and comments are what the
 * language says they are -- no line regexes.
 *
 * A "savings value" is a read of:
 *   - an identifier, property name or string key whose name contains "savings"
 *     (any case, e.g. savings, monthlySavings, potentialSavingsCeiling,
 *     total_potential_savings), starting lower-case (types and constants are
 *     not values) and not a function/predicate name (format..., is..., has...);
 *   - totalRecoverable or intelWaste;
 *   - a local alias: a const/let/var whose initializer reads a savings value
 *     (directly, or through Number/parseFloat/roundCents/Math.*), within the
 *     block that declares it -- e.g. `const total = s.totalPotentialSavings`.
 * A function being called (savingsFigure(rec)) is not a read.
 *
 * Rules (each finding names its rule):
 *   zero-default   `<savings> || 0`, `?? 0`, `?? 0.0`, `|| '0'`; `= 0` as a
 *                  savings parameter / destructuring default.
 *   ternary-zero   `c ? <savings> : 0` or `c ? 0 : <savings>`.
 *                  (Neither counts when the result is only compared, e.g.
 *                  `(x ?? 0) > 0`: a boolean is never shown.)
 *   formatter      a currency formatter called with a savings value anywhere
 *                  in its arguments (formatSavings*, formatUsd*, formatMoney,
 *                  formatCurrency*, money, fmt, format, Intl `.format(`, ...).
 *   to-string      `.toFixed(` / `.toLocaleString(` / `.toPrecision(` on an
 *                  expression that reads a savings value.
 *   dollar-template  `$${...}` in a template, or JSX text ending in "$"
 *                  followed by `{...}`, reading a savings value.
 *   jsx-raw        a savings value rendered straight into JSX: `{savings}`,
 *                  `{rec.potentialSavings * 12}`.
 *   jsx-leak       `{<savings> && ...}` in JSX, which renders "0" for 0.
 *   zero-format    a currency formatter called with a literal zero:
 *                  `formatSavings(0)`, `money(0.00)`.
 *   zero-text      a string, template or JSX text with a money zero per month:
 *                  "$0/mo", "$0.00/month".
 *
 * Guarded display: formatter, to-string, dollar-template and jsx-raw do not
 * fire inside a branch whose condition PROVES the shown amount is above $0
 * (`x > 0`, `x >= 0.01`, `0 < x`, a conjunct of `&&`, or a const flag that
 * proves it; `x > 0 || y` proves nothing) -- but only when nothing can still
 * print a zero: a whole-dollar rounding (Math.round/floor/trunc, toFixed(0))
 * always fires, and a formatter counts as guarded only if it keeps cents under
 * $1 (formatSavingsCurrency, formatSavingsTotal, formatAnnualSavingsTotal; a
 * cent formatter only on a roundCents(...) amount).
 *
 * Each finding carries the conditions of the branches it sits in, so an
 * allowlist entry can require its guard (never-show-zero-allowlist.ts `within`).
 */
import ts from 'typescript';

export type Finding = { rule: string; line: number; lineText: string; nodeText: string; conditions: string[]; start: number; end: number };

const SAVINGS_NAME = /savings/i;
const NOT_A_VALUE_PREFIX = /^(?:format|describe|rank|count|is|has|classify|aggregate|parse|to|with|get|set|fetch|use|show|render|compute|calculate|build|make|map|strip|record|stores|sub)(?=[A-Z_])/;
const EXTRA_NAMES = new Set(['totalRecoverable', 'intelWaste']);
const NUMERIC_WRAPPERS = new Set(['Number', 'parseFloat', 'parseInt', 'roundCents', 'round', 'max', 'min', 'abs', 'floor', 'ceil', 'trunc']);

/** Currency formatters by name (called as `name(` or `obj.name(`). */
const FORMATTERS = /^(?:format|fmt|money|usd\w*|formatSavings\w*|formatUsd\w*|formatUSD\w*|formatMoney|formatCurrency\w*|formatDollars?|formatWholeDollars|formatDriverAmount|formatAnnualSavingsTotal|formatOpenSavings|formatAxisDollar|formatSigned\w*|formatAmount|formatPriceAmount|formatRecordedCost|formatServiceCost|formatValue)$/;
/**
 * Formatters that never print a zero for a positive amount (lib/utils.ts: "$0.40" under $1, "<$0.01"
 * under a cent): inside an `x > 0` guard they cannot print "$0". Any other formatter may: whole
 * dollars round $0.40 to "$0", and cent formatters (formatSavingsCents, money) print $0.004 as "$0.00".
 */
const CENT_SAFE_FORMATTERS = new Set(['formatSavingsCurrency', 'formatSavingsTotal', 'formatAnnualSavingsTotal']);
/** Cent formatters ("$0.48"): safe under a guard only for an amount already rounded to cents (roundCents). */
const CENT_FORMATTERS = new Set(['formatSavingsCents', 'money']);
/** Helpers that apply the one rule themselves (lib/savings-basis.ts): calling them is the fix, not a leak. */
const RULE_HELPERS = new Set(['formatSavingsFigure', 'formatPlainSavings', 'formatRecommendationSavings']);

const MONEY_ZERO_PER_MONTH = /(?<![\d.,<])\$0(?:\.0{1,2})?(?![\d.,])\s*\/\s*mo/;
const COMPARISON = new Set([
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** Names that hold words, flags or objects about savings, not an amount: savingsLabel, savingsFirm, savingsBasis. */
const NOT_AN_AMOUNT_SUFFIX = /(?:Label|Labels|Line|Lines|Text|Copy|Note|Notes|Title|Headline|Phrase|Sentence|Kind|Basis|Firm|Shown|Tile|Figure|Figures|Value|Display|Class|Tone|Status|Source|Stats|Summary|Loading|Error|Query|Key|Unit|Mode|Rows|_basis|_source)$/;

export function isSavingsName(name: string): boolean {
  if (EXTRA_NAMES.has(name)) return true;
  return SAVINGS_NAME.test(name) && /^[a-z_$]/.test(name) && !NOT_A_VALUE_PREFIX.test(name) && !NOT_AN_AMOUNT_SUFFIX.test(name);
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const unwrap = (node: ts.Node): ts.Node => {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n)) n = n.expression;
  return n;
};

/** The parent, skipping parentheses and casts. */
const outer = (node: ts.Node): ts.Node | undefined => {
  let p = node.parent;
  while (p && (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isSatisfiesExpression(p))) p = p.parent;
  return p;
};

const isZeroLiteral = (node: ts.Node): boolean => {
  const n = unwrap(node);
  if (ts.isNumericLiteral(n)) return Number(n.text) === 0;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return /^0(?:\.0+)?$/.test(n.text);
  return false;
};

const calleeName = (call: ts.CallExpression): string | null => {
  const c = unwrap(call.expression);
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
};

const isFormatterCall = (node: ts.Node): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) return false;
  const name = calleeName(node);
  return name !== null && FORMATTERS.test(name) && !RULE_HELPERS.has(name);
};

type Alias = { name: string; start: number; end: number };

function scopeOf(node: ts.Node): ts.Node {
  for (let a = node.parent; a; a = a.parent) {
    if (ts.isBlock(a) || ts.isSourceFile(a) || ts.isModuleBlock(a) || ts.isCaseClause(a) || ts.isDefaultClause(a) || ts.isArrowFunction(a) || ts.isFunctionLike(a)) return a;
  }
  return node.getSourceFile();
}

export function scanSource(file: string, text: string): Finding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const lines = text.split('\n');
  const aliases: Alias[] = [];

  const isAlias = (node: ts.Node, name: string): boolean => {
    const pos = node.getStart(sf);
    return aliases.some((a) => a.name === name && pos >= a.start && pos < a.end);
  };
  const isSavingsRef = (id: ts.Identifier | ts.StringLiteral | ts.PrivateIdentifier): boolean =>
    isSavingsName(id.text) || isAlias(id, id.text);

  /**
   * Is `node` itself a savings amount (not merely an expression that mentions one)? A read
   * (`savings`, `rec.potentialSavings`, `row['potential_savings']`), a numeric wrapper of one
   * (Number, parseFloat, roundCents, Math.*), its string form (`.toFixed()`, `.toLocaleString()`),
   * a sum, difference or multiple of one, a `.reduce` over one, or a branch / default of one.
   * `s.data` where `s` is savings-named is the object's field, not the amount.
   */
  const isSavingsValue = (node: ts.Node): boolean => {
    const n = unwrap(node);
    if (ts.isIdentifier(n)) return isSavingsRef(n);
    if (ts.isPropertyAccessExpression(n)) return isSavingsRef(n.name);
    if (ts.isElementAccessExpression(n)) {
      // row['potential_savings'] by its key; byType[type] of a per-type savings map is an amount too.
      const key = n.argumentExpression;
      return ts.isStringLiteral(key) ? isSavingsRef(key) : isSavingsValue(n.expression);
    }
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name !== null && NUMERIC_WRAPPERS.has(name)) return n.arguments.some((a) => isSavingsValue(a));
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        if (/^(?:toFixed|toLocaleString|toPrecision|toString)$/.test(callee.name.text)) return isSavingsValue(callee.expression);
        if (callee.name.text === 'reduce') {
          const fn = n.arguments[0];
          if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
          return ts.isBlock(fn.body) ? blockReturnsSavings(fn.body) : isSavingsValue(fn.body);
        }
      }
      return false;
    }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.MinusToken) return isSavingsValue(n.left) || isSavingsValue(n.right);
      if (op === ts.SyntaxKind.AsteriskToken) return isSavingsValue(n.left) || isSavingsValue(n.right);
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return isSavingsValue(n.left) || isSavingsValue(n.right);
      return false;
    }
    if (ts.isConditionalExpression(n)) return isSavingsValue(n.whenTrue) || isSavingsValue(n.whenFalse);
    return false;
  };
  const blockReturnsSavings = (block: ts.Block): boolean => {
    let found = false;
    const visit = (x: ts.Node): void => {
      if (found || ts.isFunctionLike(x)) return;
      if (ts.isReturnStatement(x) && x.expression && isSavingsValue(x.expression)) { found = true; return; }
      ts.forEachChild(x, visit);
    };
    block.statements.forEach(visit);
    return found;
  };

  // const initializers by name, for guard flags.
  const constInits = new Map<string, ts.Expression>();

  // Aliases, to a fixed point (an alias of an alias counts).
  const decls: ts.VariableDeclaration[] = [];
  const collect = (n: ts.Node): void => { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) decls.push(n); ts.forEachChild(n, collect); };
  collect(sf);
  for (const d of decls) {
    if (d.parent && ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const)) constInits.set((d.name as ts.Identifier).text, d.initializer as ts.Expression);
  }
  for (let changed = true, rounds = 0; changed && rounds < 5; rounds += 1) {
    changed = false;
    for (const d of decls) {
      const name = (d.name as ts.Identifier).text;
      if (isSavingsName(name)) continue;
      const scope = scopeOf(d);
      const start = scope.getStart(sf);
      if (aliases.some((a) => a.name === name && a.start === start)) continue;
      if (isSavingsValue(d.initializer as ts.Expression)) {
        aliases.push({ name, start, end: scope.getEnd() });
        changed = true;
      }
    }
  }

  /**
   * Is `node` inside a branch that runs only when `value` is above zero: `value > 0 ? <here> : ...`,
   * `value > 0 && <here>`, or `if (value > 0) { <here> }` (also `> 0.0`, `>= 0.01`, `0 < value`)?
   * The condition must prove it: `value > 0` itself, a conjunct of an `&&`, or a const flag whose
   * initializer proves it. `value > 0 || other` proves nothing. That is the shape the rule asks
   * for, so a cent-keeping formatter there cannot print a zero.
   */
  const guardedAboveZero = (node: ts.Node, value: ts.Node): boolean => {
    const t = unwrap(value).getText(sf).replace(/\s+/g, '');
    const same = (x: ts.Node) => unwrap(x).getText(sf).replace(/\s+/g, '') === t;
    const positiveBound = (x: ts.Node, strict: boolean) => {
      const u = unwrap(x);
      if (!ts.isNumericLiteral(u)) return false;
      const v = Number(u.text);
      return strict ? v >= 0 : v > 0;
    };
    const proves = (cond: ts.Node, depth = 0): boolean => {
      const c = unwrap(cond);
      if (ts.isBinaryExpression(c)) {
        const op = c.operatorToken.kind;
        if (op === ts.SyntaxKind.AmpersandAmpersandToken) return proves(c.left, depth) || proves(c.right, depth);
        if (op === ts.SyntaxKind.GreaterThanToken) return same(c.left) && positiveBound(c.right, true);
        if (op === ts.SyntaxKind.GreaterThanEqualsToken) return same(c.left) && positiveBound(c.right, false);
        if (op === ts.SyntaxKind.LessThanToken) return same(c.right) && positiveBound(c.left, true);
        return false;
      }
      if (ts.isIdentifier(c) && depth < 3) {
        const init = constInits.get(c.text);
        return init !== undefined && proves(init, depth + 1);
      }
      return false;
    };
    for (let child: ts.Node = node, p = node.parent; p; child = p, p = p.parent) {
      if (ts.isConditionalExpression(p) && child === p.whenTrue && proves(p.condition)) return true;
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && child === p.right && proves(p.left)) return true;
      if (ts.isIfStatement(p) && child === p.thenStatement && proves(p.expression)) return true;
      if (ts.isFunctionLike(p)) break;
    }
    return false;
  };

  const findings: Finding[] = [];
  const squash = (x: ts.Node) => x.getText(sf).replace(/\s+/g, ' ').trim();
  /** The conditions of every branch the node sits in (if / else, either side of `? :`, right of `&&` / `||`, a switch case). */
  const conditionsOf = (node: ts.Node): string[] => {
    const out: string[] = [];
    for (let child: ts.Node = node, p = node.parent; p; child = p, p = p.parent) {
      if (ts.isConditionalExpression(p) && child !== p.condition) out.push(squash(p.condition));
      if (ts.isBinaryExpression(p) && child === p.right && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) out.push(squash(p.left));
      if (ts.isIfStatement(p) && child !== p.expression) out.push(squash(p.expression));
      if (ts.isCaseClause(p) && child !== p.expression) out.push(`case ${squash(p.expression)}`);
    }
    return out;
  };
  const add = (rule: string, node: ts.Node): void => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    findings.push({ rule, line: line + 1, lineText: lines[line] ?? '', nodeText: squash(node), conditions: conditionsOf(node), start: node.getStart(sf), end: node.getEnd() });
  };
  const onlyCompared = (node: ts.Node): boolean => {
    const p = outer(node);
    return !!p && ts.isBinaryExpression(p) && COMPARISON.has(p.operatorToken.kind);
  };
  /** The savings amount a display expression shows, for the guard check: `x` in `x.toFixed(0)`. */
  const shownAmount = (node: ts.Node): ts.Node => {
    const n = unwrap(node);
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee) && /^(?:toFixed|toLocaleString|toPrecision|toString)$/.test(callee.name.text)) return shownAmount(callee.expression);
      const name = calleeName(n);
      if (name !== null && NUMERIC_WRAPPERS.has(name) && n.arguments.length === 1) return shownAmount(n.arguments[0]);
    }
    // `x * 12` is above zero exactly when x is.
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
      if (ts.isNumericLiteral(unwrap(n.right)) && Number((unwrap(n.right) as ts.NumericLiteral).text) > 0) return shownAmount(n.left);
      if (ts.isNumericLiteral(unwrap(n.left)) && Number((unwrap(n.left) as ts.NumericLiteral).text) > 0) return shownAmount(n.right);
    }
    return n;
  };
  /**
   * Does the shown expression round to whole dollars? Then `x > 0` does not stop "$0": BE-3's
   * `x > 0 ? `$${Math.round(x)...}`` printed "$0" for $0.40.
   */
  const roundsToWhole = (node: ts.Node): boolean => {
    const n = unwrap(node);
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const name = calleeName(n);
      if (name !== null && /^(?:round|floor|trunc)$/.test(name)) return true;
      if (ts.isPropertyAccessExpression(callee) && name === 'toFixed') return (n.arguments.length === 0 || isZeroLiteral(n.arguments[0])) || roundsToWhole(callee.expression);
      if (ts.isPropertyAccessExpression(callee) && name === 'toLocaleString') return /maximumFractionDigits\s*:\s*0\b/.test(n.getText(sf)) || roundsToWhole(callee.expression);
      if (ts.isPropertyAccessExpression(callee) && /^(?:toPrecision|toString)$/.test(name ?? '')) return roundsToWhole(callee.expression);
      if (name !== null && NUMERIC_WRAPPERS.has(name)) return n.arguments.some((a) => roundsToWhole(a));
    }
    if (ts.isBinaryExpression(n)) return roundsToWhole(n.left) || roundsToWhole(n.right);
    return false;
  };
  const shownUnguarded = (at: ts.Node, value: ts.Node) =>
    roundsToWhole(value) || (!guardedAboveZero(at, value) && !guardedAboveZero(at, shownAmount(value)));

  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if ((op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) && isZeroLiteral(n.right) && isSavingsValue(n.left) && !onlyCompared(n)) add('zero-default', n);
    }
    if ((ts.isParameter(n) || ts.isBindingElement(n)) && n.initializer && isZeroLiteral(n.initializer) && ts.isIdentifier(n.name) && isSavingsName(n.name.text)) add('zero-default', n);
    if (ts.isConditionalExpression(n) && !onlyCompared(n)) {
      if ((isZeroLiteral(n.whenFalse) && isSavingsValue(n.whenTrue)) || (isZeroLiteral(n.whenTrue) && isSavingsValue(n.whenFalse))) add('ternary-zero', n);
    }
    if (isFormatterCall(n)) {
      // A guard counts only for a formatter that keeps cents under $1; any other may round a positive amount to "$0".
      // A cent formatter is safe too when it shows an amount already rounded to cents: `roundCents(x) > 0`
      // means at least $0.01.
      const name = calleeName(n) ?? '';
      const safeFor = (a: ts.Node) => CENT_SAFE_FORMATTERS.has(name)
        || (CENT_FORMATTERS.has(name) && ts.isCallExpression(unwrap(a)) && calleeName(unwrap(a) as ts.CallExpression) === 'roundCents');
      if (n.arguments.some((a) => isSavingsValue(a) && (!safeFor(a) || shownUnguarded(n, a)))) add('formatter', n);
      if (n.arguments.length > 0 && isZeroLiteral(n.arguments[0])) add('zero-format', n);
    }
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee) && /^(?:toFixed|toLocaleString|toPrecision)$/.test(callee.name.text) && isSavingsValue(callee.expression) && shownUnguarded(n, callee.expression)) add('to-string', n);
    }
    if (ts.isTemplateExpression(n)) {
      let prev = n.head.text;
      for (const span of n.templateSpans) {
        if (/\$$/.test(prev) && isSavingsValue(span.expression) && shownUnguarded(span.expression, span.expression)) add('dollar-template', span.expression);
        prev = span.literal.text;
      }
    }
    if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent)) {
      const siblings = (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) ? n.parent.children : undefined;
      const idx = siblings ? siblings.indexOf(n as ts.JsxChild) : -1;
      const before = idx > 0 ? siblings![idx - 1] : undefined;
      const shown = n.expression;
      if (before && ts.isJsxText(before) && /\$$/.test(before.text.trimEnd()) && isSavingsValue(shown) && shownUnguarded(n, shown)) add('dollar-template', n);
      else if (isSavingsValue(shown) && !ts.isConditionalExpression(unwrap(shown)) && shownUnguarded(n, shown)) add('jsx-raw', n);
      const e = unwrap(shown);
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        // Every operand but the last is rendered when it is falsy: a 0 there shows "0".
        const operands: ts.Node[] = [];
        const flatten = (x: ts.Node): void => {
          const u = unwrap(x);
          if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { flatten(u.left); flatten(u.right); } else operands.push(u);
        };
        flatten(e);
        if (operands.slice(0, -1).some((o) => isSavingsValue(o))) add('jsx-leak', n);
      }
    }
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) && MONEY_ZERO_PER_MONTH.test(n.text)) add('zero-text', n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // One report per shown amount: `$${x.toFixed(0)}` is a dollar template, not also a to-string.
  return findings.filter((f) => !(f.rule === 'to-string' && findings.some((g) => g.rule === 'dollar-template' && g.start <= f.start && f.end <= g.end)));
}
