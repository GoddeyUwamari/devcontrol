import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Check, DollarSign, Gauge, ListChecks, Lock, ShieldCheck } from 'lucide-react'
import { INFRASTRUCTURE_POSTURE_LABEL } from '@/lib/infrastructure-posture'
import { RESOURCE_CHECKS_TITLE } from './resource-checks-section'

interface PreviewItem {
  icon: LucideIcon
  /** The connected card's own icon colours. */
  iconColor: string
  iconBackground: string
  title: string
  description: string
  /** What the connected card adds, in words. */
  shows?: string[]
}

/** The KPI row, by its real card titles and icon tiles. */
const PRIMARY: PreviewItem[] = [
  {
    icon: DollarSign, iconColor: 'var(--text-success)', iconBackground: 'var(--bg-success)',
    title: 'Month-to-Date Spend',
    description: 'Actual spend from AWS Cost Explorer.',
    shows: ['Compared with the same days last month', 'Daily cost trend by service'],
  },
  {
    icon: ShieldCheck, iconColor: 'var(--text-accent)', iconBackground: 'var(--bg-accent)',
    title: 'Security Posture',
    description: 'Account findings and resource compliance checks.',
    shows: ['Findings by severity', 'A score out of 100, with its reasons'],
  },
  {
    icon: Gauge, iconColor: 'var(--text-accent)', iconBackground: 'var(--bg-accent)',
    title: INFRASTRUCTURE_POSTURE_LABEL,
    description: 'A composite of cost, security and alert coverage.',
    shows: ['Each component scored separately', 'Clear notes where evidence is partial'],
  },
]
const SECONDARY: PreviewItem[] = [
  {
    icon: AlertTriangle, iconColor: 'var(--text-danger)', iconBackground: 'var(--bg-danger)',
    title: 'Top Risk',
    description: 'The most serious security finding in your account, with a link to the finding.',
  },
  {
    icon: ListChecks, iconColor: 'var(--text-secondary)', iconBackground: 'var(--surface-1)',
    title: RESOURCE_CHECKS_TITLE,
    description: 'AWS status checks and CloudWatch thresholds for your resources.',
  },
]

const STEPS = [
  'Create a read-only IAM role in your AWS account using the policy we provide.',
  "Paste the role's ARN into DevControl. We verify access before saving.",
  'The first scan runs automatically. Cost data can take a day or two to arrive from AWS.',
]

/** The dashboard's card container: same surface, border, radius and padding as the connected cards. */
const CARD = 'bg-[var(--surface-2)] rounded-2xl border border-border p-5'

/**
 * One card: the connected card's shell, icon tile and title, then what the
 * card shows, in words. It is a preview because it has no figure, score, bar
 * or chart, and sits under a heading that says so -- not because it is faded.
 * Not interactive: no link, no hover or focus styling.
 */
function PreviewCard({ icon: Icon, iconColor, iconBackground, title, description, shows, className = '' }: PreviewItem & { className?: string }) {
  return (
    <div className={`rounded-2xl border border-border p-5 h-full flex flex-col ${className}`} data-testid="preview-card">
      <div className="flex items-center gap-2.5 min-w-0 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: iconBackground }}>
          <Icon size={16} style={{ color: iconColor }} aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold text-foreground m-0" data-testid="preview-title">{title}</h3>
      </div>
      <p className="text-xs text-[var(--text-secondary)] leading-snug m-0" data-testid="preview-description">{description}</p>
      {shows && (
        <ul className="list-none p-0 mt-2.5 mb-0 flex flex-col gap-1.5">
          {shows.map((line) => (
            <li key={line} className="flex items-start gap-1.5 text-xs text-muted-foreground leading-snug" data-testid="preview-shows">
              <Check size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The dashboard for an organization that has not connected AWS: what each
 * main card will show, and how connecting works. Words only -- never a
 * figure, score, count, bar or chart, real or sample. Only an owner can
 * connect, so only an owner gets the button; it is the page's one primary
 * control. Anyone else is told who to ask.
 */
export function DashboardUnconnectedPreview({ canConnectAws }: { canConnectAws: boolean }) {
  return (
    <>
      <section className={`${CARD} mb-6`} aria-labelledby="dashboard-preview-title" data-testid="dashboard-preview">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-5">
          <div className="min-w-0">
            <h2 id="dashboard-preview-title" className="text-xl font-bold text-foreground tracking-tight leading-tight mt-0 mb-1">
              {canConnectAws ? "What you'll see after connecting AWS" : 'What your team will see once AWS is connected'}
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed m-0">
              DevControl reads your account through a read-only IAM role you create and control.
            </p>
          </div>
          {canConnectAws ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 shrink-0" data-testid="preview-action">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Takes a few minutes</span>
              <Link
                href="/connect-aws"
                aria-label="Connect AWS"
                className="bg-[var(--text-accent)] text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold no-underline whitespace-nowrap inline-flex items-center justify-center gap-1.5 min-h-[44px] w-full sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-accent)] focus-visible:ring-offset-2"
                data-testid="preview-connect"
              >
                <span>Connect AWS</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--text-secondary)] m-0 sm:max-w-[16rem] sm:text-right" data-testid="preview-action">
              Ask your organization owner to connect AWS.
            </p>
          )}
        </div>

        {/* 640-1023px: two columns, the third card spanning both, so no cell is left empty. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-5" data-testid="preview-primary-row">
          {PRIMARY.map((item, i) => (
            <PreviewCard key={item.title} {...item} className={i === PRIMARY.length - 1 ? 'sm:col-span-2 lg:col-span-1' : ''} />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5" data-testid="preview-secondary-row">
          {SECONDARY.map((item) => <PreviewCard key={item.title} {...item} />)}
        </div>
      </section>

      <section className={`${CARD} mb-6`} aria-labelledby="connecting-steps-title" data-testid="connecting-steps">
        <h2 id="connecting-steps-title" className="text-base font-bold text-foreground mt-0 mb-4">How connecting works</h2>
        <ol className="list-none p-0 m-0 grid grid-cols-1 sm:grid-cols-3 gap-5">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-start gap-2.5" data-testid="connecting-step">
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
                style={{ background: 'var(--bg-accent)', color: 'var(--text-accent)' }}
                data-testid="connecting-step-number"
              >
                {i + 1}
              </span>
              <span className="text-xs text-[var(--text-secondary)] leading-snug pt-1.5">{step}</span>
            </li>
          ))}
        </ol>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground leading-snug mt-4 mb-0" data-testid="connecting-footer">
          <Lock size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>You control the role: deleting it in AWS removes DevControl&apos;s access.</span>
        </p>
      </section>
    </>
  )
}
