/**
 * CAT-3 in-app truth fixes: the exact strings it replaced must not come back
 * in the files it touched (source scan, comments included except where noted).
 * Exact phrases only, so unrelated copy never trips it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REMOVED: Record<string, string[]> = {
  'components/dashboard/executive-roi-card.tsx': ['Executive ROI Summary', 'View report →', 'Monthly savings realized'],
  // The tile subtitles stay in the code behind ANOMALY_DETECTION_ACTIVE (not rendered while it is
  // false; anomalies-not-active.test.tsx pins the rendered page), so only the count is scanned here.
  'app/(app)/anomalies/page.tsx': ['rules active'],
  'components/layout/top-nav.tsx': ['Real-time spend tracking', 'AI savings recommendations', 'Predictive budget forecasting', 'Detected threats and issues'],
  'app/(app)/developers/page.tsx': [
    'Connect your stack, ingest real-time data, and power insights across your infrastructure.',
    'Connect Observability', 'Connect Datadog →', 'Connect Slack →', 'Send real-time alerts to your team',
    'Monitor AWS resources and stream metrics, logs, and alarms into DevControl',
    'Send real-time alerts and reports to your Slack channels', 'Send alert notifications directly to your team via SMTP',
  ],
  'app/(app)/enterprise/page.tsx': ['Upgrade to Pro to unlock billing history and downloadable invoices.', "router.push('/billing')", '· Free plan'],
  'app/(app)/invoices/page.tsx': ['This is usually temporary', 'Having trouble fetching billing data', 'Missing billing permissions', 'Next retry in ~5 minutes'],
  'app/(app)/deployments/page.tsx': ['/logs`}', '/rollback`}'],
  'lib/hooks/useBreadcrumbs.ts': ["href: '/devops'", "href: '/observability'"],
  'app/(auth)/layout.tsx': ['href="/support"', 'href="/privacy"', 'href="/terms"'],
  'app/(app)/billing/success/page.tsx': ['href="/support"'],
  'app/(app)/billing/cancel/page.tsx': ['href="/support"', 'href="/docs/pricing"', 'Contact sales', 'View pricing FAQ'],
  'app/(app)/observability/alerts/page.tsx': ['/admin/alerts'],
  'components/ai/AIChatWidget.tsx': [
    'Which EC2 instances can I rightsize today?', 'Are there any idle or unused resources I should delete?', 'Which services have anomalous cost spikes?',
  ],
  'app/(app)/infrastructure/page.tsx': [
    'idle resources — first insights in under 2 minutes', 'Idle EC2 instances draining budget', 'Underutilized RDS databases',
    'Unused S3 storage accumulating', 'Cancel anytime', 'Downsize RDS cluster', 'Rightsize idle EC2 instances', 'avg 12% CPU utilization',
  ],
  'app/(app)/services/demo-fixture.ts': ["'Idle Instance'"],
  'app/(app)/cost-optimization/controls/page.tsx': ['CPU utilization threshold for idle'],
  'components/onboarding/welcome-modal.tsx': ['idle EC2 instances'],
  'app/(app)/costs/efficiency/page.tsx': ['Idle Resource Cost'],
}

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8')

describe('CAT-3: replaced in-app claims stay gone', () => {
  it.each(Object.entries(REMOVED))('%s', (file, strings) => {
    const source = read(file)
    for (const s of strings) expect(source, `${file} still contains "${s}"`).not.toContain(s)
  })

  it('the replacements are present', () => {
    expect(read('components/dashboard/executive-roi-card.tsx')).toContain('Estimated savings')
    expect(read('app/(app)/costs/efficiency/page.tsx')).toContain("'Stopped or Starting Resources'")
    expect(read('app/(app)/costs/efficiency/page.tsx')).toContain("'Estimated at running rates; AWS charges less while instances are stopped.'")
    expect(read('app/(app)/infrastructure/page.tsx')).toContain('Remove unattached Elastic IPs')
    expect(read('components/onboarding/welcome-modal.tsx')).toContain('low-activity EC2 instances')
  })
})
