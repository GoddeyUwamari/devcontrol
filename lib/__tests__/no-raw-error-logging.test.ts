/**
 * Guard: frontend source logs errors through logError (lib/safe-log.ts), never
 * by handing an error object -- or its config/request/response -- to console.
 *
 * Flags, in app/, components/ and lib/ (tests excluded):
 *  - console.*(…) with an argument that is an error-like identifier
 *    (e, err, error, *Error, *Err) or a catch-clause / .catch() parameter;
 *  - console.*(…) with an argument that reads .config, .request or .response;
 *  - console.* passed as a value, e.g. promise.catch(console.error).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const SCANNED = ["app", "components", "lib"];
const ALLOWED_FILES = new Set(["lib/safe-log.ts"]);
const ERROR_NAME = /^(e|err|error|.*Error|.*Err)$/;
const RAW_MEMBERS = new Set(["config", "request", "response"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

function isConsoleMember(node: ts.Node): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "console"
  );
}

/** Names bound as caught errors in scope at `node`: catch (x) and .catch((x) => …). */
function caughtNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name)) {
      names.add(n.variableDeclaration.name.text);
    }
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      n.parent &&
      ts.isCallExpression(n.parent) &&
      ts.isPropertyAccessExpression(n.parent.expression) &&
      n.parent.expression.name.text === "catch"
    ) {
      for (const p of n.parameters) if (ts.isIdentifier(p.name)) names.add(p.name.text);
    }
  }
  return names;
}

function argumentLeaks(arg: ts.Expression, caught: Set<string>): boolean {
  let leaks = false;
  const visit = (n: ts.Node) => {
    if (leaks) return;
    if (ts.isIdentifier(n) && (n === arg || ts.isSpreadElement(n.parent)) && (ERROR_NAME.test(n.text) || caught.has(n.text))) {
      leaks = true;
    } else if (ts.isPropertyAccessExpression(n) && RAW_MEMBERS.has(n.name.text)) {
      leaks = true;
    } else if (ts.isShorthandPropertyAssignment(n) && (ERROR_NAME.test(n.name.text) || caught.has(n.name.text))) {
      leaks = true;
    } else if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.initializer) && (ERROR_NAME.test(n.initializer.text) || caught.has(n.initializer.text))) {
      leaks = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(arg);
  return leaks;
}

/** Offending console uses in one file's source, as "line: text". */
export function findRawErrorLogging(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const report = (n: ts.Node) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    found.push(`${line}: ${n.getText().replace(/\s+/g, " ").slice(0, 120)}`);
  };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && isConsoleMember(n.expression)) {
      const caught = caughtNames(n);
      if (n.arguments.some((a) => argumentLeaks(a, caught))) report(n);
    } else if (isConsoleMember(n) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) {
      report(n.parent);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("no raw error logging in frontend source", () => {
  it("detector flags the shapes it is meant to catch", () => {
    const bad = [
      `try {} catch (error) { console.error("x:", error) }`,
      `try {} catch (failure) { console.warn(failure) }`,
      `p.catch((reason) => console.log("x", reason))`,
      `p.catch(console.error)`,
      `console.error("x", err.response.data)`,
      `console.error("x", e.config)`,
      `console.log({ error })`,
      `console.debug("x", axiosError)`,
    ];
    for (const snippet of bad) expect(findRawErrorLogging("x.ts", snippet), snippet).toHaveLength(1);

    const ok = [
      `try {} catch (error) { logError("x", error) }`,
      `console.log("Token exists:", !!token)`,
      `console.warn("Session expired")`,
      `console.error("stack:", info.componentStack)`,
    ];
    for (const snippet of ok) expect(findRawErrorLogging("x.ts", snippet), snippet).toEqual([]);
  });

  it("app/, components/ and lib/ hand no error objects to console", () => {
    const offenders: string[] = [];
    for (const dir of SCANNED) {
      for (const path of sourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, path);
        if (ALLOWED_FILES.has(rel)) continue;
        for (const hit of findRawErrorLogging(rel, readFileSync(path, "utf8"))) offenders.push(`${rel}:${hit}`);
      }
    }
    expect(offenders, "use logError from lib/safe-log instead").toEqual([]);
  });
});
