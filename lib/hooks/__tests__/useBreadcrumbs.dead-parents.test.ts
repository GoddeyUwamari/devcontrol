/**
 * CAT-3: there is no /devops or /observability page, so those breadcrumb
 * parents are labels only (the pattern /remediation already used).
 */
import { describe, it, expect } from 'vitest'
import { parentPaths } from '../useBreadcrumbs'

describe('breadcrumb parents without a page are not links', () => {
  it.each([
    ['/status', 'Observability'],
    ['/app/dora-metrics', 'DevOps'],
    ['/dora-metrics', 'DevOps'],
    ['/teams', 'DevOps'],
    ['/enterprise', 'DevOps'],
    ['/developers', 'DevOps'],
    ['/remediation', 'DevOps'],
  ])('%s: "%s" keeps its label and has no href', (path, label) => {
    expect(parentPaths[path]).toEqual([{ label }])
  })

  it('no breadcrumb anywhere links to /devops or /observability', () => {
    const hrefs = Object.values(parentPaths).flat().map((p) => p.href).filter(Boolean)
    expect(hrefs).not.toContain('/devops')
    expect(hrefs).not.toContain('/observability')
  })
})
