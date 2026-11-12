/**
 * StatusIcon / StatusLabel (dashboard-step1 §D, DB-D14): each kind draws its Tabler filled glyph
 * (checked against the @tabler/icons 3.45.0 source files), is aria-hidden next to text or named
 * with aria-label when standalone, and fills with a token that keeps 3:1 (non-text contrast) on
 * both app surfaces in light and dark, computed from app/globals.css.
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { contrast } from '@/app/__tests__/contrast'
import { STATUS_FILL_TOKEN, StatusIcon, StatusLabel, type StatusGlyph, type StatusKind } from '../status-icon'

const require_ = createRequire(import.meta.url)

/** The glyph path of a Tabler filled icon, read from the installed package (not from our copy). */
function tablerFilledPath(name: StatusGlyph): string {
  // The package exports "./*" as "./icons/*": this is node_modules/@tabler/icons/icons/filled/<name>.svg.
  const svg = readFileSync(require_.resolve(`@tabler/icons/filled/${name}.svg`), 'utf8')
  const paths = [...svg.matchAll(/<path([^>]*)\/>/g)].map((m) => m[1])
  // Tabler's first path is the invisible 24×24 bounding box (stroke="none" fill="none").
  const glyph = paths.filter((attrs) => !/fill="none"/.test(attrs))
  expect(glyph, `${name}.svg has one visible path`).toHaveLength(1)
  return glyph[0].match(/\sd="([^"]+)"/)![1]
}

const EXPECTED: { kind: StatusKind; variant?: 'x'; glyph: StatusGlyph; token: string }[] = [
  { kind: 'success', glyph: 'circle-check', token: '--fill-success' },
  { kind: 'warning', glyph: 'alert-triangle', token: '--fill-warning' },
  { kind: 'info', glyph: 'info-circle', token: '--text-accent' },
  { kind: 'error', glyph: 'alert-circle', token: '--fill-danger' },
  { kind: 'error', variant: 'x', glyph: 'circle-x', token: '--fill-danger' },
  { kind: 'security', glyph: 'shield-check', token: '--text-accent' },
]

const icon = (kind: StatusKind, variant?: 'x', extra: { 'aria-label'?: string } = {}) =>
  kind === 'error' ? <StatusIcon kind="error" variant={variant} data-testid="si" {...extra} /> : <StatusIcon kind={kind} data-testid="si" {...extra} />

describe('glyphs', () => {
  it.each(EXPECTED)('$kind $variant → Tabler filled $glyph, a single filled path', ({ kind, variant, glyph }) => {
    render(icon(kind, variant))
    const svg = screen.getByTestId('si')
    expect(svg.getAttribute('data-glyph')).toBe(glyph)
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    const paths = svg.querySelectorAll('path')
    expect(paths).toHaveLength(1)
    expect(paths[0].getAttribute('d')).toBe(tablerFilledPath(glyph))
    // Filled, not outline: no stroke anywhere.
    expect(svg.outerHTML).not.toMatch(/stroke/)
  })

  it('the five kinds draw five different glyphs', () => {
    const kinds: StatusKind[] = ['success', 'warning', 'info', 'error', 'security']
    const ds = kinds.map((k) => {
      const { unmount } = render(icon(k))
      const d = screen.getByTestId('si').querySelector('path')!.getAttribute('d')
      unmount()
      return d
    })
    expect(new Set(ds).size).toBe(5)
  })

  it.each(EXPECTED)('$kind $variant fills with var($token)', ({ kind, variant, token }) => {
    render(icon(kind, variant))
    expect(screen.getByTestId('si').getAttribute('style')).toBe(`fill: var(${token});`)
  })

  it('the file keeps the Tabler MIT notice', () => {
    const src = readFileSync(join(process.cwd(), 'components/ui/status-icon.tsx'), 'utf8')
    expect(src).toContain('Tabler Icons (filled)')
    expect(src).toContain('MIT License')
    expect(src).toContain('Copyright (c) 2020-2026 Paweł Kuna')
    expect(src).toContain('The above copyright notice and this permission notice shall be included in all')
  })
})

