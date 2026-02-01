/**
 * WelcomeHero Component
 * Clean, Weglot-inspired hero section for dashboard empty state
 * No gradient borders, realistic dashboard preview, better whitespace
 */

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Rocket, Check, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DashboardMockup } from './DashboardMockup';

export function WelcomeHero() {
  const router = useRouter();

  return (
    <div className="bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <div className="mx-auto max-w-7xl px-4 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left side - Content */}
          <div className="text-center lg:text-left">
            {/* Rocket Icon */}
            <div className="mb-6 flex justify-center lg:justify-start">
              <div className="rounded-full bg-gradient-to-br from-blue-100 to-purple-100 p-4 shadow-md">
                <Rocket className="h-10 w-10 text-[#635BFF]" />
              </div>
            </div>

            {/* Heading */}
            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
              <span className="text-gray-900">Welcome to</span>
              <br />
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                DevControl
              </span>
            </h1>

            {/* Description - Subheadline 1 */}
            <p className="mx-auto lg:mx-0 mb-4 max-w-xl text-xl leading-relaxed text-gray-700">
              Your AI-powered AWS infrastructure command center for engineering teams scaling from 5 to 500 engineers.
            </p>

            {/* Description - Subheadline 2 */}
            <p className="mx-auto lg:mx-0 mb-6 max-w-xl text-lg leading-relaxed text-gray-600">
              Monitor services, track deployments, optimize costs, ensure security, and centralize team governance—all in one powerful dashboard.
            </p>

            {/* Closing Line - Benefits */}
            <p className="mx-auto lg:mx-0 mb-8 max-w-xl text-xl font-semibold text-gray-900">
              Ship faster. Spend less. Reduce risk.
            </p>

            {/* CTAs */}
            <div className="mb-6 flex flex-col items-center lg:items-start gap-3 sm:flex-row">
              <Button
                size="lg"
                className="bg-[#635BFF] hover:bg-[#4f46e5] text-white px-8 py-3 text-base font-semibold shadow-lg hover:shadow-xl transition-all"
                onClick={() => router.push('/settings/organization?tab=aws')}
              >
                Connect AWS Account
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-2 border-gray-300 hover:border-gray-400 text-gray-700 hover:bg-gray-50 px-8 py-3 text-base font-semibold transition-all"
                onClick={() => router.push('/services/new')}
              >
                <PlayCircle className="mr-2 h-5 w-5" />
                Watch Demo
              </Button>
            </div>

            {/* Inline Trust Badges */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span>3-minute setup</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span>Read-only access</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span>99.9% uptime</span>
              </div>
            </div>
          </div>

          {/* Right side - Realistic Dashboard Mockup */}
          <div className="hidden lg:block">
            <DashboardMockup />
          </div>
        </div>
      </div>
    </div>
  );
}
