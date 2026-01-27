'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * PricingPreview Component
 *
 * Mini pricing section showing all tiers at a glance.
 * Drives users to full pricing page for details.
 */

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    resources: '20 resources',
    highlight: 'For personal projects',
    highlighted: false,
  },
  {
    name: 'Starter',
    price: '$79',
    period: '/month',
    resources: '60 resources',
    highlight: 'For small teams',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$299',
    period: '/month',
    resources: '500 resources',
    highlight: 'Most popular',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    resources: 'Unlimited',
    highlight: 'For large orgs',
    highlighted: false,
  },
]

export function PricingPreview() {
  return (
    <section className="py-24 bg-white">
      <div className="container mx-auto px-4">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <p className="text-sm font-semibold text-[#635BFF] uppercase tracking-wide mb-3">
            Pricing
          </p>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-xl text-muted-foreground">
            Start free, upgrade as you grow. All plans include a 14-day trial.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto mb-10">
          {tiers.map((tier, index) => (
            <Card
              key={index}
              className={cn(
                'relative transition-all duration-300 hover:shadow-lg',
                tier.highlighted
                  ? 'border-2 border-[#635BFF] shadow-lg scale-105'
                  : 'border hover:border-gray-300'
              )}
            >
              {tier.highlighted && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#635BFF] hover:bg-[#635BFF]">
                  Most Popular
                </Badge>
              )}
              <CardContent className="p-6 text-center">
                <h3 className="font-semibold text-lg mb-2">{tier.name}</h3>
                <div className="mb-3">
                  <span className="text-3xl font-bold">{tier.price}</span>
                  <span className="text-muted-foreground text-sm">
                    {tier.period}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  {tier.resources}
                </p>
                <p className="text-xs text-[#635BFF] font-medium">
                  {tier.highlight}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center">
          <Button
            variant="outline"
            size="lg"
            className="group"
            asChild
          >
            <Link href="/pricing">
              See full pricing comparison
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </Button>
        </div>

        {/* Trust Signals */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
            <span>14-day free trial</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
            <span>Cancel anytime</span>
          </div>
        </div>
      </div>
    </section>
  )
}
