/**
 * FinalCTA Component
 * Enhanced call-to-action section for bottom of page
 */

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Rocket, ArrowRight, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function FinalCTA() {
  const router = useRouter();

  return (
    <div className="py-20 bg-gradient-to-br from-blue-600 via-purple-600 to-blue-700 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-10 left-10 w-72 h-72 bg-white rounded-full blur-3xl animate-pulse" style={{ animationDuration: '4s' }} />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-white rounded-full blur-3xl animate-pulse" style={{ animationDuration: '6s', animationDelay: '1s' }} />
      </div>

      <div className="relative max-w-4xl mx-auto text-center px-4">
        {/* Icon */}
        <div className="mb-6 flex justify-center">
          <div className="p-4 bg-white/10 backdrop-blur-sm rounded-2xl animate-in zoom-in duration-700">
            <Rocket className="h-16 w-16 text-white" />
          </div>
        </div>

        {/* Badge */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-full text-white text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            <span>Start saving on AWS costs today</span>
          </div>
        </div>

        {/* Heading */}
        <h2 className="mb-6 text-4xl md:text-5xl lg:text-6xl font-bold text-white">
          Ready to Optimize Your
          <span className="block mt-2">AWS Infrastructure?</span>
        </h2>

        {/* Subheading */}
        <p className="mb-10 text-xl md:text-2xl text-blue-100 max-w-2xl mx-auto">
          Start your free 14-day trial today. No credit card required. Set up in under 2 hours.
        </p>

        {/* CTAs */}
        <div className="mb-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            size="lg"
            className="bg-white hover:bg-gray-100 text-[#7c3aed] px-10 py-7 text-lg font-bold shadow-2xl transition-all duration-200 hover:scale-105 hover:shadow-3xl"
            onClick={() => router.push('/settings/organization?tab=aws')}
          >
            <Rocket className="mr-2 h-6 w-6" />
            Start Free Trial
            <ArrowRight className="ml-2 h-6 w-6" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-2 border-white text-white hover:bg-white hover:text-[#7c3aed] px-10 py-7 text-lg font-bold transition-all duration-200 hover:scale-105"
            onClick={() => router.push('/services/new')}
          >
            Schedule Demo
          </Button>
        </div>

        {/* Trust signals */}
        <div className="flex flex-wrap items-center justify-center gap-6 text-white/90 text-sm">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-300" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-300" />
            <span>14-day free trial</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-300" />
            <span>Cancel anytime</span>
          </div>
        </div>

        {/* Additional trust elements */}
        <div className="mt-12 pt-8 border-t border-white/20">
          <p className="text-blue-100 text-sm mb-4">Trusted by engineering teams from startups to Fortune 500</p>
          <div className="flex flex-wrap items-center justify-center gap-6 text-white/80 text-sm">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>Enterprise Security</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>Read-Only Access</span>
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>99.9% Uptime SLA</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
