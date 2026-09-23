/**
 * Recent Activity "Show all N" / "Show less" toggle.
 *
 * The feed (GET /api/platform/activity, capped at 15 by the backend) is already
 * fully fetched; the card shows the newest 6 and an in-card button reveals the
 * rest. The button never navigates and never fetches. Loading, empty and the
 * existing error behavior (a failed request still renders the empty state --
 * a separate, out-of-scope follow-up) are unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RecentActivityCard } from '../recent-activity-card'
import { useActivityFeed } from '@/lib/hooks/useActivityFeed'
import { activityFeedService, type ActivityEvent } from '@/lib/services/activity-feed.service'

const NOW = Date.parse('2026-09-23T12:00:00Z')
/** n events, newest first, each with a distinct message. */
const events = (n: number, prefix = 'Event'): ActivityEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    type: 'security',
    message: `${prefix} ${i + 1}`,
    timestamp: new Date(NOW - i * 60_000).toISOString(),
    severity: 'high',
  }))

const shownMessages = () => screen.queryAllByText(/^(Event|Other) \d+$/).map((el) => el.textContent)
const card = (data: ActivityEvent[] | undefined, extra: Partial<Parameters<typeof RecentActivityCard>[0]> = {}) =>
  <RecentActivityCard isDemoActive={false} data={data} isLoading={false} isError={false} {...extra} />

afterEach(() => vi.restoreAllMocks())

describe('default view and toggle visibility', () => {
  it('exactly 6 events: shows all 6, no toggle', () => {
    render(card(events(6)))
    expect(shownMessages()).toHaveLength(6)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('fewer than 6 events: shows all of them, no toggle', () => {
    render(card(events(3)))
    expect(shownMessages()).toEqual(['Event 1', 'Event 2', 'Event 3'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([10, 15])('%i events: initially the newest 6, with a "Show all N" toggle where N is that count', (n) => {
    render(card(events(n)))
    expect(shownMessages()).toEqual(['Event 1', 'Event 2', 'Event 3', 'Event 4', 'Event 5', 'Event 6'])
    expect(screen.getByRole('button', { name: `Show all ${n}` })).toBeInTheDocument()
  })
})

describe('expanding and collapsing', () => {
  it('"Show all N" reveals every fetched event in order and becomes "Show less"; "Show less" returns to the first 6', () => {
    const data = events(10)
    render(card(data))

    fireEvent.click(screen.getByRole('button', { name: 'Show all 10' }))
    expect(shownMessages()).toEqual(data.map((e) => e.message))
    const less = screen.getByRole('button', { name: 'Show less' })
    expect(less).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(less)
    expect(shownMessages()).toEqual(data.slice(0, 6).map((e) => e.message))
    expect(screen.getByRole('button', { name: 'Show all 10' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not mutate the fetched array', () => {
    const data = events(10)
    const snapshot = [...data]
    render(card(data))
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10' }))
    expect(data).toEqual(snapshot)
  })
})

describe('state reset when the dataset changes', () => {
  it('a refetch that replaces the data collapses back to 6 rows (and the count follows the new data)', () => {
    const { rerender } = render(card(events(10)))
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10' }))
    expect(shownMessages()).toHaveLength(10)

    rerender(card(events(12, 'Other')))
    expect(shownMessages()).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Show all 12' })).toBeInTheDocument()
  })

  it('data shrinking to 6 or fewer removes the toggle and shows everything', () => {
    const { rerender } = render(card(events(10)))
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10' }))
    rerender(card(events(4, 'Other')))
    expect(shownMessages()).toEqual(['Other 1', 'Other 2', 'Other 3', 'Other 4'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('an unchanged refetch (same array reference, as React Query structural sharing returns) stays expanded', () => {
    const data = events(10)
    const { rerender } = render(card(data))
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10' }))
    rerender(card(data))
    expect(shownMessages()).toHaveLength(10)
  })
})

describe('button semantics', () => {
  it('is a <button type="button">, not a link, with no destination', () => {
    const { container } = render(card(events(10)))
    const button = screen.getByRole('button', { name: 'Show all 10' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('href')
    expect(button.closest('a')).toBeNull()
    expect(container.querySelector('a, [href]')).toBeNull()
  })
})

describe('loading / empty / error / demo are unchanged', () => {
  it('loading: the existing skeleton, no rows, no toggle', () => {
    const { container } = render(card(events(10), { isLoading: true }))
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0)
    expect(shownMessages()).toHaveLength(0)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('empty: the existing "No activity yet"', () => {
    render(card([]))
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('error: existing behavior (the empty-state presentation) is unchanged, and never offers the toggle', () => {
    render(card(events(10), { isError: true }))
    expect(screen.getByText('No activity yet')).toBeInTheDocument()
    expect(shownMessages()).toHaveLength(0)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('demo mode: the card is still not rendered', () => {
    const { container } = render(card(events(10), { isDemoActive: true }))
    expect(container).toBeEmptyDOMElement()
  })
})

describe('with the real activity query: org-scoped, fetched once, toggle never fetches', () => {
  let client: QueryClient
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  function Harness({ orgId }: { orgId?: string }) {
    const q = useActivityFeed(orgId, true)
    return card(q.data, { isLoading: q.isLoading, isError: q.isError })
  }

  it('uses ["activity-feed", orgId], calls GET /api/platform/activity once, and expanding/collapsing adds no request', async () => {
    const spy = vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue(events(15))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<QueryClientProvider client={client}><Harness orgId="org-a" /></QueryClientProvider>)

    const showAll = await screen.findByRole('button', { name: 'Show all 15' })
    expect(client.getQueryData(['activity-feed', 'org-a'])).toHaveLength(15)
    expect(spy).toHaveBeenCalledTimes(1)

    fireEvent.click(showAll)
    expect(shownMessages()).toHaveLength(15)
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(shownMessages()).toHaveLength(6)

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still does not run without an organization', () => {
    const spy = vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue(events(15))
    render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
    expect(spy).not.toHaveBeenCalled()
  })
})
