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
import { HERO_FORBIDDEN, SAMPLE_CAPTION, SAMPLE_PANEL_TITLE, SAMPLE_TAG, expectApprovedSamplePanel, expectNoGeneratedContent, expectNoStylesheets, heroWords, samplePanelProblems, withoutValidSamplePanel } from './sample-panel'

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

function renderPreview(canConnectAws = true) {
  return render(<DashboardUnconnectedPreview canConnectAws={canConnectAws} />)
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

  it('page order: headline, button row, trust line, sample panel, cards, band, then the steps', () => {
    renderPreview()
    const h1 = screen.getByRole('heading', { level: 1 })
    const order = [h1, ...['preview-action', 'preview-trust', 'sample-panel', 'preview-cards', 'preview-band', 'connecting-steps'].map((id) => screen.getByTestId(id))]
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // The headline opens the preview: nothing (no workspace label) above it.
    expect(screen.getByTestId('preview-hero-copy').firstElementChild).toBe(h1)
    // The trust line carries the lock icon and sits directly under the button row.
    const [action, trust] = [screen.getByTestId('preview-action'), screen.getByTestId('preview-trust')]
    expect(action.nextElementSibling).toBe(trust)
    expect(trust.querySelector('svg.lucide-lock')).not.toBeNull()
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

  it.each([true, false])('there is no workspace label (owner: %s)', (owner) => {
    renderPreview(owner)
    expect(screen.queryByTestId('preview-workspace')).not.toBeInTheDocument()
    // The only uppercase labels left are the card tags and the sample tag.
    const uppercase = [...document.querySelectorAll('[class~="uppercase"]')].map((node) => node.getAttribute('data-testid'))
    expect(uppercase).toEqual(['sample-panel-tag', ...Array(8).fill('preview-tag')])
  })

  it.each([true, false])('renders no numbers outside the sample panel: only the score scale and the three step numbers contain a digit (owner: %s)', (owner) => {
    const { container } = renderPreview(owner)
    const clone = withoutValidSamplePanel(container)
    expect(clone.querySelector('[data-testid="sample-panel"]')).toBeNull()
    const numbers = [...clone.querySelectorAll('[data-testid="connecting-step-number"]')]
    expect(numbers.map((n) => n.textContent)).toEqual(['1', '2', '3'])
    numbers.forEach((n) => n.remove())
    const text = (clone.textContent ?? '').replace('Get one score out of 100, with the reasons behind it', '')
    expect(text).not.toMatch(/\d|\$|%|—|\bN\/A\b/)
    // No bar, meter or chart either: the only graphics are decorative icons.
    expect(container.querySelector('[role="progressbar"], [role="meter"], [role="img"], canvas, svg:not(.lucide)')).toBeNull()
  })
})

describe('the sample panel', () => {
  it.each([true, false])('shows the approved content exactly, with a total that is the sum of its three costs (owner: %s)', (owner) => {
    const { container } = renderPreview(owner)
    expectApprovedSamplePanel(container)
    expect(screen.getByTestId('sample-panel-tag').className).toMatch(/\buppercase\b/)
  })

  it.each([true, false])('the hero says nothing live, connected, alarming or framework-specific (owner: %s)', (owner) => {
    renderPreview(owner)
    expect(heroWords(screen.getByTestId('preview-hero'))).not.toMatch(HERO_FORBIDDEN)
  })

  it.each([true, false])('nothing in the preview uses ::before, ::after or CSS content (owner: %s)', (owner) => {
    renderPreview(owner)
    expectNoGeneratedContent(screen.getByTestId('dashboard-preview'))
  })

  it.each([true, false])('no <style> or stylesheet <link> anywhere in the rendered preview (owner: %s)', (owner) => {
    const { container } = renderPreview(owner)
    expectNoStylesheets(container)
  })

  it('looks as designed: the tag is a rounded rectangle and the panel has a soft shadow', () => {
    renderPreview()
    const tag = screen.getByTestId('sample-panel-tag')
    expect(tag.className).toMatch(/(^|\s)rounded-md(\s|$)/)
    expect(tag.className).not.toMatch(/rounded-full/)
    expect(screen.getByTestId('sample-panel').className).toMatch(/(^|\s)shadow-\[0_12px_32px_-12px_rgba\(17,24,39,0\.18\)\](\s|$)/)
    expect(screen.getByTestId('preview-trust').querySelector('svg.lucide-lock')).not.toBeNull()
  })

  it('the exemption removes only a labelled panel, and only the panel', () => {
    const { container } = renderPreview()
    expect(samplePanelProblems(container)).toEqual([])
    const without = withoutValidSamplePanel(container)
    // Everything else is still there, word for word.
    const panelText = screen.getByTestId('sample-panel').textContent ?? ''
    expect(without.textContent).toBe((container.textContent ?? '').replace(panelText, ''))
    expect(without.querySelectorAll('[data-testid="preview-card"]')).toHaveLength(8)
  })

  // Each change below makes the panel unlabelled (or misplaced), so it is no longer removed and its figures reach the guards.
  it.each<[string, (panel: HTMLElement) => void]>([
    ['the tag is removed', (panel) => panel.querySelector('[data-testid="sample-panel-tag"]')!.remove()],
    ['the caption is removed', (panel) => panel.querySelector('[data-testid="sample-panel-caption"]')!.remove()],
    ['the tag is reworded', (panel) => { panel.querySelector('[data-testid="sample-panel-tag"]')!.textContent = 'Preview' }],
    ['the caption is reworded', (panel) => { panel.querySelector('[data-testid="sample-panel-caption"]')!.textContent = 'Your findings.' }],
    ['the tag is visually hidden', (panel) => panel.querySelector('[data-testid="sample-panel-tag"]')!.classList.add('sr-only')],
    ['the caption is hidden at a breakpoint', (panel) => panel.querySelector('[data-testid="sample-panel-caption"]')!.classList.add('md:hidden')],
    ['the caption is hidden from assistive technology', (panel) => panel.querySelector('[data-testid="sample-panel-caption"]')!.setAttribute('aria-hidden', 'true')],
    ['the panel is visually hidden', (panel) => panel.classList.add('hidden')],
    ['the panel is transparent', (panel) => { panel.style.opacity = '0' }],
    ['there is a second panel', (panel) => panel.after(panel.cloneNode(true))],
    ['the panel is moved below the cards', (panel) => screen.getByTestId('preview-band').before(panel)],
  ])('is not exempt when %s', (_name, mutate) => {
    const { container } = renderPreview()
    mutate(screen.getAllByTestId('sample-panel')[0])
    expect(samplePanelProblems(container)).not.toEqual([])
    expect(withoutValidSamplePanel(container).textContent).toMatch(/\$\d/)
  })
})

describe('responsive behaviour', () => {
  it('the hero stacks below 1024px (copy, then the panel) and is two columns from lg', () => {
    renderPreview()
    const hero = screen.getByTestId('preview-hero')
    expect(hero.className).toMatch(/(^|\s)grid(\s|$)/)
    expect(hero.className).toMatch(/(^|\s)grid-cols-1(\s|$)/)
    expect(hero.className).toMatch(/(^|\s)lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\](\s|$)/)
    expect(hero.className).toMatch(/(^|\s)xl:grid-cols-\[minmax\(0,11fr\)_minmax\(0,9fr\)\](\s|$)/)
    // No other breakpoint splits it: below lg it is one column.
    expect(hero.className.match(/(?:^|\s)(?:[\w-]+:)?grid-cols-\S+/g)?.map((c) => c.trim())).toEqual(['grid-cols-1', 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]', 'xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]'])
    // Stacked order is DOM order: the copy column, then the panel. No reordering classes.
    expect([...hero.children].map((child) => child.getAttribute('data-testid'))).toEqual(['preview-hero-copy', 'sample-panel'])
    expect(hero.innerHTML).not.toMatch(/(^|[\s"])(?:[\w-]+:)?order-/)
    expect([...screen.getByTestId('preview-hero-copy').children].map((child) => child.tagName + (child.getAttribute('data-testid') ? `#${child.getAttribute('data-testid')}` : ''))).toEqual(['H1', 'P', 'DIV#preview-action', 'P#preview-trust'])
  })

  it('both columns are aligned to the top, not centred against the taller panel', () => {
    renderPreview()
    const hero = screen.getByTestId('preview-hero')
    expect(hero.className).toMatch(/(^|\s)items-start(\s|$)/)
    expect(hero.className).not.toMatch(/(^|\s)(?:[\w-]+:)?items-(?:center|end|baseline|stretch)(\s|$)/)
  })

  it('a non-owner keeps the #176 hero: pill and who to ask in the copy column, and the panel beside it', () => {
    renderPreview(false)
    const copy = screen.getByTestId('preview-hero-copy')
    expect([...copy.children].map((child) => child.getAttribute('data-testid'))).toEqual([null, null, 'preview-action', 'preview-ask-owner', 'preview-trust'])
    expect(screen.getByTestId('preview-hero').lastElementChild).toBe(screen.getByTestId('sample-panel'))
  })

  it('nothing below the hero moved into it', () => {
    renderPreview()
    const hero = screen.getByTestId('preview-hero')
    expect(hero.parentElement).toBe(screen.getByTestId('dashboard-preview'))
    expect([...hero.parentElement!.children].map((child) => child.getAttribute('data-testid'))).toEqual(['preview-hero', 'preview-cards', 'preview-band'])
    for (const id of ['preview-cards', 'preview-band', 'connecting-steps']) expect(hero.contains(screen.getByTestId(id))).toBe(false)
  })

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

  it('the app type scale: the 28px page title at every width, and every size from the role tokens', () => {
    const { container } = renderPreview()
    expect(screen.getByRole('heading', { level: 1 }).className.split(/\s+/)).toEqual(expect.arrayContaining(['text-title', 'text-ink']))
    const tokens = [...container.querySelectorAll('[class]')].flatMap((node) => (node.getAttribute('class') ?? '').split(/\s+/))
    // No Tailwind size scale, no pixel sizes (the old 30 / 44 px headline), no bold: sizes and weights come from the roles.
    expect(tokens.filter((c) => /^(?:[\w-]+:)?text-(?:xs|sm|base|lg|xl|\dxl|\[\d[^\]]*\])$/.test(c))).toEqual([])
    expect(tokens.filter((c) => /^(?:[\w-]+:)?font-(?:bold|extrabold|black)$/.test(c))).toEqual([])
    // title 28, section 18, card title 15, subtitle 15, body 15, controls and rows 14, caption 13, labels 12.
    const roles = new Set(tokens.filter((c) => /^text-(?:title|subtitle|section|card-title|body|ui|meta|label|kpi)$/.test(c)))
    expect([...roles].sort()).toEqual(['text-body', 'text-card-title', 'text-label', 'text-meta', 'text-section', 'text-subtitle', 'text-title', 'text-ui'])
  })

  it('the sample amounts and total use tabular figures', () => {
    renderPreview()
    for (const value of [...screen.getAllByTestId('sample-panel-row-value').slice(0, 3), screen.getByTestId('sample-panel-total-value')]) {
      expect(value.className).toContain('tabular-nums')
    }
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
  it.each([true, false])('heading order: one h1, then the sample panel, every card, the band and the steps as h2 -- no level skipped (owner: %s)', (owner) => {
    renderPreview(owner)
    expect(screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent])).toEqual([
      ['H1', 'AI-Powered Cloud Operations & Infrastructure Intelligence'],
      ['H2', SAMPLE_PANEL_TITLE],
      ...CARD_ORDER.map(([, title]) => ['H2', title]),
      ['H2', 'See where your AWS money is going'],
      ['H2', 'How connecting works'],
    ])
  })

  it('the sections are named by their headings (the panel as sample data), and the lists are real lists', () => {
    renderPreview()
    expect(screen.getByRole('region', { name: 'AI-Powered Cloud Operations & Infrastructure Intelligence' })).toBe(screen.getByTestId('dashboard-preview'))
    const panel = screen.getByRole('region', { name: `${SAMPLE_PANEL_TITLE} ${SAMPLE_TAG}` })
    expect(panel).toBe(screen.getByTestId('sample-panel'))
    expect(panel).toHaveAccessibleDescription(SAMPLE_CAPTION)
    expect(within(panel).getAllByTestId('sample-panel-row').every((row) => row.tagName === 'LI' && row.parentElement?.tagName === 'UL')).toBe(true)
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

  it('contrast: the sample panel meets WCAG AA (4.5:1) in light and dark', () => {
    renderPreview()
    const { light, dark } = tokens()
    const panel = screen.getByTestId('sample-panel')
    expect(panel.className).toContain('bg-[var(--surface-2)]')
    const fixed = (node: Element, prefix: '' | 'dark:') => node.className.match(new RegExp(`(?:^|\\s)${prefix}text-\\[(#[0-9A-Fa-f]{6})\\]`))?.[1]

    // Green amounts: the success ink (4.5:1 on white and the 50-tints: app/__tests__/app-surface-tokens.test.ts),
    // and a fixed colour in dark mode.
    const amounts = within(panel).getAllByTestId('sample-panel-row-value').slice(0, 3)
    for (const amount of amounts) {
      expect(amount.className.split(/\s+/)).toContain('text-ink-success')
      expect(fixed(amount, 'dark:')).toBe('#34D399')
    }
    expect(contrast('#34D399', dark['--surface-2'])).toBeGreaterThanOrEqual(4.5)

    // High badge: the strong danger ink on the danger tint (4.5:1 on every tint in use, same test file),
    // and a fixed colour in dark mode (the tint is translucent there, so over the surface).
    const badge = within(panel).getAllByTestId('sample-panel-row-value')[3]
    expect(badge.className).toContain('bg-[var(--bg-danger)]')
    expect(badge.className.split(/\s+/)).toContain('text-ink-danger-strong')
    expect(fixed(badge, 'dark:')).toBe('#F87171')
    expect(dark['--bg-danger']).toMatch(/^#[0-9A-Fa-f]{8}$/)
    expect(contrast('#F87171', over(dark['--bg-danger'], dark['--surface-2']))).toBeGreaterThanOrEqual(4.5)

    // The tag and the total amount: the accent on its tint.
    const tag = screen.getByTestId('sample-panel-tag')
    const total = screen.getByTestId('sample-panel-total')
    const totalValue = screen.getByTestId('sample-panel-total-value')
    expect(tag.style.background).toBe('var(--bg-accent)')
    expect(tag.style.color).toBe('var(--text-accent)')
    expect(total.style.background).toBe('var(--bg-accent)')
    expect(totalValue.style.color).toBe('var(--text-accent)')
    expect(contrast(light['--text-accent'], light['--bg-accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark['--text-accent'], over(dark['--bg-accent'], dark['--surface-2']))).toBeGreaterThanOrEqual(4.5)

    // Subtitles and the caption: muted text on the panel surface.
    for (const node of [...within(panel).getAllByTestId('sample-panel-row-subtitle'), screen.getByTestId('sample-panel-caption')]) {
      expect(node.className.split(/\s+/)).toContain('text-ink-muted')
    }
    for (const theme of [light, dark]) expect(contrast(theme['--text-secondary'], theme['--surface-2'])).toBeGreaterThanOrEqual(4.5)
  })
})
