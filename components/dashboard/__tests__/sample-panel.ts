/**
 * The not-connected hero's sample panel, for the tests that guard the preview
 * (components/dashboard/__tests__/dashboard-unconnected-preview.test.tsx and
 * app/(app)/dashboard/__tests__/dashboard-cost-evidence.test.tsx).
 *
 * The panel is the one place in the preview allowed to show figures and to
 * say "sample" or "example", because it is labelled as sample data. The page's
 * word and figure guards therefore read the page through
 * withoutValidSamplePanel(), which removes the panel only while it is labelled:
 * one panel, in the hero's second column (after the headline, before the
 * cards), with its "Sample data" tag and its caption present, and every
 * element of the panel, the copy column beside it and the two wrappers up to
 * dashboard-preview carrying exactly the pinned attributes (an allow-list, so
 * no class or attribute can hide them). Otherwise nothing is removed, and the
 * panel's figures and words trip the guards like any other content.
 *
 * Known limits. jsdom does not compute CSS: these checks read markup (elements,
 * attributes, class strings), not what is painted. A rule from outside the
 * preview can still hide the tag or caption without changing that markup --
 * global CSS (app/globals.css or any imported stylesheet), a descendant variant
 * on an ancestor above dashboard-preview (e.g. `[&_#id]:hidden` on the page
 * wrapper), or a structural selector that matches by position. Those are a
 * code-review responsibility, not something these tests can prove.
 *
 * Not a test file (no .test suffix): vitest does not collect it.
 */
import { expect } from 'vitest'

export const SAMPLE_PANEL_TITLE = "What you'll see after connecting"
export const SAMPLE_TAG = 'Sample data'
export const SAMPLE_CAPTION = 'Illustrative example. Your own findings appear after your first scan.'
/** The approved rows, exactly and in order: title, subtitle, right-hand value. */
export const SAMPLE_ROWS: Array<[string, string, string]> = [
  ['Server running but idle', 'Idle EC2 instance', '$142/mo'],
  ['Storage attached to nothing', 'Unattached EBS volume', '$38/mo'],
  ['Old storage type, cheaper one exists', 'gp2 to gp3 upgrade', '$21/mo'],
  ['Bucket accepts non-HTTPS requests', 'S3 bucket policy', 'High'],
]
export const SAMPLE_TOTAL_LABEL = 'Estimated monthly saving (sample)'
export const SAMPLE_TOTAL_VALUE = '$201/mo'

/**
 * Words the hero (copy and sample panel) must never use: no live or connected
 * claim, no alarm wording, no compliance framework.
 */
export const HERO_FORBIDDEN = /\bconnected\b|real-?time|\blive\b|\bcritical\b|action required|\bHIPAA\b|\bPHI\b|\bSOC ?2\b|\bISO ?27001\b|\bPCI\b|\bGDPR\b|\bNIST\b|\bCIS\b|\bFedRAMP\b|\bCCPA\b/i

const PANEL = '[data-testid="sample-panel"]'

/**
 * An allow-list, not a deny-list. The two wrappers above the panel and the
 * copy column beside it (the panel's preceding sibling, which could otherwise
 * style it through a sibling variant) carry exactly these attributes.
 */
const CHAIN_ATTRIBUTES: Record<'preview' | 'hero' | 'heroCopy', Record<string, string>> = {
  preview: { class: 'mb-10', 'aria-labelledby': 'dashboard-preview-title', 'data-testid': 'dashboard-preview' },
  hero: { class: 'grid grid-cols-1 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-8 lg:gap-12 items-center mb-8', 'data-testid': 'preview-hero' },
  heroCopy: { class: 'min-w-0', 'data-testid': 'preview-hero-copy' },
}

