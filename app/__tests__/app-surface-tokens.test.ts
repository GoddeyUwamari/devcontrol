// @vitest-environment node
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import tailwind from '@tailwindcss/postcss'
import postcss, { type Root, type Rule } from 'postcss'
import { beforeAll, describe, expect, it } from 'vitest'
import { contrast } from './contrast'
import { isAppScopedSelector } from './surface-scope'

// What Tailwind really generates from the APP SURFACE block in app/globals.css: each app utility
// reads an --app-* value, and those values exist only under [data-surface="app"], so on the
// marketing and sign-in pages the utilities get no value from the block. Compiled with the same @tailwindcss/postcss plugin
// the Next.js build uses, from the block alone (no source scan; the candidates are listed inline).
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
const START = '/* === APP SURFACE (typography plan) === */'
const END = '/* === END APP SURFACE === */'
const block = css.slice(css.indexOf(START), css.indexOf(END) + END.length)

const TEXT_ROLES = ['title', 'subtitle', 'section', 'card-title', 'body', 'ui', 'meta', 'label', 'kpi']
const INKS = [
  'ink', 'ink-body', 'ink-muted', 'ink-success', 'ink-success-strong', 'ink-warning', 'ink-warning-strong',
  'ink-danger', 'ink-danger-strong', 'ink-info', 'ink-accent',
]
const CANDIDATES = [
  ...TEXT_ROLES.map((role) => `text-${role}`),
  ...INKS.flatMap((ink) => [`text-${ink}`, `bg-${ink}`, `border-${ink}`]),
  'pt-page-top', 'mt-page-top', 'lg:pt-page-top',
]

let out: Root

beforeAll(async () => {
  const input = `@import "tailwindcss" source(none);\n@source inline("${CANDIDATES.join(' ')}");\n${block}\n`
  const result = await postcss([tailwind()]).process(input, { from: join(process.cwd(), 'app/globals.css') })
  out = postcss.parse(result.css)
}, 60_000)

/** Declarations of the first rule whose only selector is `selector`, as {property: value}. */
function utility(selector: string): Record<string, string> {
  let found: Rule | undefined
  out.walkRules((rule) => {
    if (!found && rule.selector === selector) found = rule
  })
  expect(found, selector).toBeDefined()
  const decls: Record<string, string> = {}
  found!.walkDecls((decl) => void (decls[decl.prop] = decl.value))
  return decls
}

const NEW_THEME_NAMES = [
  ...TEXT_ROLES.map((role) => `--text-${role}`),
  ...INKS.map((ink) => `--color-${ink}`),
  '--spacing-page-top',
]

