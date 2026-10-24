import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import postcss, { type AtRule, type Root, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { isAppScopedSelector } from './surface-scope'

// app/globals.css styles the marketing and sign-in pages as well as the app. The app-only
// typography work adds CSS in exactly one delimited block at the end of the file; everything
// else -- including the custom purple @theme at the top -- must stay byte-identical to
// __fixtures__/globals.baseline.css (app/globals.css before that work). Updating the baseline
// needs founder sign-off in the PR.
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
const baseline = readFileSync(join(process.cwd(), 'app/__tests__/__fixtures__/globals.baseline.css'), 'utf8')

const BLOCK_START = '/* === APP SURFACE (typography plan) === */'
const BLOCK_END = '/* === END APP SURFACE === */'

/** app/globals.css split into the delimited app block (or null) and everything outside it. */
function splitAppBlock(source: string): { block: string | null; rest: string } {
  const start = source.indexOf(BLOCK_START)
  const end = source.indexOf(BLOCK_END)
  if (start === -1 && end === -1) return { block: null, rest: source }
  expect(start, 'block start marker').toBeGreaterThan(-1)
  expect(end, 'block end marker after the start marker').toBeGreaterThan(start)
  expect(source.indexOf(BLOCK_START, start + 1), 'one block start marker').toBe(-1)
  expect(source.indexOf(BLOCK_END, end + 1), 'one block end marker').toBe(-1)
  const after = end + BLOCK_END.length
  // The block is appended: a blank line before it, a newline after it, nothing else.
  expect(source.slice(after), 'nothing after the block').toBe('\n')
  expect(source.slice(start - 1, start), 'blank line before the block').toBe('\n')
  return { block: source.slice(start, after), rest: source.slice(0, start - 1) }
}

describe('app/globals.css outside the app block', () => {
  it('is byte-identical to the baseline (marketing and sign-in styles unchanged)', () => {
    expect(splitAppBlock(css).rest).toBe(baseline)
  })

  it('the baseline still contains the existing custom @theme block', () => {
    expect(baseline).toMatch(/\n@theme \{\n  --color-purple-50: #faf5ff;[\s\S]*?--color-purple-900: #581c87;\n\}\n/)
  })

  it('nothing outside the block defines or reads an --app-* value', () => {
    expect(splitAppBlock(css).rest).not.toMatch(/--app-/)
  })
})

// Every selector in the block can match only the app surface element or its descendants; the
// block's @theme only aliases new names to --app-* values, with no fallback, so outside the app its
// utilities get no value from the block (and the source scan keeps them out of non-app files).
const APP_VALUE = /^var\((--app-[\w-]+)\)$/

function appBlock(): Root {
  const { block } = splitAppBlock(css)
  expect(block, 'the APP SURFACE block exists').not.toBeNull()
  return postcss.parse(block!)
}

/** Every custom property name Tailwind's theme or the frozen part of globals.css already defines. */
function existingNames(): Set<string> {
  const names = new Set<string>()
  const tailwindTheme = readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8')
  for (const source of [tailwindTheme, baseline]) {
    postcss.parse(source).walkDecls((decl) => {
      if (decl.prop.startsWith('--')) names.add(decl.prop)
    })
  }
  return names
}

describe('the APP SURFACE block in app/globals.css', () => {
  it('holds only comments, one @theme inline, scoped rules and @media blocks of scoped rules', () => {
    const themes: AtRule[] = []
    for (const node of appBlock().nodes) {
      if (node.type === 'comment') continue
      if (node.type === 'atrule' && node.name === 'theme') {
        expect(node.params, '@theme in the block is inline').toBe('inline')
        themes.push(node)
        continue
      }
      if (node.type === 'atrule' && node.name === 'media') {
        for (const child of node.nodes ?? []) {
          if (child.type === 'comment') continue
          expect(child.type, `only rules inside @media ${node.params}`).toBe('rule')
        }
        continue
      }
      expect(node.type, `unexpected ${node.toString().slice(0, 60)}`).toBe('rule')
    }
    expect(themes).toHaveLength(1)
  })

  it('every selector (including inside @media) starts with [data-surface="app"]', () => {
    const selectors: string[] = []
    appBlock().walkRules((rule) => {
      selectors.push(...rule.selectors)
    })
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) expect(isAppScopedSelector(selector), selector).toBe(true)
  })

  it('every --app-* value is defined only inside scoped rules', () => {
    const defined = new Set<string>()
    appBlock().walkDecls(/^--app-/, (decl) => {
      expect(decl.parent?.type, decl.prop).toBe('rule')
      for (const selector of (decl.parent as Rule).selectors) expect(isAppScopedSelector(selector), `${decl.prop} in ${selector}`).toBe(true)
      defined.add(decl.prop)
    })
    expect(defined.size).toBeGreaterThan(0)
  })

  it('@theme inline only adds new names, each aliased to a defined --app-* value with no fallback', () => {
    const existing = existingNames()
    const defined = new Set<string>()
    appBlock().walkRules((rule) => {
      rule.walkDecls((decl) => {
        defined.add(decl.prop)
      })
    })
    const theme = appBlock().nodes.find((n): n is AtRule => n.type === 'atrule' && n.name === 'theme')!
    const names: string[] = []
    theme.walkDecls((decl) => {
      names.push(decl.prop)
      expect(existing.has(decl.prop), `${decl.prop} already exists`).toBe(false)
      const alias = decl.value.match(APP_VALUE)
      expect(alias, `${decl.prop}: ${decl.value}`).not.toBeNull()
      expect(defined.has(alias![1]), `${alias![1]} is defined in a scoped rule`).toBe(true)
    })
    expect(names).toContain('--text-title')
    expect(names).toContain('--color-ink-muted')
    expect(names).toContain('--spacing-page-top')
  })

  it('the selector rule rejects sibling and column combinators (self-check)', () => {
    for (const ok of ['[data-surface="app"]', ':root[data-surface="app"]', '[data-surface="app"] ::placeholder', '[data-surface="app"] > .x', '[data-surface=app] [title="a+b"]']) {
      expect(isAppScopedSelector(ok), ok).toBe(true)
    }
    for (const bad of ['body', '.x [data-surface="app"]', '[data-surface="app"] + body', '[data-surface="app"] ~ *', '[data-surface="app"]+p', '[data-surface="app"] || td', '[data-surface="application"]']) {
      expect(isAppScopedSelector(bad), bad).toBe(false)
    }
  })

  it('no value in the block has a fallback', () => {
    appBlock().walkDecls((decl) => {
      expect(decl.value, `${decl.prop}: ${decl.value}`).not.toMatch(/var\([^()]*,/)
    })
  })

  it('page-top spacing is 24 / 32 / 40 px at Tailwind sm (40rem) and lg (64rem)', () => {
    const values: Record<string, string> = {}
    appBlock().walkDecls('--app-spacing-page-top', (decl) => {
      const media = decl.parent?.parent
      values[media?.type === 'atrule' ? (media as AtRule).params : 'base'] = decl.value
    })
    expect(values).toEqual({ base: '1.5rem', '(width >= 40rem)': '2rem', '(width >= 64rem)': '2.5rem' })
  })
})
