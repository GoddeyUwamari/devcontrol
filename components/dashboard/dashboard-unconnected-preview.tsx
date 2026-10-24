import Link from 'next/link'
import { CircleCheck, Lock } from 'lucide-react'
import { INFRASTRUCTURE_POSTURE_LABEL } from '@/lib/infrastructure-posture'
import { RESOURCE_CHECKS_TITLE } from './resource-checks-section'
import { Num } from '@/components/ui/typography'

interface PreviewItem {
  /** The category tag above the title. */
  tag: string
  title: string
  subtitle: string
  /** What the card or feature covers, in words: the check lines under the subtitle. */
  shows: string[]
  /** The plan a feature needs, shown beside its tag. Only where the product enforces one. */
  planLabel?: string
}

/**
 * The eight cards, in page order (left to right, top to bottom). Each claim is
 * what the product does today: the cost checks named here exist, the assistant
 * is gated to Pro and above, and the weekly email goes to one organization owner.
 */
const CARDS: PreviewItem[] = [
  {
    tag: 'Cost',
    title: 'Month-to-Date Spend',
    subtitle: 'Your real AWS bill, straight from AWS.',
    shows: [
      'See exactly what you have spent so far this month',
      'Know right away if you are spending more or less than last month',
      'Spot which service is driving your bill, day by day',
    ],
  },
  {
    tag: 'Savings',
    title: 'Cost optimization',
    subtitle: 'Money you are paying for but not using.',
    shows: [
      'Find idle servers and unattached storage you are still paying for',
      'Switch old storage to cheaper, faster volumes',
      'See the estimated monthly saving for each recommendation',
    ],
  },
  {
    tag: 'Security',
    title: 'Security Posture',
    subtitle: 'Know where you are exposed before someone else does.',
    shows: [
      'See your security risks ranked from most to least serious',
      'Get one score out of 100, with the reasons behind it',
      'Check your resources against security best practices',
    ],
  },
  {
    tag: 'Urgent',
    title: 'Top Risk',
    subtitle: 'The one problem to address first.',
    shows: [
      'Your most serious security finding, front and center',
      'A direct link to the exact finding, so you can act on it',
    ],
  },
  {
    tag: 'Posture',
    title: INFRASTRUCTURE_POSTURE_LABEL,
    subtitle: 'One honest score for your connected account.',
    shows: [
      'A single score that combines cost, security and alert coverage',
      'See which area is pulling your score down',
      'Clear notes wherever the data is only partial',
    ],
  },
  {
    tag: 'Uptime',
    title: RESOURCE_CHECKS_TITLE,
    subtitle: 'Catch trouble before your customers do.',
    shows: [
      'See which servers are failing their AWS status checks',
      'Know when a resource crosses a CloudWatch alarm threshold',
    ],
  },
  {
    tag: 'Ask',
    planLabel: 'Pro',
    title: 'AI assistant',
    subtitle: 'Ask questions about your spend and security.',
    shows: [
      'Ask in plain English, no dashboards to learn',
      'Answers come from your own account data',
      'It tells you plainly when the data is not available',
    ],
  },
  {
    tag: 'Weekly',
    title: 'Weekly summary',
    subtitle: 'Your AWS week in one email.',
    shows: [
      'Spend compared with the previous week',
      'New security findings and deployments at a glance',
      'Sent to your workspace owner every week',
    ],
  },
]

const STEPS = [
  'Create a read-only IAM role in your AWS account using the policy we provide.',
  'Paste the role ARN into DevControl. We verify access before saving.',
  'Your first scan runs automatically. Cost data can take a day or two to arrive from AWS.',
]

interface SampleRow {
  title: string
  subtitle: string
  /** A sample monthly cost, in whole dollars. Rows without one carry a severity instead. */
  monthly?: number
  severity?: 'High'
}

/**
 * The hero's sample panel: what a first scan can find, as an illustration.
 * The amounts are made up, never read from an account, and the panel always
 * says so (its "Sample data" tag and the caption under it).
 */
const SAMPLE_ROWS: SampleRow[] = [
  { title: 'Server running but idle', subtitle: 'Idle EC2 instance', monthly: 142 },
  { title: 'Storage attached to nothing', subtitle: 'Unattached EBS volume', monthly: 38 },
  { title: 'Old storage type, cheaper one exists', subtitle: 'gp2 to gp3 upgrade', monthly: 21 },
  { title: 'Bucket accepts non-HTTPS requests', subtitle: 'S3 bucket policy', severity: 'High' },
]
/** The sum of the sample costs above, so the total can never disagree with its rows. */
const SAMPLE_TOTAL = SAMPLE_ROWS.reduce((sum, row) => sum + (row.monthly ?? 0), 0)
const perMonth = (dollars: number) => `$${dollars}/mo`

