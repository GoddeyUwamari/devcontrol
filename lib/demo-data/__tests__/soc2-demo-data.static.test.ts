/**
 * Static regression coverage for the SOC 2 demo mode implementation -- prevents
 * accidental reintroduction of the legacy ComplianceEngineService/FrameworkScanResult
 * model, and prevents any HIPAA demo functionality, in the new SOC2 demo data module
 * and the hooks it feeds. Same comment-stripping convention as
 * soc2-evidence.risk-score-isolation.test.ts's own readCode() helper, so a file that
 * legitimately NAMES a forbidden term only in an explanatory comment (documenting that
 * it does NOT depend on it) is never mistaken for a real reference.
 */
import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

function readCode(filePath: string): string {
  const full = fs.readFileSync(filePath, 'utf-8')
  return full.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

const repoRoot = path.join(__dirname, '..', '..', '..')
const FILES_UNDER_TEST = [
  path.join(repoRoot, 'lib', 'demo-data', 'soc2-demo-data.ts'),
  path.join(repoRoot, 'lib', 'hooks', 'useSoc2Readiness.ts'),
  path.join(repoRoot, 'lib', 'hooks', 'useCustomerEvidence.ts'),
]

describe('SOC 2 demo mode — legacy isolation (static)', () => {
  it.each(FILES_UNDER_TEST)('%s never references the legacy compliance-engine model', (filePath) => {
    const source = readCode(filePath)
    expect(source).not.toMatch(/complianceEngineService/)
    expect(source).not.toMatch(/ComplianceEngineService/)
    expect(source).not.toMatch(/FrameworkScanResult/)
    expect(source).not.toMatch(/ControlFramework/)
    expect(source).not.toMatch(/compliance-engine\.service/)
  })
})

describe('SOC 2 demo mode — HIPAA isolation (static)', () => {
  it.each(FILES_UNDER_TEST)('%s never references HIPAA', (filePath) => {
    const source = readCode(filePath)
    expect(source).not.toMatch(/HIPAA/i)
  })
})

describe('SOC 2 demo mode — no composite score fields', () => {
  it('the demo dataset never introduces overallScore/complianceScore/controlsPassed/controlsFailed/controlsTotal or a PASS/FAIL status', () => {
    const source = readCode(path.join(repoRoot, 'lib', 'demo-data', 'soc2-demo-data.ts'))
    expect(source).not.toMatch(/overallScore/)
    expect(source).not.toMatch(/complianceScore/)
    expect(source).not.toMatch(/controlsPassed/)
    expect(source).not.toMatch(/controlsFailed/)
    expect(source).not.toMatch(/controlsTotal/)
    expect(source).not.toMatch(/status\s*:\s*['"](pass|fail)['"]/i)
  })

  it('the demo dataset is typed against the real production SOC2 contract, not a redefined shape', () => {
    const source = readCode(path.join(repoRoot, 'lib', 'demo-data', 'soc2-demo-data.ts'))
    expect(source).toMatch(/from ['"]@\/lib\/services\/soc2\.service['"]/)
    expect(source).not.toMatch(/interface\s+Soc2ReadinessCriterion/)
    expect(source).not.toMatch(/interface\s+Soc2Observation/)
    expect(source).not.toMatch(/interface\s+Soc2CustomerEvidence/)
  })
})
