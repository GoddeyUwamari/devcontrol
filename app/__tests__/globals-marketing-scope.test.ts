import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// app/globals.css styles the marketing and sign-in pages as well as the app. The app-only
// typography work adds CSS in exactly one delimited block at the end of the file; everything
// else -- including the custom purple @theme at the top -- must stay byte-identical to
// __fixtures__/globals.baseline.css (app/globals.css before that work). Updating the baseline
// needs founder sign-off in the PR.
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
const baseline = readFileSync(join(process.cwd(), 'app/__tests__/__fixtures__/globals.baseline.css'), 'utf8')

const BLOCK_START = '/* === APP SURFACE (typography plan) === */'
const BLOCK_END = '/* === END APP SURFACE === */'

/** app/globals.css split into the delimited app block (or null) and everything outside it. */
function splitAppBlock(source: string): { block: string | null; rest: string } {
  const start = source.indexOf(BLOCK_START)
  const end = source.indexOf(BLOCK_END)
  if (start === -1 && end === -1) return { block: null, rest: source }
  expect(start, 'block start marker').toBeGreaterThan(-1)
  expect(end, 'block end marker after the start marker').toBeGreaterThan(start)
  expect(source.indexOf(BLOCK_START, start + 1), 'one block start marker').toBe(-1)
  expect(source.indexOf(BLOCK_END, end + 1), 'one block end marker').toBe(-1)
  const after = end + BLOCK_END.length
  // The block is appended: a blank line before it, a newline after it, nothing else.
  expect(source.slice(after), 'nothing after the block').toBe('\n')
  expect(source.slice(start - 1, start), 'blank line before the block').toBe('\n')
  return { block: source.slice(start, after), rest: source.slice(0, start - 1) }
}

describe('app/globals.css outside the app block', () => {
  it('is byte-identical to the baseline (marketing and sign-in styles unchanged)', () => {
    expect(splitAppBlock(css).rest).toBe(baseline)
  })

  it('the baseline still contains the existing custom @theme block', () => {
    expect(baseline).toMatch(/\n@theme \{\n  --color-purple-50: #faf5ff;[\s\S]*?--color-purple-900: #581c87;\n\}\n/)
  })
})