const TITLE_CLASS = 'text-base font-semibold text-foreground leading-snug m-0'
const SUBTITLE_CLASS = 'text-base text-[var(--text-secondary)] leading-snug m-0'
const ROW: Array<[number, string, Record<string, string>]> = [
  [2, 'LI', { class: 'flex items-center justify-between gap-4 px-6 py-4 border-b border-border', 'data-testid': 'sample-panel-row' }],
  [3, 'DIV', { class: 'min-w-0' }],
  [4, 'P', { class: TITLE_CLASS, 'data-testid': 'sample-panel-row-title' }],
  [4, 'P', { class: SUBTITLE_CLASS, 'data-testid': 'sample-panel-row-subtitle' }],
]
const AMOUNT: [number, string, Record<string, string>] = [3, 'SPAN', { class: 'shrink-0 text-lg font-bold text-[#047857] dark:text-[#34D399]', 'data-testid': 'sample-panel-row-value' }]
/**
 * Every element of the panel, in document order: [depth below the panel, tag,
 * exact attributes]. Nothing inside the panel can be added, moved, restyled or
 * given an attribute (a hiding class, a sibling variant, an overlay, a data
 * hook for a stylesheet) without the panel losing its exemption.
 * Update together with the component when its markup changes.
 */
const PANEL_ELEMENTS: Array<[number, string, Record<string, string>]> = [
  [0, 'SECTION', {
    class: 'bg-[var(--surface-2)] rounded-2xl border border-border shadow-[0_12px_32px_-12px_rgba(17,24,39,0.18)]',
    'aria-labelledby': 'sample-panel-title sample-panel-tag',
    'aria-describedby': 'sample-panel-caption',
    'data-testid': 'sample-panel',
  }],
  [1, 'DIV', { class: 'flex items-start justify-between gap-4 px-6 py-5 border-b border-border' }],
  [2, 'H2', { id: 'sample-panel-title', class: 'text-lg font-bold text-foreground tracking-tight leading-tight m-0', 'data-testid': 'sample-panel-title' }],
  [2, 'SPAN', {
    id: 'sample-panel-tag',
    class: 'text-[13px] font-bold uppercase tracking-[0.08em] leading-none shrink-0 rounded-md px-3 py-1.5',
    style: 'background: var(--bg-accent); color: var(--text-accent);',
    'data-testid': 'sample-panel-tag',
  }],
  [1, 'UL', { class: 'list-none p-0 m-0' }],
  ...ROW, AMOUNT,
  ...ROW, AMOUNT,
  ...ROW, AMOUNT,
  ...ROW,
  [3, 'SPAN', {
    class: 'shrink-0 rounded-full px-3 py-1.5 text-[13px] font-bold leading-none bg-[var(--bg-danger)] text-[#B91C1C] dark:text-[#F87171]',
    'data-testid': 'sample-panel-row-value',
    'data-severity': 'high',
  }],
  [1, 'DIV', { class: 'mx-6 mt-5 rounded-xl px-5 py-4 flex items-center justify-between gap-4', style: 'background: var(--bg-accent);', 'data-testid': 'sample-panel-total' }],
  [2, 'P', { class: 'text-base font-medium text-foreground leading-snug m-0' }],
  [2, 'SPAN', { class: 'shrink-0 text-2xl font-bold leading-none', style: 'color: var(--text-accent);', 'data-testid': 'sample-panel-total-value' }],
  [1, 'P', { id: 'sample-panel-caption', class: 'text-base text-[var(--text-secondary)] leading-normal px-6 pt-4 pb-5 m-0', 'data-testid': 'sample-panel-caption' }],
]

/** Whether every element of `panel` (itself included) matches PANEL_ELEMENTS exactly. */
function panelMatchesPins(panel: Element): boolean {
  const elements = [panel, ...panel.querySelectorAll('*')]
  if (elements.length !== PANEL_ELEMENTS.length) return false
  return elements.every((el, i) => {
    const [depth, tag, attributes] = PANEL_ELEMENTS[i]
    let d = 0
    for (let node: Element | null = el; node !== panel; node = node!.parentElement) d++
    return d === depth && el.tagName === tag && sameAttributes(el, attributes)
  })
}

