/**
 * The blog and changelog newsletter signups. The backend answers every
 * successful signup the same way (it no longer says whether the address was
 * already subscribed), so the pages show one success message for any 2xx
 * and the error message for a failure. There is no "already subscribed"
 * state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import api from '@/lib/api'
import BlogPage from '../blog/page'
import ChangelogPage from '../changelog/page'

vi.mock('@/lib/api', () => ({ default: { post: vi.fn() } }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const EMAIL = 'placeholder-reader@example.test'

const PAGES = [
  ['blog', BlogPage, "You're subscribed! We'll notify you of new posts."],
  ['changelog', ChangelogPage, "You're subscribed! We'll notify you of new updates."],
] as const

beforeEach(() => {
  vi.mocked(api.post).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function signUp(Page: () => ReactElement) {
  render(<Page />)
  fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: EMAIL } })
  fireEvent.click(screen.getByRole('button', { name: /Subscribe/ }))
}

describe.each(PAGES)('%s newsletter signup', (source, Page, success) => {
  it('posts the address and shows the success message', async () => {
    vi.mocked(api.post).mockResolvedValue({ status: 201, data: { success: true, message: 'Subscribed successfully' } })

    signUp(Page)

    expect(await screen.findByText(success)).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/api/newsletter/subscribe', { email: EMAIL, source })
    expect(screen.queryByText(/already subscribed/i)).not.toBeInTheDocument()
  })

  it('an old "Already subscribed" answer is shown as success too', async () => {
    vi.mocked(api.post).mockResolvedValue({ status: 200, data: { success: true, message: 'Already subscribed' } })

    signUp(Page)

    expect(await screen.findByText(success)).toBeInTheDocument()
    expect(screen.queryByText(/already subscribed/i)).not.toBeInTheDocument()
  })

  it('a failed request shows the error message', async () => {
    vi.mocked(api.post).mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 500 } }))

    signUp(Page)

    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument()
    expect(screen.queryByText(success)).not.toBeInTheDocument()
  })
})
