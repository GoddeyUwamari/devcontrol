'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  Activity,
  Clock,
  AlertTriangle,
  Timer,
  ArrowUp,
  ArrowDown,
  Minus,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Download,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
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

// Helper function to generate mock 30-day trend data
// TODO: Replace with real API data when available
function generateTrendData(baseValue: number, variance: number = 0.2) {
  return Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    value: Math.max(0, baseValue + (Math.random() - 0.5) * variance * baseValue),
  }));
}

// Helper function to export metrics to CSV
function exportToCSV(metrics: any, dateRange: string) {
  const csvData = [
    ['Metric', 'Value', 'Unit', 'Benchmark', 'Trend'],
    [
      'Deployment Frequency',
      metrics.deploymentFrequency.value.toFixed(2),
      metrics.deploymentFrequency.unit,
      metrics.deploymentFrequency.benchmark,
      metrics.deploymentFrequency.trend,
    ],
    [
      'Lead Time for Changes',
      metrics.leadTime.value.toFixed(2),
      metrics.leadTime.unit,
      metrics.leadTime.benchmark,
      metrics.leadTime.trend,
    ],
    [
      'Change Failure Rate',
      metrics.changeFailureRate.value.toFixed(2),
      metrics.changeFailureRate.unit,
      metrics.changeFailureRate.benchmark,
      metrics.changeFailureRate.trend,
    ],
    [
      'Mean Time to Recovery',
      metrics.mttr.value.toFixed(2),
      metrics.mttr.unit,
      metrics.mttr.benchmark,
      metrics.mttr.trend,
    ],
  ];

  const csv = csvData.map((row) => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dora-metrics-${dateRange}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Helper function to export to PDF (using browser print)
function exportToPDF() {
  window.print();
}

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
  color?: string;
}

function MetricCard({ name, metric, icon: Icon, color = '#3b82f6' }: MetricCardProps) {
  // Generate trend data for sparkline
  const trendData = generateTrendData(metric.value);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{name}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold">
                {metric.value.toFixed(2)} {metric.unit}
              </div>
            </div>

            {/* Sparkline */}
            <div className="w-32 h-12">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={color}
                    fill={color}
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload?.[0]) return null;
                      return (
                        <div className="bg-white px-2 py-1 rounded shadow text-xs border">
                          {(payload[0].value as number).toFixed(2)} {metric.unit}
                        </div>
                      );
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2">
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

  // Calculate total deployments for data confidence
  const totalDeployments = metrics
    ? Object.values(metrics.deploymentFrequency.breakdown || {}).reduce(
        (sum, val) => sum + (val || 0),
        0
      ) * metrics.period.days
    : 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">DORA Metrics Dashboard</h1>
          <p className="text-muted-foreground">
            Track the 4 key DevOps Research and Assessment (DORA) metrics to measure your team&apos;s
            software delivery performance
          </p>
        </div>

        {/* Data Confidence & Export */}
        {metrics && (
          <div className="flex flex-col items-start md:items-end gap-3">
            {/* Data Confidence */}
            <div className="text-right">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>
                  Based on <strong>{Math.round(totalDeployments)}</strong> deployments
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Last updated: {new Date().toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true
                })}
              </div>
            </div>

            {/* Export Buttons */}
            <div className="flex gap-2 no-print">
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportToCSV(metrics, dateRange)}
              >
                <FileText className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={exportToPDF}>
                <Download className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Low Data Warning */}
      {metrics && totalDeployments < 10 && (
        <Card className="border-yellow-500 bg-yellow-50">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-900">Limited Data</h3>
              <p className="text-sm text-yellow-800">
                Metrics based on only {Math.round(totalDeployments)} deployments. More data needed
                for reliable trends.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="no-print">
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
              color="#3b82f6"
            />
            <MetricCard
              name="Lead Time for Changes"
              metric={metrics.leadTime}
              icon={Clock}
              color="#8b5cf6"
            />
            <MetricCard
              name="Change Failure Rate"
              metric={metrics.changeFailureRate}
              icon={AlertTriangle}
              color="#f59e0b"
            />
            <MetricCard
              name="Mean Time to Recovery"
              metric={metrics.mttr}
              icon={Timer}
              color="#10b981"
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

      {/* Enhanced Empty State */}
      {!isLoading && !metrics && (
        <Card className="col-span-full">
          <CardContent className="py-12">
            <div className="max-w-2xl mx-auto text-center">
              <TrendingUp className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Start Tracking Your DORA Metrics</h3>
              <p className="text-muted-foreground mb-6">
                Connect your deployment pipeline to see how your team performs against industry
                benchmarks.
              </p>

              <div className="space-y-3 mb-6 max-w-md mx-auto">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-left">
                  <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                    1
                  </div>
                  <span className="text-sm">Connect your Git repository</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-left">
                  <div className="w-6 h-6 rounded-full bg-gray-300 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                    2
                  </div>
                  <span className="text-sm">Configure deployment tracking</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-left">
                  <div className="w-6 h-6 rounded-full bg-gray-300 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                    3
                  </div>
                  <span className="text-sm">View your metrics</span>
                </div>
              </div>

              <Button className="mb-6" asChild>
                <a href="/integrations">
                  Set Up Integration
                  <ExternalLink className="w-4 h-4 ml-2" />
                </a>
              </Button>

              <div className="mt-6 p-6 bg-blue-50 rounded-lg">
                <p className="text-sm font-medium mb-3">Preview: What you&apos;ll see</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-3 rounded shadow-sm">
                    <div className="text-xs font-semibold text-gray-700">
                      Deployment Frequency
                    </div>
                    <div className="text-lg font-bold text-blue-600 mt-1">2.3 per day</div>
                    <Badge className="mt-2 bg-green-500 text-white">Elite</Badge>
                  </div>
                  <div className="bg-white p-3 rounded shadow-sm">
                    <div className="text-xs font-semibold text-gray-700">Lead Time</div>
                    <div className="text-lg font-bold text-purple-600 mt-1">4.2 hours</div>
                    <Badge className="mt-2 bg-blue-500 text-white">High</Badge>
                  </div>
                  <div className="bg-white p-3 rounded shadow-sm">
                    <div className="text-xs font-semibold text-gray-700">Failure Rate</div>
                    <div className="text-lg font-bold text-amber-600 mt-1">2.1%</div>
                    <Badge className="mt-2 bg-green-500 text-white">Elite</Badge>
                  </div>
                  <div className="bg-white p-3 rounded shadow-sm">
                    <div className="text-xs font-semibold text-gray-700">MTTR</div>
                    <div className="text-lg font-bold text-green-600 mt-1">1.8 hours</div>
                    <Badge className="mt-2 bg-green-500 text-white">Elite</Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Deployment Data in Period */}
      {!isLoading && metrics && !metrics.deploymentFrequency.breakdown && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Activity className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No deployment data found</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              There are no deployments in the selected period. Try selecting a different time range
              or deploy some services to see DORA metrics.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
