import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, posix } from 'path'
import ts from 'typescript'

/**
 * Which frontend files belong to the signed-in app and which to the marketing
 * and sign-in pages, computed from the import graph (typography plan R3.1), so
 * that guards never rely on hand-kept path lists.
 *
 * - App closure: every file reachable by imports from app/(app)/**.
 * - Non-app closure: every file reachable from app/(marketing)/**,
 *   app/(auth)/**, app/layout.tsx and app/providers.tsx.
 *
 * Test files are not part of either graph. Paths are repo-relative, with `/`.
 */

export const ROOT = process.cwd()
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks', 'types']
const SOURCE_FILE = /\.(tsx?|jsx?|mjs)$/
const isTestPath = (rel: string) => /(^|\/)__tests__\//.test(rel) || /\.(test|spec)\.[jt]sx?$/.test(rel)

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = posix.join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (name !== 'node_modules' && name !== '__tests__') walk(rel, out)
    } else if (SOURCE_FILE.test(name) && !isTestPath(rel)) {
      out.push(rel)
    }
  }
}

/** Every non-test frontend source file. */
export const SOURCE_FILES: string[] = SOURCE_DIRS.filter((d) => existsSync(join(ROOT, d)))
  .flatMap((d) => {
    const out: string[] = []
    walk(d, out)
    return out
  })
  .sort()
const sourceSet = new Set(SOURCE_FILES)

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js']

/** The repo file a specifier points at, or null for a package (or a non-source file such as CSS). */
export function resolveImport(from: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = specifier.slice(2)
  else if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), specifier))
  else return null
  for (const ext of EXTENSIONS) if (sourceSet.has(base + ext)) return base + ext
  return null
}

const importCache = new Map<string, string[]>()

/** Repo files a source file imports (static, re-exports, dynamic import() and require()). */
export function importsOf(file: string): string[] {
  let imports = importCache.get(file)
  if (!imports) {
    const info = ts.preProcessFile(readFileSync(join(ROOT, file), 'utf8'), true, true)
    imports = info.importedFiles
      .map((ref) => resolveImport(file, ref.fileName))
      .filter((target): target is string => target !== null)
    importCache.set(file, imports)
  }
  return imports
}

function closure(seeds: string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...seeds]
  while (stack.length > 0) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    stack.push(...importsOf(file))
  }
  return seen
}

export const APP_CLOSURE = closure(SOURCE_FILES.filter((f) => f.startsWith('app/(app)/')))

export const NON_APP_CLOSURE = closure(
  SOURCE_FILES.filter(
    (f) =>
      f.startsWith('app/(marketing)/') ||
      f.startsWith('app/(auth)/') ||
      f === 'app/layout.tsx' ||
      f === 'app/providers.tsx'
  )
)

/**
 * True when a CSS selector can only match the app surface element or something inside it: it
 * starts with [data-surface="app"] (or :root[data-surface="app"]) and contains no sibling (+, ~)
 * or column (||) combinator anywhere, since those reach elements outside the wrapper. Attribute
 * value quotes are optional (minifiers drop them). Conservative: `+` inside :nth-child(2n+1) is
 * rejected too.
 */
export function isAppScopedSelector(selector: string): boolean {
  const s = selector.trim()
  const prefix = s.match(/^(?::root)?\[data-surface=(?:"app"|'app'|app)\](?=$|[\s>:.[#])/)
  if (!prefix) return false
  const rest = s.slice(prefix[0].length).replace(/"[^"]*"|'[^']*'/g, '""')
  return !/[+~]|\|\|/.test(rest)
}
