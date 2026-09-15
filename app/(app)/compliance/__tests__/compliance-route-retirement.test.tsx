/**
 * Coverage for retiring the legacy /compliance surface (product-truthfulness
 * remediation). /compliance previously rendered "SOC 2 & HIPAA Compliance"
 * with PASS/FAIL control badges and a downloadable "SOC 2 Type II Compliance
 * Audit Report" PDF, none of which reflect real, independently audited SOC 2
 * compliance. It is now a plain server-side redirect to /compliance/frameworks
 * (the Security Hub-backed CIS/PCI readiness page), so no customer — even one
 * who bookmarks or types the old URL directly — can reach that experience.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const mockRedirect = vi.fn()
vi.mock('next/navigation', () => ({
  redirect: (destination: string) => mockRedirect(destination),
}))

import CompliancePage from '../page'

describe('legacy /compliance route retirement', () => {
  beforeEach(() => {
    mockRedirect.mockClear()
  })

  it('redirects to /compliance/frameworks and nothing else', () => {
    CompliancePage()
    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect).toHaveBeenCalledWith('/compliance/frameworks')
  })

  it('the page source contains no SOC 2 audit/certification UI, control evaluators, or PDF download wiring', () => {
    const fullSource = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf-8')
    // Strip block comments first: the retirement note legitimately *describes*
    // the retired "SOC 2 Type II" claim for historical context — only text
    // outside comments would actually be rendered/executed.
    const code = fullSource.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/SOC 2 Type II/)
    expect(code).not.toMatch(/ready for your auditors/i)
    expect(code).not.toMatch(/\bPASS\b|\bFAIL\b/)
    expect(code).not.toMatch(/Download PDF/i)
    expect(code).not.toMatch(/complianceEngineService/)
    expect(code).not.toMatch(/getReportUrl/)
    expect(code).not.toMatch(/'use client'/)
  })
})
