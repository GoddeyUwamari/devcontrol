'use client'

import { Play, ArrowRight } from 'lucide-react'
import { AnimatedBackground } from './AnimatedBackground'
import { DashboardPreview } from './DashboardPreview'

export function HeroSection() {
  return (
    <section className="relative overflow-hidden flex items-center min-h-[90vh]">
      <AnimatedBackground />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-amber-50/30 to-white" />

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10 w-full">
        
        {/* Headline */}
<h1 className="font-bold leading-tight text-3xl sm:text-4xl lg:text-5xl mt-6 mb-5 text-center">
  <span className="text-violet-600 block">
    Know Exactly Where Your AWS Money Is Going
  </span>
</h1>
        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-slate-700 leading-relaxed max-w-[680px] mx-auto mb-4 text-center">
          Real-time cost visibility, infrastructure health, and risk detection for multi-tenant SaaS teams. See tenant-level spend, uncover hidden waste, and reduce cloud costs — without changing a single line of code.
        </p>

        {/* ROI line */}
        <p className="text-sm sm:text-base text-slate-700 mb-9 text-center">
          Find hidden AWS waste in <strong className="text-emerald-600">15 minutes</strong>
          {' · '}
          <strong className="text-emerald-600">$800–$8,000+/month</strong> potential savings
          {' · '}
          Read-only access
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
          <a
            href="/tour"
            className="bg-violet-600 text-white font-semibold px-6 py-3.5 rounded-lg shadow-lg shadow-violet-600/35 
                       hover:opacity-90 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 
                       sm:w-auto w-full"
          >
            <Play className="h-4 w-4" />
            Take a Product Tour
          </a>

          <a
            href="/register"
            className="border-2 border-violet-600 text-violet-600 font-bold px-8 py-3.5 rounded-lg 
                       hover:border-violet-700 hover:text-violet-700 transition-all flex items-center justify-center gap-2 
                       sm:w-auto w-full"
          >
            Find My AWS Waste
            <ArrowRight size={18} />
          </a>
        </div>

        {/* Book audit */}
        <div className="border border-gray-200 rounded-lg px-8 py-3 bg-amber-50/50 w-fit mx-auto mb-6">
          <p className="text-sm text-slate-700">
            Or{' '}
            <a href="/contact" className="text-violet-600 font-bold hover:underline">
              book a 15-min AWS audit
            </a>
            {' '}with our team — free, no commitment
          </p>
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs sm:text-sm font-medium text-slate-900 mt-4">
          <span>🔐 Read-only IAM</span>
          <span>☁️ AWS Partner</span>
          <span>🔒 AES-256</span>
          <span>🏅 SOC 2</span>
          <span>🇪🇺 GDPR</span>
        </div>

        {/* Micro-preview */}
        <div className="w-full border-y border-gray-200 py-5 mt-8 bg-gray-50">
          <p className="text-xs font-bold text-violet-600 uppercase tracking-wider text-center mb-3">
            What you get in 15 minutes
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-0">
            {['Top cost leaks by service', 'Risk exposure summary', 'Service-level health', 'Ranked fixes with dollar impact'].map((item, i) => (
              <div key={item} className="flex items-center">
                <span className="text-sm font-semibold text-slate-700 px-3 sm:px-5 py-2">{item}</span>
                {i < 3 && <span className="text-violet-600 text-xs hidden sm:inline">•</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard */}
        <div className="mt-6 w-full">
          <DashboardPreview />
        </div>

      </div>
    </section>
  )
}