function attributesOf(el: Element): Record<string, string> {
  return Object.fromEntries([...el.attributes].map((attr) => [attr.name, attr.value]))
}
function sameAttributes(el: Element | null | undefined, expected: Record<string, string>): boolean {
  if (!el) return false
  const actual = attributesOf(el)
  const keys = Object.keys(expected)
  return Object.keys(actual).length === keys.length && keys.every((key) => actual[key] === expected[key])
}
/** Exactly `text` as its only child: no wrapper element that could hide or replace it. */
function onlyText(el: Element, text: string): boolean {
  return el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE && el.textContent === text
}

/** Why the panel in `root` is not a valid, labelled sample panel (empty when it is). */
export function samplePanelProblems(root: Element): string[] {
  const panels = root.querySelectorAll(PANEL)
  if (panels.length !== 1) return [`expected one sample panel, found ${panels.length}`]
  const panel = panels[0]
  const problems: string[] = []

  // Place: the hero's second column, after the copy column (and so after the h1), before the cards.
  const hero = panel.parentElement
  const preview = hero?.parentElement
  const copy = panel.previousElementSibling
  if (hero?.getAttribute('data-testid') !== 'preview-hero' || preview?.getAttribute('data-testid') !== 'dashboard-preview') problems.push('not in the hero')
  if (copy?.getAttribute('data-testid') !== 'preview-hero-copy' || copy.firstElementChild?.tagName !== 'H1' || panel.nextElementSibling !== null) problems.push('not after the headline column')
  if (hero?.nextElementSibling?.getAttribute('data-testid') !== 'preview-cards') problems.push('not before the cards')

  // The wrappers above it and the column beside it, then every element of the panel, exactly as pinned.
  if (!sameAttributes(preview, CHAIN_ATTRIBUTES.preview)) problems.push('preview attributes changed')
  if (!sameAttributes(hero, CHAIN_ATTRIBUTES.hero)) problems.push('hero attributes changed')
  if (!sameAttributes(copy, CHAIN_ATTRIBUTES.heroCopy)) problems.push('copy column attributes changed')
  if (!panelMatchesPins(panel)) problems.push('panel markup changed')
  const tag = panel.querySelector('[data-testid="sample-panel-tag"]')
  const caption = panel.querySelector('[data-testid="sample-panel-caption"]')
  if (!tag || !onlyText(tag, SAMPLE_TAG)) problems.push('tag missing or changed')
  if (!caption || !onlyText(caption, SAMPLE_CAPTION)) problems.push('caption missing or changed')
  // inert anywhere in the chain or the panel makes it unreadable to keyboard and assistive technology.
  if (panel.closest('[inert]') || panel.querySelector('[inert]')) problems.push('inert')
  return problems
}

/**
 * Generated content (::before / ::after, CSS content) could put text on screen
 * that no textContent guard sees. Nothing in the preview may use it.
 */
export function expectNoGeneratedContent(preview: Element) {
  for (const node of [preview, ...preview.querySelectorAll('*')]) {
    expect(node.getAttribute('class') ?? '').not.toMatch(/(?:^|[\s:\]])(?:before|after):|content-\[/)
    expect(node.getAttribute('style') ?? '').not.toMatch(/(?:^|[;\s])content\s*:/i)
  }
}

/**
 * No stylesheet in the rendered preview: a <style> element or a stylesheet
 * <link> could hide the tag or caption without touching their markup.
 */
export function expectNoStylesheets(root: Element) {
  expect([...root.querySelectorAll('style, link')].filter((el) => el.tagName === 'STYLE' || /(^|\s)stylesheet(\s|$)/i.test(el.getAttribute('rel') ?? '') || el.getAttribute('as') === 'style')).toEqual([])
}

/**
 * A copy of `root` without the sample panel -- only if the panel is valid
 * (see samplePanelProblems). Otherwise an unchanged copy, so every guard that
 * reads the result sees the panel's figures and words.
 */
