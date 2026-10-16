import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

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

/** Linear-light sRGB of a #RRGGBB or oklch(L C h) value. */
function linear(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    return [0, 2, 4].map((i) => {
      const c = parseInt(hex[1].slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
  }
  const ok = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!ok) throw new Error(`unsupported colour ${value}`)
  const [L, C, h] = ok.slice(1).map(Number)
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** WCAG 2.x contrast ratio of two colours. */
function contrast(x: string, y: string): number {
  const lum = (v: string) => {
    const [r, g, b] = linear(v)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
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
