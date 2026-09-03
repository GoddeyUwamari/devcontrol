/**
 * Focused coverage for the Cost Intelligence IA cleanup's route retirement:
 * /infrastructure/recommendations (the page) has been deleted -- this
 * verifies its breadcrumb registry entry was cleaned up alongside it,
 * rather than left pointing at a route that no longer exists.
 */
import { describe, it, expect } from 'vitest'
import { parentPaths } from '../useBreadcrumbs'

describe('breadcrumb registry after /infrastructure/recommendations retirement', () => {
  it('no longer has an entry for the retired route', () => {
    expect(parentPaths['/infrastructure/recommendations']).toBeUndefined()
  })

  it('unrelated Infrastructure breadcrumb entries are untouched', () => {
    expect(parentPaths['/infrastructure/new']).toEqual([])
    expect(parentPaths['/tenants']).toEqual([{ label: 'Infrastructure', href: '/infrastructure' }])
  })
})
