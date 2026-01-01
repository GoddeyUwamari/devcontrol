'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Database, RefreshCw, Search, Server, Cloud, HardDrive, AlertTriangle, Shield, DollarSign, Tags } from 'lucide-react';
import { awsResourcesService, ResourceFilters } from '@/lib/services/aws-resources.service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BulkTagDialog } from '@/components/aws-resources/BulkTagDialog';
import { Breadcrumb } from '@/components/navigation/breadcrumb';

export default function AWSResourcesPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ResourceFilters>({
    page: 1,
    limit: 50,
  });
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [isBulkTagDialogOpen, setIsBulkTagDialogOpen] = useState(false);

  // Fetch resources
  const { data: resourcesData, isLoading: resourcesLoading } = useQuery({
    queryKey: ['aws-resources', filters],
    queryFn: () => awsResourcesService.getAll(filters),
  });

  // Fetch stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['aws-resources-stats'],
    queryFn: () => awsResourcesService.getStats(),
  });

  // Discovery mutation
  const discoveryMutation = useMutation({
    mutationFn: async () => {
      console.log('🚀 Calling awsResourcesService.discover()...');
      try {
        const result = await awsResourcesService.discover();
        console.log('✅ Discovery API call successful:', result);
        return result;
      } catch (error) {
        console.error('❌ Discovery API call failed:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('🎉 Discovery mutation onSuccess triggered:', data);
      toast.success('Resource discovery started', {
        description: 'AWS resources are being scanned. This may take a few minutes.',
      });
      // Refetch after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['aws-resources'] });
        queryClient.invalidateQueries({ queryKey: ['aws-resources-stats'] });
      }, 10000);
    },
    onError: (error: any) => {
      console.error('💥 Discovery mutation onError triggered:', error);
      toast.error('Discovery failed', {
        description: error.message || 'Failed to start resource discovery',
      });
    },
  });

  const handleDiscovery = () => {
    console.log('🔍 Discovery button clicked');
    console.log('🔍 Mutation state:', { isPending: discoveryMutation.isPending, isError: discoveryMutation.isError });
    try {
      discoveryMutation.mutate();
      console.log('🔍 Mutation triggered successfully');
    } catch (error) {
      console.error('🔍 Error triggering mutation:', error);
    }
  };

  const handleFilterChange = (key: keyof ResourceFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1, // Reset to first page
    }));
  };

  const getResourceTypeIcon = (type: string) => {
    switch (type) {
      case 'ec2': return <Server className="h-4 w-4" />;
      case 'rds': return <Database className="h-4 w-4" />;
      case 's3': return <HardDrive className="h-4 w-4" />;
      case 'lambda': return <Cloud className="h-4 w-4" />;
      case 'ecs': return <Server className="h-4 w-4" />;
      case 'load-balancer': return <Server className="h-4 w-4" />;
      case 'vpc': return <Cloud className="h-4 w-4" />;
      default: return <Cloud className="h-4 w-4" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'default';
      case 'low': return 'secondary';
      default: return 'default';
    }
  };

  const resources = resourcesData?.resources || [];
  const total = resourcesData?.total || 0;

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'AWS Resources', current: true },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AWS Resource Inventory</h1>
          <p className="text-muted-foreground mt-1">
            Discover, track, and monitor AWS resources with compliance scanning
          </p>
        </div>
        <Button
          onClick={handleDiscovery}
          disabled={discoveryMutation.isPending}
          className="shrink-0"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${discoveryMutation.isPending ? 'animate-spin' : ''}`} />
          {discoveryMutation.isPending ? 'Discovering...' : 'Discover Resources'}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Resources</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stats?.total_resources || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Across all regions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">
                ${(stats?.total_monthly_cost || 0).toFixed(2)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Estimated monthly spend
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compliance Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {stats?.compliance_stats?.total_issues || 0}
                </div>
                <div className="flex gap-1 mt-2">
                  {stats?.compliance_stats && (
                    <>
                      {stats.compliance_stats.by_severity.critical > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {stats.compliance_stats.by_severity.critical} Critical
                        </Badge>
                      )}
                      {stats.compliance_stats.by_severity.high > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {stats.compliance_stats.by_severity.high} High
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Security Risks</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {(stats?.unencrypted_count || 0) + (stats?.public_count || 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.unencrypted_count || 0} unencrypted, {stats?.public_count || 0} public
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter resources by type, region, or status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search resources..."
                  value={filters.search || ''}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Resource Type</label>
              <Select
                value={filters.resource_type || 'all'}
                onValueChange={(value) => handleFilterChange('resource_type', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="ec2">EC2 Instances</SelectItem>
                  <SelectItem value="rds">RDS Databases</SelectItem>
                  <SelectItem value="s3">S3 Buckets</SelectItem>
                  <SelectItem value="lambda">Lambda Functions</SelectItem>
                  <SelectItem value="ecs">ECS Services</SelectItem>
                  <SelectItem value="load-balancer">Load Balancers</SelectItem>
                  <SelectItem value="vpc">VPCs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select
                value={filters.status || 'all'}
                onValueChange={(value) => handleFilterChange('status', value === 'all' ? undefined : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="stopped">Stopped</SelectItem>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Security</label>
              <Select
                value={filters.is_encrypted !== undefined ? (filters.is_encrypted ? 'encrypted' : 'unencrypted') : 'all'}
                onValueChange={(value) => {
                  if (value === 'all') handleFilterChange('is_encrypted', undefined);
                  else handleFilterChange('is_encrypted', value === 'encrypted');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="encrypted">Encrypted Only</SelectItem>
                  <SelectItem value="unencrypted">Unencrypted Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedResourceIds.length > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {selectedResourceIds.length} resource{selectedResourceIds.length !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => setIsBulkTagDialogOpen(true)}
                >
                  <Tags className="h-4 w-4 mr-2" />
                  Bulk Tag
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedResourceIds([])}
                >
                  Clear Selection
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resources Table */}
      <Card>
        <CardHeader>
          <CardTitle>Resources ({total})</CardTitle>
          <CardDescription>All discovered AWS resources in your account</CardDescription>
        </CardHeader>
        <CardContent>
          {resourcesLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : resources.length === 0 ? (
            <div className="text-center py-12">
              <Database className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No resources found</h3>
              <p className="text-muted-foreground mt-2">
                Click "Discover Resources" to scan your AWS account
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedResourceIds.length === resources.length && resources.length > 0}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedResourceIds(resources.map((r: any) => r.id));
                          } else {
                            setSelectedResourceIds([]);
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Resource</TableHead>
                    <TableHead className="whitespace-nowrap">Type</TableHead>
                    <TableHead className="whitespace-nowrap">Region</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="whitespace-nowrap">Cost/Month</TableHead>
                    <TableHead className="whitespace-nowrap">Security</TableHead>
                    <TableHead className="whitespace-nowrap">Compliance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resources.map((resource: any) => (
                    <TableRow key={resource.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedResourceIds.includes(resource.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedResourceIds([...selectedResourceIds, resource.id]);
                            } else {
                              setSelectedResourceIds(selectedResourceIds.filter(id => id !== resource.id));
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{resource.resource_name || resource.resource_id}</div>
                          <div className="text-sm text-muted-foreground truncate max-w-xs">{resource.resource_id}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getResourceTypeIcon(resource.resource_type)}
                          <span className="uppercase text-xs font-medium">{resource.resource_type}</span>
                        </div>
                      </TableCell>
                      <TableCell>{resource.region}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{resource.status || 'Unknown'}</Badge>
                      </TableCell>
                      <TableCell>${(parseFloat(resource.estimated_monthly_cost) || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {resource.is_encrypted ? (
                            <Badge variant="secondary" className="text-xs">Encrypted</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">Not Encrypted</Badge>
                          )}
                          {resource.is_public && (
                            <Badge variant="destructive" className="text-xs">Public</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {resource.compliance_issues && resource.compliance_issues.length > 0 ? (
                          <Badge variant={getSeverityColor(resource.compliance_issues[0].severity)}>
                            {resource.compliance_issues.length} {resource.compliance_issues.length === 1 ? 'issue' : 'issues'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Compliant</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk Tag Dialog */}
      <BulkTagDialog
        open={isBulkTagDialogOpen}
        onOpenChange={setIsBulkTagDialogOpen}
        selectedResourceIds={selectedResourceIds}
        onSuccess={() => {
          setSelectedResourceIds([]);
          queryClient.invalidateQueries({ queryKey: ['aws-resources'] });
        }}
      />
    </div>
  );
}
