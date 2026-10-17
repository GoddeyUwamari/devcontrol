/**
 * Every hit to Google Analytics goes through lib/gtag, which redacts the URL:
 * no source imports @next/third-parties/google (whose GoogleAnalytics sends
 * an automatic page view with the full URL), only lib/gtag.ts and the
 * SiteAnalytics loader call gtag, and only the loader references the
 * gtag.js script.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const SOURCE_DIRS = ["app", "components", "lib", "hooks"];
const GTAG_CALLERS = ["lib/gtag.ts", "components/analytics/site-analytics.tsx"];
const SCRIPT_LOADER = "components/analytics/site-analytics.tsx";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

const files = [
  ...SOURCE_DIRS.flatMap((d) => sourceFiles(join(ROOT, d))),
  join(ROOT, "middleware.ts"),
].map((path) => ({ rel: relative(ROOT, path).split("\\").join("/"), text: readFileSync(path, "utf8") }));

describe("GA has a single, redacting entry point", () => {
  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(GTAG_CALLERS));
  });

  it("nothing imports @next/third-parties/google", () => {
    expect(files.filter((f) => f.text.includes("@next/third-parties/google")).map((f) => f.rel)).toEqual([]);
  });

  it("only lib/gtag.ts and the loader call gtag", () => {
    const callers = files.filter((f) => /\bgtag\s*\(/.test(f.text)).map((f) => f.rel);
    expect(callers.filter((rel) => !GTAG_CALLERS.includes(rel))).toEqual([]);
  });

  it("only the loader references the gtag.js script", () => {
    const loaders = files.filter((f) => f.text.includes("googletagmanager.com")).map((f) => f.rel);
    expect(loaders).toEqual([SCRIPT_LOADER]);
  });
});
