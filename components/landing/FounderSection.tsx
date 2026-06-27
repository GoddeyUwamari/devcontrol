'use client'

import Image from 'next/image'
import { ArrowRight, ExternalLink, Calendar } from 'lucide-react'

export function FounderSection() {
  return (
    <section className="bg-[#0f0b2e] py-20 sm:py-24">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">

          {/* LEFT COLUMN — Photo */}
          <div className="flex justify-center lg:justify-start">
            <div className="relative">
              <Image
                src="/landing/goddey.jpg"
                alt="Goddey Uwamari, Founder of DevControl"
                width={480}
                height={560}
                className="rounded-2xl object-cover ring-2 ring-violet-500/30"
                priority
              />
              <div className="mt-6 text-center lg:text-left">
                <p className="text-xl font-bold text-white">Goddey Uwamari</p>
                <p className="mt-1 text-sm text-violet-300">
                  Founder, DevControl &amp; WayUP Technology
                </p>
                <a
                  href="https://linkedin.com/in/goddey-uwamari"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-violet-400 transition-colors duration-300 hover:text-violet-200 motion-reduce:transition-none"
                >
                  <ExternalLink size={16} />
                  <span className="text-sm font-medium">Connect on LinkedIn</span>
                </a>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN — Story */}
          <div className="space-y-8">
            <div className="inline-block rounded-full bg-violet-900/60 px-4 py-1.5 text-xs font-semibold tracking-widest text-violet-300">
              WHY I BUILT THIS
            </div>

            <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
              AWS Doesn&apos;t Tell You When You&apos;re Wasting Money. DevControl Does.
            </h2>

            <div className="space-y-5 text-lg leading-relaxed text-slate-300">
              <p>
                After 16 years building production systems for SaaS companies, I kept seeing the same pattern — engineering teams with no idea where their AWS money was actually going.
              </p>
              <p>
                Bills that looked normal until you dug in and found idle RDS instances, forgotten staging environments, snapshots piling up for months, EC2 instances running 24/7 for deprecated features. Nobody was being negligent — they were just busy shipping. AWS doesn&apos;t tell you when something becomes wasteful. It just keeps charging.
              </p>
              <p>
                I built DevControl because I wanted to give SaaS teams the visibility layer that AWS never provides — real-time, tenant-level, no code changes, no agents, just clarity.
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-col gap-4 pt-4 sm:flex-row">
              <a
                href="/register"
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-8 py-4 font-bold text-white transition-all duration-300 ease-out hover:bg-violet-500 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-600/25 motion-reduce:transform-none motion-reduce:transition-none"
              >
                Find My AWS Waste
                <ArrowRight
                  size={18}
                  className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transform-none"
                />
              </a>

              <a
                href="https://calendly.com/uwamarigoddey/15min"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border-2 border-violet-500 px-8 py-4 font-semibold text-violet-300 transition-all duration-300 ease-out hover:border-violet-300 hover:bg-violet-900/40 hover:text-white motion-reduce:transition-none"
              >
                <Calendar size={18} />
                Book a Free 15-min AWS Audit
              </a>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}