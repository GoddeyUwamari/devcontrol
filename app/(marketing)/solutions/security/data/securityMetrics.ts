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
    value: '6',
    label: 'Compliance Frameworks',
    description:
      'Built-in support for SOC 2, HIPAA, PCI-DSS, GDPR, ISO 27001, and CIS Benchmarks.',
  },
  {
    icon: Clock,
    value: '24/7',
    label: 'Continuous Monitoring',
    description:
      'Real-time detection of security misconfigurations and compliance violations as they occur.',
  },
];
