import type { Metadata } from 'next'
import { MarketingNav } from '@/components/landing/MarketingNav'
import { HeroSection } from '@/components/landing/HeroSection'
import { FeatureShowcase } from '@/components/landing/FeatureShowcase'
import { SocialProofSection } from '@/components/landing/SocialProofSection'
import { CTASection } from '@/components/landing/CTASection'
import { Footer } from '@/components/footer'

export const metadata: Metadata = {
  title: 'DevControl - AWS Infrastructure Command Center',
  description:
    'Monitor services, track deployments, and optimize AWS costs in one beautiful dashboard. Built for platform engineering teams.',
  openGraph: {
    title: 'DevControl - AWS Infrastructure Command Center',
    description:
      'Monitor services, track deployments, and optimize AWS costs in one beautiful dashboard.',
    type: 'website',
  },
}

/**
 * Public Landing Page
 *
 * Modern SaaS landing page with hero section, features, social proof, and CTAs.
 * Optimized for conversion and built with performance in mind.
 */
export default function Home() {
  return (
    <main className="min-h-screen">
      <MarketingNav />
      <HeroSection />
      <FeatureShowcase />
      <SocialProofSection />
      <CTASection />
      <Footer />
    </main>
  )
}
