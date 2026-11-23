/**
 * PR2 empty states: the shared parts' contract. The card is a centred stack (icon, heading, one filled
 * button) with ~40px vertical padding and no other sentence; the loading blocks follow each page's tile count.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ConnectAwsHeaderButton, NotConnectedCard, NotConnectedLoading, UnmeasuredValue } from '../not-connected'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))

describe('NotConnectedCard', () => {
  it('a centred stack with 40px vertical padding: icon, heading, one filled button; nothing else', () => {
    render(<NotConnectedCard />)
    const card = screen.getByTestId('not-connected-card')
    expect(card).toHaveClass('flex', 'flex-col', 'items-center', 'text-center', 'py-10', 'w-full')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    const [icon, heading, button] = Array.from(card.children)
    expect(icon.tagName.toLowerCase()).toBe('svg')
    expect(heading).toEqual(within(card).getByRole('heading', { level: 2, name: 'No AWS account connected' }))
    expect(button).toHaveAttribute('href', '/connect-aws')
    expect(button).toHaveClass('bg-violet-700', 'text-white')
    expect(card.children).toHaveLength(3)
  })
})

describe('ConnectAwsHeaderButton and UnmeasuredValue', () => {
  it('the header button is outlined, to /connect-aws', () => {
    render(<ConnectAwsHeaderButton />)
    const button = screen.getByRole('link', { name: 'Connect AWS account' })
    expect(button).toHaveAttribute('href', '/connect-aws')
    expect(button).toHaveClass('border', 'border-violet-700', 'bg-card')
    expect(button).not.toHaveClass('bg-violet-700')
  })
  it('"—" in grey, read as "Not measured"', () => {
    render(<UnmeasuredValue />)
    const value = screen.getByTestId('unmeasured-value')
    expect(value).toHaveClass('text-ink-muted')
    expect(value).toHaveTextContent('—Not measured')
  })
})

describe('NotConnectedLoading', () => {
  it.each([3, 4, 5] as const)('%i tile blocks, then two body blocks; no text', (tiles) => {
    render(<NotConnectedLoading tiles={tiles} />)
    expect(screen.getByTestId('connection-loading-tiles').children).toHaveLength(tiles)
    expect(screen.getByTestId('connection-loading').textContent).toBe('')
  })
})
