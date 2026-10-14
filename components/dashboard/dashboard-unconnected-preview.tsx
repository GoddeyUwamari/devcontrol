import Link from 'next/link'
import { CircleCheck, Lock } from 'lucide-react'
import { INFRASTRUCTURE_POSTURE_LABEL } from '@/lib/infrastructure-posture'
import { RESOURCE_CHECKS_TITLE } from './resource-checks-section'

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

const CONNECT_HREF = '/connect-aws'
const ASK_OWNER = 'Ask your organization owner to connect AWS.'

/** Tags and the workspace label: 13px bold, uppercase, letter-spaced. */
const LABEL = 'text-[13px] font-bold uppercase tracking-[0.08em] leading-none'
const SURFACE = 'bg-[var(--surface-2)] rounded-2xl border border-border p-7'
const PILL = 'inline-flex items-center rounded-full border border-border bg-[var(--surface-2)] px-3.5 py-2 text-[13px] font-semibold leading-none text-[var(--text-secondary)]'
const BUTTON = 'inline-flex items-center justify-center rounded-xl px-6 min-h-[44px] text-base font-semibold no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2'

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
            className="text-[13px] font-bold leading-none rounded-full px-3 py-1.5 bg-foreground text-background"
            data-testid="preview-plan-label"
          >
            {planLabel}
          </span>
        )}
      </div>
      <h2 className="text-2xl font-bold text-foreground tracking-tight leading-tight mt-0 mb-1.5" data-testid="preview-title">{title}</h2>
      <p className="text-base text-[var(--text-secondary)] leading-normal m-0" data-testid="preview-subtitle">{subtitle}</p>
      <ul className="list-none p-0 mt-5 mb-0 flex flex-col gap-3">
        {shows.map((line) => (
          <li key={line} className="flex items-start gap-2.5 text-base font-medium text-foreground leading-[1.4]" data-testid="preview-shows">
            <CircleCheck size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--text-success)' }} aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}

/**
 * The dashboard for an organization that has not connected AWS. It replaces
 * the page hero in this state, so it owns the page's h1: the workspace name,
 * the headline, the way to connect, what each card will show, and how
 * connecting works. Words only -- never a figure, score, count, bar or chart,
 * real or sample. Only an owner can connect, so only an owner gets the two
 * buttons (both to the same route); anyone else gets no link at all and is
 * told who to ask.
 */
export function DashboardUnconnectedPreview({ canConnectAws, orgName }: { canConnectAws: boolean; orgName: string }) {
  return (
    <>
      <section className="mb-10" aria-labelledby="dashboard-preview-title" data-testid="dashboard-preview">
        <p className={`${LABEL} mt-0 mb-4`} style={{ color: 'var(--text-accent)' }} data-testid="preview-workspace">{orgName}</p>
        <h1 id="dashboard-preview-title" className="text-[30px] md:text-[44px] font-bold text-foreground tracking-tight leading-[1.1] mt-0 mb-4 max-w-3xl">
          AI-Powered Cloud Operations &amp; Infrastructure Intelligence
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-normal mt-0 mb-6 max-w-3xl">
          Operational visibility across cloud costs, security, observability, and infrastructure efficiency, so you can reduce waste, mitigate risk, and scale with confidence.
        </p>

        <div className="flex flex-wrap items-center gap-3" data-testid="preview-action">
          {canConnectAws ? (
            <Link
              href={CONNECT_HREF}
              // The accent token lightens in dark mode, where white text on it would fall below AA.
              className={`${BUTTON} bg-[var(--text-accent)] dark:bg-[#7C3AED] text-white w-full sm:w-auto focus-visible:ring-[var(--text-accent)]`}
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
          <p className="text-base text-[var(--text-secondary)] leading-normal mt-4 mb-0" data-testid="preview-ask-owner">{ASK_OWNER}</p>
        )}
        <p className="flex items-start gap-2 text-base text-[var(--text-secondary)] leading-normal mt-4 mb-8 max-w-3xl" data-testid="preview-trust">
          <Lock size={16} className="shrink-0 mt-1" aria-hidden="true" />
          <span>Read-only access through a role you create and control. Delete it anytime and our access ends. Setup takes a few minutes.</span>
        </p>

        <ul className="list-none p-0 mt-0 mb-5 grid grid-cols-1 md:grid-cols-2 gap-5" data-testid="preview-cards">
          {CARDS.map((item) => <PreviewCard key={item.title} {...item} />)}
        </ul>

        {/* Dark in both themes, so its colours are fixed rather than taken from the theme tokens. */}
        <div
          className="rounded-2xl border border-white/10 bg-[#1A1730] p-7 flex flex-col gap-5 md:flex-row md:items-center md:justify-between"
          data-testid="preview-band"
        >
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-white tracking-tight leading-tight mt-0 mb-1.5">See where your AWS money is going</h2>
            <p className="text-base text-[#D6D3E8] leading-normal m-0">Connect once. Your first scan runs automatically.</p>
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
            <p className="text-base font-medium text-white leading-normal m-0 md:max-w-xs md:text-right" data-testid="preview-band-ask-owner">{ASK_OWNER}</p>
          )}
        </div>
      </section>

      <section className="mb-6" aria-labelledby="connecting-steps-title" data-testid="connecting-steps">
        <h2 id="connecting-steps-title" className="text-2xl font-bold text-foreground tracking-tight leading-tight mt-0 mb-5">How connecting works</h2>
        <ol className="list-none p-0 m-0 grid grid-cols-1 md:grid-cols-3 gap-5">
          {STEPS.map((step, i) => (
            <li key={step} className={`${SURFACE} flex flex-col gap-4`} data-testid="connecting-step">
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold"
                style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}
                data-testid="connecting-step-number"
              >
                {i + 1}
              </span>
              <span className="text-base text-[var(--text-secondary)] leading-normal">{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
