'use client'

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { deploymentsService } from '@/lib/services/deployments.service';
import { LiveLogViewer } from '@/components/deployments/LiveLogViewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { Deployment } from '@/lib/types';

export default function DeploymentDetailsPage() {
  const params = useParams();
  const deploymentId = params.id as string;

  const { data: deployment, isLoading } = useQuery<Deployment>({
    queryKey: ['deployment', deploymentId],
    queryFn: () => deploymentsService.getById(deploymentId),
  });

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 lg:p-10">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-4 bg-gray-200 rounded w-96" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="p-6 md:p-8 lg:p-10">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <p className="text-lg font-medium">Deployment not found</p>
              <Link href="/deployments">
                <Button>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Deployments
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      running: 'bg-green-100 text-green-800',
      stopped: 'bg-gray-100 text-gray-800',
      deploying: 'bg-blue-100 text-blue-800',
      success: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };

    return (
      <Badge className={variants[status] || 'bg-gray-100 text-gray-800'} variant="secondary">
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  return (
    <div className="p-6 md:p-8 lg:p-10">
      {/* Header */}
      <div className="mb-8">
        <Link href="/deployments">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Deployments
          </Button>
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">
              {deployment.serviceName || deployment.serviceId || 'Deployment'}
            </h1>
            <p className="text-muted-foreground mt-2">
              {deployment.environment} • Deployed by {deployment.deployedBy}
            </p>
          </div>

          {/* Status Badge */}
          {getStatusBadge(deployment.status)}
        </div>
      </div>

      {/* Deployment Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Region
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{deployment.awsRegion}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Version
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold font-mono">
              {(deployment as any).version || 'N/A'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Started At
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {new Date(deployment.deployedAt).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">
              {(deployment as any).duration || 'In progress...'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Live Logs Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Live Deployment Logs</h2>
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://console.aws.amazon.com/cloudwatch/home?region=${deployment.awsRegion}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View in AWS Console
              <ExternalLink className="h-4 w-4 ml-2" />
            </a>
          </Button>
        </div>

        {/* Live Log Viewer Component */}
        <LiveLogViewer
          deploymentId={deploymentId}
          logGroupName="/aws/ecs/deployments"
          logStreamName={deploymentId}
        />
      </div>
    </div>
  );
}
