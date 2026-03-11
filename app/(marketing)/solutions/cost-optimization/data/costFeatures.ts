import {
  Search,
  TrendingDown,
  PieChart,
  Bell,
  Calculator,
  Trash2,
} from 'lucide-react';

export const costFeatures = [
  {
    icon: Search,
    title: 'Unused Resource Detection',
    description:
      'Automatically identify idle EC2 instances, unattached EBS volumes, unused Elastic IPs, and orphaned snapshots costing you money.',
  },
  {
    icon: TrendingDown,
    title: 'Rightsizing Recommendations',
    description:
      'AI-powered analysis of CPU, memory, and network utilization to recommend optimal instance types and sizes.',
  },
  {
    icon: Calculator,
    title: 'Reserved Instance Advisor',
    description:
      'Analyze your usage patterns and get recommendations for Reserved Instances and Savings Plans that maximize discounts.',
  },
  {
    icon: PieChart,
    title: 'Cost Allocation',
    description:
      'Track spending by team, project, environment, or any custom dimension. Automatic tag enforcement and gap detection.',
  },
  {
    icon: Bell,
    title: 'Budget Alerts',
    description:
      'Set budgets at any level and get alerts before you exceed them. Anomaly detection catches unexpected spend spikes.',
  },
  {
    icon: Trash2,
    title: 'Waste Elimination',
    description:
      'One-click cleanup of development resources, old snapshots, and unused storage. Safe deletion with rollback protection.',
  },
];
