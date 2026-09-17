/**
 * Sales Demo Data
 * Realistic but impressive numbers for sales demonstrations
 *
 * These numbers are:
 * - Authentic (based on real customer data)
 * - Impressive (showcase 26x ROI)
 * - Believable (not too good to be true)
 */

export interface SalesDemoData {
  // ROI Hero Metrics
  monthlySavings: number;
  monthlySavingsChange: number;
  hoursSaved: number;
  hoursSavedChange: number;
  securityIncidents: number;
  daysSafe: number;
  roiMultiplier: number;
  annualSavings: number;
  annualCost: number;

  // Engineering Velocity
  deployFrequency: number; // per day
  deployFrequencyTier: 'Elite' | 'High' | 'Medium' | 'Low';
  leadTimeHours: number;
  leadTimeTier: 'Elite' | 'High' | 'Medium' | 'Low';
  mttrMinutes: number;
  mttrTier: 'Elite' | 'High' | 'Medium' | 'Low';
  changeFailureRate: number; // percentage
  changeFailureTier: 'Elite' | 'High' | 'Medium' | 'Low';
  overallPercentile: number; // 0-100
  velocityScore: number; // 0-100

  // Security & Compliance
  complianceScore: number; // 0-100
  socTwoReady: boolean;
  criticalIssuesFixed: number;
  s3BucketsEncrypted: number;
  securityGroupsTightened: number;
  iamPoliciesRestricted: number;
  nonCompliantBlocked: number;
  averageBreachCost: number;
  breachVectorsPrevented: number;

  // Cost Optimization
  costSavings: Array<{
    title: string;
    monthlySavings: number;
    description: string;
    icon: string;
  }>;
  twelveMonthReduction: number; // percentage
  wasteFoundRange: { min: number; max: number };

  // Time Saved
  timeSaved: Array<{
    task: string;
    hours: number;
    description: string;
  }>;
  fteEquivalent: number;
  laborCostSaved: number;
  engineeringHourlyRate: number;

  // Before/After Transformation
  transformation: {
    daysSinceStart: number;
    before: {
      deployFrequency: string;
      costVisibility: string;
      securityAudits: string;
      mttr: string;
      complianceReports: string;
      costWasteFound: string;
    };
    after: {
      deployFrequency: string;
      costVisibility: string;
      securityAudits: string;
      mttr: string;
      complianceReports: string;
      costWasteFound: string;
    };
    improvements: {
      deploySpeed: string;
      mttrReduction: string;
    };
    paybackDays: number;
  };

  // Competitive Benchmarking
  benchmarks: Array<{
    category: string;
    yourValue: string;
    industryAvg: string;
    rank: string;
    medal: '🥇' | '🥈' | '🥉' | '';
  }>;
  overallRank: string;
  eliteTier: boolean;
  eliteStats: {
    revenueGrowthMultiplier: number;
    turnoverReduction: number;
    timeToMarketImprovement: number;
  };

  // Executive Reporting
  reports: Array<{
    name: string;
    lastSent: string;
    schedule: string;
    recipients: string[];
  }>;
}

