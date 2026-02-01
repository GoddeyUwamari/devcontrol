'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Cloud,
  Server,
  Database,
  Globe,
  Search,
  LayoutGrid,
  List,
  ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export type ServiceStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export interface ServiceHealth {
  id: string;
  name: string;
  icon?: React.ElementType;
  status: ServiceStatus;
  lastDeployment?: Date;
  version?: string;
  environment?: string;
  responseTime?: number;
  errorRate?: number;
  uptime?: number;
}

interface ServiceHealthGridProps {
  services: ServiceHealth[];
  isLoading?: boolean;
  viewMode?: 'grid' | 'list';
  onServiceClick?: (service: ServiceHealth) => void;
  onViewAll?: () => void;
}

const statusConfig = {
  healthy: {
    icon: '●',
    label: 'Healthy',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
  },
  warning: {
    icon: '⚠️',
    label: 'Warning',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
    borderColor: 'border-yellow-200',
  },
  critical: {
    icon: '●',
    label: 'Critical',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
  },
  unknown: {
    icon: '●',
    label: 'Unknown',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200',
  },
};

const defaultIcons: Record<string, React.ElementType> = {
  api: Server,
  database: Database,
  web: Globe,
  default: Cloud,
};

function ServiceCard({
  service,
  onClick,
  compact = false,
}: {
  service: ServiceHealth;
  onClick?: (service: ServiceHealth) => void;
  compact?: boolean;
}) {
  const status = statusConfig[service.status];
  const Icon = service.icon || defaultIcons.default;

  // Build dynamic className based on status
  const cardClassName = `
    bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-xl transition-all duration-200 rounded-xl
    ${onClick ? 'cursor-pointer hover:-translate-y-0.5' : ''}
    ${service.status === 'critical' ? 'ring-2 ring-red-500/30 border-red-200' : ''}
    ${service.status === 'warning' ? 'border-yellow-200' : ''}
    ${status.borderColor} border-l-4
  `.trim();

  return (
    <Card className={cardClassName} onClick={() => onClick?.(service)}>
      <CardContent className={compact ? 'p-5' : 'p-6'}>
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`h-10 w-10 rounded-lg ${status.bgColor} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`h-5 w-5 ${status.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className={`text-sm font-semibold text-gray-900 truncate ${service.status === 'critical' ? 'font-bold' : ''}`}>
                {service.name}
              </h4>
              {service.environment && (
                <p className="text-xs text-muted-foreground font-mono">
                  {service.environment}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div className="mb-3">
          <Badge
            variant="secondary"
            className={`${status.bgColor} ${status.color} border-0 ${service.status === 'critical' ? 'text-sm font-bold' : ''}`}
          >
            {/* Enhanced status dot with ping animation for critical */}
            <span className="relative flex h-3 w-3 mr-2">
              {service.status === 'critical' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${
                  service.status === 'healthy'
                    ? 'bg-green-500'
                    : service.status === 'warning'
                    ? 'bg-blue-500'
                    : service.status === 'critical'
                    ? 'bg-red-500 animate-pulse'
                    : 'bg-gray-400'
                }`}
              ></span>
            </span>
            {status.label}
          </Badge>
        </div>

        {/* Metrics */}
        {!compact && (
          <div className="space-y-2 mb-3">
            {service.responseTime !== undefined && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Response time:</span>
                <span className={`font-semibold ${service.status === 'critical' ? 'text-base' : ''}`}>
                  {service.responseTime}ms
                </span>
              </div>
            )}
            {service.errorRate !== undefined && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Error rate:</span>
                <span
                  className={`font-semibold ${service.errorRate > 5 ? 'text-red-600' : 'text-gray-900'} ${
                    service.status === 'critical' ? 'text-base' : ''
                  }`}
                >
                  {service.errorRate.toFixed(1)}%
                </span>
              </div>
            )}
            {service.uptime !== undefined && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Uptime:</span>
                <span className={`font-semibold ${service.status === 'critical' ? 'text-base' : ''}`}>
                  {service.uptime.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-xs text-muted-foreground border-t pt-2 mt-2">
          {service.lastDeployment ? (
            <span>Deployed {formatDistanceToNow(service.lastDeployment, { addSuffix: true })}</span>
          ) : (
            <span>No deployments</span>
          )}
          {service.version && (
            <span className="ml-2 font-mono text-gray-500">v{service.version}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceListItem({
  service,
  onClick,
}: {
  service: ServiceHealth;
  onClick?: (service: ServiceHealth) => void;
}) {
  const status = statusConfig[service.status];
  const Icon = service.icon || defaultIcons.default;

  // Build dynamic className based on status
  const listItemClassName = `
    flex items-center gap-4 p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm transition-all duration-200
    ${onClick ? 'cursor-pointer hover:bg-gray-50 hover:shadow-xl hover:-translate-y-0.5' : ''}
    ${service.status === 'critical' ? 'ring-2 ring-red-500/30 border-red-200' : ''}
    ${service.status === 'warning' ? 'border-yellow-200' : ''}
    ${status.borderColor} border-l-4
  `.trim();

  return (
    <div className={listItemClassName} onClick={() => onClick?.(service)}>
      {/* Icon */}
      <div className={`h-10 w-10 rounded-lg ${status.bgColor} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`h-5 w-5 ${status.color}`} />
      </div>

      {/* Name & Status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className={`text-sm font-semibold text-gray-900 truncate ${service.status === 'critical' ? 'font-bold' : ''}`}>
            {service.name}
          </h4>
          <Badge
            variant="secondary"
            className={`${status.bgColor} ${status.color} border-0 text-xs ${service.status === 'critical' ? 'font-bold' : ''}`}
          >
            {/* Enhanced status dot with ping animation for critical */}
            <span className="relative flex h-3 w-3 mr-1.5">
              {service.status === 'critical' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${
                  service.status === 'healthy'
                    ? 'bg-green-500'
                    : service.status === 'warning'
                    ? 'bg-blue-500'
                    : service.status === 'critical'
                    ? 'bg-red-500 animate-pulse'
                    : 'bg-gray-400'
                }`}
              ></span>
            </span>
            {status.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {service.environment && <span className="font-mono mr-2">{service.environment}</span>}
          {service.lastDeployment && (
            <span>Deployed {formatDistanceToNow(service.lastDeployment, { addSuffix: true })}</span>
          )}
        </p>
      </div>

      {/* Metrics */}
      <div className="hidden md:flex items-center gap-6 text-xs">
        {service.responseTime !== undefined && (
          <div className="text-center">
            <div className="text-muted-foreground mb-0.5">Response</div>
            <div className={`font-semibold ${service.status === 'critical' ? 'text-sm' : ''}`}>
              {service.responseTime}ms
            </div>
          </div>
        )}
        {service.errorRate !== undefined && (
          <div className="text-center">
            <div className="text-muted-foreground mb-0.5">Error Rate</div>
            <div
              className={`font-semibold ${service.errorRate > 5 ? 'text-red-600' : ''} ${
                service.status === 'critical' ? 'text-sm' : ''
              }`}
            >
              {service.errorRate.toFixed(1)}%
            </div>
          </div>
        )}
        {service.uptime !== undefined && (
          <div className="text-center">
            <div className="text-muted-foreground mb-0.5">Uptime</div>
            <div className={`font-semibold ${service.status === 'critical' ? 'text-sm' : ''}`}>
              {service.uptime.toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      {/* Arrow */}
      <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
    </div>
  );
}

function ServiceSkeleton({ viewMode }: { viewMode: 'grid' | 'list' }) {
  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-4 p-4 border rounded-lg">
        <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start gap-3 mb-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <Skeleton className="h-6 w-20 mb-3" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ServiceHealthGrid({
  services,
  isLoading,
  viewMode: initialViewMode = 'grid',
  onServiceClick,
  onViewAll,
}: ServiceHealthGridProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ServiceStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialViewMode);

  // Filter services
  const filteredServices = services.filter((service) => {
    const matchesSearch = service.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || service.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Status counts
  const statusCounts = {
    all: services.length,
    healthy: services.filter((s) => s.status === 'healthy').length,
    warning: services.filter((s) => s.status === 'warning').length,
    critical: services.filter((s) => s.status === 'critical').length,
  };

  const filterOptions: { value: ServiceStatus | 'all'; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: statusCounts.all },
    { value: 'healthy', label: 'Healthy', count: statusCounts.healthy },
    { value: 'warning', label: 'Warning', count: statusCounts.warning },
    { value: 'critical', label: 'Critical', count: statusCounts.critical },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>Service Health Status</CardTitle>
            <CardDescription>Monitor the health of all your services</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* View Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <Button
                variant={viewMode === 'grid' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('grid')}
                className={`h-8 px-3 ${viewMode === 'grid' ? 'bg-white shadow-sm' : ''}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('list')}
                className={`h-8 px-3 ${viewMode === 'list' ? 'bg-white shadow-sm' : ''}`}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            {onViewAll && (
              <Button variant="outline" size="sm" onClick={onViewAll}>
                View all
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search services..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                variant={statusFilter === option.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(option.value)}
                className="h-9"
              >
                {option.label}
                <Badge variant="secondary" className="ml-2 px-1.5 py-0.5">
                  {option.count}
                </Badge>
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className={viewMode === 'grid' ? 'grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'space-y-4'}>
            {[...Array(8)].map((_, i) => (
              <ServiceSkeleton key={i} viewMode={viewMode} />
            ))}
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="text-center py-12">
            <Server className="h-12 w-12 mx-auto mb-3 text-gray-400" />
            <p className="text-sm font-medium text-gray-900">No services found</p>
            <p className="text-sm text-muted-foreground mt-1">
              {search || statusFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Add your first service to get started'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredServices.map((service) => (
              <ServiceCard key={service.id} service={service} onClick={onServiceClick} />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredServices.map((service) => (
              <ServiceListItem key={service.id} service={service} onClick={onServiceClick} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Demo data generator
export function generateDemoServices(): ServiceHealth[] {
  const now = new Date();
  return [
    {
      id: '1',
      name: 'payment-api',
      icon: Server,
      status: 'healthy',
      lastDeployment: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      version: '1.2.3',
      environment: 'production',
      responseTime: 45,
      errorRate: 0.2,
      uptime: 99.9,
    },
    {
      id: '2',
      name: 'user-service',
      icon: Server,
      status: 'healthy',
      lastDeployment: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      version: '2.0.1',
      environment: 'production',
      responseTime: 32,
      errorRate: 0.5,
      uptime: 99.95,
    },
    {
      id: '3',
      name: 'postgres-db',
      icon: Database,
      status: 'warning',
      lastDeployment: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      version: '14.5',
      environment: 'production',
      responseTime: 120,
      errorRate: 2.1,
      uptime: 99.5,
    },
    {
      id: '4',
      name: 'frontend-app',
      icon: Globe,
      status: 'healthy',
      lastDeployment: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      version: '3.1.0',
      environment: 'production',
      responseTime: 28,
      errorRate: 0.1,
      uptime: 99.99,
    },
  ];
}
