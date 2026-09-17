import { Shield, FileCheck, Clock } from 'lucide-react';

export const securityMetrics = [
  {
    icon: Shield,
    value: '200+',
    label: 'Security Checks',
    description:
      'Comprehensive scanning across IAM, network, encryption, logging, and resource configurations.',
  },
  {
    icon: FileCheck,
    value: '3',
    label: 'Compliance Frameworks',
    description:
      'Security Hub-backed evaluation for CIS, PCI DSS, and NIST 800-53 — plus SOC 2 readiness planning underway.',
  },
  {
    icon: Clock,
    value: '24/7',
    label: 'Continuous Monitoring',
    description:
      'Real-time detection of security misconfigurations and compliance violations as they occur.',
  },
];
