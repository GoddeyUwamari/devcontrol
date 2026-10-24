// @vitest-environment node
import { readFileSync } from 'fs'
import { join } from 'path'
import { twMerge } from 'tailwind-merge'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { NON_APP_CLOSURE } from './surface-scope'

// lib/utils.ts is shared with the marketing and sign-in pages (components/marketing-ui imports cn from it),
// and cn() now knows the app's type roles (a recorded exception to the typography plan's R3.6). This proves
// the change cannot alter a marketing or sign-in page: for every file those pages reach, every pair of
// class-like words in that file's strings merges exactly as stock tailwind-merge merges it.

/** Every whitespace-separated word in a file's string literals and template chunks that could be a class. */
function classWords(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(join(process.cwd(), file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const words = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const word of node.text.split(/\s+/)) if (/^[!-]?[a-z][\w[\]:&>*@./#%(),=+'"-]*$/i.test(word) && word.length < 100) words.add(word)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...words]
}

const FILES = [...NON_APP_CLOSURE].filter((file) => /\.[jt]sx?$/.test(file)).sort()

describe('cn() merges marketing and sign-in classes exactly as before', () => {
  it('compares two different mergers (self-check)', () => {
    expect(cn('text-ui text-ink-muted')).not.toBe(twMerge('text-ui text-ink-muted'))
    expect(FILES).toContain('components/marketing-ui/button.tsx')
    expect(FILES).toContain('app/(marketing)/page.tsx')
    expect(FILES).toContain('app/(auth)/login/page.tsx')
  })

  it('every pair of class words in each marketing and sign-in file', () => {
    const differences: string[] = []
    let pairs = 0
    for (const file of FILES) {
      const words = classWords(file)
      for (const a of words) {
        for (const b of words) {
          if (a === b) continue
          pairs++
          const merged = cn(a, b)
          const stock = twMerge(`${a} ${b}`)
          if (merged !== stock && differences.length < 20) differences.push(`${file}: "${a} ${b}" -> ${merged} (stock: ${stock})`)
        }
      }
    }
    expect(differences).toEqual([])
    expect(pairs).toBeGreaterThan(100_000)
  }, 180_000)
})
