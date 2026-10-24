import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { APP_CLOSURE, NON_APP_CLOSURE, SOURCE_FILES } from './surface-scope'

// The app-only tokens (the APP SURFACE block in app/globals.css) may be used only by app code:
// files reachable from app/(app)/** and not from the marketing or sign-in pages
// (app/__tests__/surface-scope.ts). Everywhere else -- marketing, sign-in, the root layout,
// components/marketing-ui, files both sides share, and unused files -- they must not appear.
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
const START = '/* === APP SURFACE (typography plan) === */'
const block = css.slice(css.indexOf(START))
const themeBody = block.slice(block.indexOf('@theme inline {'), block.indexOf('}', block.indexOf('@theme inline {')))

const names = (prefix: string) =>
  [...themeBody.matchAll(new RegExp(`^\\s*--${prefix}-([a-z-]+?): `, 'gm'))]
    .map((m) => m[1])
    .filter((name) => !name.includes('--'))
const TEXT = [...new Set(names('text'))]
const COLOR = [...new Set(names('color'))]
const SPACING = [...new Set(names('spacing'))]

const alt = (list: string[]) => list.join('|')
const COLOR_UTILITY =
  'text|bg|border|border-[trblxy]|border-[se]|ring|ring-offset|outline|fill|stroke|decoration|divide|placeholder|caret|accent|shadow|inset-shadow|from|via|to'
const TOKEN_USE = new RegExp(
  [
    `(?<![\\w-])text-(?:${alt(TEXT)})(?![\\w-])`,
    `(?<![\\w-])(?:${COLOR_UTILITY})-(?:${alt(COLOR)})(?![\\w-])`,
    `(?<![\\w])-?[a-z]+(?:-[a-z]+)*-(?:${alt(SPACING)})(?![\\w-])`,
    `--app-`,
    `--(?:text-(?:${alt(TEXT)})|color-(?:${alt(COLOR)})|spacing-(?:${alt(SPACING)}))(?![\\w-])`,
  ].join('|')
)

const APP_ONLY = (file: string) => APP_CLOSURE.has(file) && !NON_APP_CLOSURE.has(file)

describe('app tokens stay in app code', () => {
  it('the token names come from the block', () => {
    expect(TEXT).toEqual(['title', 'subtitle', 'section', 'card-title', 'body', 'ui', 'meta', 'label', 'kpi'])
    expect(COLOR).toContain('ink-muted')
    expect(COLOR).toHaveLength(11)
    expect(SPACING).toEqual(['page-top'])
  })

  it('the pattern catches each kind of use (self-check)', () => {
    for (const use of [
      'text-title', 'sm:text-kpi', 'text-ink-muted', 'hover:bg-ink', 'border-ink-danger', 'pt-page-top',
      'lg:pt-page-top', '-mt-page-top', 'var(--app-color-ink)', 'var(--text-title)', 'var(--spacing-page-top)',
    ]) {
      expect(`className="${use}"`, use).toMatch(TOKEN_USE)
    }
    for (const other of ['text-sm', 'text-pink-600', 'text-title-case', 'bg-slate-100', 'pt-6', 'text-secondary']) {
      expect(`className="${other}"`, other).not.toMatch(TOKEN_USE)
    }
  })

  it('no file outside the app uses them', () => {
    const offending = SOURCE_FILES.filter((file) => !APP_ONLY(file)).flatMap((file) => {
      const match = readFileSync(join(process.cwd(), file), 'utf8').match(TOKEN_USE)
      return match ? [`${file}: ${match[0]}`] : []
    })
    expect(offending).toEqual([])
  })
})
