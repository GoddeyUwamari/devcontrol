'use client'

import { Shield, Clock, CheckCircle2, Award } from 'lucide-react'

/**
 * CompanyLogos Component - UPDATED
 *
 * Previously displayed fake company logos. Now shows trust indicators instead.
 * NOTE: Add real customer logos only with written permission.
 */
export function CompanyLogos() {
  const trustIndicators = [
    { icon: Shield, label: 'Enterprise Security' },
    { icon: Clock, label: '3-min Setup' },
    { icon: CheckCircle2, label: 'Read-Only Access' },
    { icon: Award, label: '99.9% Uptime' },
  ]

  return (
    <div className="mb-20">
      <p className="text-center text-sm text-muted-foreground mb-6">
        Trusted by engineering teams from startups to Fortune 500 companies
      </p>
      <div className="flex flex-wrap items-center justify-center gap-8">
        {trustIndicators.map((item, index) => {
          const Icon = item.icon
          return (
            <div
              key={index}
              className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-lg border border-gray-100"
            >
              <Icon className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