export function withoutValidSamplePanel<T extends Element>(root: T): T {
  const clone = root.cloneNode(true) as T
  if (samplePanelProblems(clone).length === 0) clone.querySelector(PANEL)!.remove()
  return clone
}

/** The hero's text, one space between text nodes, without the non-owner's "AWS not connected" pill. */
export function heroWords(hero: Element): string {
  const clone = hero.cloneNode(true) as Element
  clone.querySelector('[data-testid="preview-pill-aws"]')?.remove()
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
  return parts.join(' ').replace(/\s+/g, ' ')
}

/** Parses "$142/mo" to 142; anything else is an error. */
function dollarsPerMonth(text: string | null): number {
  const match = /^\$(\d+)\/mo$/.exec(text ?? '')
  expect(match, `"${text}" is not a monthly amount`).not.toBeNull()
  return Number(match![1])
}

/**
 * The panel in `root` says exactly the approved content and nothing else, its
 * total is the sum of its cost rows, it is labelled for assistive technology
 * as sample data, and it is not interactive.
 */
export function expectApprovedSamplePanel(root: Element) {
  expect(samplePanelProblems(root)).toEqual([])
  const panel = root.querySelector(PANEL)!

  const rows = [...panel.querySelectorAll('[data-testid="sample-panel-row"]')]
  expect(rows.map((row) => [
    row.querySelector('[data-testid="sample-panel-row-title"]')?.textContent,
    row.querySelector('[data-testid="sample-panel-row-subtitle"]')?.textContent,
    row.querySelector('[data-testid="sample-panel-row-value"]')?.textContent,
  ])).toEqual(SAMPLE_ROWS)
  expect(panel.querySelector('[data-testid="sample-panel-title"]')?.textContent).toBe(SAMPLE_PANEL_TITLE)
  const total = panel.querySelector('[data-testid="sample-panel-total"]')!
  expect(total.textContent).toBe(SAMPLE_TOTAL_LABEL + SAMPLE_TOTAL_VALUE)
  // The whole panel, word for word: nothing else can sit inside it.
  expect(panel.textContent).toBe(
    SAMPLE_PANEL_TITLE + SAMPLE_TAG + SAMPLE_ROWS.flat().join('') + SAMPLE_TOTAL_LABEL + SAMPLE_TOTAL_VALUE + SAMPLE_CAPTION,
  )

  // The total is the sum of the three cost rows, as rendered.
  const costs = rows.slice(0, 3).map((row) => dollarsPerMonth(row.querySelector('[data-testid="sample-panel-row-value"]')!.textContent))
  const shown = dollarsPerMonth(total.querySelector('[data-testid="sample-panel-total-value"]')!.textContent)
  expect(costs.reduce((sum, cost) => sum + cost, 0)).toBe(shown)
  expect(rows[3].querySelector('[data-testid="sample-panel-row-value"]')).toHaveAttribute('data-severity', 'high')

  // Named as sample data, and described by its caption.
  expect(panel.tagName).toBe('SECTION')
  expect(panel).toHaveAccessibleName(`${SAMPLE_PANEL_TITLE} ${SAMPLE_TAG}`)
  expect(panel).toHaveAccessibleDescription(SAMPLE_CAPTION)

  // Not interactive: no link, button or focus stop, and no hover or focus styling.
  expect(panel.closest('a, button, [role="button"], [role="link"]')).toBeNull()
  expect(panel.querySelector('a, button, input, select, textarea, [role="button"], [role="link"], [tabindex], [onclick]')).toBeNull()
  for (const node of [panel, ...panel.querySelectorAll('*')]) {
    expect(node.getAttribute('class') ?? '').not.toMatch(/hover:|cursor-pointer|focus/)
  }
  expect(HERO_FORBIDDEN.test(heroWords(panel))).toBe(false)
}
