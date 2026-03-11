import {
  Shield,
  UserX,
  Network,
  FileSearch,
  Bell,
  FileText,
} from 'lucide-react';

export const securityFeatures = [
  {
    icon: Shield,
    title: 'Security Posture Scoring',
    description:
      'Real-time security score across your entire AWS environment. Track improvements over time and benchmark against industry standards.',
  },
  {
    icon: UserX,
    title: 'IAM Risk Analysis',
    description:
      'Identify overly permissive policies, unused credentials, and excessive admin access. Get actionable recommendations to reduce blast radius.',
  },
  {
    icon: Network,
    title: 'Network Security',
    description:
      'Detect open security groups, public S3 buckets, unencrypted data stores, and misconfigured VPCs before attackers do.',
  },
  {
    icon: FileSearch,
    title: 'Configuration Drift Detection',
    description:
      'Monitor resources for unauthorized changes. Get alerted when configurations deviate from your approved baselines.',
  },
  {
    icon: Bell,
    title: 'Real-Time Alerts',
    description:
      'Instant notifications via Slack, PagerDuty, or email when critical security issues are detected. Customizable severity thresholds.',
  },
  {
    icon: FileText,
    title: 'Audit-Ready Reports',
    description:
      'Generate compliance reports for auditors with one click. Evidence collection automated for SOC 2, HIPAA, and other frameworks.',
  },
];
