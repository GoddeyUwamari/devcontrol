/**
 * Focused coverage for the Cost Intelligence IA cleanup's /costs/efficiency
 * fix: "Pending efficiency analysis" implied a temporary, in-progress state
 * for every real running resource, when per-resource efficiency analysis
 * was never implemented at all (deriveEfficiencyScore() is a cost-tier
 * heuristic, not real utilization data -- confirmed by this file's own
 * comments). The copy now says so honestly instead of implying it's merely
 * pending.
 *
 * Same rationale as the Dashboard test in this PR: this page is wired to
 * several hooks/services, so this reads the source directly as a structural/
 * copy regression guard rather than rendering the full component.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')

describe('/costs/efficiency misleading-copy fix', () => {
  it('no longer claims analysis is "pending" for resources that were never analyzed', () => {
    expect(source).not.toMatch(/Pending efficiency analysis/)
  })

  it('honestly states efficiency analysis is not available', () => {
    expect(source).toMatch(/Efficiency analysis not available/)
  })

  it('the genuinely-different "resource not running" case is unchanged', () => {
    expect(source).toMatch(/Resource not running/)
  })

  it('does not fabricate a savings figure for the unanalyzed case (savings stays null)', () => {
    expect(source).toMatch(/savings:\s*null as number \| null/)
  })

  it('the underlying efficiency heuristic is untouched (still documented as a heuristic, not real utilization data)', () => {
    expect(source).toMatch(/deriveEfficiencyScore\(\) is a cost-tier heuristic, not a real utilization metric/)
  })
})
