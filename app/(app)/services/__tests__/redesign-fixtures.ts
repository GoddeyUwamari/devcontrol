/**
 * Fixtures for the Services redesign tests (PR 3b): the real `multi_region`
 * examples of docs/SERVICES_COVERAGE_MULTI_REGION.md (each one is a recorded
 * route answer, compared with the route by the backend examples test), read
 * from the doc at test time, and small builders on top of them. Synthetic
 * data only.
 */
import * as fs from 'fs'
import * as path from 'path'

const DOC = path.join(process.cwd(), 'docs', 'SERVICES_COVERAGE_MULTI_REGION.md')

/** Every `<!-- example: name -->` block of the doc, parsed. */
export function docExamples(): Record<string, any> {
  const text = fs.readFileSync(DOC, 'utf8')
  const out: Record<string, any> = {}
  for (const m of text.matchAll(/<!-- example: (\w+) -->\n```json\n([\s\S]*?)\n```/g)) out[m[1]] = JSON.parse(m[2])
  return out
}

/** One doc example, deep-copied so a test can change it. */
export function docExample(name: string): any {
  const ex = docExamples()[name]
  if (!ex) throw new Error(`no doc example ${name}`)
  return structuredClone(ex)
}
