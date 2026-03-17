/**
 * useBreadcrumbs Hook
 * Auto-generates breadcrumbs from current route path
 */

'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { BreadcrumbItem } from '@/components/ui/breadcrumb';

// Map of route segments to readable labels
const routeLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  services: 'Services',
  deployments: 'Deployments',
  dependencies: 'Dependencies',
  infrastructure: 'Infrastructure',
  'aws-resources': 'AWS Resources',
  teams: 'Teams',
  monitoring: 'Monitoring',
  'dora-metrics': 'DORA Metrics',
  settings: 'Settings',
  billing: 'Billing',
  integrations: 'Integrations',
  profile: 'Profile',
  organization: 'Organization',
  pricing: 'Pricing',
  'audit-logs': 'Audit Logs',
  alerts: 'Alerts',
  'cost-recommendations': 'Cost Recommendations',
  aws: 'AWS',
  platform: 'Platform',
  admin: 'Observability',
  observability: 'Observability',
  'alert-history': 'Alert History',
  slos: 'SLO Dashboard',
  users: 'Users',
  api: 'API',
  docs: 'Documentation',
  help: 'Help',
  support: 'Support',
  new: 'Create Service',
};

const parentPaths: Record<string, { label: string; href: string }> = {
  '/deployments':  { label: 'Services', href: '/services' },
  '/dependencies': { label: 'Services', href: '/services' },
}

/**
 * Hook to generate breadcrumbs from current pathname
 * @param customLabels - Optional override labels for dynamic segments (e.g., IDs)
 * @returns Array of breadcrumb items
 */
export function useBreadcrumbs(
  customLabels?: Record<string, string>
): BreadcrumbItem[] {
  const pathname = usePathname();

  return useMemo(() => {
    // Remove leading/trailing slashes and split path
    const segments = pathname.split('/').filter(Boolean);

    // If we're on root or login, don't show breadcrumbs
    if (segments.length === 0 || segments[0] === 'login') {
      return [];
    }

    // Always start with Dashboard (home)
    const breadcrumbs: BreadcrumbItem[] = [
      {
        label: 'Dashboard',
        href: '/dashboard',
      },
    ]

    const parent = parentPaths[pathname]
    if (parent) {
      breadcrumbs.push({
        label: parent.label,
        href: parent.href,
      })
    }

    // Build breadcrumbs from path segments
    let currentPath = '';
    segments.forEach((segment, index) => {
      currentPath += `/${segment}`;

      // Skip the first segment if it's just 'dashboard'
      if (segment === 'dashboard' && index === 0) {
        // Update the dashboard breadcrumb to be current if we're on /dashboard
        if (segments.length === 1) {
          breadcrumbs[0].current = true;
          breadcrumbs[0].href = undefined;
        }
        return;
      }

      // Check if segment is a UUID or numeric ID
      const isUUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        segment
      );
      const isNumericId = /^\d+$/.test(segment);
      const isId = isUUID || isNumericId;

      let label: string;
      if (isId && customLabels?.[segment]) {
        // Use custom label if provided (e.g., service name instead of ID)
        label = customLabels[segment];
      } else if (isId) {
        // Show shortened ID for UUIDs, or full numeric ID
        label = isUUID ? `${segment.slice(0, 8)}...` : `#${segment}`;
      } else {
        // Use route label map or format segment
        label = routeLabels[segment] || formatSegment(segment);
      }

      // Last segment is current page (no link)
      const isLast = index === segments.length - 1;

      breadcrumbs.push({
        label,
        href: isLast ? undefined : currentPath,
        current: isLast,
      });
    });

    return breadcrumbs;
  }, [pathname, customLabels]);
}

/**
 * Format segment: 'aws-resources' -> 'AWS Resources'
 */
function formatSegment(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
