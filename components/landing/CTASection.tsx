'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight, Shield, Users } from 'lucide-react'

/**
 * CTASection Component
 *
 * Final conversion opportunity with bold gradient background,
 * guarantee badge, and social proof.
 */
export function CTASection() {
  return (
    <section className="py-24 bg-gradient-to-br from-blue-600 to-purple-600">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center text-white">
          {/* Social Proof Counter */}
          <div className="flex items-center justify-center gap-2 mb-6 text-blue-100">
            <Users className="h-5 w-5" />
            <span className="text-sm font-medium">47 teams signed up this week</span>
          </div>

          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            Ready to optimize your AWS infrastructure?
          </h2>
          <p className="text-xl mb-8 text-blue-100">
            Engineering teams save an average of $2,400/month with DevControl.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              variant="secondary"
              className="text-lg px-8 py-6 hover:scale-105 transition-transform"
              asChild
            >
              <Link href="/register">
                Start Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-lg px-8 py-6 bg-white/10 border-white/20 text-white hover:bg-white/20 hover:scale-105 transition-all"
            >
              Schedule Demo
            </Button>
          </div>

          {/* Guarantee Badge */}
          <div className="flex items-center justify-center gap-2 mt-8 px-6 py-3 bg-white/10 rounded-full inline-flex mx-auto">
            <Shield className="h-5 w-5 text-green-300" />
            <span className="text-sm font-medium">14-Day Money-Back Guarantee</span>
          </div>

          <div className="mt-6 text-sm text-blue-100">
            No credit card required • 14-day free trial • Cancel anytime
          </div>
        </div>
      </div>
    </section>
  )
}
