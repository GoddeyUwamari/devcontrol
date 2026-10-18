/**
 * Guard: no frontend source builds a URL that carries a token in its query
 * string, or appends a token value to a `token=` parameter.
 *
 * A token in a URL lands in the address bar, browser history, server and
 * proxy logs, and the Referer of whatever the page loads next. Tokens travel
 * in a request body, a header, or -- for links -- the fragment, which
 * takeUrlCredentials reads and removes; they are never written into a URL by
 * the frontend itself.
 *
 * Flags, in app/, components/, lib/ and hooks/ (tests excluded), any string or
 * template literal containing `?token=` or `&token=`, or a `token=` parameter
 * whose value is an interpolation (`token=${...}`). Comments are not scanned.
 * It sees literals only, so it cannot catch a token added through an API such
 * as `url.searchParams.set("token", ...)` or `new URLSearchParams({ token })`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const SCANNED = ["app", "components", "lib", "hooks"];

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

/** `?token=` / `&token=` anywhere in a literal's text. */
const TOKEN_QUERY_PARAM = /[?&]token=/i;
/** Literal text that ends in a `token=` parameter, so the next interpolation is its value. */
const TOKEN_PARAM_BEFORE_VALUE = /(?:^|[?&#;\s"'`(/])token=$/i;

/** URL-building literals in one file's source, as "line: text". */
export function findTokenUrls(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (n: ts.Node) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    found.push(`${line}: ${n.getText().replace(/\s+/g, " ").slice(0, 120)}`);
  };
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (TOKEN_QUERY_PARAM.test(n.text)) report(n);
    } else if (ts.isTemplateExpression(n)) {
      // Each literal piece: the head, then the text after each interpolation.
      const pieces = [n.head.text, ...n.templateSpans.map((span) => span.literal.text)];
      const flagged =
        pieces.some((piece) => TOKEN_QUERY_PARAM.test(piece)) ||
        // Every piece but the last is followed by an interpolation.
        pieces.slice(0, -1).some((piece) => TOKEN_PARAM_BEFORE_VALUE.test(piece));
      if (flagged) report(n);
      // Nested templates inside the interpolations are visited too.
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("no frontend source puts a token in a URL", () => {
  it("detector flags the shapes it is meant to catch", () => {
    const bad = [
      "const a = `/accept-invitation?token=${encodeURIComponent(t)}`;",
      "const b = `/reset?x=1&token=${t}`;",
      'const c = "/verify?token=abc";',
      "const d = `${base}/accept-invitation#token=${t}`;",
      "const e = `token=${t}`;",
      "const f = `/x?a=${a}&token=${t}`;",
      "const g = <a href={`/x?token=${t}`}>x</a>;",
      "const h = '/x?TOKEN=1';",
    ];
    for (const src of bad) {
      expect(findTokenUrls("bad.tsx", src), src).toHaveLength(1);
    }
  });

  it("detector leaves unrelated shapes alone", () => {
    const ok = [
      // A cookie named auth-token is not a URL parameter.
      "document.cookie = `auth-token=${token}; max-age=1`;",
      "const a = `/accept-invitation`;",
      "const b = `/login?from=${encodeURIComponent(path)}`;",
      "const c = `refreshToken=${x}`;",
      "const d = { token };",
      "// A comment mentioning /accept-invitation?token= is not a URL being built.",
      "const e = `csrf_token=${x}`;",
      "takeUrlCredentials(['token'] as const);",
    ];
    for (const src of ok) {
      expect(findTokenUrls("ok.tsx", src), src).toEqual([]);
    }
  });

  it("frontend sources build no URL with a token in it", () => {
    const offenders: string[] = [];
    for (const dir of SCANNED) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        for (const hit of findTokenUrls(file, readFileSync(file, "utf8"))) {
          offenders.push(`${relative(ROOT, file)}:${hit}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