const CONNECT_HREF = '/connect-aws'
const ASK_OWNER = 'Ask your organization owner to connect AWS.'

/** Tags: the 12px label role, uppercase, letter-spaced. */
const LABEL = 'text-label uppercase tracking-[0.04em] leading-none'
const SURFACE = 'bg-[var(--surface-2)] rounded-2xl border border-border p-7'
const PILL = 'inline-flex items-center rounded-full border border-border bg-[var(--surface-2)] px-3.5 py-2 text-label leading-none text-ink-muted'
const BUTTON = 'inline-flex items-center justify-center rounded-xl px-6 min-h-[44px] text-ui font-semibold no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2'

/**
 * One card: tag, title, subtitle, then what the card shows, in words. It is a
 * preview because it has no figure, score, bar or chart -- not because it is
 * faded. Not interactive: no link, no hover or focus styling.
 */
function PreviewCard({ tag, title, subtitle, shows, planLabel }: PreviewItem) {
  return (
    <li className={`${SURFACE} flex flex-col`} data-testid="preview-card">
      <div className="flex items-center gap-2 mb-4">
        <span
          className={`${LABEL} rounded-full px-3 py-1.5`}
          style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}
          data-testid="preview-tag"
        >
          {tag}
        </span>
        {planLabel && (
          <span
            className="text-label leading-none rounded-full px-3 py-1.5 bg-foreground text-background"
            data-testid="preview-plan-label"
          >
            {planLabel}
          </span>
        )}
      </div>
      <h2 className="text-card-title text-ink mt-0 mb-1.5" data-testid="preview-title">{title}</h2>
      <p className="text-body text-ink-muted m-0" data-testid="preview-subtitle">{subtitle}</p>
      <ul className="list-none p-0 mt-5 mb-0 flex flex-col gap-3">
        {shows.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-ui font-medium text-ink-body" data-testid="preview-shows">
            <CircleCheck size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--text-success)' }} aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * What a first scan can find, as labelled sample data: four findings and the
 * total of their sample costs. Not interactive. The "Sample data" tag and the
 * caption are always shown, and name the panel for assistive technology.
 */
function SamplePanel() {
  return (
    <section
      className="bg-[var(--surface-2)] rounded-2xl border border-border shadow-[0_12px_32px_-12px_rgba(17,24,39,0.18)]"
      aria-labelledby="sample-panel-title sample-panel-tag"
      aria-describedby="sample-panel-caption"
      data-testid="sample-panel"
    >
      <div className="flex items-start justify-between gap-4 px-6 py-3.5 border-b border-border">
        <h2 id="sample-panel-title" className="text-card-title text-ink m-0" data-testid="sample-panel-title">
          What you&apos;ll see after connecting
        </h2>
        <span
          id="sample-panel-tag"
          className={`${LABEL} shrink-0 rounded-md px-3 py-1.5`}
          style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}
          data-testid="sample-panel-tag"
        >
          Sample data
        </span>
      </div>
      <ul className="list-none p-0 m-0">
        {SAMPLE_ROWS.map((row) => (
          <li key={row.title} className="flex items-center justify-between gap-4 px-6 py-2 border-b border-border" data-testid="sample-panel-row">
            <div className="min-w-0">
              <p className="text-ui font-medium text-ink m-0" data-testid="sample-panel-row-title">{row.title}</p>
              <p className="text-ui text-ink-muted m-0" data-testid="sample-panel-row-subtitle">{row.subtitle}</p>
            </div>
            {row.monthly !== undefined ? (
              <Num className="shrink-0 text-ui font-semibold text-ink-success dark:text-[#34D399]" data-testid="sample-panel-row-value">
                {perMonth(row.monthly)}
              </Num>
            ) : (
              <span
                className="shrink-0 rounded-full px-3 py-1.5 text-label leading-none bg-[var(--bg-danger)] text-ink-danger-strong dark:text-[#F87171]"
                data-testid="sample-panel-row-value"
                data-severity={row.severity?.toLowerCase()}
              >
                {row.severity}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="mx-6 mt-3 rounded-xl px-5 py-2.5 flex items-center justify-between gap-4" style={{ background: 'var(--bg-accent)' }} data-testid="sample-panel-total">
        <p className="text-ui font-medium text-ink m-0">Estimated monthly saving (sample)</p>
        <Num className="shrink-0 text-section leading-none" style={{ color: 'var(--text-accent)' }} data-testid="sample-panel-total-value">
          {perMonth(SAMPLE_TOTAL)}
        </Num>
      </div>
      <p id="sample-panel-caption" className="text-meta text-ink-muted px-6 pt-2.5 pb-3.5 m-0" data-testid="sample-panel-caption">
        Illustrative example. Your own findings appear after your first scan.
      </p>
    </section>
  )
}

/**
 * The dashboard for an organization that has not connected AWS. It replaces
 * the page hero in this state, so it owns the page's h1: the headline, the way
 * to connect, a labelled sample of what a scan finds, what each card will
 * show, and how connecting works. Outside the sample panel it is words only --
 * never a figure, score, count, bar or chart. Only an owner can connect, so
 * only an owner gets the two buttons (both to the same route); anyone else
 * gets no link at all and is told who to ask.
 */
export function DashboardUnconnectedPreview({ canConnectAws }: { canConnectAws: boolean }) {
  return (
    <>
      <section className="mb-10" aria-labelledby="dashboard-preview-title" data-testid="dashboard-preview">
        {/* Two columns from lg (equal until xl, so the panel does not wrap at 1024px), both aligned to the top: the copy and the way to connect, then the sample panel. Stacked, in that order, below. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-8 xl:gap-12 items-start mb-6" data-testid="preview-hero">
          <div className="min-w-0" data-testid="preview-hero-copy">
            <h1 id="dashboard-preview-title" className="text-title text-ink mt-0 mb-4 max-w-3xl">
              AI-Powered Cloud Operations &amp; Infrastructure Intelligence
            </h1>
            <p className="text-subtitle text-ink-muted mt-0 mb-6 max-w-3xl">
              Operational visibility across cloud costs, security, observability, and infrastructure efficiency, so you can reduce waste, mitigate risk, and scale with confidence.
            </p>

            <div className="flex flex-wrap items-center gap-3" data-testid="preview-action">
              {canConnectAws ? (
                <Link
                  href={CONNECT_HREF}
                  // The accent token lightens in dark mode, where white text on it would fall below AA.
                  // The focus ring's offset is the page background, so the gap is not a white halo in dark mode.
                  className={`${BUTTON} bg-[var(--text-accent)] dark:bg-[#7C3AED] text-white w-full sm:w-auto focus-visible:ring-[var(--text-accent)] focus-visible:ring-offset-[var(--surface-1)]`}
                  data-testid="preview-connect"
                >
                  Connect AWS
                </Link>
              ) : (
                <span className={PILL} data-testid="preview-pill-aws" data-state="not-connected">AWS not connected</span>
              )}
              {['GCP', 'Azure'].map((name) => (
                <span key={name} className={PILL} data-testid={`preview-pill-${name.toLowerCase()}`}>{name} soon</span>
              ))}
            </div>
            {!canConnectAws && (
              <p className="text-body text-ink-muted mt-4 mb-0" data-testid="preview-ask-owner">{ASK_OWNER}</p>
            )}
            <p className="flex items-start gap-2 text-body text-ink-muted mt-4 mb-0 max-w-[540px]" data-testid="preview-trust">
              <Lock size={16} className="shrink-0 mt-1" aria-hidden="true" />
              <span>Read-only access through a role you create and control. Delete it anytime and our access ends. Setup takes a few minutes.</span>
            </p>
          </div>
          <SamplePanel />
        </div>

        <ul className="list-none p-0 mt-0 mb-5 grid grid-cols-1 md:grid-cols-2 gap-5" data-testid="preview-cards">
          {CARDS.map((item) => <PreviewCard key={item.title} {...item} />)}
        </ul>

        {/* Dark in both themes, so its colours are fixed rather than taken from the theme tokens. */}
        <div
          className="rounded-2xl border border-white/10 bg-[#1A1730] p-7 flex flex-col gap-5 md:flex-row md:items-center md:justify-between"
          data-testid="preview-band"
        >
          <div className="min-w-0">
            <h2 className="text-section text-white mt-0 mb-1.5">See where your AWS money is going</h2>
            <p className="text-body text-[#D6D3E8] m-0">Connect once. Your first scan runs automatically.</p>
          </div>
          {canConnectAws ? (
            <Link
              href={CONNECT_HREF}
              className={`${BUTTON} bg-white text-[#1A1730] shrink-0 w-full md:w-auto focus-visible:ring-white focus-visible:ring-offset-[#1A1730]`}
              data-testid="preview-band-connect"
            >
              Connect AWS
            </Link>
          ) : (
            <p className="text-body font-medium text-white m-0 md:max-w-xs md:text-right" data-testid="preview-band-ask-owner">{ASK_OWNER}</p>
          )}
        </div>
      </section>

      <section className="mb-6" aria-labelledby="connecting-steps-title" data-testid="connecting-steps">
        <h2 id="connecting-steps-title" className="text-section text-ink mt-0 mb-5">How connecting works</h2>
        <ol className="list-none p-0 m-0 grid grid-cols-1 md:grid-cols-3 gap-5">
          {STEPS.map((step, i) => (
            <li key={step} className={`${SURFACE} flex flex-col gap-4`} data-testid="connecting-step">
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-label"
                style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}
                data-testid="connecting-step-number"
              >
                {i + 1}
              </span>
              <span className="text-body text-ink-muted">{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
