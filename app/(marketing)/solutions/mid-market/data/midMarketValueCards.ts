import {
  Users,
  Shield,
  BarChart3,
  GitBranch,
  Layers,
  Bell,
} from 'lucide-react';

export const midMarketValueCards = [
  {
    icon: Users,
    title: 'Multi-Team Management',
    description:
      'Organize resources by team with role-based access control. Each team sees what they own without stepping on others.',
  },
  {
    icon: Shield,
    title: 'Compliance Automation',
    description:
      'Continuous scanning against CIS, PCI-DSS, and NIST 800-53 via AWS Security Hub, plus SOC 2 readiness planning to help prepare for your independent audit.',
  },
  {
    icon: BarChart3,
    title: 'Cost Attribution',
    description:
      'Track cloud spend by team, project, or environment. Set budgets and get alerts before overruns happen.',
  },
  {
    icon: GitBranch,
    title: 'Change Intelligence',
    description:
      'Correlate deployments with incidents. See exactly what changed and who changed it when issues arise.',
  },
  {
    icon: Layers,
    title: 'Service Catalog',
    description:
      'Maintain a living inventory of all services, their owners, dependencies, and documentation in one place.',
  },
  {
    icon: Bell,
    title: 'Smart Alerting',
    description:
      'Route alerts to the right team via Slack, PagerDuty, or email. Reduce noise with intelligent deduplication.',
  },
];
