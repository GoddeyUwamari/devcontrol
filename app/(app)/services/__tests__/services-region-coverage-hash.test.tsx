/**
 * PR 3d-1 (founder decision D7): Infrastructure's "View regions →" and
 * Security's "Region coverage →" link to /services#region-coverage. The card
 * renders only after coverage loads, so the browser's own jump finds nothing:
 * the card scrolls itself into view once, on its first render, when the URL
 * has that hash (Security's #findings pattern). No visual change.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { RegionCoverageCard, REGION_COVERAGE_CARD_ID } from '../RegionCoverageCard'
import { describeCoverageCard } from '../redesignModel'
import { R_NOW, tab5 } from './redesign-fixtures'

const view = () => describeCoverageCard(tab5('ok'), R_NOW)

afterEach(() => {
  window.history.replaceState(null, '', '/')
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

function spyScroll() {
  const spy = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: spy, configurable: true, writable: true })
  return spy
}

describe('the Region coverage card and #region-coverage', () => {
  it('scrolls itself into view once, on its first render, when the URL has the hash', () => {
    const spy = spyScroll()
    window.history.replaceState(null, '', `/services#${REGION_COVERAGE_CARD_ID}`)
    const { rerender, container } = render(<RegionCoverageCard view={view()} now={R_NOW} />)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.contexts[0]).toBe(container.querySelector(`#${REGION_COVERAGE_CARD_ID}`))
    // A later render (a coverage refetch) never scrolls again.
    rerender(<RegionCoverageCard view={view()} now={R_NOW + 60_000} />)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does nothing without the hash, or with another one', () => {
    const spy = spyScroll()
    render(<RegionCoverageCard view={view()} now={R_NOW} />)
    window.history.replaceState(null, '', '/services#findings')
    render(<RegionCoverageCard view={view()} now={R_NOW} />)
    expect(spy).not.toHaveBeenCalled()
  })

  it('never throws where scrollIntoView does not exist (jsdom)', () => {
    window.history.replaceState(null, '', `/services#${REGION_COVERAGE_CARD_ID}`)
    expect(() => render(<RegionCoverageCard view={view()} now={R_NOW} />)).not.toThrow()
  })

  it('the markup is the same with and without the hash (no visual change)', () => {
    // React's generated ids (useId) differ per render root; everything else must be identical.
    const ids = (html: string) => html.replace(/:r[0-9a-z]+:|«r[0-9a-z]+»|_r_[0-9a-z]+_/g, ':id:')
    const plain = ids(render(<RegionCoverageCard view={view()} now={R_NOW} />).container.innerHTML)
    window.history.replaceState(null, '', `/services#${REGION_COVERAGE_CARD_ID}`)
    const hashed = ids(render(<RegionCoverageCard view={view()} now={R_NOW} />).container.innerHTML)
    expect(hashed).toBe(plain)
  })
})
