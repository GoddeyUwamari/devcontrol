'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  Server,
  DollarSign,
  Activity,
  AlertTriangle,
  Rocket,
  GitBranch,
  ExternalLink,
  Users,
  Globe,
  Database,
  Cloud,
  Layers,
  FileText,
  BarChart3,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import type { ServiceStatus } from '@/components/dashboard/service-health-grid';

export interface ServiceDetail {
  id: string;
  name: string;
  status: ServiceStatus;
  description?: string;
  techStack: string;
  environment: string;
  version?: string;
  team: string;
  teamMembers?: { name: string; role: string }[];
  uptime?: number;
  responseTime?: number;
  errorRate?: number;
  monthlyCoste?: number;
  activeAlerts?: number;
  recentDeployments?: {
    id: string;
    version: string;
    status: 'success' | 'failed' | 'in_progress';
    deployedAt: Date;
    deployedBy: string;
  }[];
  repositoryUrl?: string;
  lastDeployment?: Date;
}

interface ServiceDetailSlideOverProps {
  service: ServiceDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onEditService?: (service: ServiceDetail) => void;
  onDeployNow?: (service: ServiceDetail) => void;
}

const statusConfig = {
  healthy: {
    label: 'Healthy',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
    dotColor: 'bg-green-500',
  },
  warning: {
    label: 'Warning',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
    borderColor: 'border-yellow-200',
    dotColor: 'bg-yellow-500',
  },
  critical: {
    label: 'Critical',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
    dotColor: 'bg-red-500',
  },
  unknown: {
    label: 'Unknown',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200',
    dotColor: 'bg-gray-500',
  },
};

const techStackIcons: Record<string, React.ElementType> = {
  'Node.js': Server,
  'Python': Database,
  'React': Globe,
  'Go': Cloud,
  'Next.js': Globe,
  'PostgreSQL': Database,
  'Redis': Database,
  'default': Layers,
};

export function ServiceDetailSlideOver({
  service,
  isOpen,
  onClose,
  onEditService,
  onDeployNow,
}: ServiceDetailSlideOverProps) {
  const router = useRouter();

  // Close on ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!service) return null;

  const status = statusConfig[service.status];
  const TechIcon = techStackIcons[service.techStack] || techStackIcons.default;

  const formatCurrency = (amount?: number) => {
    if (amount === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const quickActions = [
    {
      label: 'View Deployments',
      icon: Rocket,
      href: `/app/deployments?service=${service.id}`,
    },
    {
      label: 'View Dependencies',
      icon: GitBranch,
      href: `/app/dependencies?service=${service.id}`,
    },
    {
      label: 'View Logs',
      icon: FileText,
      href: `/app/monitoring/logs?service=${service.id}`,
    },
    {
      label: 'View Metrics',
      icon: BarChart3,
      href: `/app/monitoring?service=${service.id}`,
    },
  ];

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Slide-over panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="px-6 py-6 border-b border-gray-200 bg-gray-50">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`h-12 w-12 rounded-lg ${status.bgColor} flex items-center justify-center`}>
                    <TechIcon className={`h-6 w-6 ${status.color}`} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{service.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className={`${status.bgColor} ${status.color} border ${status.borderColor}`}>
                        <span className={`h-2 w-2 rounded-full ${status.dotColor} mr-1.5`} />
                        {status.label}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        {service.environment}
                      </Badge>
                      {service.version && (
                        <Badge variant="outline" className="font-mono text-xs">
                          v{service.version}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {service.description && (
                  <p className="text-sm text-gray-600 mt-2">{service.description}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="ml-4 p-2 rounded-lg hover:bg-gray-200 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6">
              {/* Health Metrics */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-gray-500" />
                  Health Metrics
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {service.uptime?.toFixed(2)}%
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Uptime</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {service.responseTime}ms
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Response Time</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 text-center">
                    <div className={`text-2xl font-bold ${(service.errorRate || 0) > 2 ? 'text-red-600' : 'text-gray-900'}`}>
                      {service.errorRate?.toFixed(1)}%
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">Error Rate</div>
                  </div>
                </div>
              </div>

              {/* Team & Owner */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Users className="h-5 w-5 text-gray-500" />
                  Team
                </h3>
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-700">Owner Team</span>
                    <Badge variant="outline">{service.team}</Badge>
                  </div>
                  {service.teamMembers && service.teamMembers.length > 0 && (
                    <div className="space-y-2 pt-3 border-t border-gray-200">
                      {service.teamMembers.map((member, index) => (
                        <div key={index} className="flex items-center justify-between text-sm">
                          <span className="text-gray-900">{member.name}</span>
                          <span className="text-gray-500">{member.role}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Cost & Alerts */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <DollarSign className="h-4 w-4" />
                    Monthly Cost
                  </div>
                  <div className="text-xl font-bold text-gray-900">
                    {formatCurrency(service.monthlyCoste)}/mo
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    Active Alerts
                  </div>
                  <div className={`text-xl font-bold ${(service.activeAlerts || 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {service.activeAlerts || 0}
                  </div>
                </div>
              </div>

              {/* Recent Deployments */}
              {service.recentDeployments && service.recentDeployments.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Rocket className="h-5 w-5 text-gray-500" />
                    Recent Deployments
                  </h3>
                  <div className="space-y-3">
                    {service.recentDeployments.slice(0, 5).map((deployment) => (
                      <div
                        key={deployment.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-2 w-2 rounded-full ${
                              deployment.status === 'success'
                                ? 'bg-green-500'
                                : deployment.status === 'failed'
                                ? 'bg-red-500'
                                : 'bg-blue-500 animate-pulse'
                            }`}
                          />
                          <div>
                            <div className="font-mono text-sm font-medium text-gray-900">
                              v{deployment.version}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              by {deployment.deployedBy}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge
                            variant="secondary"
                            className={
                              deployment.status === 'success'
                                ? 'bg-green-100 text-green-700'
                                : deployment.status === 'failed'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-blue-100 text-blue-700'
                            }
                          >
                            {deployment.status === 'in_progress' ? 'Deploying' : deployment.status}
                          </Badge>
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(deployment.deployedAt, { addSuffix: true })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Repository Link */}
              {service.repositoryUrl && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-gray-500" />
                    Repository
                  </h3>
                  <a
                    href={service.repositoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                  >
                    <span className="text-sm font-medium text-blue-600">
                      {service.repositoryUrl.replace('https://github.com/', '')}
                    </span>
                    <ExternalLink className="h-4 w-4 text-gray-400" />
                  </a>
                </div>
              )}

              {/* Quick Navigation Actions */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Layers className="h-5 w-5 text-gray-500" />
                  Quick Navigation
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {quickActions.map((action) => (
                    <Button
                      key={action.label}
                      variant="outline"
                      className="justify-start h-auto py-3"
                      onClick={() => {
                        onClose();
                        router.push(action.href);
                      }}
                    >
                      <action.icon className="h-4 w-4 mr-2 text-gray-500" />
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1">
                Close
              </Button>
              <div className="flex gap-2">
                {onEditService && (
                  <Button
                    variant="outline"
                    onClick={() => onEditService(service)}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Edit Service
                  </Button>
                )}
                {onDeployNow && (
                  <Button
                    onClick={() => onDeployNow(service)}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Rocket className="h-4 w-4 mr-2" />
                    Deploy Now
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
