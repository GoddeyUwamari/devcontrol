import { createHash } from 'crypto'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { APP_CLOSURE, NON_APP_CLOSURE, ROOT, SOURCE_FILES, importsOf } from './surface-scope'

// The marketing and sign-in pages use frozen copies of the shared components in
// components/marketing-ui, so the app's components/ui can be restyled without changing them
// (typography plan R3.2). The copies were taken byte for byte from components/ui; changing one
// changes a marketing or sign-in page and needs founder sign-off in the PR.
const FROZEN: Record<string, string> = {
  'alert.tsx': '49d8311589b810b106aada8ef7b13f70b2b1f68cfce4e1458b7f31a191f420e9',
  'badge.tsx': 'e7455feb113b38c59456ba29a9ec264b5ffa1daae8883866332ad637ffd57c31',
  'button.tsx': 'dba7b9bf4c928d33a56c05b8abb0fcfb21ee56d1cb02fbc8d1b6d9154b500e34',
  'card.tsx': '8a9277d879fbcbfc9fb5bafcd2ebcaa64894ef99161e444ec7e1afc9c01731a5',
  'checkbox.tsx': 'd2634970f38b9c766965ec1298ece33b6a0cd70d3bbf04b24a86cc7993a230bb',
  'input.tsx': '811a15c1a825fe8723729628dc2feb9212d05af8f80fdbb79a5e618093bf4119',
  'label.tsx': '9ec42c8a57e82311118b794318409ee02b2cebfa49ba6cce8457cff6448cd471',
}

// components/ui files the marketing and sign-in pages may still use: only ones the app does not
// use, so restyling the app cannot reach them.
const NON_APP_UI_ALLOWED = ['components/ui/accordion.tsx']

// Files both surfaces reach (reviewed): none renders markup except site-analytics, which renders
// only the analytics script. A new shared component would let an app change reach marketing.
const SHARED_REVIEWED = [
  'components/analytics/site-analytics.tsx',
  'lib/api.ts',
  'lib/contexts/auth-context.tsx',
  'lib/gtag.ts',
  'lib/login-redirect.ts',
  'lib/org-scoped-cache.ts',
  'lib/pending-invitation.ts',
  'lib/query-client.ts',
  'lib/safe-log.ts',
  'lib/safe-return-path.ts',
  'lib/services/auth.service.ts',
  'lib/services/organizations.service.ts',
  'lib/types.ts',
  'lib/utils.ts',
  'types/billing.ts',
]

const sha256 = (file: string) => createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex')
const isMarketingUi = (file: string) => file.startsWith('components/marketing-ui/')

describe('components/marketing-ui is frozen', () => {
  it('holds exactly the seven frozen copies', () => {
    expect(readdirSync(join(ROOT, 'components/marketing-ui')).sort()).toEqual(Object.keys(FROZEN).sort())
  })

  it.each(Object.entries(FROZEN))('%s matches its recorded sha256', (name, hash) => {
    expect(sha256(`components/marketing-ui/${name}`)).toBe(hash)
  })
})

describe('import fence between the app and the marketing and sign-in pages', () => {
  it('the graphs are non-trivial (both surfaces were found)', () => {
    expect(APP_CLOSURE.has('app/(app)/layout.tsx')).toBe(true)
    expect(APP_CLOSURE.has('app/(app)/dashboard/page.tsx')).toBe(true)
    expect(NON_APP_CLOSURE.has('app/(marketing)/page.tsx')).toBe(true)
    expect(NON_APP_CLOSURE.has('app/(auth)/login/page.tsx')).toBe(true)
    expect(NON_APP_CLOSURE.has('components/marketing-ui/button.tsx')).toBe(true)
  })

  it('marketing and sign-in code imports from components/ui only what the app does not use', () => {
    const offending = [...NON_APP_CLOSURE].flatMap((file) =>
      importsOf(file)
        .filter((target) => target.startsWith('components/ui/') && !NON_APP_UI_ALLOWED.includes(target))
        .map((target) => `${file} -> ${target}`)
    )
    expect(offending).toEqual([])
    for (const allowed of NON_APP_UI_ALLOWED) expect(APP_CLOSURE.has(allowed), allowed).toBe(false)
  })

  it('only marketing and sign-in code imports components/marketing-ui', () => {
    const importers = SOURCE_FILES.filter((file) => !isMarketingUi(file) && importsOf(file).some(isMarketingUi))
    expect(importers.filter((file) => !NON_APP_CLOSURE.has(file) || APP_CLOSURE.has(file))).toEqual([])
    expect([...APP_CLOSURE].filter(isMarketingUi)).toEqual([])
  })

  it('the two surfaces share only the reviewed files', () => {
    expect([...APP_CLOSURE].filter((file) => NON_APP_CLOSURE.has(file)).sort()).toEqual(SHARED_REVIEWED)
  })
})
