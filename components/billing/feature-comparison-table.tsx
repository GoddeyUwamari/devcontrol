'use client';

import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, X } from 'lucide-react';

interface Feature {
  category: string;
  name: string;
  free: boolean | string;
  starter: boolean | string;
  pro: boolean | string;
  enterprise: boolean | string;
}

const features: Feature[] = [
  // Resources
  { category: 'Resources', name: 'AWS Resources', free: '20', starter: '50', pro: '500', enterprise: 'Unlimited' },
  { category: 'Resources', name: 'Resource Types', free: '3 types', starter: '10 types', pro: 'All types', enterprise: 'All types' },
  { category: 'Resources', name: 'Multi-region support', free: true, starter: true, pro: true, enterprise: true },

  // Security & Compliance
  { category: 'Security', name: 'Basic security flags', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Security', name: 'Advanced security scanning', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Security', name: 'Compliance scanning (SOC 2, HIPAA, PCI)', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Security', name: 'Custom compliance frameworks', free: false, starter: false, pro: false, enterprise: true },
  { category: 'Security', name: 'Auto-remediation workflows', free: false, starter: false, pro: false, enterprise: true },

  // Cost Management
  { category: 'Cost Management', name: 'Total cost visibility', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Cost attribution by team/service', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Orphaned resource detection', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Savings recommendations', free: false, starter: true, pro: true, enterprise: true },

  // Features
  { category: 'Features', name: 'Manual tagging', free: '5 at a time', starter: '25 at a time', pro: 'Unlimited', enterprise: 'Unlimited' },
  { category: 'Features', name: 'Bulk actions', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Features', name: 'Bulk remediation', free: false, starter: false, pro: false, enterprise: true },
  { category: 'Features', name: 'Risk score & trends', free: false, starter: false, pro: true, enterprise: true },

  // Reports & Integrations
  { category: 'Reports', name: 'Export reports (CSV/PDF)', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Reports', name: 'Scheduled reports', free: false, starter: false, pro: false, enterprise: true },
  { category: 'Reports', name: 'Slack alerts', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Reports', name: 'Email alerts', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Reports', name: 'Ticket creation (Jira/Linear)', free: false, starter: false, pro: true, enterprise: true },

  // API & Advanced
  { category: 'API', name: 'API access', free: false, starter: false, pro: false, enterprise: true },
  { category: 'API', name: 'API requests/hour', free: '500', starter: '2,000', pro: '5,000', enterprise: '20,000' },

  // Team & Support
  { category: 'Team', name: 'Team members', free: '1', starter: '5', pro: '10', enterprise: 'Unlimited' },
  { category: 'Team', name: 'Role-based access control', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Team', name: 'SSO/SAML', free: false, starter: false, pro: false, enterprise: true },

  // Support
  { category: 'Support', name: 'Email support', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Support', name: 'Priority support', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Support', name: 'Dedicated support', free: false, starter: false, pro: false, enterprise: true },
  { category: 'Support', name: 'SLA guarantee', free: false, starter: false, pro: false, enterprise: true },
];

function FeatureValue({ value }: { value: boolean | string }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="w-5 h-5 text-green-600 dark:text-green-400 mx-auto" />
    ) : (
      <X className="w-5 h-5 text-muted-foreground/30 mx-auto" />
    );
  }
  return <span className="text-sm font-medium">{value}</span>;
}

export function FeatureComparisonTable() {
  const categories = Array.from(new Set(features.map((f) => f.category)));

  return (
    <div className="py-16">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Compare Plans</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Detailed feature comparison across all pricing tiers
          </p>
        </div>

        <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[250px] font-semibold">Feature</TableHead>
                  <TableHead className="text-center font-semibold">Free</TableHead>
                  <TableHead className="text-center font-semibold">Starter</TableHead>
                  <TableHead className="text-center font-semibold bg-primary/5">Pro</TableHead>
                  <TableHead className="text-center font-semibold">Enterprise</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => {
                  const categoryFeatures = features.filter((f) => f.category === category);
                  return (
                    <React.Fragment key={category}>
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={5} className="font-semibold text-sm py-3">
                          {category}
                        </TableCell>
                      </TableRow>
                      {categoryFeatures.map((feature, index) => (
                        <TableRow key={`${category}-${index}`}>
                          <TableCell className="font-medium">{feature.name}</TableCell>
                          <TableCell className="text-center">
                            <FeatureValue value={feature.free} />
                          </TableCell>
                          <TableCell className="text-center">
                            <FeatureValue value={feature.starter} />
                          </TableCell>
                          <TableCell className="text-center bg-primary/5">
                            <FeatureValue value={feature.pro} />
                          </TableCell>
                          <TableCell className="text-center">
                            <FeatureValue value={feature.enterprise} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          All plans include 14-day free trial (except Free tier). No credit card required.
        </p>
      </div>
    </div>
  );
}
