/**
 * TrustIndicators Component
 * Security badges and compliance indicators
 */

'use client';

import React from 'react';
import { Shield, Lock, Eye, FileCheck, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const securityFeatures = [
  {
    icon: <Lock className="h-5 w-5" />,
    title: 'End-to-End Encryption',
    description: 'All data encrypted in transit and at rest with AES-256',
  },
  {
    icon: <Eye className="h-5 w-5" />,
    title: 'Read-Only Access',
    description: 'We never modify your AWS resources or infrastructure',
  },
  {
    icon: <FileCheck className="h-5 w-5" />,
    title: 'Audit Logging',
    description: 'Complete audit trail of all user actions and system events',
  },
  {
    icon: <Shield className="h-5 w-5" />,
    title: 'Role-Based Access',
    description: 'Granular permissions and team-based access controls',
  },
];

const complianceBadges = [
  { name: 'Enterprise Security', status: 'Bank-level encryption' },
  { name: 'GDPR', status: 'Compliant' },
  { name: 'Data Protection', status: 'AES-256 encryption' },
  { name: 'Access Control', status: 'Role-based' },
];

export function TrustIndicators() {
  return (
    <div className="py-16 bg-white">
      {/* Section Header */}
      <div className="mb-12 text-center">
        <Badge className="mb-4 bg-green-50 text-green-600 border-green-200 hover:bg-green-100">
          <Shield className="h-3 w-3 mr-1" />
          Security & Compliance
        </Badge>
        <h2 className="mb-4 text-3xl font-bold text-gray-900 md:text-4xl">
          Enterprise-Grade Security
        </h2>
        <p className="text-lg text-gray-600 max-w-3xl mx-auto">
          Your security is our top priority. DevControl is built with industry-leading security
          standards and compliance certifications
        </p>
      </div>

      <div className="max-w-6xl mx-auto">
        {/* Compliance Badges */}
        <div className="mb-12">
          <div className="flex flex-wrap items-center justify-center gap-6">
            {complianceBadges.map((badge, index) => (
              <Card
                key={index}
                className="group border-2 border-gray-200 hover:border-green-400 transition-all duration-300 hover:shadow-lg animate-in fade-in zoom-in"
                style={{ animationDelay: `${index * 100}ms`, animationDuration: '500ms' }}
              >
                <CardContent className="p-6 text-center min-w-[140px]">
                  <div className="mb-2">
                    <Shield className="h-10 w-10 text-green-600 mx-auto" />
                  </div>
                  <div className="font-bold text-gray-900 mb-1">{badge.name}</div>
                  <div className="text-xs text-green-600 font-medium">{badge.status}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Security Features Grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          {securityFeatures.map((feature, index) => (
            <Card
              key={index}
              className="border-2 border-gray-200 hover:border-[#7c3aed]/50 transition-all duration-300 hover:shadow-lg animate-in fade-in slide-in-from-bottom-4"
              style={{ animationDelay: `${index * 100 + 400}ms`, animationDuration: '600ms' }}
            >
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-green-50 text-green-600 flex-shrink-0">
                    {feature.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 mb-2">{feature.title}</h3>
                    <p className="text-sm text-gray-600">{feature.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="text-center p-8 bg-gradient-to-br from-green-50 to-blue-50 rounded-2xl border-2 border-green-200">
          <h3 className="text-xl font-bold text-gray-900 mb-3">
            Want to learn more about our security practices?
          </h3>
          <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
            Read our comprehensive security documentation and compliance reports
          </p>
          <button className="inline-flex items-center gap-2 bg-[#7c3aed] hover:bg-[#4f46e5] text-white px-6 py-3 rounded-lg font-medium transition-all hover:scale-105">
            <span>View Security Details</span>
            <ArrowRight className="h-4 w-4" />
          </button>

          {/* Trust indicators */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Regular security audits</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>24/7 monitoring</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>99.9% uptime SLA</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
