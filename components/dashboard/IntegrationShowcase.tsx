/**
 * IntegrationShowcase Component
 * Displays AWS service integrations
 */

'use client';

import React from 'react';
import { Server, Database, HardDrive, Network, Lock, Code, ArrowRight, Cloud } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface IntegrationCategory {
  category: string;
  icon: React.ReactNode;
  services: string[];
  color: string;
  bgColor: string;
}

const integrations: IntegrationCategory[] = [
  {
    category: 'Compute',
    icon: <Server className="h-6 w-6" />,
    services: ['EC2', 'Lambda', 'ECS', 'EKS', 'Fargate', 'Batch'],
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  {
    category: 'Storage',
    icon: <HardDrive className="h-6 w-6" />,
    services: ['S3', 'EBS', 'EFS', 'Glacier', 'FSx', 'Backup'],
    color: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  {
    category: 'Database',
    icon: <Database className="h-6 w-6" />,
    services: ['RDS', 'DynamoDB', 'Aurora', 'Redshift', 'ElastiCache', 'Neptune'],
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
  {
    category: 'Networking',
    icon: <Network className="h-6 w-6" />,
    services: ['VPC', 'CloudFront', 'Route 53', 'ELB', 'API Gateway', 'Direct Connect'],
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
  },
  {
    category: 'Security',
    icon: <Lock className="h-6 w-6" />,
    services: ['IAM', 'KMS', 'Secrets Manager', 'WAF', 'Shield', 'GuardDuty'],
    color: 'text-red-600',
    bgColor: 'bg-red-50',
  },
  {
    category: 'Developer Tools',
    icon: <Code className="h-6 w-6" />,
    services: ['CodePipeline', 'CodeBuild', 'CodeDeploy', 'CodeCommit', 'X-Ray', 'CloudWatch'],
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
  },
];

export function IntegrationShowcase() {
  return (
    <div className="py-16 bg-white">
      {/* Section Header */}
      <div className="mb-12 text-center">
        <Badge className="mb-4 bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100">
          <Cloud className="h-3 w-3 mr-1" />
          Integrations
        </Badge>
        <h2 className="mb-4 text-3xl font-bold text-gray-900 md:text-4xl">
          Works with Your Existing Stack
        </h2>
        <p className="text-lg text-gray-600 max-w-3xl mx-auto">
          DevControl integrates seamlessly with 50+ AWS services across all major categories
        </p>
      </div>

      {/* Integration Categories Grid */}
      <div className="max-w-6xl mx-auto grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration, index) => (
          <Card
            key={index}
            className="group border-2 border-gray-200 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-[#7c3aed]/50 animate-in fade-in slide-in-from-bottom-4"
            style={{ animationDelay: `${index * 100}ms`, animationDuration: '600ms' }}
          >
            <CardContent className="p-6">
              {/* Category header */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-3 rounded-lg ${integration.bgColor} ${integration.color} transition-transform duration-300 group-hover:scale-110`}>
                  {integration.icon}
                </div>
                <h3 className="text-lg font-bold text-gray-900">{integration.category}</h3>
              </div>

              {/* Services badges */}
              <div className="flex flex-wrap gap-2">
                {integration.services.map((service, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-xs border-gray-300 hover:border-[#7c3aed] hover:bg-[#7c3aed]/10 transition-colors"
                  >
                    {service}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* View all link */}
      <div className="mt-10 text-center">
        <button className="inline-flex items-center gap-2 text-[#7c3aed] hover:text-[#4f46e5] font-medium text-lg group">
          <span>View all 50+ integrations</span>
          <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>

      {/* Bottom stats */}
      <div className="mt-12 pt-8 border-t border-gray-200">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div>
            <div className="text-3xl font-bold text-gray-900 mb-1">50+</div>
            <div className="text-sm text-gray-600">AWS Services</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-900 mb-1">12</div>
            <div className="text-sm text-gray-600">AWS Regions</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-900 mb-1">100K+</div>
            <div className="text-sm text-gray-600">Resources Monitored</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-900 mb-1">24/7</div>
            <div className="text-sm text-gray-600">Live Monitoring</div>
          </div>
        </div>
      </div>
    </div>
  );
}
