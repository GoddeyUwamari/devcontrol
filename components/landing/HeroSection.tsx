'use client'

import { Play, ArrowRight, Lock, Cloud, Shield, BadgeCheck, Globe, ShoppingBag } from 'lucide-react'
import { AnimatedBackground } from './AnimatedBackground'

const trustBadges = [
  { label: 'Read-only IAM', icon: Lock },
  { label: 'AWS Partner', icon: Cloud },
  { label: 'Available on AWS Marketplace', icon: ShoppingBag },
  { label: 'AES-256 Encryption', icon: Shield },
  { label: 'SOC 2 In Progress', icon: BadgeCheck },
  { label: 'GDPR Ready', icon: Globe },
]

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-8 pb-16 sm:pt-10">
      <AnimatedBackground />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-violet-50/40 to-white" />

      <div className="relative z-10 mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <h1 className="text-center text-3xl font-bold leading-tight text-violet-600 sm:text-4xl lg:text-5xl">
          Know Exactly Where Your AWS Money Is Going
        </h1>

        <p className="mx-auto mb-4 mt-5 max-w-[680px] text-center text-lg leading-relaxed text-slate-700 sm:text-xl">
          Real-time cost visibility, infrastructure health, and risk detection for multi-tenant SaaS teams — without changing a single line of code.
        </p>

        <p className="mb-9 text-center text-sm text-slate-700 sm:text-base">
          Find hidden AWS waste in <strong className="text-emerald-600">15 minutes</strong>
          {' · '}
          <strong className="text-emerald-600">$800–$8,000+/month</strong> potential savings
          {' · '}
          Read-only access
        </p>

        <div className="mb-6 flex flex-col justify-center gap-4 sm:flex-row">
          <a
            href="/tour"
            className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-6 py-3.5 font-semibold text-white shadow-lg shadow-violet-600/35 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-xl motion-reduce:transform-none motion-reduce:transition-none sm:w-auto"
          >
            <Play className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
            Take a Product Tour
          </a>

          <a
            href="/register"
            className="group inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-violet-600 px-8 py-3.5 font-bold text-violet-600 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-violet-700 hover:bg-violet-50 hover:text-violet-700 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none sm:w-auto"
          >
            Find My AWS Waste
            <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
          </a>
        </div>

        <div className="mx-auto mb-6 w-fit rounded-xl border border-slate-200 bg-slate-50 px-6 py-3 shadow-sm">
          <p className="text-sm text-slate-700">
            Or{' '}
            <a href="/contact" className="font-bold text-violet-600 hover:underline">
              book a 15-min AWS audit
            </a>
            {' '}with our team — free, no commitment
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3 text-xs font-medium text-slate-700 sm:text-sm">
          {trustBadges.map(({ label, icon: Icon }, i) => (
            <span
              key={`${label}-${i}`}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm"
            >
              <Icon className="h-4 w-4 text-violet-600" />
              {label}
            </span>
          ))}
        </div>

      </div>
    </section>
  )
}