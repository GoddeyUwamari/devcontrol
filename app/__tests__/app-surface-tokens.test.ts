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
