import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// Pages and components already on the app type scale (typography plan T1, T2b, T2c) may not drift back: every size and weight comes
// from the role tokens (text-title ... text-label), and text colours are the ink tokens or pass AA on their
// own surface. The full guard for every app file is its own PR (TG); this covers the files moved so far.
// Variants count, bracketed ones included ([&_p]:, data-[state=open]:, group-[.x]:); dark: variants are
// exempt (dark mode is not wired up; typography plan Q3). Inline style colours and sizes count too.
const STRICT = [
  'app/(app)/connect-aws/page.tsx',
  'components/dashboard/dashboard-unconnected-preview.tsx',
  'components/ui/typography.tsx',
  // T2b: the shared components.
  'components/ui/alert-dialog.tsx',
  'components/ui/alert.tsx',
  'components/ui/badge.tsx',
  'components/ui/button.tsx',
  'components/ui/card.tsx',
  'components/ui/command.tsx',
  'components/ui/dialog.tsx',
  'components/ui/dropdown-menu.tsx',
  'components/ui/empty-state.tsx',
  'components/ui/error-display.tsx',
  'components/ui/form.tsx',
  'components/ui/input.tsx',
  'components/ui/label.tsx',
  'components/ui/select.tsx',
  'components/ui/severity-badge.tsx',
  'components/ui/table.tsx',
  'components/ui/tabs.tsx',
  'components/ui/textarea.tsx',
  'components/ui/tooltip.tsx',
  // T2c: the app shell.
  'app/(app)/layout.tsx',
  'components/ConnectionIndicator.tsx',
  'components/ai/AIChatWidget.tsx',
  'components/command-palette.tsx',
  'components/demo/DemoBanner.tsx',
  'components/error-boundary.tsx',
  'components/layout/top-nav.tsx',
  'components/navigation/back-button.tsx',
  'components/navigation/breadcrumb.tsx',
  'components/onboarding/welcome-modal.tsx',
  'components/ui/breadcrumb.tsx',
  'components/ui/user-dropdown.tsx',
]

