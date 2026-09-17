'use client';

import { Lock, Zap, BadgeCheck } from 'lucide-react';

const badges = [
  {
    icon: Lock,
    text: 'Bank-Level Encryption',
    subtext: 'AES-256 & TLS 1.3',
    color: 'text-green-600 dark:text-green-400',
  },
  {
    icon: BadgeCheck,
    text: 'Enterprise Security',
    subtext: 'SOC 2 readiness planned',
    color: 'text-amber-600 dark:text-amber-400',
  },
  {
    icon: Zap,
    text: '99.9% Uptime SLA',
    subtext: 'Enterprise reliability',
    color: 'text-purple-600 dark:text-purple-400',
  },
];

export function TrustBadges() {
  return (
    <div className="py-10 border-t border-b bg-muted/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {badges.map((badge, index) => {
            const Icon = badge.icon;
            return (
              <div key={index} className="flex items-center gap-3 justify-center md:justify-start">
                <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${badge.color}`} />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-foreground">{badge.text}</p>
                  <p className="text-xs text-muted-foreground">{badge.subtext}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
