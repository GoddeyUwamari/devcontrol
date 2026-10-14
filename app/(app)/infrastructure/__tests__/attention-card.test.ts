/**
 * Infrastructure's red card says why its resources are counted, from the same
 * computation that counted them. It says "critical" only when a Critical finding
 * exists, and never says there are no findings beside a count some other cause explains.
 */
import { describe, it, expect } from 'vitest'
import { describeAttentionCard } from '../attentionCard'

const findings = (critical: number, high: number, medium = 0, low = 0) => ({ critical, high, medium, low })
const reasons = (with_finding: number, with_cost_recommendation = 0, stopped_or_degraded = 0, failed = 0) =>
  ({ with_finding, with_cost_recommendation, stopped_or_degraded, failed })

describe('describeAttentionCard', () => {
  it('is never titled "Critical Issues"', () => {
    expect(describeAttentionCard(4, findings(0, 3), reasons(3, 0, 1)).label).toBe('Needs Attention')
    expect(describeAttentionCard(2, findings(2, 0), reasons(2)).label).toBe('Needs Attention')
    expect(describeAttentionCard(null, undefined, undefined).label).toBe('Needs Attention')
  })

  it.each([
    [4, findings(0, 2), reasons(2, 1, 1), '2 high findings · 1 stopped or degraded · 1 cost recommendation'],
    [2, findings(0, 2, 3, 9), reasons(2), '2 high findings'],
    [1, findings(0, 1), reasons(1), '1 high finding'],
    [3, findings(1, 2), reasons(3), '1 critical finding · 2 high findings'],
    [2, findings(5, 0), reasons(2), '5 critical findings'],
    [3, findings(0, 0, 4, 2), reasons(0, 0, 2, 1), '1 failed · 2 stopped or degraded'],
    [2, findings(0, 0), reasons(0, 2), '2 cost recommendations'],
    [5, findings(1, 2), reasons(2, 1, 1, 1), '1 critical finding · 2 high findings · 1 failed · 1 stopped or degraded · 1 cost recommendation'],
  ])('%i flagged, %j, %j -> "%s"', (count, f, r, line) => {
    expect(describeAttentionCard(count, f, r).reasonLine).toBe(line)
  })

  it('a non-zero count is never beside "no findings": a resource counted through its status says so', () => {
    const card = describeAttentionCard(1, findings(0, 0, 4, 2), reasons(0, 0, 1))
    expect(card.reasonLine).toBe('1 stopped or degraded')
    expect(card.reasonLine).not.toMatch(/no .*findings/i)
  })

  it('does not name findings when no resource is counted because of one', () => {
    // High findings exist in the account, but only on resources counted for another reason... none here.
    expect(describeAttentionCard(1, findings(0, 0), reasons(0, 1)).reasonLine).toBe('1 cost recommendation')
  })

  it('does not use the word "critical" at 0 Critical', () => {
    for (const [count, f, r] of [[2, findings(0, 2), reasons(2)], [1, findings(0, 0), reasons(0, 0, 1)], [0, findings(0, 0), reasons(0)]] as const) {
      const card = describeAttentionCard(count, f, r)
      expect(`${card.label} ${card.reasonLine} ${card.action}`).not.toMatch(/critical/i)
    }
  })

  it('zero flagged: says so', () => {
    expect(describeAttentionCard(0, findings(0, 0, 3, 9), reasons(0)).reasonLine).toBe('No resources flagged')
  })

  it('a non-zero count with no cause reported is left unexplained rather than explained wrongly', () => {
    expect(describeAttentionCard(2, findings(0, 0), reasons(0)).reasonLine).toBeNull()
  })

  it('unknown counts (loading, failed, older backend) give no line rather than a guess', () => {
    expect(describeAttentionCard(null, findings(0, 2), reasons(2)).reasonLine).toBeNull()
    expect(describeAttentionCard(2, undefined, reasons(2)).reasonLine).toBeNull()
    expect(describeAttentionCard(2, findings(0, 2), undefined).reasonLine).toBeNull()
  })

  it('"Resolve now" is kept for when there is a Critical finding', () => {
    expect(describeAttentionCard(1, findings(1, 0), reasons(1)).action).toBe('Resolve now →')
    expect(describeAttentionCard(4, findings(0, 4), reasons(4)).action).toBe('Review →')
  })
})
