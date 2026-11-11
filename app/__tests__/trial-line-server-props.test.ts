/**
 * Server pages may render the CAT-1 trial components (client components), but
 * only with plain-data props: a function prop fails `next build` while
 * prerendering ("Functions cannot be passed directly to Client Components",
 * /solutions/platform-engineering, PR #316). This scans every app/ and
 * components/ file that is NOT a client component and renders <TrialCta>,
 * <TrialLine>, <InAppTrialLine> or <FoundingBanner>, and fails on an arrow
 * function, a `function` expression or a `render` prop inside those tags.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '..', '..')
const TAG = /<(TrialCta|TrialLine|InAppTrialLine|FoundingBanner)\b[\s\S]*?\/>/g

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) return []
    return statSync(full).isDirectory() ? files(full) : /\.tsx$/.test(name) ? [full] : []
  })
}

const isClient = (src: string) => /^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*['"]use client['"]/.test(src)

const serverFilesWithTrial = [...files(join(ROOT, 'app')), ...files(join(ROOT, 'components'))]
  .map((f) => ({ file: relative(ROOT, f), src: readFileSync(f, 'utf8') }))
  .filter(({ src }) => !isClient(src) && new RegExp(TAG.source).test(src))

describe('server components pass only plain data to the trial components', () => {
  it('finds the server pages that render them (the scan is not vacuous)', () => {
    expect(serverFilesWithTrial.map((f) => f.file)).toContain('app/(marketing)/solutions/platform-engineering/page.tsx')
  })

  it.each(serverFilesWithTrial.map((f) => [f.file, f.src] as const))('%s', (_file, src) => {
    for (const tag of src.match(TAG) ?? []) {
      expect(tag, tag).not.toMatch(/=>|\bfunction\b|\brender\s*=/)
    }
  })
})
