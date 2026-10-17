/**
 * The /services breadcrumb uses the page's title, "Services".
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

let mockPathname = '/services'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

import { useBreadcrumbs } from '../useBreadcrumbs'

describe('useBreadcrumbs — /services', () => {
  it('reads Dashboard > Services', () => {
    mockPathname = '/services'
    const { result } = renderHook(() => useBreadcrumbs())
    expect(result.current.map((b) => b.label)).toEqual(['Dashboard', 'Services'])
  })
})