// Any chain of variants except dark:, including arbitrary ones: md:, hover:, [&_p]:, data-[state=open]:.
const VARIANT = '(?:[\\w-]+(?:-\\[[^\\]\\s]*\\])?|\\[[^\\]\\s]*\\])'
const V = `(?<![\\w:\\]-])(?:(?!dark:)${VARIANT}:)*`
const RULES: Record<string, RegExp> = {
  'Tailwind size scale (use a role token)': new RegExp(`${V}text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\\w-])`, 'g'),
  'arbitrary font size': new RegExp(`${V}text-\\[(?:\\d|\\.\\d|calc|clamp|length:)[^\\]]*\\]`, 'g'),
  'bold weight (roles carry 600)': new RegExp(`${V}font-(?:bold|extrabold|black)(?![\\w-])`, 'g'),
  'arbitrary text property': new RegExp(`${V}\\[(?:font-size|font-weight|font-family|line-height|letter-spacing|color|opacity|-webkit-text-fill-color):[^\\]]*\\]`, 'g'),
  'inline text style': /(?<![\w[-])(?:fontSize|fontFamily|fontWeight|lineHeight|letterSpacing|color|opacity|WebkitTextFillColor)\s*:\s*(?:'[^']*'|"[^"]*"|`[^`]*`|[\w.$]+(?:\([^)]*\))?)/g,
  'text colour below AA on light surfaces': new RegExp(
    `${V}text-(?:(?:slate|gray|zinc|neutral|stone)-(?:50|100|200|300|400|500)|(?:green|emerald|teal|cyan|lime|amber|yellow|orange)-(?:300|400|500|600)|(?:red|blue|sky|rose|pink)-(?:300|400|500)|red-600)(?:\\/\\d+)?(?![\\w-])`,
    'g'
  ),
  'arbitrary text colour': new RegExp(`${V}text-\\[(?:#|rgb|hsl|oklch|color:)[^\\]]*\\]`, 'g'),
  'opacity on content': new RegExp(`${V}opacity-\\d+(?![\\w-])`, 'g'),
}

/**
 * Reviewed exceptions: each names the exact class or style, how many times it may occur (an extra
 * occurrence fails, and so does a missing one), and why it is fine. `variant` is the exact variant chain
 * the class carries (for example 'disabled:'); without one, only the bare class is allowed.
 */
const ALLOWED: { file: string; match: string; variant?: string; rule: string; count: number; reason: string }[] = [
  {
    file: 'app/(app)/connect-aws/page.tsx',
    match: 'text-slate-200',
    rule: 'text colour below AA on light surfaces',
    count: 1,
    reason: 'Light text on the dark code block: the trust policy sits on bg-slate-900, well above 4.5:1.',
  },
  {
    file: 'components/dashboard/dashboard-unconnected-preview.tsx',
    match: 'text-[#D6D3E8]',
    rule: 'arbitrary text colour',
    count: 1,
    reason: 'The band is dark in both themes (#1A1730); dashboard-unconnected-preview.test.tsx checks this line is at least 4.5:1 on it.',
  },
  {
    file: 'components/dashboard/dashboard-unconnected-preview.tsx',
    match: 'text-[#1A1730]',
    rule: 'arbitrary text colour',
    count: 1,
    reason: "The band's white button: dark text on white, checked in dashboard-unconnected-preview.test.tsx.",
  },
  {
    file: 'components/dashboard/dashboard-unconnected-preview.tsx',
    match: "color: 'var(--text-accent)'",
    rule: 'inline text style',
    count: 4,
    reason: 'The accent token on its own tint (card tags, the sample tag, the sample total, step numbers); dashboard-unconnected-preview.test.tsx checks 4.5:1 on --bg-accent in light and dark.',
  },
  {
    file: 'components/dashboard/dashboard-unconnected-preview.tsx',
    match: "color: 'var(--text-success)'",
    rule: 'inline text style',
    count: 1,
    reason: 'The aria-hidden check icon in each card line: a decorative icon, not text (green-700 in the app).',
  },
  // T2b: the shared components (reviewed exceptions, typography plan T2b).
  { file: 'components/ui/button.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/input.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/input.tsx', match: 'text-sm', variant: 'file:', rule: 'Tailwind size scale (use a role token)', count: 1, reason: "The native file-picker button's label (file:), 14 px like the field; left as it is by founder decision (no visible change)." },
  { file: 'components/ui/textarea.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/select.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/select.tsx', match: 'opacity-50', variant: 'data-[disabled]:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/select.tsx', match: 'opacity-50', rule: 'opacity on content', count: 1, reason: "The trigger's decorative chevron icon (an svg, not text); founder decision: kept, no visible change." },
  { file: 'components/ui/label.tsx', match: 'opacity-50', variant: 'group-data-[disabled=true]:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/label.tsx', match: 'opacity-50', variant: 'peer-disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/tabs.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/dropdown-menu.tsx', match: 'opacity-50', variant: 'data-[disabled]:', rule: 'opacity on content', count: 3, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24). Item, checkbox item and radio item.' },
  { file: 'components/ui/command.tsx', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/command.tsx', match: 'opacity-50', variant: 'data-[disabled=true]:', rule: 'opacity on content', count: 1, reason: 'Disabled-state dimming, kept until the solid disabled style lands in its own PR after T2 (founder decision, Oct 24).' },
  { file: 'components/ui/command.tsx', match: 'opacity-50', rule: 'opacity on content', count: 1, reason: "The input's decorative search icon (an svg, not text); founder decision: kept, no visible change." },
  { file: 'components/ui/dialog.tsx', match: 'opacity-70', rule: 'opacity on content', count: 1, reason: "The close button, whose only visible content is the X icon (its name is sr-only text); founder decision: kept, no visible change." },
  { file: 'components/ui/dialog.tsx', match: 'opacity-100', variant: 'hover:', rule: 'opacity on content', count: 1, reason: "The same close button at full opacity on hover; founder decision: kept, no visible change." },
  { file: 'components/ui/error-display.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 2, reason: 'The aria-hidden error icon on its red-50 tint (server/auth/permission and default schemes): an icon, not text; founder decision: kept.' },
  { file: 'components/ui/error-display.tsx', match: 'text-orange-600', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The aria-hidden error icon on its orange-50 tint (network/timeout/offline): an icon, not text; founder decision: kept.' },
  // T2c: the app shell (reviewed exceptions, typography plan T2c).
  { file: 'components/layout/top-nav.tsx', match: 'text-xl', rule: 'Tailwind size scale (use a role token)', count: 2, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Desktop: the DC monogram and the DevControl wordmark.' },
  { file: 'components/layout/top-nav.tsx', match: 'font-bold', rule: 'bold weight (roles carry 600)', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Desktop: the DC monogram.' },
  { file: 'components/layout/top-nav.tsx', match: 'fontWeight: 700', rule: 'inline text style', count: 3, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar wordmark, phone bar monogram, and the DevControl name heading the phone drawer.' },
  { file: 'components/layout/top-nav.tsx', match: "fontSize: '1.2rem'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar wordmark.' },
  { file: 'components/layout/top-nav.tsx', match: "color: '#1e1b4b'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar wordmark (indigo-black on white, 16:1).' },
  { file: 'components/layout/top-nav.tsx', match: "letterSpacing: '-0.01em'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar wordmark.' },
  { file: 'components/layout/top-nav.tsx', match: "color: '#fff'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar monogram: white on its blue-to-indigo gradient tile.' },
  { file: 'components/layout/top-nav.tsx', match: "fontSize: '13px'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). Phone bar monogram.' },
  { file: 'components/layout/top-nav.tsx', match: "fontSize: '1rem'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). The DevControl name heading the phone drawer.' },
  { file: 'components/layout/top-nav.tsx', match: "color: '#0F172A'", rule: 'inline text style', count: 1, reason: 'Brand mark: the DevControl wordmark and the DC monogram stay exactly as they are (founder decision on the T2 plan, Oct 24). The DevControl name heading the phone drawer (slate-900).' },
  { file: 'components/layout/top-nav.tsx', match: "color: '#94A3B8'", rule: 'inline text style', count: 1, reason: "The drawer sections' decorative chevron icon (an svg, not text); kept, no visible change (typography plan T2c)." },
  { file: 'components/layout/top-nav.tsx', match: 'text-base', rule: 'Tailwind size scale (use a role token)', count: 2, reason: 'Top-level nav labels 16 px, founder decision Oct 26: the desktop top-level links and dropdown triggers (16/24, the size before #254). Menu items stay text-ui, descriptions text-meta.' },
  { file: 'components/ui/breadcrumb.tsx', match: 'text-gray-400', rule: 'text colour below AA on light surfaces', count: 1, reason: 'The decorative chevron icon between steps (an svg, not text); kept, no visible change (typography plan T2c).' },
  { file: 'components/error-boundary.tsx', match: 'text-red-600', rule: 'text colour below AA on light surfaces', count: 1, reason: "The fallback's alert icon on its red-100 circle: an icon, not text; kept like the error-display icons (typography plan T2b, T2c)." },
]

type Finding = { rule: string; match: string; variant: string; line: number }

function findingsIn(source: string): Finding[] {
  const out: Finding[] = []
  for (const [rule, re] of Object.entries(RULES)) {
    for (const m of source.matchAll(re)) {
      // Classes are reported without their variants, which are kept apart; inline styles with their spacing
      // normalised.
      const variant = rule === 'inline text style' ? '' : (m[0].match(new RegExp(`^(?:${VARIANT}:)+`))?.[0] ?? '')
      const match = rule === 'inline text style' ? m[0].replace(/\s+/g, ' ') : m[0].slice(variant.length)
      out.push({ rule, match, variant, line: source.slice(0, m.index).split('\n').length })
    }
  }
  return out
}

const findings = (file: string) => findingsIn(readFileSync(join(process.cwd(), file), 'utf8'))
const covers = (entry: (typeof ALLOWED)[number], f: Finding) =>
  entry.match === f.match && entry.rule === f.rule && (entry.variant ?? '') === f.variant

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
      ['style={{ fontSize: 12 }}', 'inline text style'],
      ["style={{ color: '#94A3B8' }}", 'inline text style'],
      ["style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}", 'inline text style'],
      ['style={{ lineHeight: 1.1 }}', 'inline text style'],
      [`[&_p]:${t}-sm`, 'Tailwind size scale (use a role token)'],
      [`data-[state=open]:${t}-xs`, 'Tailwind size scale (use a role token)'],
      [`[&_span]:${t}-[13px]`, 'arbitrary font size'],
      [['group-[.is-x]', 'font-bold'].join(':'), 'bold weight (roles carry 600)'],
      [`[&>p]:${t}-slate-400`, 'text colour below AA on light surfaces'],
      [['[font-size', '12px]'].join(':'), 'arbitrary text property'],
      [['md:[color', '#999]'].join(':'), 'arbitrary text property'],
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
    const fine = [`${t}-ui`, `${t}-ink-muted`, `${t}-slate-600`, `${t}-green-700`, `${t}-[var(--text-accent)]`, `dark:${t}-slate-400`, `[&_p]:${t}-ui`, 'font-semibold', 'disabled:cursor-not-allowed', "style={{ background: 'var(--bg-accent)' }}"]
    for (const cls of fine) {
      for (const [rule, re] of Object.entries(RULES)) expect(`className="${cls}"`, `${cls} vs ${rule}`).not.toMatch(new RegExp(re.source))
    }
  })

  it.each(STRICT)('%s has no drift outside the reviewed exceptions', (file) => {
    const all = findings(file)
    const unexpected = all.filter((f) => !ALLOWED.some((a) => a.file === file && covers(a, f)))
    expect(unexpected.map((f) => `${file}:${f.line} ${f.variant}${f.match} (${f.rule})`)).toEqual([])
    // An allowed class or style may occur exactly as often as reviewed: one more is drift too.
    for (const entry of ALLOWED.filter((a) => a.file === file)) {
      const found = all.filter((f) => covers(entry, f))
      expect(found.map((f) => `${file}:${f.line} ${f.variant}${f.match}`), `${entry.variant ?? ''}${entry.match} may occur ${entry.count}x`).toHaveLength(entry.count)
    }
  })

  it('an exception covers only its own variant chain (self-check)', () => {
    const entry = { file: 'x', match: 'opacity-50', variant: 'disabled:', rule: 'opacity on content', count: 1, reason: '' }
    const [disabled, bare, hover] = findingsIn('className="disabled:opacity-50 opacity-50 hover:opacity-50"')
    expect([disabled.variant, bare.variant, hover.variant]).toEqual(['disabled:', '', 'hover:'])
    expect([covers(entry, disabled), covers(entry, bare), covers(entry, hover)]).toEqual([true, false, false])
    expect(covers({ ...entry, variant: undefined }, bare)).toBe(true)
    expect(covers({ ...entry, variant: undefined }, disabled)).toBe(false)
  })

  it('every exception names a strict file, a count of at least 1 and a reason', () => {
    for (const entry of ALLOWED) {
      expect(STRICT, entry.file).toContain(entry.file)
      expect(entry.count, entry.match).toBeGreaterThanOrEqual(1)
      expect(entry.reason.length, entry.match).toBeGreaterThan(20)
    }
  })
})
