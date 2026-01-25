import {
  Package,
  Boxes,
  Rocket,
  Building,
  Cloud,
  Users,
  Activity,
  Target,
  User,
  CreditCard,
  Bell,
  FileText,
  Book,
  Sparkles,
  Settings,
  DollarSign,
  Server,
  Network,
  Layers,
  Database,
  TrendingUp,
  Shield,
  Zap,
  Building2,
  type LucideIcon,
} from 'lucide-react';

// TypeScript interfaces
export interface NavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  badge?: string | number;
  description?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface NavGroup {
  label: string;
  sections?: NavSection[];
  items?: NavItem[];
}

// ============================================================
// APP NAVIGATION (Authenticated Users Only)
// ============================================================

// App Navigation - shown in authenticated TopNav
export const appNav: NavGroup = {
  label: 'Platform',
  sections: [
    {
      label: 'Core Features',
      items: [
        {
          label: 'Services',
          href: '/services',
          icon: Layers,
          description: 'Service catalog and management',
        },
        {
          label: 'Dependencies',
          href: '/dependencies',
          icon: Network,
          description: 'Service dependencies and relationships',
        },
        {
          label: 'Deployments',
          href: '/deployments',
          icon: Rocket,
          description: 'Deployment history and tracking',
        },
        {
          label: 'Infrastructure',
          href: '/infrastructure',
          icon: Server,
          description: 'Infrastructure resources overview',
        },
      ],
    },
    {
      label: 'Monitoring & Analytics',
      items: [
        {
          label: 'AWS Resources',
          href: '/aws-resources',
          icon: Database,
          description: 'AWS resource discovery and tracking',
        },
        {
          label: 'Teams',
          href: '/teams',
          icon: Users,
          description: 'Team management and collaboration',
        },
        {
          label: 'Monitoring',
          href: '/admin/monitoring',
          icon: Activity,
          description: 'Real-time monitoring and alerts',
        },
        {
          label: 'DORA Metrics',
          href: '/dora-metrics',
          icon: TrendingUp,
          description: 'DevOps performance metrics',
        },
      ],
    },
  ],
};

// Legacy alias for backward compatibility
export const platformNav = appNav;

// ============================================================
// MARKETING NAVIGATION (Public Pages Only)
// ============================================================

// Solutions Navigation - marketing content
export const solutionsNav: NavGroup = {
  label: 'Solutions',
  sections: [
    {
      label: 'By Team Size',
      items: [
        {
          label: 'Startups',
          href: '/solutions/startups',
          icon: Zap,
          description: 'For teams of 5-20 engineers',
        },
        {
          label: 'Mid-Market',
          href: '/solutions/mid-market',
          icon: Building,
          description: 'For teams of 20-100 engineers',
        },
        {
          label: 'Enterprise',
          href: '/solutions/enterprise',
          icon: Building2,
          description: 'For teams of 100+ engineers',
        },
      ],
    },
    {
      label: 'By Use Case',
      items: [
        {
          label: 'Cost Optimization',
          href: '/solutions/cost-optimization',
          icon: DollarSign,
          description: 'Reduce AWS spend by 15-30%',
        },
        {
          label: 'Security & Compliance',
          href: '/solutions/security',
          icon: Shield,
          description: 'Automated compliance scanning',
        },
        {
          label: 'Platform Engineering',
          href: '/solutions/platform-engineering',
          icon: Server,
          description: 'Internal developer portals',
        },
      ],
    },
  ],
};

// Resources Navigation (new - placeholders)
export const resourcesNav: NavGroup = {
  label: 'Resources',
  items: [
    {
      label: 'Documentation',
      href: '/docs',
      icon: Book,
      description: 'Complete guides and references',
    },
    {
      label: 'Getting Started',
      href: '/docs/getting-started',
      icon: Rocket,
      description: '2-minute setup guide',
    },
    {
      label: 'API Reference',
      href: '/docs/api',
      icon: FileText,
      description: 'REST API documentation',
    },
    {
      label: 'Blog',
      href: '/blog',
      icon: FileText,
      description: 'Platform engineering insights',
    },
    {
      label: 'System Status',
      href: '/status',
      icon: Activity,
      description: 'Real-time system status',
    },
    {
      label: 'Changelog',
      href: '/changelog',
      icon: Sparkles,
      description: "What's new in DevControl",
    },
  ],
};

// Marketing Standalone Links (shown in marketing nav only)
export const marketingStandaloneLinks: NavItem[] = [
  {
    label: 'Pricing',
    href: '/pricing',
  },
  {
    label: 'Enterprise',
    href: '/enterprise',
  },
  {
    label: 'Developers',
    href: '/developers',
  },
];

// Legacy alias (DO NOT USE in TopNav - this is for marketing only)
export const standaloneLinks = marketingStandaloneLinks;

// User Dropdown Navigation (enhanced version)
export const userNavSections: NavSection[] = [
  {
    label: 'Personal',
    items: [
      {
        label: 'Profile',
        href: '/profile',
        icon: User,
      },
      {
        label: 'Organization',
        href: '/settings/organization',
        icon: Building2,
      },
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
      },
    ],
  },
  {
    label: 'Billing',
    items: [
      {
        label: 'Billing & Usage',
        href: '/settings/billing',
        icon: CreditCard,
      },
      {
        label: 'View Pricing',
        href: '/pricing',
        icon: DollarSign,
      },
      {
        label: 'Alerts',
        href: '/admin/alerts',
        icon: Bell,
      },
      {
        label: 'Audit Logs',
        href: '/audit-logs',
        icon: Shield,
      },
    ],
  },
  {
    label: 'Help',
    items: [
      {
        label: 'Documentation',
        href: '/docs',
        icon: Book,
      },
      {
        label: "What's New",
        href: '/changelog',
        icon: Sparkles,
      },
    ],
  },
];

// Quick Actions for the "+ New" dropdown
export const quickActions: NavItem[] = [
  {
    label: 'Create Service',
    href: '/services/new',
    icon: Layers,
  },
  {
    label: 'Record Deployment',
    href: '/deployments/new',
    icon: Rocket,
  },
  {
    label: 'Add Infrastructure',
    href: '/infrastructure/new',
    icon: Server,
  },
  {
    label: 'Create Team',
    href: '/teams/new',
    icon: Users,
  },
];
