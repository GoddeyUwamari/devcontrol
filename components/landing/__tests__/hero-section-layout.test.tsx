/**
 * Marketing homepage hero (w1): founder-locked copy and order, the labelled
 * sample panel, CTA destinations, the two-column/stacked layout, accessibility
 * and light-theme contrast. The marketing layout has no dark theme (fixed
 * white background, nothing sets `.dark`), so only light colours are checked.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { HeroSection } from '../HeroSection'

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('HeroSection copy', () => {
  it('renders the left column copy exactly, in order', () => {
    render(<HeroSection />)
    const copy = screen.getByTestId('hero-copy')
    const blocks = Array.from(copy.querySelectorAll(':scope > p, :scope > h1, :scope > div, :scope > ul')).map(text)
    expect(blocks).toEqual([
      'AI-powered cloud operations & infrastructure intelligence',
      'Find the AWS waste hiding in your bill.',
      'Connect read-only and see idle resources, security risks and cost drivers across your AWS account. No agents. No code changes.',
      'Find My AWS WasteTake a product tour',
      'Read-only access · Takes a few minutes · Delete the role anytime',
      'Read-only accessNo agentsAES-256 encryption',
    ])
  })

  it('puts "AWS waste" in the brand purple inside the h1', () => {
    render(<HeroSection />)
    const accent = within(screen.getByRole('heading', { level: 1 })).getByText('AWS waste')
    expect(accent.tagName).toBe('SPAN')
    expect(accent.className).toContain('text-violet-700')
  })

  it('renders the sample panel rows exactly, in order, with green amounts', () => {
    render(<HeroSection />)
    const rows = screen.getAllByTestId('hero-sample-panel-row').map((row) =>
      Array.from(row.querySelectorAll('p, [data-testid="hero-sample-panel-row-value"]')).map(text),
    )
    expect(rows).toEqual([
      ['Server running but idle', 'Idle EC2 instance', '$142/mo'],
      ['Storage attached to nothing', 'Unattached EBS volume', '$38/mo'],
      ['Old storage type, cheaper one exists', 'gp2 to gp3 upgrade', '$21/mo'],
      ['Old database backup nobody uses', 'Idle RDS snapshot', '$64/mo'],
    ])
    for (const value of screen.getAllByTestId('hero-sample-panel-row-value')) {
      expect(value.className).toContain('text-[#047857]')
    }
  })

  it('computes the total from the rows', () => {
    render(<HeroSection />)
    const sum = screen
      .getAllByTestId('hero-sample-panel-row-value')
      .reduce((acc, el) => acc + Number(text(el).replace(/[$,]|\/mo/g, '')), 0)
    expect(sum).toBe(265)
    const total = screen.getByTestId('hero-sample-panel-total')
    expect(within(total).getByText('Estimated monthly saving')).toBeInTheDocument()
    expect(text(screen.getByTestId('hero-sample-panel-total-value'))).toBe(`$${sum}/mo`)
  })

  it('labels the panel as sample data and captions it', () => {
    render(<HeroSection />)
    const panel = screen.getByRole('region', { name: 'Cost optimization Sample data' })
    expect(panel).toBe(screen.getByTestId('hero-sample-panel'))
    const tag = screen.getByTestId('hero-sample-panel-tag')
    expect(text(tag)).toBe('Sample data')
    expect(tag.className).toContain('uppercase')
    expect(panel).toHaveAccessibleDescription('Illustrative example. Your own findings appear after your first scan.')
    // The caption sits directly under the panel, outside its card.
    expect(screen.getByTestId('hero-sample-panel-caption').previousElementSibling).toBe(panel)
  })

  it('renders both cards exactly', () => {
    render(<HeroSection />)
    const outcome = screen.getByTestId('hero-outcome-card')
    expect(Array.from(outcome.children).map(text)).toEqual([
      'Recent client outcome',
      '$8,000/mo',
      'in unnecessary AWS spend identified in under 60 seconds, with no agent and no code changes.',
    ])
    expect(outcome.firstElementChild?.className).toContain('uppercase')
    const audit = screen.getByTestId('hero-audit-card')
    expect(Array.from(audit.children).map(text)).toEqual([
      'Rather talk it through?',
      'Book a free 15-minute AWS audit with our team. No commitment.',
      'Book a free audit',
    ])
  })

  it('no longer renders the old hero content', () => {
    render(<HeroSection />)
    const all = text(screen.getByTestId('hero-section'))
    for (const gone of [
      'Cloud Infrastructure Intelligence',
      'Modern Engineering Teams',
      'real-time visibility',
      'Take a Product Tour',
      'book a 15-min AWS audit',
      'Read-only IAM',
      'SOC 2',
    ]) {
      expect(all).not.toContain(gone)
    }
  })
})

describe('HeroSection CTAs', () => {
  it('links each CTA to its destination, primary before secondary', () => {
    render(<HeroSection />)
    const links = screen.getAllByRole('link')
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Find My AWS Waste', '/register'],
      ['Take a product tour', '/tour'],
      ['Book a free audit', '/contact'],
    ])
    expect(screen.getByRole('link', { name: 'Find My AWS Waste' })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: 'Take a product tour' })).toHaveAttribute('href', '/tour')
    expect(screen.getByRole('link', { name: 'Book a free audit' })).toHaveAttribute('href', '/contact')
  })
})

describe('HeroSection layout', () => {
  it('is two columns from lg (1024px), stacked below, copy before panel', () => {
    render(<HeroSection />)
    const columns = screen.getByTestId('hero-columns')
    expect(columns.className).toMatch(/(^| )grid-cols-1( |$)/)
    expect(columns.className).toMatch(/(^| )lg:grid-cols-\[/)
    expect(columns.className).not.toMatch(/(^| )(sm|md):grid-cols-/)
    expect(Array.from(columns.children).map((el) => el.getAttribute('data-testid'))).toEqual(['hero-copy', 'hero-sample'])
  })

  it('puts the two cards side by side from lg, stacked below, after the columns', () => {
    render(<HeroSection />)
    const cards = screen.getByTestId('hero-cards')
    expect(cards.className).toMatch(/(^| )grid-cols-1( |$)/)
    expect(cards.className).toMatch(/(^| )lg:grid-cols-2( |$)/)
    expect(cards.className).not.toMatch(/(^| )(sm|md):grid-cols-/)
    expect(Array.from(cards.children).map((el) => el.getAttribute('data-testid'))).toEqual([
      'hero-outcome-card',
      'hero-audit-card',
    ])
    expect(screen.getByTestId('hero-columns').nextElementSibling).toBe(cards)
  })

  it('keeps the 16px side gutter at phone width', () => {
    render(<HeroSection />)
    expect(screen.getByTestId('hero-columns').parentElement?.className).toMatch(/(^| )px-4( |$)/)
  })
})

describe('HeroSection accessibility', () => {
  it('has exactly one h1 and no skipped heading levels', () => {
    const { container } = render(<HeroSection />)
    const levels = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) => Number(h.tagName[1]))
    expect(levels.filter((l) => l === 1)).toHaveLength(1)
    expect(levels[0]).toBe(1)
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
    expect(screen.getAllByRole('heading').map(text)).toEqual([
      'Find the AWS waste hiding in your bill.',
      'Cost optimization',
      'Rather talk it through?',
    ])
  })

  it('hides every icon from assistive technology', () => {
    const { container } = render(<HeroSection />)
    const svgs = Array.from(container.querySelectorAll('svg'))
    expect(svgs.length).toBe(5) // arrow, play, three checks
    for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('gives the text-only tour link a 44px tap target (the other two CTAs are padded buttons)', () => {
    render(<HeroSection />)
    expect(screen.getByRole('link', { name: 'Take a product tour' }).className).toMatch(/(^| )min-h-11( |$)/)
  })

  it('names the badge list', () => {
    render(<HeroSection />)
    expect(within(screen.getByRole('list', { name: 'Trust badges' })).getAllByRole('listitem')).toHaveLength(3)
  })
})

// ---- Contrast (WCAG 2.x), using Tailwind's own theme values (oklch) ----------------

const require = createRequire(import.meta.url)
const THEME = readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8')

/** Linear sRGB channels for a Tailwind colour token (e.g. "violet-700"), "white" or a hex. */
function linearRgb(color: string): [number, number, number] {
  if (color === 'white') return [1, 1, 1]
  if (color.startsWith('#')) {
    const n = color.slice(1)
    return [0, 2, 4].map((i) => {
      const c = parseInt(n.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
  }
  const m = THEME.match(new RegExp(`--color-${color}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`))
  if (!m) throw new Error(`no oklch value for ${color}`)
  const L = Number(m[1]) / 100
  const C = Number(m[2])
  const h = (Number(m[3]) * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ]
}

function contrast(fg: string, bg: string) {
  const lum = (c: string) => {
    const [r, g, b] = linearRgb(c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('HeroSection contrast (light theme)', () => {
  // [what, foreground, background]; every pair is a class combination used in HeroSection.tsx.
  const PAIRS: [string, string, string][] = [
    ['eyebrow', 'violet-700', 'violet-50'],
    ['h1', 'slate-900', 'violet-50'],
    ['h1 accent', 'violet-700', 'violet-50'],
    ['subheadline', 'slate-700', 'violet-50'],
    ['primary button', 'white', 'violet-700'],
    ['primary button hover', 'white', 'violet-800'],
    ['tour link', 'violet-700', 'violet-50'],
    ['microcopy', 'slate-600', 'violet-50'],
    ['badge text', 'slate-700', 'white'],
    ['panel title / row title', 'slate-900', 'white'],
    ['row subtitle', 'slate-600', 'white'],
    ['row amount', '#047857', 'white'],
    ['sample tag', 'violet-800', 'violet-100'],
    ['total label', 'slate-900', 'violet-100'],
    ['total value', 'violet-800', 'violet-100'],
    ['caption', 'slate-600', 'violet-50'],
    ['outcome label', 'slate-600', 'white'],
    ['outcome figure', 'violet-700', 'white'],
    ['outcome body', 'slate-700', 'white'],
    ['audit heading', 'white', 'slate-900'],
    ['audit body', 'slate-300', 'slate-900'],
    ['audit button', 'slate-900', 'white'],
  ]

  it.each(PAIRS)('%s meets 4.5:1 (%s on %s)', (_what, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('checks the colours the component actually uses', () => {
    const { container } = render(<HeroSection />)
    const classes = new Set(
      Array.from(container.querySelectorAll('[class]')).flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/)),
    )
    const used = Array.from(classes)
      .map((c) => c.replace(/^hover:/, ''))
      .filter((c) => /^(text|bg)-(white|slate-\d+|violet-\d+|\[#[0-9a-fA-F]{6}\])$/.test(c))
      .map((c) => c.replace(/^(text|bg)-/, '').replace(/^\[(#.+)\]$/, '$1'))
    const covered = new Set(PAIRS.flatMap(([, fg, bg]) => [fg, bg]))
    // slate-100 is only the audit button's hover background behind slate-900 text (darker than white: still passes).
    const uncovered = used.filter((c) => !covered.has(c) && c !== 'slate-100')
    expect(uncovered).toEqual([])
    expect(contrast('slate-900', 'slate-100')).toBeGreaterThanOrEqual(4.5)
  })
})
