/**
 * The not-connected dashboard preview on its own: layout, responsive classes
 * and accessibility. The page-level behaviour (which state shows it, the word
 * guards, the role matrix through the real page) is covered in
 * app/(app)/dashboard/__tests__/dashboard-cost-evidence.test.tsx.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DashboardUnconnectedPreview } from '../dashboard-unconnected-preview'

const CARD_ORDER = [
  ['Cost', 'Month-to-Date Spend'],
  ['Savings', 'Cost optimization'],
  ['Security', 'Security Posture'],
  ['Urgent', 'Top Risk'],
  ['Posture', 'Infrastructure Posture'],
  ['Uptime', 'Resource checks'],
  ['Ask', 'AI assistant'],
  ['Weekly', 'Weekly summary'],
]

function renderPreview(canConnectAws = true, orgName = 'Placeholder Org') {
  return render(<DashboardUnconnectedPreview canConnectAws={canConnectAws} orgName={orgName} />)
}

/** WCAG 2.x contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** A translucent #RRGGBBAA colour as it appears over an opaque #RRGGBB one. */
function over(top: string, bottom: string): string {
  const alpha = parseInt(top.slice(7, 9), 16) / 255
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(top.slice(i, i + 2), 16) * alpha + parseInt(bottom.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('')
}
/** The app's semantic colour tokens, read from the stylesheet: light (:root) and dark (.dark). */
function tokens(): Record<'light' | 'dark', Record<string, string>> {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {\n  --surface-1`)
    expect(start).toBeGreaterThan(-1)
    const body = css.slice(start, css.indexOf('}', start))
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}))\b/g)].map((m) => [m[1], m[2]]))
  }
  return { light: block(':root'), dark: block('.dark') }
}

describe('layout', () => {
  it('eight cards, in the approved order, each with a tag, a title, a subtitle and check lines', () => {
    renderPreview()
    const cards = screen.getAllByTestId('preview-card')
    expect(cards.map((card) => [within(card).getByTestId('preview-tag').textContent, within(card).getByTestId('preview-title').textContent])).toEqual(CARD_ORDER)
    for (const card of cards) {
      expect(within(card).getByTestId('preview-subtitle').textContent).not.toBe('')
      expect(within(card).getAllByTestId('preview-shows').length).toBeGreaterThanOrEqual(2)
      for (const line of within(card).getAllByTestId('preview-shows')) expect(line.querySelector('svg.lucide-circle-check')).not.toBeNull()
    }
  })

  it('page order: workspace name, headline, button row, trust line, cards, band, then the steps', () => {
    renderPreview()
    const order = ['preview-workspace', 'preview-action', 'preview-trust', 'preview-cards', 'preview-band', 'connecting-steps'].map((id) => screen.getByTestId(id))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(order[0].compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(h1.compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The trust line carries the lock icon and sits directly under the button row.
    expect(order[1].nextElementSibling).toBe(order[2])
    expect(order[2].querySelector('svg.lucide-lock')).not.toBeNull()
    // The old boxed header and the old three-column rows are gone.
    expect(document.body.textContent).not.toMatch(/What you'll see after connecting AWS/)
    expect(document.querySelector('[class*="grid-cols-3"]:not(ol)')).toBeNull()
    for (const id of ['preview-primary-row', 'preview-feature-row', 'preview-secondary-row']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  it('an owner gets two "Connect AWS" buttons, both to the same route', () => {
    renderPreview()
    const buttons = screen.getAllByRole('link', { name: 'Connect AWS' })
    expect(buttons).toHaveLength(2)
    expect(buttons.map((button) => button.getAttribute('href'))).toEqual(['/connect-aws', '/connect-aws'])
    expect(buttons[0].closest('[data-testid="preview-action"]')).not.toBeNull()
    expect(buttons[1].closest('[data-testid="preview-band"]')).not.toBeNull()
    expect(screen.getAllByRole('link')).toEqual(buttons)
  })

  it('anyone else gets no button or link: an "AWS not connected" pill, and who to ask (also in the band)', () => {
    renderPreview(false)
    expect(document.querySelector('a, button, [role="button"], [role="link"]')).toBeNull()
    expect(screen.queryByText('Connect AWS')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-action').textContent).toBe('AWS not connected' + 'GCP soon' + 'Azure soon')
    expect(screen.getByTestId('preview-ask-owner').textContent).toBe('Ask your organization owner to connect AWS.')
    expect(within(screen.getByTestId('preview-band')).getByTestId('preview-band-ask-owner').textContent).toBe('Ask your organization owner to connect AWS.')
  })

  it.each([true, false])('the "soon" pills are plain text, not clickable or focusable (owner: %s)', (owner) => {
    renderPreview(owner)
    for (const id of ['preview-pill-gcp', 'preview-pill-azure', ...(owner ? [] : ['preview-pill-aws'])]) {
      const pill = screen.getByTestId(id)
      expect(pill.tagName).toBe('SPAN')
      expect(pill.closest('a, button, [role="button"], [role="link"]')).toBeNull()
      expect(pill).not.toHaveAttribute('tabindex')
      expect(pill).not.toHaveAttribute('role')
      expect(pill).not.toHaveAttribute('onclick')
      expect(pill.className).not.toMatch(/hover:|cursor-pointer|focus/)
    }
    expect(screen.getByTestId('preview-pill-gcp').textContent).toBe('GCP soon')
    expect(screen.getByTestId('preview-pill-azure').textContent).toBe('Azure soon')
  })

  it.each(['Placeholder Org', 'Another Workspace'])('the workspace label is the organization name it is given (%s)', (orgName) => {
    renderPreview(true, orgName)
    const label = screen.getByTestId('preview-workspace')
    expect(label.textContent).toBe(orgName)
    // Uppercase is presentation only: the name itself is not rewritten.
    expect(label.className).toMatch(/\buppercase\b/)
  })

  it.each([true, false])('renders no numbers: only the score scale and the three step numbers contain a digit (owner: %s)', (owner) => {
    const { container } = renderPreview(owner)
    const clone = container.cloneNode(true) as HTMLElement
    const numbers = [...clone.querySelectorAll('[data-testid="connecting-step-number"]')]
    expect(numbers.map((n) => n.textContent)).toEqual(['1', '2', '3'])
    numbers.forEach((n) => n.remove())
    const text = (clone.textContent ?? '').replace('Get one score out of 100, with the reasons behind it', '')
    expect(text).not.toMatch(/\d|\$|%|—|\bN\/A\b/)
    // No bar, meter or chart either: the only graphics are decorative icons.
    expect(container.querySelector('[role="progressbar"], [role="meter"], [role="img"], canvas, svg:not(.lucide)')).toBeNull()
  })
})

describe('responsive behaviour', () => {
  it('cards are one per row, then two per row; steps are stacked, then three across', () => {
    renderPreview()
    const cards = screen.getByTestId('preview-cards')
    expect(cards.className).toMatch(/\bgrid-cols-1\b/)
    expect(cards.className).toMatch(/\bmd:grid-cols-2\b/)
    expect(cards.className).toMatch(/\bgap-5\b/)
    expect(cards.className.match(/grid-cols-\d/g)).toEqual(['grid-cols-1', 'grid-cols-2'])
    const steps = screen.getAllByTestId('connecting-step')[0].parentElement!
    expect(steps.className).toMatch(/\bgrid-cols-1\b/)
    expect(steps.className).toMatch(/\bmd:grid-cols-3\b/)
  })

  it('the headline is smaller on a phone, and the type scale is only 13/16/18/24/44 (plus the mobile headline)', () => {
    const { container } = renderPreview()
    expect(screen.getByRole('heading', { level: 1 }).className).toMatch(/\btext-\[30px\]\s.*\bmd:text-\[44px\]/)
    const sizes = new Set<string>()
    for (const node of container.querySelectorAll('[class]')) {
      for (const size of (node.getAttribute('class') ?? '').match(/(?<![\w-])(?:md:)?text-(?:\[\d+px\]|xs|sm|base|lg|xl|\dxl)(?![\w-])/g) ?? []) sizes.add(size)
    }
    // text-base = 16px, text-lg = 18px, text-2xl = 24px.
    expect([...sizes].sort()).toEqual(['md:text-[44px]', 'text-2xl', 'text-[13px]', 'text-[30px]', 'text-base', 'text-lg'])
  })

  it('buttons are full width on a phone, the band stacks, and nothing forces horizontal scrolling', () => {
    const { container } = renderPreview()
    const [primary, band] = screen.getAllByRole('link', { name: 'Connect AWS' })
    expect(primary.className).toMatch(/\bw-full\b.*\bsm:w-auto\b/)
    expect(band.className).toMatch(/\bw-full\b.*\bmd:w-auto\b/)
    expect(screen.getByTestId('preview-band').className).toMatch(/\bflex-col\b.*\bmd:flex-row\b/)
    expect(screen.getByTestId('preview-action').className).toMatch(/\bflex-wrap\b/)
    for (const node of container.querySelectorAll('[class]')) {
      expect(node.getAttribute('class') ?? '').not.toMatch(/(^|\s)(min-w-\[|w-\[|whitespace-nowrap|overflow-x)/)
    }
  })

  it('cards have 28px padding', () => {
    renderPreview()
    for (const card of screen.getAllByTestId('preview-card')) expect(card.className).toMatch(/\bp-7\b/)
  })
})

describe('accessibility', () => {
  it('heading order: one h1, then every card, the band and the steps as h2 -- no level skipped', () => {
    renderPreview()
    expect(screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent])).toEqual([
      ['H1', 'AI-Powered Cloud Operations & Infrastructure Intelligence'],
      ...CARD_ORDER.map(([, title]) => ['H2', title]),
      ['H2', 'See where your AWS money is going'],
      ['H2', 'How connecting works'],
    ])
  })

  it('both sections are named by their headings, and the lists are real lists', () => {
    renderPreview()
    expect(screen.getByRole('region', { name: 'AI-Powered Cloud Operations & Infrastructure Intelligence' })).toBe(screen.getByTestId('dashboard-preview'))
    expect(screen.getByRole('region', { name: 'How connecting works' })).toBe(screen.getByTestId('connecting-steps'))
    expect(screen.getByTestId('preview-cards').tagName).toBe('UL')
    expect(screen.getAllByTestId('preview-card').every((card) => card.tagName === 'LI')).toBe(true)
    expect(screen.getAllByTestId('connecting-step')[0].parentElement?.tagName).toBe('OL')
  })

  it('buttons are named by their visible text, are at least 44px tall, and show a focus ring', () => {
    renderPreview()
    for (const button of screen.getAllByRole('link')) {
      expect(button).toHaveAccessibleName('Connect AWS')
      expect(button.textContent).toBe('Connect AWS')
      expect(button).not.toHaveAttribute('aria-label')
      expect(button.className).toContain('min-h-[44px]')
      expect(button.className).toMatch(/focus-visible:ring-2/)
    }
  })

  it('the primary button has a visible focus ring in light and dark, offset by the page background', () => {
    renderPreview()
    const { light, dark } = tokens()
    const [primary] = screen.getAllByRole('link', { name: 'Connect AWS' })
    expect(primary.className).toContain('focus-visible:ring-[var(--text-accent)]')
    expect(primary.className).toContain('focus-visible:ring-offset-2')
    // The offset gap takes the page background (not the default white), and the ring stands out from it.
    expect(primary.className).toContain('focus-visible:ring-offset-[var(--surface-1)]')
    for (const theme of [light, dark]) expect(contrast(theme['--text-accent'], theme['--surface-1'])).toBeGreaterThanOrEqual(3)
    // In dark mode the ring also differs from the button's own fill, so it reads as a ring.
    expect(dark['--text-accent'].toLowerCase()).not.toBe(primary.className.match(/dark:bg-\[(#[0-9A-Fa-f]{6})\]/)![1].toLowerCase())
  })

  it('the trust line is held to a narrow measure, as in the design', () => {
    renderPreview()
    expect(screen.getByTestId('preview-trust').className).toMatch(/\bmax-w-\[540px\]/)
  })

  it('every icon is decorative and hidden from assistive technology', () => {
    const { container } = renderPreview()
    const icons = [...container.querySelectorAll('svg')]
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('contrast: text meets WCAG AA (4.5:1) on its background, in light and dark', () => {
    renderPreview()
    const { light, dark } = tokens()
    const [primary, band] = screen.getAllByRole('link', { name: 'Connect AWS' })

    // Primary button: white on the accent token in light mode, and on a fixed purple in dark mode
    // (the dark accent token is a light lilac, which white text would fail on).
    expect(primary.className).toContain('text-white')
    expect(primary.className).toContain('bg-[var(--text-accent)]')
    expect(contrast('#FFFFFF', light['--text-accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#FFFFFF', dark['--text-accent'])).toBeLessThan(4.5)
    const darkFill = primary.className.match(/dark:bg-\[(#[0-9A-Fa-f]{6})\]/)?.[1]
    expect(darkFill).toBeDefined()
    expect(contrast('#FFFFFF', darkFill!)).toBeGreaterThanOrEqual(4.5)

    // The band is dark in both themes, with fixed colours.
    const bandEl = screen.getByTestId('preview-band')
    const bandFill = bandEl.className.match(/(?:^|\s)bg-\[(#[0-9A-Fa-f]{6})\]/)?.[1]
    expect(bandFill).toBeDefined()
    expect(contrast('#FFFFFF', bandFill!)).toBeGreaterThanOrEqual(4.5)
    const bandLine = within(bandEl).getByText('Connect once. Your first scan runs automatically.')
    expect(contrast(bandLine.className.match(/text-\[(#[0-9A-Fa-f]{6})\]/)![1], bandFill!)).toBeGreaterThanOrEqual(4.5)
    expect(band.className).toContain('bg-white')
    expect(contrast(band.className.match(/text-\[(#[0-9A-Fa-f]{6})\]/)![1], '#FFFFFF')).toBeGreaterThanOrEqual(4.5)

    // Token pairs the component uses: secondary text on the card surface and the page, tags on their tint.
    for (const theme of [light, dark]) {
      expect(contrast(theme['--text-secondary'], theme['--surface-2'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(theme['--text-secondary'], theme['--surface-1'])).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(light['--text-accent'], light['--bg-accent'])).toBeGreaterThanOrEqual(4.5)
    // Dark tags: the tint is translucent, so the real background is the tint over the card surface.
    expect(dark['--bg-accent']).toMatch(/^#[0-9A-Fa-f]{8}$/)
    const tag = screen.getAllByTestId('preview-tag')[0]
    expect(tag.style.background).toBe('var(--bg-accent)')
    expect(tag.style.color).toBe('var(--text-accent)')
    expect(tag.closest('[data-testid="preview-card"]')!.className).toContain('bg-[var(--surface-2)]')
    expect(contrast(dark['--text-accent'], over(dark['--bg-accent'], dark['--surface-2']))).toBeGreaterThanOrEqual(4.5)
  })
})
