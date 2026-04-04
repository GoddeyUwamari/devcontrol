import { TrendingDown, Shield, Target, Layers, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ValueProp {
  icon: React.ReactNode;
  title: string;
  description: string;
  benefits: string[];
  metric: string;
  metricLabel: string;
  iconBgColor: string;
  iconTextColor: string;
  metricColor: string;
}

export function InfrastructureValueProps() {
  const props: ValueProp[] = [
    {
      icon: <TrendingDown className="w-6 h-6" />,
      title: 'Prevent Budget Overruns',
      description: 'Catch cost spikes within hours, not on your monthly bill—preventing budget overruns that average $15K per incident',
      benefits: [
        'Real-time cost anomaly detection',
        'Instant Slack/email alerts on spikes',
        'Granular cost breakdown by service',
        'Forecast future spend with ML',
      ],
      metric: '$2,400',
      metricLabel: 'Average savings per month',
      iconBgColor: 'bg-green-100',
      iconTextColor: 'text-green-600',
      metricColor: 'bg-green-50 text-green-700 border-green-200',
    },
    {
      icon: <Shield className="w-6 h-6" />,
      title: 'Infrastructure Visibility for Compliance',
      description: 'Eliminate shadow IT with 100% infrastructure visibility—required for SOC 2 compliance and security audits',
      benefits: [
        'Complete resource inventory in real-time',
        'Automated compliance reporting',
        'Track all changes with audit trails',
        'Tag enforcement for governance',
      ],
      metric: '10,000+',
      metricLabel: 'Resources tracked per account',
      iconBgColor: 'bg-blue-100',
      iconTextColor: 'text-blue-600',
      metricColor: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      icon: <Target className="w-6 h-6" />,
      title: 'Stop Wasting Money on Orphaned Resources',
      description: 'Prevent wasted spend on forgotten infrastructure—teams recover an average of $18K annually in orphaned resources',
      benefits: [
        'Auto-detect idle EC2 & RDS instances',
        'Find unattached EBS volumes',
        'Identify unused Elastic IPs',
        'Right-sizing recommendations',
      ],
      metric: '12-18%',
      metricLabel: 'Average cost reduction',
      iconBgColor: 'bg-orange-100',
      iconTextColor: 'text-orange-600',
      metricColor: 'bg-orange-50 text-orange-700 border-orange-200',
    },
    {
      icon: <Layers className="w-6 h-6" />,
      title: 'Unified Multi-Account Management',
      description: 'Unified visibility across unlimited AWS accounts—saving engineering teams 20+ hours monthly on manual reconciliation',
      benefits: [
        'Single dashboard for all accounts',
        'Cross-account cost comparison',
        'Consolidated billing insights',
        'Team-based access controls',
      ],
      metric: '20 hrs',
      metricLabel: 'Time saved per month',
      iconBgColor: 'bg-purple-100',
      iconTextColor: 'text-purple-600',
      metricColor: 'bg-purple-50 text-purple-700 border-purple-200',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 mb-3">
          Infrastructure Visibility That Drives Business Value
        </h2>
        <p className="text-base text-muted-foreground max-w-3xl mx-auto">
          Enterprise-grade AWS observability with measurable ROI. Our customers save an average of $28,000 annually.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {props.map((prop, index) => (
          <div
            key={index}
            className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 hover:shadow-lg hover:border-blue-300 transition-all group"
          >
            {/* Icon */}
            <div className={`w-12 h-12 ${prop.iconBgColor} rounded-lg flex items-center justify-center ${prop.iconTextColor} mb-4`}>
              {prop.icon}
            </div>

            {/* Title */}
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {prop.title}
            </h3>

            {/* Description */}
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              {prop.description}
            </p>

            {/* Metric Badge */}
            <div className="mb-4">
              <Badge className={`${prop.metricColor} border px-3 py-1.5 font-bold text-base`}>
                {prop.metric}
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">
                {prop.metricLabel}
              </p>
            </div>

            {/* Benefits List */}
            <ul className="space-y-2 mb-4">
              {prop.benefits.map((benefit, idx) => (
                <li key={idx} className="flex items-start text-xs text-gray-600">
                  <span className="text-green-500 mr-2 mt-0.5 flex-shrink-0">✓</span>
                  {benefit}
                </li>
              ))}
            </ul>

            {/* Learn More Link */}
            <div className="pt-4 border-t border-gray-100">
              <a
                href="/platform/infrastructure"
                className="text-sm font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 group-hover:gap-2 transition-all"
              >
                Learn more
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom CTA */}
      <div className="text-center pt-6">
        <p className="text-sm font-medium text-gray-700">
          See how your team can achieve similar results with a free 14-day trial
        </p>
      </div>
    </div>
  );
}
