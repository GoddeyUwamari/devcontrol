/**
 * The command palette's Ask AI examples must be questions Ask AI actually
 * answers since PR #137: alerts are not_supported, and "expensive" has no
 * stated cost bound. Source-reading guard (same convention as
 * app/(app)/cost-optimization/__tests__/page-terminology-and-wiring.test.ts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '../command-palette.tsx'), 'utf-8')

describe('command palette Ask AI examples', () => {
  it('no longer suggests unsupported questions', () => {
    expect(source).not.toMatch(/show expensive EC2/i)
    expect(source).not.toMatch(/critical alerts today/i)
  })

  it('suggests supported questions', () => {
    expect(source).toContain('Try: "stopped EC2 instances" · "what is my AWS spend this month"')
  })
})
