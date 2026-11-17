/**
 * Static checks for the Services redesign (PR 3b, pr3-step1.md §I.2, §I.7):
 * - no AWS region literal anywhere in app/(app)/services outside tests (the
 *   browser never holds a region list; regions come from the API), with the
 *   UNANCHORED pattern ['"`][a-z]{2}-[a-z]+-\d['"`];
 * - the redesign's new components use theme tokens: no fixed light surface
 *   (bg-white) and no slate/gray text outside a dark: variant;
 * - no browser storage for page state; one Coming soon element in the
 *   redesign's components.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.join(process.cwd(), 'app', '(app)', 'services')
const REGION_LITERAL = /['"`][a-z]{2}-[a-z]+-\d['"`]/g

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...sourceFiles(full))
    } else {
      out.push(full)
    }
  }
  return out
}
const rel = (f: string) => path.relative(process.cwd(), f)

const REDESIGN_FILES = ['RedesignHeader.tsx', 'ScanBanner.tsx', 'RegionCoverageCard.tsx', 'UnknownOwnerTip.tsx', 'NotCheckedLine.tsx', 'redesignTone.ts', 'redesignModel.ts', 'servicesRedesignFlag.ts']
  .map((f) => path.join(ROOT, f))

describe('no AWS region literal in app/(app)/services (outside tests)', () => {
  it('the pattern catches each quoting, anywhere in a line (self-check)', () => {
    const r = ['us', 'east', '1'].join('-')
    for (const s of [`const a = '${r}'`, `x("${r}")`, `\`${r}\``, `{ region: '${r}', n: 1 }`, `// see '${r}'`]) expect(s.match(REGION_LITERAL), s).not.toBeNull()
    for (const s of [r, `region ${r}`, "'global'", "'cloudfront'"]) expect(s.match(REGION_LITERAL), s).toBeNull()
  })

  it('every file in the folder (pages, components, models, the redesign) has none', () => {
    const files = sourceFiles(ROOT)
    expect(files.length).toBeGreaterThan(30)
    for (const f of REDESIGN_FILES) expect(files).toContain(f)
    const hits = files.flatMap((f) => (fs.readFileSync(f, 'utf8').match(REGION_LITERAL) ?? []).map((m) => `${rel(f)}: ${m}`))
    expect(hits).toEqual([])
  })
})

describe("the redesign's new components use tokens (dark mode)", () => {
  const FIXED_LIGHT = /(?<![\w:-])(?:bg-white|text-(?:slate|gray|zinc|neutral)-\d{2,3})(?![\w-])/g

  it('the pattern catches a bare class and lets a dark: variant through (self-check)', () => {
    expect('className="bg-white p-2"'.match(FIXED_LIGHT)).not.toBeNull()
    expect('className="text-slate-600"'.match(FIXED_LIGHT)).not.toBeNull()
    expect('className="dark:text-slate-400"'.match(FIXED_LIGHT)).toBeNull()
    expect('className="text-ink-muted"'.match(FIXED_LIGHT)).toBeNull()
  })

  it.each(REDESIGN_FILES.map((f) => [rel(f), f]))('%s', (_name, file) => {
    expect(fs.readFileSync(file, 'utf8').match(FIXED_LIGHT) ?? []).toEqual([])
  })
})

describe('no browser storage; one Coming soon', () => {
  it('no localStorage / sessionStorage / indexedDB in the Services folder', () => {
    const hits = sourceFiles(ROOT).filter((f) => /localStorage|sessionStorage|indexedDB/.test(fs.readFileSync(f, 'utf8')))
    expect(hits.map(rel)).toEqual([])
  })

  it('the redesign components render no ComingSoonTag; YourServices renders the V2-60 line once', () => {
    for (const f of REDESIGN_FILES) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/ComingSoonTag|Coming soon/)
    const ys = fs.readFileSync(path.join(ROOT, 'YourServices.tsx'), 'utf8')
    expect(ys.match(/data-testid="coming-soon-line"/g)).toHaveLength(1)
  })
})
