import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { contrast } from './contrast'

// The theme tokens in app/globals.css are oklch() values. Wrapping one in hsl()/rgb() is invalid at
// computed-value time, which silently turned the site-wide focus outline into `outline-style: none`.
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')

/** Body of the first top-level rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {\n`)
  expect(start, `rule ${selector}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

/** Custom properties declared in every top-level `selector {` block (light = :root, dark = .dark). */
function tokens(selector: ':root' | '.dark'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(new RegExp(`\\n${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'g'))) {
    for (const d of m[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim()
  }
  return out
}

const FOCUS_RULES = ['.skip-to-content:focus', '*:focus-visible', '.focus-within-ring:focus-within', '.keyboard-navigating *:focus']

describe('focus ring', () => {
  it('no focus rule wraps a custom property in hsl()/hsla()/rgb()/rgba()', () => {
    for (const selector of FOCUS_RULES) {
      expect(rule(selector), selector).not.toMatch(/(hsla?|rgba?)\(\s*var\(--/)
    }
  })

  it('*:focus-visible draws a 2px solid outline in var(--text-accent)', () => {
    expect(rule('*:focus-visible')).toMatch(/outline:\s*2px solid var\(--text-accent\);/)
  })

  it('*:focus-visible does not override the focused element’s border-radius', () => {
    expect(rule('*:focus-visible')).not.toMatch(/border-radius/)
  })

  it('there is no separate .dark focus override: --text-accent already switches per theme', () => {
    expect(css).not.toMatch(/\.dark \*:focus-visible/)
  })

  it.each([':root', '.dark'] as const)('--text-accent meets 3:1 non-text contrast on every %s surface', (theme) => {
    const t = tokens(theme)
    const ring = t['--text-accent']
    for (const surface of ['--background', '--card', '--surface-1', '--surface-2']) {
      expect(contrast(ring, t[surface]), `${theme} ${surface}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('skip link', () => {
  it('uses the primary tokens directly, not wrapped in hsl()', () => {
    const body = rule('.skip-to-content')
    expect(body).toMatch(/background-color:\s*var\(--primary\);/)
    expect(body).toMatch(/color:\s*var\(--primary-foreground\);/)
  })

  it.each([':root', '.dark'] as const)('%s: skip-link text meets 4.5:1 on its background', (theme) => {
    const t = tokens(theme)
    expect(contrast(t['--primary-foreground'], t['--primary'])).toBeGreaterThanOrEqual(4.5)
  })
})
