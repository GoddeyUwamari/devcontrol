'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  AlertCircle,
  Layers,
  CheckCircle,
  Rocket,
  DollarSign,
  MoreVertical,
  Download,
  Upload,
  GitBranch,
  Activity,
} from 'lucide-react';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { servicesService } from '@/lib/services/services.service';

// Import existing premium components
import { HeroMetricCard } from '@/components/dashboard/hero-metric-card';
import { ServiceHealthGrid, type ServiceHealth } from '@/components/dashboard/service-health-grid';

// Import service-specific components
import { ServiceDetailSlideOver } from '@/components/services/service-detail-slide-over';
import {
  generateExtendedDemoServices,
  calculateServiceMetrics,
  toServiceDetail,
  type ExtendedService,
} from '@/components/services/demo-services-data';
import { QuickStartOptions } from '@/components/services/QuickStartOptions';
import { ServiceBenefits } from '@/components/services/ServiceBenefits';
import { ProTip } from '@/components/services/ProTip';

// Loading Skeleton for metrics
function MetricsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white rounded-lg border p-6">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
          <Skeleton className="h-9 w-28 mb-3" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// Error State Component
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg bg-red-50">
      <AlertCircle className="h-8 w-8 text-red-600" />
      <div className="text-center">
        <h3 className="text-lg font-semibold text-red-900">Error Loading Services</h3>
        <p className="text-sm text-red-700 mt-1">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline">
        Try Again
      </Button>
    </div>
  );
}

