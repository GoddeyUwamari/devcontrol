/**
 * The command palette is on the app type scale (typography plan T2c): every group heading renders at 600
 * (the label role from components/ui/command), hints are meta (13 px) in the accent ink (violet-700, not
 * purple-600), and secondary lines are meta in muted ink. The AI Results heading's count is a meta span at
 * normal weight inside the heading; the heading itself stays 600.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/services/services.service', () => ({ servicesService: { getAll: vi.fn().mockResolvedValue([{ id: 's1', name: 'sample-api', template: 'api', status: 'active' }]) } }))
vi.mock('@/lib/services/deployments.service', () => ({ deploymentsService: { getAll: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: vi.fn().mockResolvedValue([]) } }))
const rows = vi.hoisted(() => Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, resource_name: `sample-${i}`, resource_type: 'EC2', region: 'us-east-1' })))
vi.mock('@/lib/services/nl-query.service', () => ({
  nlQueryService: {
    executeQuery: vi.fn().mockResolvedValue({
      intent: { target: 'infrastructure', filters: {}, explanation: 'Stopped EC2 instances' },
      data: { type: 'resources', outcome: 'answered', rows, summary: '9 resources', columns: [], evidence: { state: 'available', source: 'x', provenance: 'actual', period: null, asOf: null, reason: null } },
      executedAt: '2026-10-23T12:00:00Z', rowCount: 9, executionMs: 42,
    }),
  },
}))

import { CommandPalette } from '../command-palette'

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  }
})

const classes = (el: Element) => el.className.split(/\s+/)
const HEADING_600 = '[&_[cmdk-group-heading]]:font-semibold'

async function openPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><CommandPalette /></QueryClientProvider>)
  await act(async () => { fireEvent.keyDown(document, { key: 'k', metaKey: true }) })
  return screen.findByRole('dialog')
}

/** Every rendered group heading is set to 600 by its own group and by the palette dialog, and never to 500. */
function expectHeadings600(dialog: HTMLElement, names: string[]) {
  const headings = [...dialog.querySelectorAll('[cmdk-group-heading]')]
  // The AI Results heading also holds its count ("9 results · 42ms"), so match on the heading's start.
  const texts = headings.map((h) => h.textContent?.trim() ?? '')
  for (const name of names) expect(texts.some((t) => t.startsWith(name))).toBe(true)
  for (const heading of headings) {
    const group = heading.closest('[cmdk-group]')!
    expect(classes(group)).toContain(HEADING_600)
    expect(group.className).not.toMatch(/\[&_\[cmdk-group-heading\]\]:font-(?:medium|normal)/)
    expect(heading.className).not.toMatch(/font-(?:medium|normal)/)
  }
  const root = dialog.querySelector('[cmdk-root]')!
  expect(classes(root)).toContain(HEADING_600)
}

describe('command palette type', () => {
  it('every group heading renders at 600', async () => {
    const dialog = await openPalette()
    await screen.findByText('sample-api')
    expectHeadings600(dialog, ['Actions', 'Navigate', 'Services'])
  })

  it('secondary lines are meta in muted ink', async () => {
    await openPalette()
    const sub = await screen.findByText(/api · active/)
    expect(classes(sub)).toEqual(expect.arrayContaining(['text-meta', 'text-ink-muted']))
  })

  it('AI search: the hint and prompts use the accent and ink roles; the results heading stays 600 with a meta count', async () => {
    const dialog = await openPalette()
    const input = within(dialog).getByRole('combobox')
    await act(async () => { fireEvent.change(input, { target: { value: 'show stopped instances' } }) })

    const hint = screen.getByText('AI Search').parentElement!
    expect(classes(hint)).toEqual(expect.arrayContaining(['text-meta', 'text-ink-accent']))
    expect(hint.className).not.toMatch(/(?<![\w:-])text-purple-600/)
    expect(classes(screen.getByText('Press Enter to search with AI'))).toEqual(expect.arrayContaining(['text-ui', 'font-medium', 'text-ink']))
    expect(classes(screen.getByText(/^Try:/))).toEqual(expect.arrayContaining(['text-meta', 'text-ink-muted']))

    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    await screen.findByText('AI Results')
    expectHeadings600(dialog, ['AI Results'])
    const count = screen.getByText((_, el) => el?.tagName === 'SPAN' && /^9 results·/.test(el.textContent ?? ''))
    expect(classes(count)).toEqual(expect.arrayContaining(['text-meta', 'text-ink-muted', 'font-normal']))
    expect(classes(screen.getByText('View all 9 results →'))).toEqual(expect.arrayContaining(['text-meta', 'text-ink-accent', 'font-medium']))
    expect(classes(screen.getByText('Stopped EC2 instances'))).toEqual(expect.arrayContaining(['font-medium', 'text-ink']))
  })
})
