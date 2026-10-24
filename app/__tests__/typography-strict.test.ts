import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// Pages already on the app type scale (typography plan T1) may not drift back: every size and weight comes
// from the role tokens (text-title ... text-label), and text colours are the ink tokens or pass AA on their
// own surface. The full guard for every app file is its own PR (TG); this covers the files moved so far.
// dark: variants are exempt (dark mode is not wired up; typography plan Q3).
const STRICT = [
  'app/(app)/connect-aws/page.tsx',
  'components/dashboard/dashboard-unconnected-preview.tsx',
  'components/ui/typography.tsx',
]

const V = '(?<![\\w:-])(?:(?!dark:)[\\w-]+:)*'
const RULES: Record<string, RegExp> = {
  'Tailwind size scale (use a role token)': new RegExp(`${V}text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\\w-])`, 'g'),
  'arbitrary font size': new RegExp(`${V}text-\\[(?:\\d|\\.\\d|calc|clamp|length:)[^\\]]*\\]`, 'g'),
  'bold weight (roles carry 600)': new RegExp(`${V}font-(?:bold|extrabold|black)(?![\\w-])`, 'g'),
  'inline font style': /\bfont(?:Size|Family|Weight)\s*:/g,
  'text colour below AA on light surfaces': new RegExp(
    `${V}text-(?:(?:slate|gray|zinc|neutral|stone)-(?:50|100|200|300|400|500)|(?:green|emerald|teal|cyan|lime|amber|yellow|orange)-(?:300|400|500|600)|(?:red|blue|sky|rose|pink)-(?:300|400|500)|red-600)(?:\\/\\d+)?(?![\\w-])`,
    'g'
  ),
  'arbitrary text colour': new RegExp(`${V}text-\\[(?:#|rgb|hsl|oklch|color:)[^\\]]*\\]`, 'g'),
  'opacity on content': new RegExp(`${V}opacity-\\d+(?![\\w-])`, 'g'),
}

/** Reviewed exceptions: each names the exact class, why it is fine, and must still occur (no stale entries). */
const ALLOWED: { file: string; match: string; rule: string; reason: string }[] = [
  {
    file: 'app/(app)/connect-aws/page.tsx',
    match: 'text-slate-200',
    rule: 'text colour below AA on light surfaces',
    reason: 'Light text on the dark code block: the trust policy sits on bg-slate-900, well above 4.5:1.',
  },
  {
    file: 'components/dashboard/dashboard-unconnected-preview.tsx',
    match: 'text-[#D6D3E8]',
    rule: 'arbitrary text colour',
    reason: 'The band is dark in both themes (#1A1730); dashboard-unconnected-preview.test.tsx checks this line is at least 4.5:1 on it.',
  },
  {
    file: 'components/dashboard/dashboard-unconnected-preview.tsx',
    match: 'text-[#1A1730]',
    rule: 'arbitrary text colour',
    reason: "The band's white button: dark text on white, checked in dashboard-unconnected-preview.test.tsx.",
  },
]

function findings(file: string): { rule: string; match: string; line: number }[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8')
  const out: { rule: string; match: string; line: number }[] = []
  for (const [rule, re] of Object.entries(RULES)) {
    for (const m of source.matchAll(re)) {
      out.push({ rule, match: m[0].replace(/^.*:(?=text-|font-|opacity-)/, ''), line: source.slice(0, m.index).split('\n').length })
    }
  }
  return out
}

describe('strict typography for the pages on the app type scale', () => {
  it('the rules catch each kind of drift (self-check)', () => {
    // Assembled at runtime so Tailwind's scan of this file does not generate these utilities.
    const t = 'text'
    const bad: [string, string][] = [
      [`${t}-sm`, 'Tailwind size scale (use a role token)'],
      [`md:${t}-2xl`, 'Tailwind size scale (use a role token)'],
      [`${t}-[13px]`, 'arbitrary font size'],
      [`${t}-[0.75rem]`, 'arbitrary font size'],
      ['font-bold', 'bold weight (roles carry 600)'],
      ['style={{ fontSize: 12 }}', 'inline font style'],
      [`${t}-slate-500`, 'text colour below AA on light surfaces'],
      [`hover:${t}-gray-400`, 'text colour below AA on light surfaces'],
      [`${t}-green-600`, 'text colour below AA on light surfaces'],
      [`${t}-red-600`, 'text colour below AA on light surfaces'],
      [`${t}-[#047857]`, 'arbitrary text colour'],
      ['opacity-70', 'opacity on content'],
    ]
    for (const [cls, rule] of bad) {
      const re = new RegExp(RULES[rule].source)
      expect(`className="${cls}"`, `${cls} -> ${rule}`).toMatch(re)
    }
    const fine = [`${t}-ui`, `${t}-ink-muted`, `${t}-slate-600`, `${t}-green-700`, `${t}-[var(--text-accent)]`, `dark:${t}-slate-400`, 'font-semibold', 'disabled:cursor-not-allowed']
    for (const cls of fine) {
      for (const [rule, re] of Object.entries(RULES)) expect(`className="${cls}"`, `${cls} vs ${rule}`).not.toMatch(new RegExp(re.source))
    }
  })

  it.each(STRICT)('%s has no drift outside the reviewed exceptions', (file) => {
    const unexpected = findings(file).filter((f) => !ALLOWED.some((a) => a.file === file && a.match === f.match && a.rule === f.rule))
    expect(unexpected.map((f) => `${file}:${f.line} ${f.match} (${f.rule})`)).toEqual([])
  })

  it('every exception still occurs (stale entries fail) and gives a reason', () => {
    for (const entry of ALLOWED) {
      expect(STRICT, entry.file).toContain(entry.file)
      expect(entry.reason.length, entry.match).toBeGreaterThan(20)
      expect(findings(entry.file).some((f) => f.match === entry.match && f.rule === entry.rule), `${entry.file}: ${entry.match}`).toBe(true)
    }
  })
})
