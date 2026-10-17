/**
 * Guard: every <form> in frontend source declares method="post".
 *
 * A form is rendered as plain HTML before React hydrates (and stays plain HTML
 * if hydration fails). Submitting it then is a native submit, which with no
 * method is a GET to the current URL: every field, passwords included, lands
 * in the query string -- the address bar, browser history, request logs and
 * the Referer of whatever the page loads next. With method="post" the fields
 * travel in the request body instead. After hydration nothing changes: each
 * onSubmit handler prevents the native submit.
 *
 * Flags, in app/, components/, lib/ and hooks/ (tests excluded), any JSX
 * <form> whose method is missing, is not the literal "post", or could be
 * overridden by a spread.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

function declaresPost(attributes: ts.JsxAttributes): boolean {
  let post = false;
  for (const attr of attributes.properties) {
    // A spread after (or before) method could replace it; require it explicit.
    if (ts.isJsxSpreadAttribute(attr)) return false;
    if (ts.isIdentifier(attr.name) && attr.name.text === "method") {
      post = !!attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === "post";
    }
  }
  return post;
}

/** <form> elements in one file's source without method="post", as "line: text". */
export function findFormsWithoutPost(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      ts.isIdentifier(n.tagName) &&
      n.tagName.text === "form" &&
      !declaresPost(n.attributes)
    ) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      found.push(`${line}: ${n.getText().replace(/\s+/g, " ").slice(0, 120)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("every <form> posts", () => {
  it("detector flags the shapes it is meant to catch", () => {
    const bad = [
      `const a = <form onSubmit={submit}><input name="password" /></form>`,
      `const a = <form>x</form>`,
      `const a = <form method="get" onSubmit={submit} />`,
      `const a = <form method={m} onSubmit={submit} />`,
      `const a = <form method="POST" />`,
      `const a = <form method="post" {...props} />`,
      `const a = <form {...props} method="post" />`,
      `const a = <form method />`,
    ];
    for (const snippet of bad) expect(findFormsWithoutPost("x.tsx", snippet), snippet).toHaveLength(1);

    const ok = [
      `const a = <form method="post" onSubmit={submit}><input /></form>`,
      `const a = <form onSubmit={submit} method="post" className="x" />`,
      // Components named Form (react-hook-form's provider) are not <form> elements.
      `const a = <Form {...form}><div /></Form>`,
    ];
    for (const snippet of ok) expect(findFormsWithoutPost("x.tsx", snippet), snippet).toEqual([]);
  });

  it("app/, components/, lib/ and hooks/ have no <form> without method=\"post\"", () => {
    const offenders: string[] = [];
    let forms = 0;
    for (const dir of SCANNED) {
      if (!existsSync(join(ROOT, dir))) continue;
      for (const path of sourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, path);
        const text = readFileSync(path, "utf8");
        forms += text.match(/<form[\s>]/g)?.length ?? 0;
        for (const hit of findFormsWithoutPost(rel, text)) offenders.push(`${rel}:${hit}`);
      }
    }
    // The scan must actually see the forms (the auth pages alone have four).
    expect(forms).toBeGreaterThanOrEqual(4);
    expect(offenders, 'add method="post" so a pre-hydration submit never puts fields in the URL').toEqual([]);
  });
});
