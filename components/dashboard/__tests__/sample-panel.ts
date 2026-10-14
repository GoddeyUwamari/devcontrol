/**
 * The not-connected hero's sample panel, for the tests that guard the preview
 * (components/dashboard/__tests__/dashboard-unconnected-preview.test.tsx and
 * app/(app)/dashboard/__tests__/dashboard-cost-evidence.test.tsx).
 *
 * The panel is the one place in the preview allowed to show figures and to
 * say "sample" or "example", because it is labelled as sample data. The page's
 * word and figure guards therefore read the page through
 * withoutValidSamplePanel(), which removes the panel only while it is labelled:
 * one panel, in the hero (before the cards), with its "Sample data" tag and its
 * caption both present and visible. Otherwise nothing is removed, and the
 * panel's figures and words trip the guards like any other content.
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
/** Classes that hide an element visually or from everyone, with or without a breakpoint prefix. */
const HIDING_CLASS = /(^|\s)(?:[\w-]+:)*(?:sr-only|hidden|invisible|opacity-0|text-transparent)(?=\s|$)/

/** Whether `el` and every ancestor up to `root` are visible: no hiding class, attribute or inline style. */
function isVisible(el: Element, root: Element): boolean {
  for (let node: Element | null = el; node; node = node === root ? null : node.parentElement) {
    if (HIDING_CLASS.test(node.getAttribute('class') ?? '')) return false
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false
    if (node.tagName === 'DETAILS' && !node.hasAttribute('open') && node !== el) return false
    const style = (node as HTMLElement).style
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false
  }
  return true
}

/** One element matching `selector` inside `panel`, with exactly `text`, visible up to `root`. */
function hasVisible(panel: Element, root: Element, selector: string, text: string): boolean {
  const found = panel.querySelectorAll(selector)
  return found.length === 1 && found[0].textContent === text && isVisible(found[0], root)
}

/** Why the panel in `root` is not a valid, labelled sample panel (empty when it is). */
export function samplePanelProblems(root: Element): string[] {
  const panels = root.querySelectorAll(PANEL)
  if (panels.length !== 1) return [`expected one sample panel, found ${panels.length}`]
  const panel = panels[0]
  const problems: string[] = []
  const preview = panel.closest('[data-testid="dashboard-preview"]')
  const cards = preview?.querySelector('[data-testid="preview-cards"]')
  if (!preview || !cards) problems.push('not inside the preview, above its cards')
  else if (!(panel.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING) || panel.contains(cards)) problems.push('not before the cards')
  if (!isVisible(panel, root)) problems.push('panel hidden')
  if (!hasVisible(panel, root, '[data-testid="sample-panel-tag"]', SAMPLE_TAG)) problems.push('tag missing or hidden')
  else if (!/(^|\s)uppercase(\s|$)/.test(panel.querySelector('[data-testid="sample-panel-tag"]')!.getAttribute('class') ?? '')) problems.push('tag not uppercase')
  if (!hasVisible(panel, root, '[data-testid="sample-panel-caption"]', SAMPLE_CAPTION)) problems.push('caption missing or hidden')
  return problems
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
