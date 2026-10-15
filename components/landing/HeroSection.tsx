'use client'

import { ArrowRight, Check, Play } from 'lucide-react'

// "GDPR Ready" was removed: no dedicated GDPR program (DPA, subprocessor list, data-subject
// tooling) exists to substantiate it — see the Phase 5 product-truthfulness audit. Do not
// re-add a GDPR badge here without real, traceable implementation evidence behind it.
// No SOC 2 badge either: SOC 2 is readiness planning only, not an audit or certification.
const trustBadges = ['Read-only access', 'No agents', 'AES-256 encryption']

interface SampleRow {
  title: string
  subtitle: string
  /** A sample monthly cost, in whole dollars. */
  monthly: number
}

/**
 * The hero's sample panel: what a first scan can find, as an illustration.
 * Not a customer's data, and the panel says so (its "Sample data" tag and the
 * caption under it).
 */
const SAMPLE_ROWS: SampleRow[] = [
  { title: 'Server running but idle', subtitle: 'Idle EC2 instance', monthly: 142 },
  { title: 'Storage attached to nothing', subtitle: 'Unattached EBS volume', monthly: 38 },
  { title: 'Old storage type, cheaper one exists', subtitle: 'gp2 to gp3 upgrade', monthly: 21 },
  { title: 'Old database backup nobody uses', subtitle: 'Idle RDS snapshot', monthly: 64 },
]

/** The sum of the sample costs above, so the total can never disagree with its rows. */
const SAMPLE_TOTAL = SAMPLE_ROWS.reduce((sum, row) => sum + row.monthly, 0)

const perMonth = (dollars: number) => `$${dollars.toLocaleString('en-US')}/mo`

/**
 * Labelled sample findings, in the same style as the in-app preview panel
 * (components/dashboard/dashboard-unconnected-preview.tsx). Not interactive.
 * The tag and the caption are always shown, and name the panel for assistive
 * technology.
 */
function SamplePanel() {
  return (
    <div data-testid="hero-sample">
      <section
        className="rounded-2xl border border-slate-200 bg-white shadow-[0_12px_32px_-12px_rgba(17,24,39,0.18)]"
        aria-labelledby="hero-sample-panel-title hero-sample-panel-tag"
        aria-describedby="hero-sample-panel-caption"
        data-testid="hero-sample-panel"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <h2 id="hero-sample-panel-title" className="m-0 text-lg font-bold leading-tight tracking-tight text-slate-900">
            Cost optimization
          </h2>
          <span
            id="hero-sample-panel-tag"
            className="shrink-0 rounded-md bg-violet-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-violet-800"
            data-testid="hero-sample-panel-tag"
          >
            Sample data
          </span>
        </div>
        <ul className="m-0 list-none p-0">
          {SAMPLE_ROWS.map((row) => (
            <li
              key={row.title}
              className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4"
              data-testid="hero-sample-panel-row"
            >
              <div className="min-w-0">
                <p className="m-0 text-base font-semibold leading-snug text-slate-900">{row.title}</p>
                <p className="m-0 text-sm leading-snug text-slate-600">{row.subtitle}</p>
              </div>
              {/* Fixed green: lighter emerald shades fall below AA for text on white. */}
              <span className="shrink-0 text-lg font-bold text-[#047857]" data-testid="hero-sample-panel-row-value">
                {perMonth(row.monthly)}
              </span>
            </li>
          ))}
        </ul>
        <div
          className="mx-6 my-5 flex items-center justify-between gap-4 rounded-xl bg-violet-100 px-5 py-4"
          data-testid="hero-sample-panel-total"
        >
          <p className="m-0 text-base font-medium leading-snug text-slate-900">Estimated monthly saving</p>
          <span className="shrink-0 text-2xl font-bold leading-none text-violet-800" data-testid="hero-sample-panel-total-value">
            {perMonth(SAMPLE_TOTAL)}
          </span>
        </div>
      </section>
      <p
        id="hero-sample-panel-caption"
        className="m-0 mt-3 px-1 text-sm leading-normal text-slate-600"
        data-testid="hero-sample-panel-caption"
      >
        Illustrative example. Your own findings appear after your first scan.
      </p>
    </div>
  )
}

export function HeroSection() {
  return (
    <section className="bg-violet-50 pt-10 pb-16 sm:pt-14 lg:pb-20" data-testid="hero-section">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Two columns from lg: the copy, then the sample panel. Stacked, in that order, below. */}
        <div
          className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14"
          data-testid="hero-columns"
        >
          <div data-testid="hero-copy">
            <p className="m-0 text-sm font-medium text-violet-700">
              AI-powered cloud operations &amp; infrastructure intelligence
            </p>

            <h1 className="mt-4 text-4xl font-bold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Find the <span className="text-violet-700">AWS waste</span> hiding in your bill.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-700">
              Connect read-only and see idle resources, security risks and cost drivers across your AWS account. No
              agents. No code changes.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
              <a
                href="/register"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-7 py-4 font-semibold text-white shadow-lg shadow-violet-700/30 transition-colors hover:bg-violet-800 sm:w-auto"
              >
                Find My AWS Waste
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </a>
              <a
                href="/tour"
                className="inline-flex items-center justify-center gap-2 font-semibold text-violet-700 hover:text-violet-800 hover:underline"
              >
                <Play aria-hidden="true" className="h-4 w-4" />
                Take a product tour
              </a>
            </div>

            <p className="mt-6 text-sm text-slate-600">
              Read-only access · Takes a few minutes · Delete the role anytime
            </p>

            <ul className="mt-5 flex list-none flex-wrap gap-3 p-0" aria-label="Trust badges">
              {trustBadges.map((label) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
                  data-testid="hero-trust-badge"
                >
                  <Check aria-hidden="true" className="h-4 w-4 text-violet-700" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <SamplePanel />
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2" data-testid="hero-cards">
          <div className="rounded-2xl border border-slate-200 bg-white p-7" data-testid="hero-outcome-card">
            <p className="m-0 text-xs font-semibold uppercase tracking-wider text-slate-600">Recent client outcome</p>
            <p className="m-0 mt-2 text-4xl font-bold tracking-tight text-violet-700">$8,000/mo</p>
            <p className="m-0 mt-3 text-base leading-relaxed text-slate-700">
              in unnecessary AWS spend identified in under 60 seconds, with no agent and no code changes.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-900 p-7" data-testid="hero-audit-card">
            <h2 className="m-0 text-2xl font-bold tracking-tight text-white">Rather talk it through?</h2>
            <p className="m-0 mt-3 text-base leading-relaxed text-slate-300">
              Book a free 15-minute AWS audit with our team. No commitment.
            </p>
            <a
              href="/contact"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-slate-900 transition-colors hover:bg-slate-100"
            >
              Book a free audit
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
