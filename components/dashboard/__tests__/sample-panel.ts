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
 * cards), with its "Sample data" tag and its caption present, and the panel,
 * tag, caption and every element up to dashboard-preview carrying exactly the
 * pinned attributes (an allow-list, so no class or attribute can hide them).
 * Otherwise nothing is removed, and the panel's figures and words trip the
 * guards like any other content.
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
 * An allow-list, not a deny-list: the panel, its tag, its caption and every
 * element between them and dashboard-preview must carry exactly these
 * attributes (class and style included, word for word), nothing more. Any
 * added class, style, `hidden`, `inert`, `aria-hidden` or other attribute
 * means the panel is no longer exempt -- whatever it would do to visibility.
 * Update these pins together with the component when its markup changes.
 */
const CHAIN_ATTRIBUTES: Record<'preview' | 'hero' | 'panel' | 'header' | 'tag' | 'caption', Record<string, string>> = {
  preview: { class: 'mb-10', 'aria-labelledby': 'dashboard-preview-title', 'data-testid': 'dashboard-preview' },
  hero: { class: 'grid grid-cols-1 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-8 lg:gap-12 items-center mb-8', 'data-testid': 'preview-hero' },
  panel: {
    class: 'bg-[var(--surface-2)] rounded-2xl border border-border shadow-[0_12px_32px_-12px_rgba(17,24,39,0.18)]',
    'aria-labelledby': 'sample-panel-title sample-panel-tag',
    'aria-describedby': 'sample-panel-caption',
    'data-testid': 'sample-panel',
  },
  header: { class: 'flex items-start justify-between gap-4 px-6 py-5 border-b border-border' },
  tag: {
    id: 'sample-panel-tag',
    class: 'text-[13px] font-bold uppercase tracking-[0.08em] leading-none shrink-0 rounded-md px-3 py-1.5',
    style: 'background: var(--bg-accent); color: var(--text-accent);',
    'data-testid': 'sample-panel-tag',
  },
  caption: { id: 'sample-panel-caption', class: 'text-base text-[var(--text-secondary)] leading-normal px-6 pt-4 pb-5 m-0', 'data-testid': 'sample-panel-caption' },
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

  // Every element from dashboard-preview down to the tag and the caption, exactly as pinned.
  const tags = panel.querySelectorAll('[data-testid="sample-panel-tag"]')
  const captions = panel.querySelectorAll('[data-testid="sample-panel-caption"]')
  const tag = tags.length === 1 ? tags[0] : null
  const caption = captions.length === 1 ? captions[0] : null
  const header = tag?.parentElement
  if (!sameAttributes(preview, CHAIN_ATTRIBUTES.preview)) problems.push('preview attributes changed')
  if (!sameAttributes(hero, CHAIN_ATTRIBUTES.hero)) problems.push('hero attributes changed')
  if (!sameAttributes(panel, CHAIN_ATTRIBUTES.panel)) problems.push('panel attributes changed')
  if (!tag || !onlyText(tag, SAMPLE_TAG)) problems.push('tag missing or changed')
  else if (!sameAttributes(tag, CHAIN_ATTRIBUTES.tag)) problems.push('tag attributes changed')
  if (!header || header.parentElement !== panel || panel.firstElementChild !== header || !sameAttributes(header, CHAIN_ATTRIBUTES.header)) problems.push('tag header changed')
  if (!caption || !onlyText(caption, SAMPLE_CAPTION)) problems.push('caption missing or changed')
  else if (caption.parentElement !== panel || panel.lastElementChild !== caption || !sameAttributes(caption, CHAIN_ATTRIBUTES.caption)) problems.push('caption attributes or place changed')
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
