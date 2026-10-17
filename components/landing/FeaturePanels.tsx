'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function FeaturePanels() {
  return (
    <section className="w-full bg-white pt-8 pb-16 sm:pt-10 sm:pb-20">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">

        {/* Header */}
<div className="text-center mb-8 sm:mb-12">
  <span className="inline-block bg-violet-600 text-white px-4 py-1.5 text-xs font-semibold tracking-widest rounded-full uppercase">
    AI-Powered Intelligence
  </span>
  
  <h2 className="text-violet-600 font-bold text-3xl sm:text-4xl leading-tight mt-4 pt-3 text-center">
    Make Better AWS Decisions with Full Visibility
  </h2>
</div>

        {/* Text panel. The former screenshot showed detectors DevControl does not have (idle RDS, oversized EC2). */}
        <div className="mx-auto max-w-2xl">
           <div className="pr-4">
            <p className="text-slate-600 text-lg leading-relaxed">
              DevControl scans your AWS account every 6 hours, flags waste and security findings, and explains what it found in plain English.
            </p>

            <ul className="space-y-4 mt-6">
              {[
                'Weekly AI cost and risk summary, delivered every Monday',
                'Ask questions about your AWS account in plain English',
                'Executive reports you can generate or schedule',
              ].map((point) => (
                <li key={point} className="flex items-start gap-3">
                  <span className="rounded-full bg-violet-600 h-2 w-2 mt-2 flex-shrink-0" />
                  <span className="text-slate-700 text-base leading-relaxed">{point}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8">
              <Link
                href="/register"
                className="group inline-flex items-center gap-2 bg-violet-600 text-white font-bold px-8 py-4 rounded-lg hover:bg-violet-500 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-600/25 transition-all duration-300 ease-out motion-reduce:transform-none motion-reduce:transition-none"
              >
                Run Your First AI Analysis
                <ArrowRight
                  size={18}
                  className="group-hover:translate-x-1 transition-transform duration-300 motion-reduce:transform-none"
                />
              </Link>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}