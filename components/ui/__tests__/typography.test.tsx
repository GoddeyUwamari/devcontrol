/**
 * The app type-role components (components/ui/typography.tsx): PageHeader is the page's one h1 on the
 * title role with an optional subtitle and actions; Num gives inline figures tabular digits.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Num, PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS, PageHeader } from '../typography'

describe('the page title and subtitle classes', () => {
  it('are the title role in ink and the subtitle role in muted ink', () => {
    expect(PAGE_TITLE_CLASS).toBe('text-title text-ink')
    expect(PAGE_SUBTITLE_CLASS).toBe('text-subtitle text-ink-muted')
  })
})

describe('PageHeader', () => {
  it('renders one h1 on the title role, and the subtitle on the subtitle role', () => {
    render(<PageHeader title="Costs" subtitle="What you spend, by service." />)
    const h1 = screen.getByRole('heading', { level: 1, name: 'Costs' })
    expect(h1.className.split(/\s+/)).toEqual(['text-title', 'text-ink'])
    const subtitle = screen.getByText('What you spend, by service.')
    expect(subtitle.tagName).toBe('P')
    expect(subtitle.className.split(/\s+/)).toEqual(['text-subtitle', 'text-ink-muted', 'mt-2', 'max-w-[70ch]'])
  })

  it('without a subtitle or actions, renders only the title', () => {
    const { container } = render(<PageHeader title="Costs" />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
    expect(container.querySelector('[data-slot="page-header"]')!.children).toHaveLength(1)
  })

  it('gives the h1 an id for aria-labelledby, and renders actions beside it', () => {
    render(
      <section aria-labelledby="page-title">
        <PageHeader title="Costs" titleId="page-title" actions={<button type="button">Export</button>} />
      </section>
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('id', 'page-title')
    expect(screen.getByRole('region', { name: 'Costs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  })

  it('passes className to the wrapper', () => {
    const { container } = render(<PageHeader title="Costs" className="mb-8" />)
    expect((container.firstElementChild as HTMLElement).className).toContain('mb-8')
  })
})

describe('Num', () => {
  it('renders a span with tabular figures, keeping other classes and props', () => {
    render(<Num className="font-semibold" data-testid="n">$1,234.50</Num>)
    const n = screen.getByTestId('n')
    expect(n.tagName).toBe('SPAN')
    expect(n.className.split(/\s+/)).toEqual(expect.arrayContaining(['tabular-nums', 'font-semibold']))
    expect(n).toHaveTextContent('$1,234.50')
  })

  it('keeps a role size and an ink colour together through cn()', () => {
    render(<Num className="text-ui font-semibold text-ink-success" data-testid="n">$142/mo</Num>)
    expect(screen.getByTestId('n').className).toBe('tabular-nums text-ui font-semibold text-ink-success')
  })

  it('merges its classes with cn(): a later role replaces an earlier size, and tabular figures stay', () => {
    render(<Num className="text-sm text-section text-ink" data-testid="n">$1,234.50</Num>)
    expect(screen.getByTestId('n').className).toBe('tabular-nums text-section text-ink')
  })
})
