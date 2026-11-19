/**
 * Founder rule (Cost Optimization tidy): every toast appears at the TOP of the
 * screen, never bottom-right. The one Toaster (app/layout.tsx) takes
 * TOAST_POSITION; the AI assistant button (bottom-right) and the Live updates
 * pill (bottom-left) stay where they are.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Toaster, toast } from 'sonner'
import { useRef } from 'react'
import { TOAST_MOBILE_OFFSET, TOAST_OFFSET, TOAST_POSITION } from '@/lib/toast-position'
import { TOAST_CLEAR_ATTR, toastTop } from '@/lib/toast-clearance'
import { useToastClearance } from '@/lib/hooks/use-toast-clearance'

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

afterEach(() => {
  act(() => { toast.dismiss() })
})

describe('toasts appear at the top of the screen', () => {
  it('the position is a top one', () => {
    expect(TOAST_POSITION).toMatch(/^top-/)
  })

  it('the root layout mounts exactly one Toaster, with TOAST_POSITION', () => {
    const layout = source('app/layout.tsx')
    expect(layout.match(/<Toaster\b/g)).toHaveLength(1)
    expect(layout).toContain('<Toaster position={TOAST_POSITION} offset={TOAST_OFFSET} mobileOffset={TOAST_MOBILE_OFFSET} />')
    expect(layout).toContain('import { TOAST_MOBILE_OFFSET, TOAST_OFFSET, TOAST_POSITION } from "@/lib/toast-position"')
  })

  it('no other file mounts a Toaster or sets a bottom position', () => {
    for (const path of ['app/(app)/layout.tsx', 'app/(app)/cost-optimization/page.tsx', 'app/providers.tsx']) {
      const text = source(path)
      expect(text).not.toMatch(/<Toaster\b/)
      expect(text).not.toMatch(/position=["']bottom/)
    }
  })

  it("the toaster's live region is not a containing block (else top-center is the end of the page, not the screen)", () => {
    const css = source('app/globals.css')
    // The app-wide rule that caused it stays for every other live region…
    expect(css).toMatch(/\[aria-live\] \{\n {2}contain: layout;\n\}/)
    // …and sonner's wrapper is exempted.
    expect(css).toMatch(/\[aria-live\]:has\(> \[data-sonner-toaster\]\) \{\n {2}contain: none;\n\}/)
  })

  it('a toast renders in the top stack', async () => {
    render(<Toaster position={TOAST_POSITION} />)
    act(() => { toast.success('Recommendation marked as resolved') })
    const list = await new Promise<Element | null>((resolve) => setTimeout(() => resolve(document.querySelector('[data-sonner-toaster]')), 0))
    expect(list).not.toBeNull()
    expect(list!.getAttribute('data-y-position')).toBe('top')
    expect(list!.getAttribute('data-y-position')).not.toBe('bottom')
  })
})

describe('round 3: toasts sit just below the app nav, never over it or the page banner', () => {
  const box = (top: number, bottom: number) => ({ getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) })

  it('the Toaster reads the clearance variable, with sonner\'s own offsets as the fallback', () => {
    expect(TOAST_OFFSET).toEqual({ top: 'var(--app-toast-top, 24px)' })
    expect(TOAST_MOBILE_OFFSET).toEqual({ top: 'var(--app-toast-top, 16px)' })
  })

  it('just below the nav: its bottom + 12px', () => {
    expect(toastTop(box(0, 101), [])).toBe(113)
    expect(toastTop(box(0, 68), [])).toBe(80)
  })

  it('a marked banner right under the nav pushes the toast below it', () => {
    expect(toastTop(box(0, 101), [box(133, 197)])).toBe(209)
  })

  it('a marked banner that has scrolled under the nav, or is far down the page, does not', () => {
    expect(toastTop(box(0, 101), [box(-40, 24)])).toBe(113)
    expect(toastTop(box(0, 101), [box(600, 664)])).toBe(113)
    expect(toastTop(box(0, 101), [box(133, 133)])).toBe(113) // closed (no height)
  })

  it('a banner half under the nav still pushes the toast past its visible part', () => {
    expect(toastTop(box(0, 101), [box(80, 144)])).toBe(156)
  })

  it('no nav (outside the app shell): 12px from the top, plus any banner', () => {
    expect(toastTop(null, [])).toBe(12)
  })

  it('useToastClearance writes the variable on <html> and removes it on unmount', () => {
    const header = document.createElement('div')
    header.getBoundingClientRect = () => ({ top: 0, bottom: 101, height: 101 } as DOMRect)
    const banner = document.createElement('section')
    banner.setAttribute(TOAST_CLEAR_ATTR, '')
    banner.getBoundingClientRect = () => ({ top: 133, bottom: 197, height: 64 } as DOMRect)
    document.body.append(header, banner)
    function Probe() {
      const ref = useRef<HTMLElement | null>(header)
      useToastClearance(ref)
      return null
    }
    const { unmount } = render(<Probe />)
    expect(document.documentElement.style.getPropertyValue('--app-toast-top')).toBe('209px')
    unmount()
    expect(document.documentElement.style.getPropertyValue('--app-toast-top')).toBe('')
    header.remove()
    banner.remove()
  })

  it('the app layout measures its sticky header, and the Cost Optimization banner is marked', () => {
    const app = source('app/(app)/layout.tsx')
    expect(app).toContain('useToastClearance(stickyHeader)')
    expect(app).toContain('<div ref={stickyHeader} className="sticky top-0 z-50')
    expect(source('app/(app)/cost-optimization/CostAnalysisBanner.tsx')).toContain('{...{ [TOAST_CLEAR_ATTR]: \'\' }}')
  })
})

describe('the floating controls keep their corners', () => {
  it('the AI assistant button stays bottom-right', () => {
    expect(source('components/ai/AIChatWidget.tsx')).toContain('fixed bottom-4 right-4 sm:bottom-6 sm:right-6')
  })

  it('the Live updates pill stays bottom-left', () => {
    expect(source('components/ConnectionIndicator.tsx')).toContain('fixed bottom-4 left-4')
  })
})
