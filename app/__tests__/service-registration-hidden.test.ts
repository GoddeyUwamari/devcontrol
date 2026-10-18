/**
 * Service registration is hidden until its create contract works: the form
 * posts camelCase that the backend rejects, and a registered service never
 * appears in the list. Nothing in the app may link to /services/new or offer
 * to add, create or register a service, and neither the docs nor the app may
 * promise a service catalog. The backend routes are kept; only the UI entry
 * points are gone.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { navItems, mobileSections } from '@/components/layout/top-nav'
import { quickActions } from '@/lib/navigation-config'
import { parentPaths } from '@/lib/hooks/useBreadcrumbs'

const ROOT = join(__dirname, '..', '..')
const SCANNED_DIRS = ['app', 'components', 'lib', 'hooks']
// The page itself is kept for the contract fix and is unreachable: it
// redirects to /services (see services-route-redirects.test.ts).
const KEPT_PAGE = join('app', '(app)', 'services', 'new') + sep

// Marketing pages outside /docs (solutions, blog) are a separate copy pass.
const MARKETING_OUTSIDE_DOCS = (file: string) =>
  file.startsWith(join('app', '(marketing)') + sep) && !file.startsWith(join('app', '(marketing)', 'docs') + sep)

const FORBIDDEN: { name: string; pattern: RegExp; skip?: (file: string) => boolean }[] = [
  { name: 'link to /services/new', pattern: /['"`]\/services\/new\b/ },
  { name: 'add/create/register a service', pattern: /\b(add|create|register)\s+(a\s+|your\s+(first\s+)?|new\s+)?services?\b/i },
  { name: 'service catalog claim', pattern: /\bservice catalog\b/i, skip: MARKETING_OUTSIDE_DOCS },
]

const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line)

function sourceFiles(): string[] {
  return SCANNED_DIRS.flatMap((dir) =>
    (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
      .map((file) => join(dir, file))
      .filter((file) => /\.(tsx?|jsx?)$/.test(file))
      .filter((file) => !file.split(sep).includes('__tests__') && !/\.test\.[tj]sx?$/.test(file))
      .filter((file) => !file.startsWith(KEPT_PAGE))
  )
}

describe('service registration is not offered anywhere in the app', () => {
  const files = sourceFiles()

  it('scans the app source', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain(join('components', 'layout', 'top-nav.tsx'))
    expect(files).toContain(join('app', '(marketing)', 'docs', 'getting-started', 'page.tsx'))
  })

  it.each(FORBIDDEN)('no source file contains a $name', ({ pattern, skip }) => {
    const hits = files
      .filter((file) => !skip?.(file))
      .flatMap((file) =>
        readFileSync(join(ROOT, file), 'utf8')
          .split('\n')
          .flatMap((line, i) => (pattern.test(line) && !isComment(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []))
      )
    expect(hits).toEqual([])
  })

  it('the top nav and mobile drawer have no /services/new entry', () => {
    const hrefs = [...navItems.flatMap((item) => item.children ?? [item]), ...mobileSections.flatMap((s) => s.items)]
      .map((item) => item.href)
    expect(hrefs).toContain('/services')
    expect(hrefs).not.toContain('/services/new')
  })

  it('the "+ New" menu has no Create Service action', () => {
    expect(quickActions.map((a) => a.label)).not.toContain('Create Service')
    expect(quickActions.map((a) => a.href)).not.toContain('/services/new')
    expect(quickActions.length).toBeGreaterThan(0)
  })

  it('the breadcrumb registry has no /services/new entry', () => {
    expect(parentPaths['/services/new']).toBeUndefined()
  })
})
