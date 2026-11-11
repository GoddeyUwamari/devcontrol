'use client'

import { useState } from 'react'
import Image from 'next/image'
import { CheckCircle2 } from 'lucide-react'

const personas = [
  {
    id: 'eng-leaders',
    label: 'Eng Leaders',
    headline: 'Ship Faster Without Losing Control',
    hook: 'Understand infrastructure health and cost impact.',
    bullets: [
      'Executive AI Reports auto-delivered monthly',
      'Risk score and trends at a glance',
      'Make confident scaling decisions',
    ],
    image: '/landing/personas/eng-leaders.png',
  },
  {
    id: 'eng-managers',
    label: 'Eng Managers',
    headline: "Know Your Team's Numbers Without Asking",
    hook: 'Get team-level accountability without micromanaging.',
    bullets: [
      'Cost attribution by team',
      'SLO dashboard for owned services',
      'Weekly AI email summaries',
    ],
    image: '/landing/personas/eng-managers.png',
  },
  {
    id: 'platform-engineers',
    label: 'Platform Eng',
    headline: 'Optimize Infrastructure at Scale',
    hook: 'Operational tools for the people doing the work every day.',
    bullets: [
      'Detect idle and over-provisioned resources',
      'Anomaly detection with auto-remediation workflows',
      'Slack and Jira integrations',
    ],
    image: '/landing/personas/platform-engineers.png',
  },
  {
    id: 'product-leaders',
    label: 'Product Leaders',
    headline: 'See If Infrastructure Is Slowing You Down',
    hook: 'Use delivery-speed signals, not just cost numbers.',
    bullets: [
      'DORA metrics and engineering performance',
      'Deployment frequency and lead time trends',
      'Monthly exec reports without engineering asks',
    ],
    image: '/landing/personas/product-leaders.png',
  },
  {
    id: 'finance-teams',
    label: 'Finance Teams',
    headline: 'Cost Allocation, Solved',
    hook: 'Get chargeback-ready numbers without spreadsheets.',
    bullets: [
      'Cost attribution by team or tenant',
      'Exportable reports in CSV and PDF',
      'Executive AI Reports for forecasting',
    ],
    image: '/landing/personas/finance-teams.png',
  },
  {
    id: 'developers',
    label: 'Developers',
    headline: "Ask, Don't Dig",
    hook: 'Self-serve answers without the AWS console.',
    bullets: [
      'AI chat assistant and natural language search',
      'Alerts scoped to their service',
      'Slack-native, no context switching',
    ],
    image: '/landing/personas/developers.png',
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

        {/* Two-panel showcase */}
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-2">
          {/* Left panel */}
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

          {/* Right panel */}
          <div className="flex flex-col gap-6 bg-violet-50/40 p-6 sm:p-8 lg:p-10">
            {/* Screenshot */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <Image
                src={active.image}
                alt={`${active.label} dashboard view`}
                width={1024}
                height={576}
                className="h-auto w-full object-cover"
                priority={active.id === personas[0].id}
              />
            </div>

            {/* The same real checks on every tab; no customer quotes (catalog CAT-0). */}
            <div className="rounded-2xl border-2 border-dashed border-violet-200 bg-white/60 p-5" data-testid="persona-first-scan">
              <p className="mb-2 text-sm font-semibold text-slate-800">What a first scan looks for</p>
              <p className="text-sm leading-relaxed text-slate-600">
                Low-activity EC2 instances · Unattached EBS volumes · Open security groups
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
