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
import { TOAST_POSITION } from '@/lib/toast-position'

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
    expect(layout).toContain('<Toaster position={TOAST_POSITION} />')
    expect(layout).toContain('import { TOAST_POSITION } from "@/lib/toast-position"')
  })

  it('no other file mounts a Toaster or sets a bottom position', () => {
    for (const path of ['app/(app)/layout.tsx', 'app/(app)/cost-optimization/page.tsx', 'app/providers.tsx']) {
      const text = source(path)
      expect(text).not.toMatch(/<Toaster\b/)
      expect(text).not.toMatch(/position=["']bottom/)
    }
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

describe('the floating controls keep their corners', () => {
  it('the AI assistant button stays bottom-right', () => {
    expect(source('components/ai/AIChatWidget.tsx')).toContain('fixed bottom-4 right-4 sm:bottom-6 sm:right-6')
  })

  it('the Live updates pill stays bottom-left', () => {
    expect(source('components/ConnectionIndicator.tsx')).toContain('fixed bottom-4 left-4')
  })
})
