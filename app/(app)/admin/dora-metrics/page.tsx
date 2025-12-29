'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Clock,
  AlertTriangle,
  Timer,
  ArrowUp,
  ArrowDown,
  Minus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumb } from '@/components/navigation/breadcrumb';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { doraMetricsService } from '@/lib/services/dora-metrics.service';
import {
  DORAMetricsFilters,
  DateRangeOption,
  BenchmarkLevel,
  TrendDirection,
  DORAMetric,
  Service,
  Team,
} from '@/lib/types';

// Benchmark badge component
function BenchmarkBadge({ level }: { level: BenchmarkLevel }) {
  const config = {
    elite: { label: 'Elite', className: 'bg-green-500 text-white' },
    high: { label: 'High', className: 'bg-blue-500 text-white' },
    medium: { label: 'Medium', className: 'bg-yellow-500 text-white' },
    low: { label: 'Low', className: 'bg-red-500 text-white' },
  };

  const { label, className } = config[level];

  return (
    <Badge className={className} variant="default">
      {label}
    </Badge>
  );
}

// Trend indicator component
function TrendIndicator({ trend }: { trend: TrendDirection }) {
  const config = {
    improving: {
      icon: ArrowUp,
      label: 'Improving',
      className: 'text-green-600',
    },
    stable: {
      icon: Minus,
      label: 'Stable',
      className: 'text-gray-600',
    },
    declining: {
      icon: ArrowDown,
      label: 'Declining',
      className: 'text-red-600',
    },
  };

  const { icon: Icon, label, className } = config[trend];

  return (
    <div className={`flex items-center gap-1 text-sm ${className}`}>
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </div>
  );
}

// Metric card component
interface MetricCardProps {
  name: string;
  metric: DORAMetric;
  icon: React.ElementType;
}

