'use client'

import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

const personas = [
  {
    id: 'eng-leaders',
    label: 'Eng Leaders',
    headline: 'Ship Faster Without Losing Control',
    hook: 'Understand infrastructure health and cost impact.',
    bullets: [
      'Executive AI reports, on demand or scheduled',
      'Risk score and trends at a glance',
      'Make confident scaling decisions',
    ],
  },
  {
    id: 'eng-managers',
    label: 'Eng Managers',
    headline: "Know Your Team's Numbers Without Asking",
    hook: 'Get team-level accountability without micromanaging.',
    bullets: [
      'Services and their owners in one view',
      'Weekly AI email summaries',
    ],
  },
  {
    id: 'platform-engineers',
    label: 'Platform Eng',
    headline: 'Optimize Infrastructure at Scale',
    hook: 'Operational tools for the people doing the work every day.',
    bullets: [
      'Detect idle and unattached resources',
      'Security findings across your AWS account',
      'Slack and Jira integrations',
    ],
  },
  {
    id: 'product-leaders',
    label: 'Product Leaders',
    headline: 'See If Infrastructure Is Slowing You Down',
    hook: 'Use delivery-speed signals, not just cost numbers.',
    bullets: [
      'DORA metrics and engineering performance',
      'Deployment frequency and lead time trends',
      'Exec reports without engineering asks',
    ],
  },
  {
    id: 'finance-teams',
    label: 'Finance Teams',
    headline: 'Cost Allocation, Solved',
    hook: 'Get chargeback-ready numbers without spreadsheets.',
    bullets: [
      'Spend broken down by AWS service',
      'Exportable reports in CSV and PDF',
      'Trend-based spend forecast',
    ],
  },
  {
    id: 'developers',
    label: 'Developers',
    headline: "Ask, Don't Dig",
    hook: 'Self-serve answers without the AWS console.',
    bullets: [
      'AI chat assistant and natural language search',
      'Alerts sent to Slack or Jira',
    ],
  },
]

export function PersonaSection() {
  const [activeId, setActiveId] = useState(personas[0].id)
  const active = personas.find((p) => p.id === activeId)!

  return (
    <section id="personas" className="w-full bg-white py-16 sm:py-24">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
        {/* Section heading */}
        <div className="mb-10 text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-violet-600">
            Built for Every Team
          </p>
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-violet-600 sm:text-4xl lg:text-5xl">
            One Infrastructure View. Every Team Sees What Matters.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
            DevControl turns complex AWS data into clear decisions for every team — from engineering efficiency to financial control.
          </p>
        </div>

        {/* Tab pills */}
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {personas.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={[
                'rounded-full border px-5 py-2 text-sm font-semibold transition-all duration-300 ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2',
                'motion-reduce:transition-none',
                activeId === p.id
                  ? 'border-violet-600 bg-violet-600 text-white shadow-md shadow-violet-600/25'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Persona panel */}
        <div className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col justify-center gap-6 bg-gradient-to-br from-violet-700 to-violet-500 p-8 sm:p-10 lg:p-12">
            <div>
              <h3 className="mb-3 text-2xl font-extrabold leading-tight text-white sm:text-3xl">
                {active.headline}
              </h3>
              <p className="mb-6 text-base leading-relaxed text-violet-100 sm:text-lg">
                {active.hook}
              </p>
              <ul className="flex flex-col gap-3">
                {active.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-3 text-white">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-violet-200 motion-reduce:transition-none" />
                    <span className="text-sm leading-relaxed sm:text-base">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
