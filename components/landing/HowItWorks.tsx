'use client'

import { Link2, BarChart3, Zap } from 'lucide-react'

/**
 * HowItWorks Component
 *
 * 3-step process section explaining how DevControl works.
 * Builds confidence by showing simplicity of setup.
 */

const steps = [
  {
    number: 1,
    title: 'Connect AWS',
    description: 'Deploy a read-only IAM role in 2 minutes. No credentials stored, fully secure.',
    icon: Link2,
    color: 'blue',
  },
  {
    number: 2,
    title: 'Instant Insights',
    description: 'See costs, security posture, and resource health across all accounts instantly.',
    icon: BarChart3,
    color: 'purple',
  },
  {
    number: 3,
    title: 'Take Action',
    description: 'Optimize costs, fix security issues, and improve performance with one-click actions.',
    icon: Zap,
    color: 'green',
  },
]

const colorClasses = {
  blue: {
    bg: 'bg-blue-100',
    text: 'text-blue-600',
    border: 'border-blue-200',
    number: 'bg-blue-600',
  },
  purple: {
    bg: 'bg-purple-100',
    text: 'text-purple-600',
    border: 'border-purple-200',
    number: 'bg-purple-600',
  },
  green: {
    bg: 'bg-green-100',
    text: 'text-green-600',
    border: 'border-green-200',
    number: 'bg-green-600',
  },
}

export function HowItWorks() {
  return (
    <section className="py-24 bg-gray-50">
      <div className="container mx-auto px-4">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-sm font-semibold text-[#635BFF] uppercase tracking-wide mb-3">
            Simple Setup
          </p>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Get started in minutes
          </h2>
          <p className="text-xl text-muted-foreground">
            No complex configuration. No agents to install. Just connect and go.
          </p>
        </div>

        {/* Steps Grid */}
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* Connecting Line (desktop only) */}
            <div className="hidden md:block absolute top-16 left-[16.67%] right-[16.67%] h-0.5 bg-gradient-to-r from-blue-200 via-purple-200 to-green-200" />

            {steps.map((step, index) => {
              const Icon = step.icon
              const colors = colorClasses[step.color as keyof typeof colorClasses]

              return (
                <div
                  key={index}
                  className="relative text-center animate-in fade-in slide-in-from-bottom-4"
                  style={{
                    animationDelay: `${index * 150}ms`,
                    animationDuration: '600ms',
                  }}
                >
                  {/* Step Number */}
                  <div className="relative inline-flex mb-6">
                    <div
                      className={`w-32 h-32 rounded-2xl ${colors.bg} flex items-center justify-center relative z-10`}
                    >
                      <Icon className={`h-12 w-12 ${colors.text}`} />
                    </div>
                    {/* Number Badge */}
                    <div
                      className={`absolute -top-2 -right-2 w-8 h-8 ${colors.number} rounded-full flex items-center justify-center text-white font-bold text-sm shadow-lg z-20`}
                    >
                      {step.number}
                    </div>
                  </div>

                  {/* Content */}
                  <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