describe('generated CSS for the app tokens', () => {
  it('each utility reads an --app-* value directly', () => {
    expect(utility('.pt-page-top')).toEqual({ 'padding-top': 'var(--app-spacing-page-top)' })
    expect(utility('.mt-page-top')).toEqual({ 'margin-top': 'var(--app-spacing-page-top)' })
    expect(utility('.text-ink-muted')).toEqual({ color: 'var(--app-color-ink-muted)' })
    expect(utility('.bg-ink')).toEqual({ 'background-color': 'var(--app-color-ink)' })
    const title = utility('.text-title')
    expect(title['font-size']).toBe('var(--app-text-title)')
    expect(Object.values(title).join(' ')).toContain('var(--app-text-title--line-height)')
    expect(Object.values(title).join(' ')).toContain('var(--app-text-title--font-weight)')
    expect(Object.values(title).join(' ')).toContain('var(--app-text-title--letter-spacing)')
    for (const role of TEXT_ROLES) expect(utility(`.text-${role}`)['font-size']).toBe(`var(--app-text-${role})`)
  })

  it('no generated value falls back to anything when --app-* is undefined', () => {
    out.walkDecls((decl) => {
      expect(decl.value, `${decl.prop}: ${decl.value}`).not.toMatch(/var\(--app-[\w-]+,/)
    })
  })

  it('the new theme names are not defined anywhere (not on :root, :host)', () => {
    out.walkDecls((decl) => {
      expect(NEW_THEME_NAMES, decl.prop).not.toContain(decl.prop)
    })
  })

  it('every --app-* value is defined only under [data-surface="app"]', () => {
    const defined: string[] = []
    out.walkDecls(/^--app-/, (decl) => {
      const rule = decl.parent as Rule
      expect(rule.type, decl.prop).toBe('rule')
      for (const selector of rule.selectors) expect(isAppScopedSelector(selector), `${decl.prop} in ${selector}`).toBe(true)
      defined.push(decl.prop)
    })
    expect(defined).toContain('--app-spacing-page-top')
    expect(defined).toContain('--app-text-title')
    expect(defined).toContain('--app-color-ink-muted')
  })

  it('the palette colours the ink values point at are emitted', () => {
    const emitted = new Set<string>()
    out.walkDecls(/^--color-/, (decl) => void emitted.add(decl.prop))
    const referenced = [...block.matchAll(/--app-color-[\w-]+: var\((--color-[a-z]+-\d+)\);/g)].map((m) => m[1])
    expect(referenced).toHaveLength(INKS.length)
    for (const name of referenced) expect(emitted.has(name), name).toBe(true)
  })
})

// The whole app/globals.css, compiled the way the Next.js build compiles it (the same plugin, scanning the
// repo for class candidates), and the frozen baseline compiled the same way. What a page without
// [data-surface="app"] can match -- the full output minus the app-scoped rules, minus the utilities generated
// from the app tokens, minus default palette variables the app values reference, minus the new theme names
// -- must equal the baseline's output, with and without Lightning CSS minification. So nothing in the block,
// and nothing the preceding @theme blocks do with it, changes the marketing and sign-in pages.
//
// The new theme names do reach :root in a real build: Tailwind emits a theme variable whose name appears
// as var(--name) in any scanned file (test files included), even for @theme inline. Each one is only an
// alias of its own --app-* value, so outside the app it is an undefined value that nothing there reads
// (app-token-scope.test.ts keeps the names out of non-app files).
const baselineCss = readFileSync(join(process.cwd(), 'app/__tests__/__fixtures__/globals.baseline.css'), 'utf8')
const defaultPalette: Record<string, string> = {}
postcss
  .parse(readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8'))
  .walkDecls(/^--color-[a-z]+-\d+$/, (decl) => void (defaultPalette[decl.prop] = decl.value))

// Separate `from` paths: the plugin caches its compiler per input file.
async function compileWhole(source: string, from: string, optimize: boolean): Promise<Root> {
  // No asset URL rewriting: it is relative to `from`, which differs between the two compiles.
  const result = await postcss([tailwind({ optimize, transformAssetUrls: false })]).process(source, { from: join(process.cwd(), from) })
  return postcss.parse(result.css)
}

/** A new theme name aliased to its own --app-* value: --text-title: var(--app-text-title). */
const isAppAlias = (prop: string, value: string) => NEW_THEME_NAMES.includes(prop) && value.trim() === `var(--app-${prop.slice(2)})`

/**
 * A utility generated from the app tokens (.text-title, .sm\:text-kpi, .-mt-page-top, .drop-shadow-ink, ...):
 * it applies only to elements carrying that class, and app-token-scope.test.ts keeps those class names out
 * of every non-app file.
 */
const TOKEN_UTILITY = new RegExp(
  `^-?(?:text-(?:${TEXT_ROLES.join('|')})|[a-z-]+-(?:${INKS.join('|')})|[a-z-]+-page-top)$`
)
const isTokenUtility = (rule: Rule) =>
  rule.selectors.every((selector) => {
    const cls = selector.trim().match(/^\.((?:\\.|[\w-])+)/)?.[1]
    if (!cls) return false
    const name = cls.replace(/\\(.)/g, '$1').split(':').pop()!
    return TOKEN_UTILITY.test(name)
  })

/** One line per rule, at-rule and declaration, in order; comments and formatting ignored. */
function serialise(root: Root, skipDecl: (prop: string, value: string) => boolean = () => false): string[] {
  const lines: string[] = []
  const visit = (nodes: Root['nodes'], depth: number) => {
    for (const node of nodes) {
      if (node.type === 'decl') {
        if (!skipDecl(node.prop, node.value)) lines.push(`${'  '.repeat(depth)}${node.prop}: ${node.value}${node.important ? ' !important' : ''}`)
      } else if (node.type === 'rule') {
        lines.push(`${'  '.repeat(depth)}${node.selector} {`)
        visit(node.nodes, depth + 1)
      } else if (node.type === 'atrule') {
        lines.push(`${'  '.repeat(depth)}@${node.name} ${node.params} {`)
        visit(node.nodes ?? [], depth + 1)
      }
    }
  }
  visit(root.nodes, 0)
  return lines
}

/** The full output as a page without the marker sees it. */
function withoutAppSurface(root: Root): Root {
  const copy = root.clone()
  copy.walkRules((rule) => {
    if (rule.selectors.every(isAppScopedSelector) || isTokenUtility(rule)) rule.remove()
  })
  // Drop at-rules the removal emptied (e.g. the block's @media wrappers).
  let removed = true
  while (removed) {
    removed = false
    copy.walkAtRules((at) => {
      if (at.nodes && at.nodes.length === 0) { at.remove(); removed = true }
    })
  }
  return copy
}

describe('the whole app/globals.css, compiled with a repo scan', () => {
  const outputs: Record<string, { full: Root; baseline: Root }> = {}

  beforeAll(async () => {
    for (const optimize of [false, true]) {
      outputs[String(optimize)] = {
        full: await compileWhole(css, 'app/globals.css', optimize),
        baseline: await compileWhole(baselineCss, 'app/__tests__/__fixtures__/globals.baseline.css', optimize),
      }
    }
  }, 180_000)

  it.each(['false', 'true'])('outside the app it equals the baseline (optimize: %s)', (optimize) => {
    const { full, baseline } = outputs[optimize]
    const baselineDecls = new Set<string>()
    baseline.walkDecls((decl) => void baselineDecls.add(`${decl.prop}: ${decl.value}`))
    // A palette variable the app values reference may be emitted where the baseline did not need it:
    // a new, unused name with Tailwind's own value, so it changes nothing outside the app.
    const addedPalette = (prop: string, value: string) =>
      !baselineDecls.has(`${prop}: ${value}`) && prop in defaultPalette && defaultPalette[prop] === value
    expect(serialise(withoutAppSurface(full), (prop, value) => addedPalette(prop, value) || isAppAlias(prop, value))).toEqual(serialise(baseline))
  })

  it.each(['false', 'true'])('a new theme name appears only as its own --app-* alias, and every --app-* value is app-scoped (optimize: %s)', (optimize) => {
    const { full } = outputs[optimize]
    const defined: string[] = []
    full.walkDecls((decl) => {
      if (NEW_THEME_NAMES.includes(decl.prop)) {
        expect(isAppAlias(decl.prop, decl.value), `${decl.prop}: ${decl.value}`).toBe(true)
        expect((decl.parent as Rule).selectors?.map((s) => s.trim()).sort(), decl.prop).toEqual([':host', ':root'])
        return
      }
      if (!decl.prop.startsWith('--app-')) return
      const rule = decl.parent as Rule
      expect(rule.type, decl.prop).toBe('rule')
      for (const selector of rule.selectors) expect(isAppScopedSelector(selector), `${decl.prop} in ${selector}`).toBe(true)
      defined.push(decl.prop)
    })
    expect(defined).toContain('--app-color-ink-muted')
  })

  // The re-pointed tokens (globals-marketing-scope.test.ts checks the source): in the real output each one
  // is declared, inside the app, by a rule that includes :root[data-surface=app] -- specificity (0,2,0)
  // against the frozen :root's (0,1,0) -- so on <html> it wins even if minification reorders rules.
  it.each(['false', 'true'])('re-pointed tokens outrank :root on <html>, and placeholders get full opacity (optimize: %s)', (optimize) => {
    const { full } = outputs[optimize]
    const ROOT_APP = /^:root\[data-surface=(?:"app"|app)\]$/
    for (const name of ['--muted-foreground', '--text-success', '--text-warning', '--text-danger']) {
      const scoped: Rule[] = []
      full.walkDecls(name, (decl) => {
        const rule = decl.parent as Rule
        if (rule.selectors.every(isAppScopedSelector)) scoped.push(rule)
      })
      expect(scoped.length, name).toBeGreaterThan(0)
      for (const rule of scoped) expect(rule.selectors.some((s) => ROOT_APP.test(s.trim())), `${name} in ${rule.selector}`).toBe(true)
    }
    const placeholders: Rule[] = []
    full.walkRules((rule) => {
      if (rule.selectors.every(isAppScopedSelector) && /placeholder/.test(rule.selector)) placeholders.push(rule)
    })
    expect(placeholders.length).toBeGreaterThan(0)
    for (const rule of placeholders) {
      const decls: Record<string, string> = {}
      rule.walkDecls((decl) => void (decls[decl.prop] = decl.value))
      expect(decls, rule.selector).toEqual({ color: 'var(--muted-foreground)', opacity: '1' })
    }
  })

  // The app fonts: app/layout.tsx defines --font-geist-sans/--font-geist-mono on <body> only, so they must be
  // read on <body> or below. In the real output the only font-family rules that need the marker are Geist on
  // <body> under a marked <html> (dialogs and menus portalled to <body>) and on the wrapper (first paint), and
  // Geist Mono on bare code elements. Nothing sets a font on <html> itself.
  it.each(['false', 'true'])('the app fonts are read on <body> and the wrapper, never on <html> (optimize: %s)', (optimize) => {
    const { full } = outputs[optimize]
    const norm = (selector: string) => selector.replace(/["']/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim()
    const fonts: Record<string, string[]> = {}
    full.walkDecls('font-family', (decl) => {
      const rule = decl.parent as Rule
      if (rule.type !== 'rule' || !rule.selectors.some((s) => /data-surface/.test(s))) return
      for (const selector of rule.selectors) {
        expect(isAppScopedSelector(selector), selector).toBe(true)
        ;(fonts[decl.value] ??= []).push(norm(selector))
      }
    })
    expect(Object.keys(fonts).sort()).toEqual(['var(--font-geist-mono)', 'var(--font-geist-sans)'])
    expect(fonts['var(--font-geist-sans)'].sort()).toEqual([':root[data-surface=app] body', '[data-surface=app]:not(:root)'])
    expect(fonts['var(--font-geist-mono)']).toEqual(['[data-surface=app] :is(code,kbd,samp,pre)'])
  })
})

describe('the app font variables', () => {
  it('app/layout.tsx defines them on <body>, where the APP SURFACE font rules read them', () => {
    const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/Geist\(\{\s*variable: "--font-geist-sans"/)
    expect(layout).toMatch(/Geist_Mono\(\{\s*variable: "--font-geist-mono"/)
    expect(layout).toMatch(/<body[^>]*className=\{`\$\{geistSans\.variable\} \$\{geistMono\.variable\}/)
    expect(layout).not.toMatch(/<html[^>]*className/)
  })
})

// The promised contrast of each ink token (typography plan §3.1/§3.3) against the light surfaces it
// may sit on, from Tailwind's own palette values.
const palette: Record<string, string> = {}
postcss
  .parse(readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8'))
  .walkDecls(/^--color-[a-z]+-\d+$/, (decl) => void (palette[decl.prop.slice('--color-'.length)] = decl.value))

/** The palette colour an ink token is defined as in the block (`var(--color-slate-600)` → slate-600). */
function inkColour(ink: string): string {
  const m = block.match(new RegExp(`--app-color-${ink}: var\\(--color-([a-z]+-\\d+)\\);`))
  expect(m, ink).not.toBeNull()
  return m![1]
}

const WHITE = '#ffffff'
const NEUTRAL_50 = ['slate-50', 'gray-50']
const NEUTRAL_100_200 = ['slate-100', 'gray-100', 'slate-200', 'gray-200']
const TINTS_50 = ['red-50', 'amber-50', 'green-50', 'blue-50', 'violet-50', 'orange-50', 'emerald-50', 'purple-50']
const TINTS_100 = ['red-100', 'amber-100', 'green-100', 'blue-100', 'violet-100', 'orange-100', 'purple-100', 'yellow-100']
const ALL = [...NEUTRAL_50, ...NEUTRAL_100_200, ...TINTS_50, ...TINTS_100]

const PROMISES: [string, string[]][] = [
  ['ink', ALL],
  ['ink-body', ALL],
  ['ink-muted', ALL],
  ['ink-success', [...NEUTRAL_50, ...TINTS_50]],
  ['ink-warning', [...NEUTRAL_50, ...TINTS_50]],
  ['ink-success-strong', ALL],
  ['ink-warning-strong', ALL],
  ['ink-danger', ALL],
  ['ink-danger-strong', ALL],
  ['ink-info', ALL],
  ['ink-accent', ALL],
]

describe('ink tokens meet 4.5:1 on the surfaces they are promised for', () => {
  it('every ink token has a promise', () => {
    expect(PROMISES.map(([ink]) => ink).sort()).toEqual([...INKS].sort())
  })

  it.each(PROMISES)('%s', (ink, surfaces) => {
    const fg = palette[inkColour(ink)]
    expect(fg, ink).toBeDefined()
    expect(contrast(fg, WHITE), `${ink} on white`).toBeGreaterThanOrEqual(4.5)
    for (const surface of surfaces) {
      expect(palette[surface], surface).toBeDefined()
      expect(contrast(fg, palette[surface]), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

// The app values of the re-pointed tokens meet 4.5:1 where they are used: muted text on every light
// surface, the status colours on white, the page and card surfaces and the 50-tints (on a 100-tint or a
// --bg-* tint the app uses the -strong ink instead).
const OVERRIDE_INK: [string, string, string[]][] = [
  ['--muted-foreground', 'ink-muted', ALL],
  ['--text-success', 'ink-success', [...NEUTRAL_50, ...TINTS_50]],
  ['--text-warning', 'ink-warning', [...NEUTRAL_50, ...TINTS_50]],
  ['--text-danger', 'ink-danger', ALL],
]

describe('re-pointed tokens meet 4.5:1 in the app', () => {
  it.each(OVERRIDE_INK)('%s', (name, ink, surfaces) => {
    // The value as written: an ink token (var(--app-color-ink-…)) or, if edited, a palette colour.
    const m = block.match(new RegExp(`\\n  ${name}: var\\(--(?:app-color-(ink[a-z-]*)|color-([a-z]+-\\d+))\\);`))
    expect(m, name).not.toBeNull()
    const fg = palette[m![1] ? inkColour(m![1]) : m![2]]
    expect(fg, name).toBeDefined()
    expect(contrast(fg, WHITE), `${name} on white`).toBeGreaterThanOrEqual(4.5)
    for (const surface of surfaces) expect(contrast(fg, palette[surface]), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    expect(m![1], `${name} uses the ${ink} token`).toBe(ink)
  })
})