describe('accessibility', () => {
  it.each(EXPECTED)('$kind $variant without a label is decorative: aria-hidden, no role, not focusable', ({ kind, variant }) => {
    render(icon(kind, variant))
    const svg = screen.getByTestId('si')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(svg).not.toHaveAttribute('aria-label')
    expect(svg).toHaveAttribute('focusable', 'false')
  })

  it.each(EXPECTED)('$kind $variant standalone with aria-label is a named image, not hidden', ({ kind, variant }) => {
    render(icon(kind, variant, { 'aria-label': 'Status: example' }))
    const img = screen.getByRole('img', { name: 'Status: example' })
    expect(img).toBe(screen.getByTestId('si'))
    expect(img).not.toHaveAttribute('aria-hidden')
  })

  it.each(EXPECTED)('StatusLabel $kind $variant: the text is next to an aria-hidden icon of that kind', ({ kind, variant, glyph }) => {
    render(
      kind === 'error'
        ? <StatusLabel kind="error" variant={variant} data-testid="sl">Degraded</StatusLabel>
        : <StatusLabel kind={kind} data-testid="sl">Degraded</StatusLabel>
    )
    const label = screen.getByTestId('sl')
    expect(label).toHaveTextContent(/^Degraded$/)
    const svg = label.querySelector('svg')!
    expect(svg.getAttribute('data-glyph')).toBe(glyph)
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    // Icon first, then the text, as siblings.
    expect(svg.nextElementSibling).toHaveTextContent(/^Degraded$/)
    expect(screen.queryByRole('img')).toBeNull()
  })
})

// ---- Contrast, from the token values in app/globals.css ----

type Mode = 'light' | 'dark'
const SELECTOR: Record<Mode, string> = { light: ':root', dark: '.dark' }
const NAMES = ['--surface-1', '--surface-2', '--fill-success', '--fill-warning', '--fill-danger', '--text-accent', '--bg-success', '--bg-accent']

let parsed: Record<Mode, Record<string, string>> | null = null
/** Called inside tests, so a missing or duplicated token fails a named test. */
function tokens(): Record<Mode, Record<string, string>> {
  if (parsed) return parsed
  const out: Record<Mode, Record<string, string>> = { light: {}, dark: {} }
  const seen: Record<string, number> = {}
  postcss.parse(readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')).walkDecls((decl) => {
    if (!NAMES.includes(decl.prop) || decl.parent?.type !== 'rule') return
    const selector = (decl.parent as Rule).selector.trim()
    const mode = (Object.keys(SELECTOR) as Mode[]).find((m) => SELECTOR[m] === selector)
    // Defined anywhere else (another selector, an at-rule) would make the values below not the ones the page uses.
    expect(mode, `${decl.prop} only in :root or .dark, found in ${selector}`).toBeDefined()
    seen[`${mode}${decl.prop}`] = (seen[`${mode}${decl.prop}`] ?? 0) + 1
    out[mode!][decl.prop] = decl.value.trim()
  })
  for (const mode of Object.keys(SELECTOR) as Mode[]) for (const name of NAMES) expect(seen[`${mode}${name}`], `${mode} ${name} defined once`).toBe(1)
  parsed = out
  return out
}

/** #RRGGBBAA over an opaque #RRGGBB, as the browser composites a translucent tint onto the card. */
function over(top: string, base: string): string {
  const m = top.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)!
  if (!m[2]) return top
  const a = parseInt(m[2], 16) / 255
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  const b = base.slice(1)
  return '#' + [0, 2, 4].map((i) => Math.round(ch(m[1], i) * a + ch(b, i) * (1 - a)).toString(16).padStart(2, '0')).join('')
}

const KINDS: StatusKind[] = ['success', 'warning', 'info', 'error', 'security']

describe('contrast: each fill token ≥ 3:1 (WCAG 1.4.11 non-text) on both surfaces, light and dark', () => {
  const cases = (['light', 'dark'] as Mode[]).flatMap((mode) =>
    KINDS.flatMap((kind) => (['--surface-1', '--surface-2'] as const).map((surface) => ({ mode, kind, surface }))))

  it('every token is defined exactly once, in :root (light) and .dark', () => {
    expect(Object.keys(tokens().light).sort()).toEqual([...NAMES].sort())
    expect(Object.keys(tokens().dark).sort()).toEqual([...NAMES].sort())
  })

  it.each(cases)('$mode $kind on $surface', ({ mode, kind, surface }) => {
    const T = tokens()
    const fill = T[mode][STATUS_FILL_TOKEN[kind]]
    const bg = T[mode][surface]
    expect(fill, 'opaque fill').toMatch(/^#[0-9a-f]{6}$/i)
    expect(contrast(fill, bg), `${STATUS_FILL_TOKEN[kind]} ${fill} on ${surface} ${bg}`).toBeGreaterThanOrEqual(3)
  })

  // Recent Activity puts the sync and security icons on their own tint inside the --surface-2 card.
  it.each([
    ...(['light', 'dark'] as Mode[]).map((mode) => ({ mode, kind: 'success' as const, tint: '--bg-success' })),
    ...(['light', 'dark'] as Mode[]).map((mode) => ({ mode, kind: 'security' as const, tint: '--bg-accent' })),
  ])('$mode $kind on its $tint tint over --surface-2 (Recent Activity)', ({ mode, kind, tint }) => {
    const T = tokens()
    const bg = over(T[mode][tint], T[mode]['--surface-2'])
    expect(contrast(T[mode][STATUS_FILL_TOKEN[kind]], bg)).toBeGreaterThanOrEqual(3)
  })
})
