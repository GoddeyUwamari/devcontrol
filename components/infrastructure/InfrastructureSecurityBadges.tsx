import { Shield, Lock, CheckCircle, Clock, Award } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface SecurityFeature {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function InfrastructureSecurityBadges() {
  const features: SecurityFeature[] = [
    {
      icon: <Shield className="w-5 h-5" />,
      title: 'Bank-Level Encryption',
      description: 'AES-256 encryption for data at rest and in transit',
    },
    {
      icon: <Lock className="w-5 h-5" />,
      title: 'Read-Only Access',
      description: 'We never modify your infrastructure',
    },
    {
      icon: <CheckCircle className="w-5 h-5" />,
      title: 'Enterprise Security',
      description: 'Bank-level security standards',
    },
    {
      icon: <Clock className="w-5 h-5" />,
      title: '99.9% Uptime SLA',
      description: 'Enterprise-grade reliability guarantee',
    },
    {
      icon: <Award className="w-5 h-5" />,
      title: 'AWS Integration',
      description: 'Secure AWS API access',
    },
  ];

  return (
    <div className="bg-gradient-to-br from-slate-50 to-gray-50 rounded-lg border border-slate-200 p-8">
      <div className="text-center mb-6">
        <h2 className="text-xl md:text-2xl font-semibold text-gray-900 mb-2">
          Enterprise-Grade Security & Compliance
        </h2>
        <p className="text-sm text-muted-foreground">
          Your infrastructure data is protected with industry-leading security standards
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {features.map((feature, index) => (
          <div
            key={index}
            className="bg-white rounded-lg border border-slate-200 p-4 text-center hover:shadow-sm transition-shadow"
          >
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600 mx-auto mb-3">
              {feature.icon}
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">
              {feature.title}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {feature.description}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="bg-white">
          AES-256 Encryption
        </Badge>
        <Badge variant="outline" className="bg-white">
          TLS 1.3
        </Badge>
      </div>
    </div>
  );
}
