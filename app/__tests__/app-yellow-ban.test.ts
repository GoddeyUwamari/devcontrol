import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { APP_CLOSURE, NON_APP_CLOSURE, SOURCE_FILES } from './surface-scope'

// app/globals.css (frozen part) forces some yellow classes to white or grey with !important -- bg 50-500,
// text 500-800, border 300-500 -- and leaves the rest, and every variant, really yellow. So a yellow class
// silently renders as something else, or not, depending on its shade. The app uses none: warning text and
// surfaces use the ink-warning tokens and amber (typography plan T1). Marketing and sign-in pages keep
// theirs (the override still applies there), as does code nothing imports.
//
// Files shared by the app and the marketing or sign-in pages (in both import closures, e.g. lib/utils.ts)
// are skipped on purpose: whatever they render also appears on marketing and sign-in pages, which T1 must
// leave exactly as they are, so a yellow class there is a marketing decision, not an app one. None of them
// uses a yellow class today.
const YELLOW = /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|decoration|placeholder|caret|accent|shadow)-yellow-\d{2,3}(?:\/\d+)?(?![\w-])/

const APP_ONLY = (file: string) => APP_CLOSURE.has(file) && !NON_APP_CLOSURE.has(file)

describe('no yellow utility classes in app code', () => {
  it('the pattern catches each kind of use (self-check)', () => {
    // Assembled at runtime so Tailwind's scan of this file does not generate these utilities.
    const Y = 'yellow'
    for (const use of [`text-${Y}-600`, `bg-${Y}-50`, `border-${Y}-200`, `hover:bg-${Y}-100`, `dark:text-${Y}-200`, `bg-${Y}-800/50`, `border-l-${Y}-400`, `ring-${Y}-500`]) {
      expect(`className="${use}"`, use).toMatch(YELLOW)
    }
    for (const other of ['text-amber-700', 'bg-amber-50', 'text-ink-warning', 'yellow', 'text-yellowish-500']) {
      expect(`className="${other}"`, other).not.toMatch(YELLOW)
    }
  })

  it('no app file uses one', () => {
    const offending = SOURCE_FILES.filter(APP_ONLY).flatMap((file) =>
      readFileSync(join(process.cwd(), file), 'utf8')
        .split('\n')
        .flatMap((line, i) => {
          const match = line.match(YELLOW)
          return match ? [`${file}:${i + 1}: ${match[0]}`] : []
        })
    )
    expect(offending).toEqual([])
  })
})
