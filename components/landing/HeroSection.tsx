'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, ArrowRight, Play, Check, ChevronDown, Star } from 'lucide-react'
import { DashboardPreview } from './DashboardPreview'
import { AnimatedBackground } from './AnimatedBackground'

/**
 * HeroSection Component
 *
 * Primary conversion driver with gradient background, animated elements,
 * large CTAs, and dashboard preview.
 */
export function HeroSection() {
  return (
    <section className="relative min-h-screen pt-24 pb-20 overflow-hidden">
      {/* Animated Background */}
      <AnimatedBackground />

      {/* Gradient Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-purple-50 to-blue-50 -z-10" />

      {/* Content Container */}
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center">
          {/* Social Proof Badge */}
          <div className="flex justify-center mb-4 animate-in fade-in slide-in-from-top-4 duration-700">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full border shadow-sm">
              <div className="flex items-center text-blue-500">
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
                <Star className="h-4 w-4 fill-current" />
              </div>
              <span className="text-sm font-medium text-gray-700">
                Trusted by 500+ engineering teams
              </span>
            </div>
          </div>

          {/* Announcement Badge */}
          <div className="flex justify-center mb-6 animate-in fade-in slide-in-from-top-4 duration-700 delay-100">
            <Badge
              variant="outline"
              className="py-2 px-4 border-[#635BFF]/20 hover:border-[#635BFF]/40 transition-colors cursor-pointer"
            >
              <Sparkles className="h-3 w-3 mr-2 text-[#635BFF]" />
              <span className="text-sm">New: Automated cost optimization</span>
              <ArrowRight className="h-3 w-3 ml-2" />
            </Badge>
          </div>

          {/* Eyebrow Text */}
          <p className="text-sm font-semibold text-[#635BFF] uppercase tracking-wide mb-4 animate-in fade-in duration-700 delay-150">
            For Platform Engineers
          </p>

          {/* Main Heading */}
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 animate-in fade-in zoom-in duration-1000 delay-200">
            Your AWS Infrastructure,
            <span className="block mt-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Simplified
            </span>
          </h1>

          {/* Description - Outcome focused */}
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-8 animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-400">
            Cut AWS costs by 30%, deploy 2x faster, and sleep better at night.
            <span className="block mt-2 text-lg">
              Join 500+ teams saving $2,400/month on average.
            </span>
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-600">
            <Button
              size="lg"
              className="bg-[#635BFF] hover:bg-[#4f46e5] text-lg px-8 py-6 hover:scale-105 transition-transform"
              asChild
            >
              <Link href="/register">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-lg px-8 py-6 hover:scale-105 transition-transform"
            >
              <Play className="mr-2 h-5 w-5" />
              Watch Demo
            </Button>
          </div>

          {/* Trust Signals */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground animate-in fade-in duration-1000 delay-800">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span>2-minute setup</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span>14-day free trial</span>
            </div>
          </div>
        </div>

        {/* Dashboard Preview */}
        <div className="mt-16 animate-in fade-in zoom-in duration-1000 delay-1000">
          <DashboardPreview />
        </div>

        {/* Scroll Indicator */}
        <div className="flex justify-center mt-12 animate-in fade-in duration-1000 delay-1200">
          <a
            href="#how-it-works"
            className="flex flex-col items-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
          >
            <span className="text-sm mb-2">See how it works</span>
            <ChevronDown className="h-5 w-5 animate-bounce" />
          </a>
        </div>
      </div>
    </section>
  )
}
