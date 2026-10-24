// @vitest-environment node
import { readFileSync } from 'fs'
import { join } from 'path'
import { twMerge } from 'tailwind-merge'
import { describe, expect, it } from 'vitest'
import { APP_SPACING, APP_TEXT_ROLES, cn } from '../utils'

// cn() knows the app's type roles (text-title ... text-kpi) as font sizes and page-top as spacing, so a role
// survives next to an ink colour, and a later size or padding still replaces it.
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
const block = css.slice(css.indexOf('/* === APP SURFACE (typography plan) === */'))
const theme = block.slice(block.indexOf('@theme inline {'), block.indexOf('}', block.indexOf('@theme inline {')))
const themeNames = (prefix: string) =>
  [...new Set([...theme.matchAll(new RegExp(`^\\s*--${prefix}-([a-z-]+?): `, 'gm'))].map((m) => m[1]).filter((n) => !n.includes('--')))]
// The roles as the stylesheet defines them, not as lib/utils.ts lists them, so a role missing from the
// merger's list fails the merge checks too.
const ROLES = themeNames('text')

describe('cn() and the app type roles', () => {
  it('knows exactly the roles and spacing the APP SURFACE block defines', () => {
    expect(APP_TEXT_ROLES).toEqual(themeNames('text'))
    expect(APP_SPACING).toEqual(themeNames('spacing'))
  })

  it('keeps a role size next to an ink colour (stock tailwind-merge drops the size as a colour)', () => {
    expect(twMerge('text-ui text-ink-success')).toBe('text-ink-success')
    expect(ROLES).toHaveLength(9)
    for (const role of ROLES) {
      expect(cn(`text-${role}`, 'text-ink-muted'), role).toBe(`text-${role} text-ink-muted`)
      expect(cn(`text-${role} text-white`), role).toBe(`text-${role} text-white`)
    }
  })

  it('a later size replaces a role, and a later role replaces a size', () => {
    expect(cn('text-label font-semibold', 'text-xs')).toBe('font-semibold text-xs')
    expect(cn('text-sm', 'text-ui')).toBe('text-ui')
    expect(cn('text-ui', 'text-meta')).toBe('text-meta')
    expect(cn('text-title text-ink', 'sm:text-title', 'sm:text-kpi')).toBe('text-title text-ink sm:text-kpi')
  })

  it('a role replaces an earlier line height, like any font size', () => {
    expect(cn('leading-none', 'text-card-title')).toBe('text-card-title')
    expect(cn('text-card-title', 'leading-none')).toBe('text-card-title leading-none')
  })

  it('page-top is spacing: it replaces, and is replaced by, other top padding', () => {
    expect(cn('pt-6', 'pt-page-top')).toBe('pt-page-top')
    expect(cn('pt-page-top', 'pt-0')).toBe('pt-0')
    expect(cn('pt-page-top pb-6', 'py-4')).toBe('py-4')
  })

  it('merges everything else as before', () => {
    for (const input of ['px-2 px-4', 'text-sm text-lg', 'text-red-600 text-slate-900', 'text-center text-sm', 'font-medium font-semibold', 'p-2 pt-6']) {
      expect(cn(input), input).toBe(twMerge(input))
    }
  })
})
