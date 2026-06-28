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
    // replace with real customer before launch
    testimonial: {
      quote: 'DevControl gives me the numbers I need for every board update without bugging my engineers or digging through AWS myself.',
      name: 'Jordan Ellis',
      title: 'VP Engineering, SaaS Co.',
      initials: 'JE',
    },
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
    // replace with real customer before launch
    testimonial: {
      quote: 'I used to spend hours pulling AWS cost data. Now the numbers just show up every Monday, ready for leadership review.',
      name: 'Sam Rivera',
      title: ' Engineering Manager, Platform Team',
      initials: 'SR',
    },
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
    // replace with real customer before launch
    testimonial: {
      quote: "The anomaly alerts caught a misconfigured Lambda we’d been paying for for three months and helped us shut it down fast.",
      name: ' Alex Kim',
      title: ' Senior Platform Engineer',
      initials: 'AK',
    },
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
    // replace with real customer before launch
    testimonial: {
      quote: 'It finally connects infrastructure health to shipping velocity, so my PMs can see what’s slowing delivery down',
      name: ' Taylor Morgan',
      title: 'Head of Product, B2B SaaS',
      initials: 'TM',
    },
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
    // replace with real customer before launch
    testimonial: {
      quote: 'We cut our cloud cost reconciliation process from two days to thirty minutes.',
      name: ' Dana Okafor',
      title: ' Director of Finance, Tech Startup',
      initials: 'DO',
    },
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
    // replace with real customer before launch
    testimonial: {
      quote: 'I can ask "what did my service cost last week?" in Slack and get a real answer in seconds.',
      name: ' Chris Nakamura',
      title: ' Senior Software Engineer',
      initials: 'CN',
    },
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

            {/* PLACEHOLDER testimonial — replace with real customer before launch */}
            <div className="rounded-2xl border-2 border-dashed border-violet-200 bg-white/60 p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
                  {active.testimonial.initials}
                </div>
                <div>
                  {/* replace with real customer before launch */}
                  <p className="text-sm font-semibold text-slate-800">{active.testimonial.name}</p>
                  <p className="text-xs text-slate-500">{active.testimonial.title}</p>
                </div>
              </div>
              <p className="text-sm italic leading-relaxed text-slate-600">
                &ldquo;{active.testimonial.quote}&rdquo;
              </p>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
                {/* Placeholder — replace before launch */}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