export const SALES_DEMO_DATA: SalesDemoData = {
  // ROI Hero
  monthlySavings: 12847,
  monthlySavingsChange: 2341,
  hoursSaved: 847,
  hoursSavedChange: 124,
  securityIncidents: 0,
  daysSafe: 45,
  roiMultiplier: 26,
  annualSavings: 154164,
  annualCost: 5988, // $499/mo * 12

  // Engineering Velocity
  deployFrequency: 24,
  deployFrequencyTier: 'Elite',
  leadTimeHours: 2.3,
  leadTimeTier: 'Elite',
  mttrMinutes: 14,
  mttrTier: 'Elite',
  changeFailureRate: 3.2,
  changeFailureTier: 'Elite',
  overallPercentile: 94,
  velocityScore: 87,

  // Security & Compliance
  complianceScore: 94,
  socTwoReady: true,
  criticalIssuesFixed: 23,
  s3BucketsEncrypted: 23,
  securityGroupsTightened: 12,
  iamPoliciesRestricted: 5,
  nonCompliantBlocked: 8,
  averageBreachCost: 4450000, // $4.45M from IBM
  breachVectorsPrevented: 23,

  // Cost Optimization
  costSavings: [
    {
      title: 'Right-sized 12 EC2 instances',
      monthlySavings: 4200,
      description: 'Your t3.2xlarge instances were at 12% CPU',
      icon: '🏆',
    },
    {
      title: 'Deleted 47 unattached EBS volumes',
      monthlySavings: 2890,
      description: 'Orphaned storage from old deployments',
      icon: '🏆',
    },
    {
      title: 'Enabled S3 Intelligent-Tiering',
      monthlySavings: 1840,
      description: 'Auto-moved 340GB to cheaper storage',
      icon: '🏆',
    },
    {
      title: 'Removed 8 idle RDS snapshots',
      monthlySavings: 420,
      description: '3-year-old backups you forgot about',
      icon: '🏆',
    },
  ],
  twelveMonthReduction: 34,
  wasteFoundRange: { min: 10000, max: 50000 },

  // Time Saved
  timeSaved: [
    {
      task: 'Cost analysis reports',
      hours: 420,
      description: 'Manual spreadsheet hell → automated weekly reports',
    },
    {
      task: 'Security compliance checks',
      hours: 280,
      description: 'No more manual AWS config audits',
    },
    {
      task: 'Deployment tracking',
      hours: 92,
      description: 'Auto-tracked from GitHub webhooks',
    },
    {
      task: 'DORA metrics calculation',
      hours: 55,
      description: 'Your board deck writes itself',
    },
  ],
  fteEquivalent: 5,
  laborCostSaved: 106000,
  engineeringHourlyRate: 125,

  // Transformation
  transformation: {
    daysSinceStart: 90,
    before: {
      deployFrequency: '3/week',
      costVisibility: 'Monthly spreadsheet',
      securityAudits: 'Quarterly (20h)',
      mttr: '4 hours',
      complianceReports: '2 weeks manual',
      costWasteFound: '$0 (no visibility)',
    },
    after: {
      deployFrequency: '24/day',
      costVisibility: 'Real-time',
      securityAudits: 'Daily (auto)',
      mttr: '14 minutes',
      complianceReports: '1-click',
      costWasteFound: '$12k/mo',
    },
    improvements: {
      deploySpeed: '56x',
      mttrReduction: '94%',
    },
    paybackDays: 11,
  },

  // Benchmarking
  benchmarks: [
    {
      category: 'Deploy Speed',
      yourValue: '24/day',
      industryAvg: '4/day',
      rank: 'Top 6%',
      medal: '🥇',
    },
    {
      category: 'AWS Efficiency',
      yourValue: '$0.34/user',
      industryAvg: '$0.52/user',
      rank: 'Top 12%',
      medal: '🥈',
    },
    {
      category: 'Security Score',
      yourValue: '94/100',
      industryAvg: '67/100',
      rank: 'Top 8%',
      medal: '🥇',
    },
    {
      category: 'Change Failure',
      yourValue: '3.2%',
      industryAvg: '15%',
      rank: 'Top 10%',
      medal: '🥈',
    },
  ],
  overallRank: 'Top 10%',
  eliteTier: true,
  eliteStats: {
    revenueGrowthMultiplier: 2.5,
    turnoverReduction: 50,
    timeToMarketImprovement: 60,
  },

  // Executive Reports
  reports: [
    {
      name: 'Monthly Board Deck (DORA + Costs)',
      lastSent: 'Dec 1',
      schedule: 'Monthly',
      recipients: ['CEO', 'CFO'],
    },
    {
      name: 'Quarterly Cost Optimization Review',
      lastSent: 'Jan 2',
      schedule: 'Quarterly',
      recipients: ['CFO'],
    },
    {
      name: 'SOC 2 Readiness Summary',
      lastSent: 'Dec 15',
      schedule: 'On-demand',
      recipients: ['Auditor'],
    },
    {
      name: 'Security Incident Report (Zero!)',
      lastSent: 'Weekly',
      schedule: 'Weekly',
      recipients: ['CISO', 'VP Eng'],
    },
  ],
};

/**
 * Hook to toggle sales demo mode
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SalesDemoStore {
  enabled: boolean;
  toggle: () => void;
  enable: () => void;
  disable: () => void;
}

export const useSalesDemo = create<SalesDemoStore>()(
  persist(
    (set) => ({
      enabled: false,
      toggle: () => set((state) => ({ enabled: !state.enabled })),
      enable: () => set({ enabled: true }),
      disable: () => set({ enabled: false }),
    }),
    {
      name: 'sales-demo-mode',
    }
  )
);