export default function ServicesPage() {
  const router = useRouter();
  const demoMode = useDemoMode();

  // State for slide-over
  const [selectedService, setSelectedService] = useState<ExtendedService | null>(null);
  const [slideOverOpen, setSlideOverOpen] = useState(false);

  // Fetch real services
  const { data: realServices = [], isLoading, error, refetch } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesService.getAll(),
  });

  // Demo services
  const demoServices = useMemo(() => generateExtendedDemoServices(), []);

  // Map real service status to grid status
  const mapServiceStatus = (status: string): 'healthy' | 'warning' | 'critical' | 'unknown' => {
    switch (status) {
      case 'active':
        return 'healthy';
      case 'deploying':
        return 'warning';
      case 'failed':
        return 'critical';
      case 'inactive':
      default:
        return 'unknown';
    }
  };

  // Use demo services when demo mode is on, otherwise use real services
  const services: ExtendedService[] = useMemo(() => {
    if (demoMode) {
      return demoServices;
    }
    // Convert real services to ExtendedService format
    return realServices.map((s): ExtendedService => ({
      id: s.id,
      name: s.name,
      status: mapServiceStatus(s.status),
      environment: 'production',
      techStack: s.template || 'Unknown',
      team: s.owner || 'Unknown',
      version: '1.0.0',
      uptime: 99.9,
      responseTime: 100,
      errorRate: 0.5,
      monthlyCoste: 200,
      activeAlerts: 0,
      lastDeployment: s.createdAt ? new Date(s.createdAt) : undefined,
      repositoryUrl: s.githubUrl,
    }));
  }, [demoMode, demoServices, realServices]);

  // Calculate metrics
  const metrics = useMemo(() => calculateServiceMetrics(services), [services]);

  // Check if truly empty (no demo mode AND no services)
  const isEmptyState = !demoMode && !isLoading && realServices.length === 0;

  // Handle service click
  const handleServiceClick = (service: ServiceHealth) => {
    const extendedService = services.find(s => s.id === service.id);
    if (extendedService) {
      setSelectedService(extendedService);
      setSlideOverOpen(true);
    }
  };

  // Handle edit service
  const handleEditService = (service: ExtendedService) => {
    setSlideOverOpen(false);
    router.push(`/app/services/${service.id}/edit`);
  };

  // Handle deploy now
  const handleDeployNow = (service: ExtendedService) => {
    setSlideOverOpen(false);
    router.push(`/app/deployments/new?service=${service.id}`);
  };

  return (
    <div className="space-y-8 px-4 md:px-6 lg:px-8">
      {/* Demo Mode Indicator */}
      {demoMode && (
        <div className="bg-purple-600 text-white px-4 py-3 rounded-lg text-center font-medium -mx-4 md:-mx-6 lg:-mx-8 -mt-8 mb-0">
          <div className="flex items-center justify-center gap-2">
            <Activity className="w-4 h-4 animate-pulse" />
            <span>Demo Mode Active - Showing sample service catalog data</span>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Service Catalog</h1>
          <p className="text-muted-foreground leading-relaxed">
            Manage and monitor all platform services
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Quick Actions Dropdown */}
          {!isEmptyState && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Service actions menu">
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => router.push('/app/infrastructure?action=import')}>
                  <Upload className="h-4 w-4 mr-2" />
                  Bulk Import from AWS
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Download className="h-4 w-4 mr-2" />
                  Export Services (CSV)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/app/deployments')}>
                  <Rocket className="h-4 w-4 mr-2" />
                  View All Deployments
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/app/dependencies')}>
                  <GitBranch className="h-4 w-4 mr-2" />
                  View Service Map
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button className="w-full sm:w-auto" onClick={() => router.push('/services/new')}>
            <Plus className="h-4 w-4 mr-2" />
            Create Service
          </Button>
        </div>
      </div>

      {/* Show empty state only when no demo mode AND no real services */}
      {isEmptyState ? (
        <>
          {/* Quick Start Options */}
          <QuickStartOptions />

          {/* Value Proposition */}
          <ServiceBenefits />

          {/* Pro Tip */}
          <ProTip />
        </>
      ) : (
        <>
          {/* Metrics Cards */}
          {isLoading ? (
            <MetricsSkeleton />
          ) : error ? (
            <ErrorState
              message={(error as Error).message}
              onRetry={() => refetch()}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <HeroMetricCard
                title="Total Services"
                value={metrics.totalServices}
                trend={{ value: 8.7, direction: 'up', label: 'vs last month' }}
                icon={Layers}
                iconColor="text-blue-600"
                iconBgColor="bg-blue-100"
                sparklineData={[10, 10, 11, 11, 12, 12]}
              />
              <HeroMetricCard
                title="Healthy Services"
                value={metrics.healthyServices}
                trend={{ value: 5, direction: 'up', label: 'this week' }}
                icon={CheckCircle}
                iconColor="text-green-600"
                iconBgColor="bg-green-100"
                status={{
                  label: `${metrics.healthyPercentage}% of total`,
                  variant: metrics.healthyPercentage >= 80 ? 'success' : metrics.healthyPercentage >= 60 ? 'warning' : 'error',
                }}
                sparklineData={[7, 7, 8, 8, 9, 9]}
              />
              <HeroMetricCard
                title="Deployments This Week"
                value={metrics.deploymentsThisWeek}
                trend={{ value: 20, direction: 'up', label: 'vs last week' }}
                icon={Rocket}
                iconColor="text-purple-600"
                iconBgColor="bg-purple-100"
                href="/app/deployments"
                sparklineData={[12, 15, 18, 20, 16, 16]}
              />
              <HeroMetricCard
                title="Total Service Cost"
                value={`$${metrics.totalCost.toLocaleString()}/mo`}
                trend={{ value: 8, direction: 'up', label: 'vs last month' }}
                icon={DollarSign}
                iconColor="text-orange-600"
                iconBgColor="bg-orange-100"
                trendInverted={true}
                sparklineData={[5200, 5400, 5600, 5800, 6000, metrics.totalCost]}
              />
            </div>
          )}

          {/* Service Health Grid */}
          {!isLoading && !error && (
            <ServiceHealthGrid
              services={services}
              isLoading={isLoading}
              onServiceClick={handleServiceClick}
            />
          )}
        </>
      )}

      {/* Service Detail Slide-Over */}
      <ServiceDetailSlideOver
        service={selectedService ? toServiceDetail(selectedService) : null}
        isOpen={slideOverOpen}
        onClose={() => {
          setSlideOverOpen(false);
          setSelectedService(null);
        }}
        onEditService={selectedService ? () => handleEditService(selectedService) : undefined}
        onDeployNow={selectedService ? () => handleDeployNow(selectedService) : undefined}
      />
    </div>
  );
}
