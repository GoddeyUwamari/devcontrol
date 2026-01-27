'use client'

import { StatsRow } from './StatsRow'
import { Shield, Lock, Award, Cloud } from 'lucide-react'

/**
 * SocialProofSection Component
 *
 * Displays trust badges and statistics to build credibility.
 * Updated messaging for pre-launch (no customer logos yet).
 */
export function SocialProofSection() {
  const badges = [
    { icon: Cloud, label: 'AWS Partner', color: 'text-blue-600' },
    { icon: Shield, label: 'SOC 2 Ready', color: 'text-blue-500' },
    { icon: Lock, label: 'GDPR Compliant', color: 'text-green-500' },
    { icon: Award, label: 'ISO 27001', color: 'text-purple-500' },
  ]

  return (
    <section className="py-24 bg-gradient-to-b from-white to-gray-50">
      <div className="container mx-auto px-4">
        {/* Section Header */}
        <div className="text-center mb-12">
          <p className="text-sm font-semibold text-[#635BFF] uppercase tracking-wide mb-3">
            Why Teams Trust Us
          </p>
          <h2 className="text-4xl font-bold mb-4">
            Built for platform engineering teams
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Enterprise-grade security and reliability, designed by engineers who understand your challenges
          </p>
        </div>

        {/* Trust Badges */}
        <div className="flex flex-wrap items-center justify-center gap-8 mb-16">
          {badges.map((badge, index) => {
            const Icon = badge.icon
            return (
              <div
                key={index}
                className="flex items-center gap-3 px-6 py-3 bg-white rounded-full border shadow-sm hover:shadow-md transition-shadow"
              >
                <Icon className={`h-5 w-5 ${badge.color}`} />
                <span className="font-medium text-gray-700">{badge.label}</span>
              </div>
            )
          })}
        </div>

        {/* Stats Row */}
        <StatsRow />
      </div>
    </section>
  )
}
