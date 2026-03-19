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
  services: 'Services Overview',
  deployments: 'Deployments',
  dependencies: 'Dependencies',
  infrastructure: 'Infrastructure',
  'aws-resources': 'AWS Resources',
  teams: 'Teams',
  monitoring: 'Monitoring',
  'dora-metrics': 'Engineering Performance',
  'connect-aws': 'Connect AWS',
  'recommendations': 'Recommendations',
  'tenants': 'Tenants',
  'status': 'Status',
  settings: 'Settings',
  billing: 'Billing',
  integrations: 'Integrations',
  profile: 'Profile',
  organization: 'Organization',
  pricing: 'Pricing',
  'audit-logs': 'Audit Logs',
  'security':   'Security Overview',
  'anomalies':  'Anomalies',
  'compliance': 'Compliance',
  'frameworks': 'Compliance',
  enterprise: 'Enterprise',
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
  new: 'Add Resource',
  developers: 'Developers',
  'costs': 'Cost Overview',
  'cost-optimization': 'Optimization',
  'forecast': 'Forecast',
  'invoices': 'Invoices',
  'ai-reports': 'AI Reports',
};

const parentPaths: Record<string, { label: string; href: string }[]> = {
  '/deployments':      [{ label: 'Services', href: '/services' }],
  '/dependencies':     [{ label: 'Services', href: '/services' }],
  '/services/new':     [],
  '/recommendations':  [{ label: 'Infrastructure', href: '/infrastructure' }],
  '/tenants':          [{ label: 'Infrastructure', href: '/infrastructure' }],
  '/infrastructure/new':             [],
  '/infrastructure/recommendations': [{ label: 'Infrastructure', href: '/infrastructure' }],
  '/status':           [{ label: 'Observability',  href: '/observability'  }],
  '/app/dora-metrics': [{ label: 'DevOps',         href: '/devops'         }],
  '/dora-metrics':     [{ label: 'DevOps',         href: '/devops'         }],
  '/connect-aws':      [],
  '/teams':            [{ label: 'DevOps', href: '/devops' }],
  '/enterprise':       [{ label: 'DevOps', href: '/devops' }],
  '/developers':       [{ label: 'DevOps', href: '/devops' }],
  '/cost-optimization': [{ label: 'Costs', href: '/costs' }],
  '/forecast':          [{ label: 'Costs', href: '/costs' }],
  '/invoices':          [{ label: 'Costs', href: '/costs' }],
  '/ai-reports':        [{ label: 'Costs', href: '/costs' }],
  '/monitoring':      [{ label: 'Observability', href: '/monitoring' }],
  '/monitoring/slos': [{ label: 'Observability', href: '/monitoring' }],
  '/anomalies':             [{ label: 'Security', href: '/security' }],
  '/compliance/frameworks': [{ label: 'Security', href: '/security' }],
  '/audit-logs':            [{ label: 'Security', href: '/security' }],
};

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
    const segments = pathname.split('/').filter((s) => Boolean(s) && s !== 'app' && s !== 'compliance');

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

    const parents = parentPaths[pathname] ?? [];
    parents.forEach((parent) => {
      breadcrumbs.push({
        label: parent.label,
        href: parent.href,
      });
    });

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
