import type { Metadata } from 'next'
import { MarketingNav } from '@/components/landing/MarketingNav'
import { HeroSection } from '@/components/landing/HeroSection'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { FeatureShowcase } from '@/components/landing/FeatureShowcase'
import { SocialProofSection } from '@/components/landing/SocialProofSection'
import { PricingPreview } from '@/components/landing/PricingPreview'
import { CTASection } from '@/components/landing/CTASection'
import { Footer } from '@/components/footer'

export const metadata: Metadata = {
  title: 'DevControl - AWS Infrastructure Command Center',
  description:
    'Cut AWS costs by 30%, deploy 2x faster, and sleep better at night. The platform engineering toolkit trusted by 500+ teams.',
  openGraph: {
    title: 'DevControl - AWS Infrastructure Command Center',
    description:
      'Cut AWS costs by 30%, deploy 2x faster, and sleep better at night. The platform engineering toolkit trusted by 500+ teams.',
    type: 'website',
  },
}

/**
 * Public Landing Page
 *
 * Modern SaaS landing page with hero section, how it works, features,
 * social proof, pricing preview, and CTAs.
 * Optimized for conversion and built with performance in mind.
 *
 * Section Order:
 * 1. MarketingNav (fixed)
 * 2. HeroSection (with social proof badge)
 * 3. HowItWorks (3-step process)
 * 4. FeatureShowcase (feature grid)
 * 5. SocialProofSection (trust badges + stats)
 * 6. PricingPreview (tier cards)
 * 7. CTASection (final conversion)
 * 8. Footer
 */
export default function Home() {
  return (
    <main className="min-h-screen">
      <MarketingNav />
      <HeroSection />
      <section id="how-it-works">
        <HowItWorks />
      </section>
      <FeatureShowcase />
      <SocialProofSection />
      <section id="pricing">
        <PricingPreview />
      </section>
      <CTASection />
      <Footer />
    </main>
  )
}
