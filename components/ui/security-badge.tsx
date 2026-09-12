'use client';

import { Shield, Lock, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface SecurityBadgeProps {
  className?: string;
  variant?: 'default' | 'compact';
}

export function SecurityBadge({ className, variant = 'default' }: SecurityBadgeProps) {
  const certifications = [
    { name: 'SOC 2 Type II', status: 'in-progress', icon: Clock },
    { name: 'GDPR Compliant', status: 'compliant', icon: Check },
    { name: 'SSL/TLS Encryption', status: 'active', icon: Check },
    { name: 'Data Encryption at Rest', status: 'active', icon: Check },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'certified':
      case 'active':
        return 'text-green-600 dark:text-green-400';
      case 'compliant':
        return 'text-blue-600 dark:text-blue-400';
      case 'in-progress':
        return 'text-yellow-600 dark:text-yellow-400';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'certified':
        return 'Certified';
      case 'active':
        return 'Active';
      case 'compliant':
        return 'Compliant';
      case 'in-progress':
        return 'In Progress';
      default:
        return status;
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
              'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
              'border border-blue-200 dark:border-blue-800',
              'cursor-help transition-all hover:border-blue-300 dark:hover:border-blue-700',
              className
            )}
          >
            <Shield className="w-3 h-3" />
            {variant === 'default' && <span>Enterprise Security</span>}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs p-3">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-medium">Security & Compliance</span>
            </div>
            <div className="space-y-2">
              {certifications.map((cert) => (
                <div
                  key={cert.name}
                  className="flex items-center justify-between text-xs gap-3"
                >
                  <span className="text-muted-foreground">
                    {cert.name}
                  </span>
                  <span
                    className={cn(
                      'font-medium flex items-center gap-1',
                      getStatusColor(cert.status)
                    )}
                  >
                    {cert.status === 'in-progress' ? (
                      <Clock className="w-3 h-3" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                    {getStatusLabel(cert.status)}
                  </span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-border">
              <a
                href="/security"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View security details →
              </a>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
