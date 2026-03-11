import {
  Layers,
  GitBranch,
  Workflow,
  FileText,
  BarChart3,
  Shield,
} from 'lucide-react';

export const platformFeatures = [
  {
    icon: Layers,
    title: 'Service Catalog',
    description:
      'Auto-discovered inventory of all services with ownership, dependencies, SLOs, and documentation. Always up-to-date, never stale.',
  },
  {
    icon: GitBranch,
    title: 'Golden Paths',
    description:
      'Pre-built templates for common patterns—new services, databases, queues. Developers follow the paved road, platform teams maintain standards.',
  },
  {
    icon: Workflow,
    title: 'Self-Service Workflows',
    description:
      'Enable developers to provision resources, create environments, and manage infrastructure without filing tickets or waiting.',
  },
  {
    icon: FileText,
    title: 'Living Documentation',
    description:
      'Auto-generated docs from infrastructure state. Architecture diagrams, dependency maps, and runbooks that update themselves.',
  },
  {
    icon: BarChart3,
    title: 'DORA Metrics',
    description:
      'Track deployment frequency, lead time, MTTR, and change failure rate. Measure what matters for engineering effectiveness.',
  },
  {
    icon: Shield,
    title: 'Guardrails & Standards',
    description:
      'Enforce organizational standards without blocking developers. Policy-as-code that guides instead of gates.',
  },
];