function MetricCard({ name, metric, icon: Icon }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{name}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <div className="text-2xl font-bold">
            {metric.value.toFixed(2)} {metric.unit}
          </div>
          <div className="flex items-center gap-2">
            <BenchmarkBadge level={metric.benchmark} />
            <TrendIndicator trend={metric.trend} />
          </div>
          {metric.description && (
            <p className="text-xs text-muted-foreground">{metric.description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Loading skeleton for metric cards
function MetricCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-4 rounded-full" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-4 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function DORAMetricsPage() {
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d');
  const [selectedService, setSelectedService] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('all');
  const [showBenchmarks, setShowBenchmarks] = useState(false);

  // Fetch services for filter dropdown
  const { data: servicesData } = useQuery<{ success: boolean; data: Service[] }>({
    queryKey: ['services'],
    queryFn: async () => {
      const response = await fetch('http://localhost:8080/api/services');
      return response.json();
    },
  });

  // Fetch teams for filter dropdown
  const { data: teamsData } = useQuery<{ success: boolean; data: Team[] }>({
    queryKey: ['teams'],
    queryFn: async () => {
      const response = await fetch('http://localhost:8080/api/teams');
      return response.json();
    },
  });

  // Fetch DORA metrics
  const {
    data: metricsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['dora-metrics', dateRange, selectedService, selectedTeam, selectedEnvironment],
    queryFn: async () => {
      const filters: DORAMetricsFilters = {
        dateRange,
      };

      if (selectedService && selectedService !== 'all') filters.serviceId = selectedService;
      if (selectedTeam && selectedTeam !== 'all') filters.teamId = selectedTeam;
      if (selectedEnvironment && selectedEnvironment !== 'all') filters.environment = selectedEnvironment;

      return doraMetricsService.getDORAMetrics(filters);
    },
  });

  const metrics = metricsData?.data;

  // Clear filters handler
  const clearFilters = () => {
    setSelectedService('all');
    setSelectedTeam('all');
    setSelectedEnvironment('all');
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'DORA Metrics' }
        ]}
      />

      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">DORA Metrics Dashboard</h1>
        <p className="text-muted-foreground">
          Track the 4 key DevOps Research and Assessment (DORA) metrics to measure your team's
          software delivery performance
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Customize the metrics view with filters</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Time Range Buttons */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Time Range</label>
              <div className="flex gap-2">
                <Button
                  variant={dateRange === '7d' ? 'default' : 'outline'}
                  onClick={() => setDateRange('7d')}
                  size="sm"
                >
                  Last 7 Days
                </Button>
                <Button
                  variant={dateRange === '30d' ? 'default' : 'outline'}
                  onClick={() => setDateRange('30d')}
                  size="sm"
                >
                  Last 30 Days
                </Button>
                <Button
                  variant={dateRange === '90d' ? 'default' : 'outline'}
                  onClick={() => setDateRange('90d')}
                  size="sm"
                >
                  Last 90 Days
                </Button>
              </div>
            </div>

            {/* Filter Dropdowns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Service Filter */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Service</label>
                <Select value={selectedService} onValueChange={setSelectedService}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Services" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Services</SelectItem>
                    {servicesData?.data?.map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Team Filter */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Team</label>
                <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Teams</SelectItem>
                    {teamsData?.data?.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Environment Filter */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Environment</label>
                <Select value={selectedEnvironment} onValueChange={setSelectedEnvironment}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Environments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Environments</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                    <SelectItem value="development">Development</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Clear Filters */}
            {(selectedService !== 'all' || selectedTeam !== 'all' || selectedEnvironment !== 'all') && (
              <div>
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500">Error Loading Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'An unknown error occurred'}
            </p>
            <Button onClick={() => refetch()} className="mt-4" variant="outline">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Metric Cards Grid */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      )}

      {!isLoading && metrics && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              name="Deployment Frequency"
              metric={metrics.deploymentFrequency}
              icon={TrendingUp}
            />
            <MetricCard
              name="Lead Time for Changes"
              metric={metrics.leadTime}
              icon={Clock}
            />
            <MetricCard
              name="Change Failure Rate"
              metric={metrics.changeFailureRate}
              icon={AlertTriangle}
            />
            <MetricCard
              name="Mean Time to Recovery"
              metric={metrics.mttr}
              icon={Timer}
            />
          </div>

          {/* Period Info */}
          <Card>
            <CardHeader>
              <CardTitle>Reporting Period</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="font-medium">Start:</span> {metrics.period.start}
                </div>
                <div>
                  <span className="font-medium">End:</span> {metrics.period.end}
                </div>
                <div>
                  <span className="font-medium">Days:</span> {metrics.period.days}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Breakdown by Service */}
          {metrics.deploymentFrequency.breakdown &&
            Object.keys(metrics.deploymentFrequency.breakdown).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Breakdown by Service</CardTitle>
                  <CardDescription>
                    Detailed metrics for each service in the selected period
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead className="text-right">Deployment Freq</TableHead>
                        <TableHead className="text-right">Lead Time (hrs)</TableHead>
                        <TableHead className="text-right">Failure Rate (%)</TableHead>
                        <TableHead className="text-right">MTTR (min)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.keys(metrics.deploymentFrequency.breakdown).map((serviceName) => (
                        <TableRow key={serviceName}>
                          <TableCell className="font-medium">{serviceName}</TableCell>
                          <TableCell className="text-right">
                            {metrics.deploymentFrequency.breakdown?.[serviceName]?.toFixed(2) ||
                              'N/A'}
                          </TableCell>
                          <TableCell className="text-right">
                            {metrics.leadTime.breakdown?.[serviceName]?.toFixed(2) || 'N/A'}
                          </TableCell>
                          <TableCell className="text-right">
                            {metrics.changeFailureRate.breakdown?.[serviceName]?.toFixed(2) ||
                              'N/A'}
                          </TableCell>
                          <TableCell className="text-right">
                            {metrics.mttr.breakdown?.[serviceName]?.toFixed(2) || 'N/A'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
        </>
      )}

      {/* Industry Benchmarks Reference */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          onClick={() => setShowBenchmarks(!showBenchmarks)}
        >
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Industry Benchmarks Reference</CardTitle>
              <CardDescription>
                Understanding the DORA performance levels
              </CardDescription>
            </div>
            {showBenchmarks ? <ChevronUp /> : <ChevronDown />}
          </div>
        </CardHeader>
        {showBenchmarks && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Deployment Frequency */}
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Deployment Frequency
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="elite" />
                    <span>Multiple deploys per day (&gt;1/day)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="high" />
                    <span>1 per day to 1 per week</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="medium" />
                    <span>1 per week to 1 per month</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="low" />
                    <span>Less than 1 per month</span>
                  </div>
                </div>
              </div>

              {/* Lead Time */}
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Lead Time for Changes
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="elite" />
                    <span>Less than 1 day</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="high" />
                    <span>1 day to 1 week</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="medium" />
                    <span>1 week to 1 month</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="low" />
                    <span>More than 1 month</span>
                  </div>
                </div>
              </div>

              {/* Change Failure Rate */}
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Change Failure Rate
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="elite" />
                    <span>0-15%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="high" />
                    <span>16-30%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="medium" />
                    <span>31-45%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="low" />
                    <span>46-100%</span>
                  </div>
                </div>
              </div>

              {/* MTTR */}
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Timer className="h-4 w-4" />
                  Mean Time to Recovery
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="elite" />
                    <span>Less than 1 hour</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="high" />
                    <span>Less than 1 day</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="medium" />
                    <span>1 day to 1 week</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BenchmarkBadge level="low" />
                    <span>More than 1 week</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                <strong>Note:</strong> These benchmarks are based on the DevOps Research and
                Assessment (DORA) research. For more information, visit{' '}
                <a
                  href="https://dora.dev/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  dora.dev
                </a>
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* No Data State */}
      {!isLoading && metrics && !metrics.deploymentFrequency.breakdown && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Activity className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No deployment data found</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              There are no deployments in the selected period. Deploy some services to see DORA
              metrics.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
