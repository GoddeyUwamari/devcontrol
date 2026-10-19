'use client'

import { Rocket, GitBranch, TrendingUp, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface ChecklistStep {
  id: string
  number: number
  title: string
  description: string
  icon: React.ReactNode
  isCompleted: boolean
  isCurrent: boolean
  action: {
    label: string
    href?: string
    onClick?: () => void
  }
}

const steps: ChecklistStep[] = [
  {
    id: 'create-service',
    number: 1,
    title: 'Create Service',
    description: 'Register your first application',
    icon: <Rocket className="w-6 h-6" />,
    isCompleted: false,
    isCurrent: true,
    action: {
      label: 'Go to Services',
      href: '/services',
    },
  },
  {
    id: 'connect-github',
    number: 2,
    title: 'Connect CI/CD',
    description: 'Link GitHub Actions or GitLab',
    icon: <GitBranch className="w-6 h-6" />,
    isCompleted: false,
    isCurrent: false,
    action: {
      label: 'Connect Now',
      href: '/settings/integrations',
    },
  },
  {
    id: 'deploy',
    number: 3,
    title: 'First Deploy',
    description: 'Ship code to production',
    icon: <TrendingUp className="w-6 h-6" />,
    isCompleted: false,
    isCurrent: false,
    action: {
      label: 'View Guide',
      href: 'https://docs.example.com/deploy',
    },
  },
  {
    id: 'view-metrics',
    number: 4,
    title: 'Track Metrics',
    description: 'Unlock DORA analytics',
    icon: <BarChart3 className="w-6 h-6" />,
    isCompleted: false,
    isCurrent: false,
    action: {
      label: 'Auto-unlocks',
      href: '#',
    },
  },
]

function StepCard({ step }: { step: ChecklistStep }) {
  const isDisabled = !step.isCompleted && !step.isCurrent

  return (
    <div
      className={`rounded-lg border-2 p-4 text-center transition-all ${
        step.isCompleted
          ? 'bg-green-50 border-green-300'
          : step.isCurrent
          ? 'bg-blue-50 border-blue-400 shadow-sm'
          : 'bg-gray-50 border-gray-200 opacity-70'
      }`}
    >
      {/* Step Number */}
      <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm mx-auto mb-3">
        {step.number}
      </div>

      {/* Icon */}
      <div className={`mb-3 flex justify-center ${
        step.isCurrent ? 'text-blue-600' : step.isCompleted ? 'text-green-600' : 'text-gray-500'
      }`}>
        {step.icon}
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold mb-1">{step.title}</h3>

      {/* Description */}
      <p className="text-xs text-gray-600 mb-3">{step.description}</p>

      {/* CTA */}
      {step.action.href && step.action.href !== '#' ? (
        <Link href={step.action.href}>
          <Button
            size="sm"
            variant={step.isCurrent ? 'default' : 'outline'}
            disabled={isDisabled}
            className="w-full text-xs"
          >
            {step.action.label}
          </Button>
        </Link>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={true}
          className="w-full text-xs text-gray-500"
        >
          {step.action.label}
        </Button>
      )}
    </div>
  )
}

export function DeploymentSetupChecklist() {
  return (
    <div className="border rounded-lg p-5 bg-white">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h3 className="text-lg font-semibold mb-1">
            🚀 Get Started in 4 Steps
          </h3>
          <p className="text-sm text-gray-600">
            Complete these steps to unlock deployment tracking and DORA metrics
          </p>
        </div>

        {/* Steps - Horizontal 4 Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {steps.map((step) => (
            <StepCard key={step.id} step={step} />
          ))}
        </div>
      </div>
    </div>
  )
}
