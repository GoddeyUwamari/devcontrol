/**
 * Static tenant-predicate check shared by the tenant-scope suites. A statement
 * on a table whose RLS does not protect the application role (owner-bypassed,
 * or as a second layer under forced RLS) must name the table's own
 * organization_id in its own WHERE, as a top-level AND conjunct:
 *
 *  - a predicate inside a subquery, or on another alias, scopes something else;
 *  - a top-level OR (`organization_id = $1 OR true`) makes the predicate optional.
 *
 * ORs inside parentheses stay allowed (`AND ($5 IS NULL OR aws_region = $5)`):
 * the parenthesised group is one conjunct, ANDed with the predicate.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/** Every backtick or quoted string in `text` that is a statement on `table`. */
export function statementsOnTable(text: string, table: string): string[] {
  const strings = text.match(/`(?:[^`\\]|\\[\s\S])*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) ?? [];
  const names = new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, 'i');
  return strings.filter((s) => names.test(s));
}

export function statementsInFiles(files: string[], table: string): { file: string; statement: string }[] {
  return files.flatMap((file) => statementsOnTable(readFileSync(file, 'utf-8'), table).map((statement) => ({ file, statement })));
}

/** `statement` without any parenthesised subquery, however deeply nested. */
export function withoutSubqueries(statement: string): string {
  let result = '';
  let depth = 0;
  for (let i = 0; i < statement.length; i += 1) {
    if (depth === 0 && /^\(\s*SELECT\b/i.test(statement.slice(i))) depth = 1;
    else if (depth > 0 && statement[i] === '(') depth += 1;
    else if (depth > 0 && statement[i] === ')') depth -= 1;
    else if (depth === 0) result += statement[i];
  }
  return result;
}

/** `text` with every parenthesised group removed: what is left is its top level. */
function topLevel(text: string): string {
  let result = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) result += char;
  }
  return result;
}

const WHERE_END = /\b(ORDER\s+BY|GROUP\s+BY|LIMIT|OFFSET|RETURNING|FOR\s+UPDATE|ON\s+CONFLICT)\b/i;

/** The statement's own WHERE clause (subqueries removed), or null when it has none. */
function outerWhere(statement: string): string | null {
  const outer = withoutSubqueries(statement);
  const start = outer.search(/\bWHERE\b/i);
  if (start < 0) return null;
  const rest = outer.slice(start + 'WHERE'.length);
  const end = rest.search(WHERE_END);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * True when `statement` is scoped to one organization on `table`: an INSERT
 * naming organization_id first, or a WHERE whose top level has the predicate
 * (unqualified, or on one of `aliases`) and no OR.
 */
export function hasOrganizationPredicate(statement: string, table: string, aliases: string[] = []): boolean {
  if (new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(\\s*organization_id\\b`, 'i').test(statement)) return true;
  const where = outerWhere(statement);
  if (where === null) return false;
  const conjuncts = topLevel(where);
  if (/\bOR\b/i.test(conjuncts)) return false;
  const qualifier = aliases.length > 0 ? `(?:(?:${aliases.join('|')})\\.)?` : '';
  return new RegExp(`(?<![\\w.])${qualifier}organization_id\\s*=\\s*\\$\\d`, 'i').test(conjuncts);
}
