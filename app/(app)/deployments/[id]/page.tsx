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
import { deploymentStatusDisplay, type RecordedDeployment as Deployment } from '@/lib/deployments/status';
import { isManualRecord } from '@/lib/deployments/record';
import { githubRecordDetail, UNKNOWN } from '@/lib/deployments/github-record';
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography';

/**
 * A deployment recorded by hand (metadata.source = 'manual', D2) has no
 * pipeline behind it: no logs, no duration, and its person and time are who
 * recorded it and when. Its version is the one recorded (resources.version).
 * Copy approved in review-logs/deployments/d3-build.md §1.8; pipeline rows are
 * shown as before.
 */
const MANUAL_DETAIL_COPY = {
  recordedBy: 'Recorded by',
  recordedAt: 'Recorded at',
  notRecorded: 'Not recorded',
  noLogs: 'Recorded by hand · no logs attached',
} as const;

/** The version recorded with a hand-recorded deployment, or null when none was. */
function recordedVersion(deployment: Deployment): string | null {
  const version = deployment.resources?.version;
  return typeof version === 'string' && version.trim() ? version.trim() : null;
}

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
              <p className="text-section font-medium">Deployment not found</p>
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

  const manual = isManualRecord(deployment);
  const version = manual ? recordedVersion(deployment) : null;
  // D8b-2: a row the GitHub App recorded shows what GitHub reported, nothing else.
  const github = manual ? null : githubRecordDetail(deployment, deployment.githubRepository);

  // The status as recorded; unrecognised values are Unknown.
  const getStatusBadge = (status: string, createdAt: string) => {
    const { label, color, background } = deploymentStatusDisplay(status, createdAt);
    return (
      <Badge variant="secondary" style={{ color, background }}>
        {label}
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
            <h1 className={PAGE_TITLE_CLASS}>
              {deployment.serviceName || deployment.serviceId || 'Deployment'}
            </h1>
            <p className={`${PAGE_SUBTITLE_CLASS} mt-2`}>
              {deployment.environment} • {manual ? MANUAL_DETAIL_COPY.recordedBy : 'Deployed by'} {deployment.deployedBy}
            </p>
            {github && <p className="text-ui text-muted-foreground mt-1 mb-0" data-testid="deployment-source">{github.sourceLabel}</p>}
          </div>

          {/* Status Badge */}
          {getStatusBadge(deployment.status, deployment.createdAt)}
        </div>
      </div>

      {github ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8" data-testid="deployment-github">
            {([
              ['Repository', github.repository, 'deployment-repository'],
              ['Commit', github.commit, 'deployment-commit'],
              [github.targetLabel, github.target, 'deployment-target'],
              ['Started', github.started, 'deployment-started'],
              ['Duration', github.duration, 'deployment-duration'],
              // Fix round 2 (N-4): unknown reads "—" like every other unknown on this card set (R10).
              ['Region', deployment.awsRegion || UNKNOWN, 'deployment-region'],
            ] as const).map(([label, value, testId]) => (
              <Card key={testId}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-ui font-medium text-muted-foreground">{label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p
                    className={`text-section break-words${testId === 'deployment-commit' && github.commitFull ? ' font-mono' : ''}`}
                    data-testid={testId}
                    title={testId === 'deployment-commit' ? github.commitFull ?? undefined : undefined}
                  >
                    {value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Only the URL GitHub sent and DevControl stored (job rows); never one built here. */}
          {github.url ? (
            <Button variant="outline" size="sm" asChild>
              <a href={github.url} target="_blank" rel="noopener noreferrer" data-testid="deployment-github-link">
                View on GitHub ↗
              </a>
            </Button>
          ) : null}
        </>
      ) : (
      <>
      {/* Deployment Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-ui font-medium text-muted-foreground">
              Region
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-section" data-testid="deployment-region">{deployment.awsRegion || MANUAL_DETAIL_COPY.notRecorded}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-ui font-medium text-muted-foreground">
              Version
            </CardTitle>
          </CardHeader>
          <CardContent>
            {manual ? (
              <p className={`text-section${version ? ' font-mono' : ''}`} data-testid="deployment-version">
                {version ?? MANUAL_DETAIL_COPY.notRecorded}
              </p>
            ) : (
              <p className="text-section font-mono" data-testid="deployment-version">
                {(deployment as any).version || 'N/A'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-ui font-medium text-muted-foreground">
              {manual ? MANUAL_DETAIL_COPY.recordedAt : 'Started At'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-section">
              {new Date(deployment.deployedAt).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-ui font-medium text-muted-foreground">
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-section" data-testid="deployment-duration">
              {manual ? MANUAL_DETAIL_COPY.notRecorded : (deployment as any).duration || 'In progress...'}
            </p>
          </CardContent>
        </Card>
      </div>

      {manual ? (
        // Nothing ran in a pipeline, so there are no logs to show or fetch (same text as D2's list banner).
        <p className="text-ui text-ink-muted rounded-lg border border-border p-4 m-0" data-testid="deployment-no-logs">
          {MANUAL_DETAIL_COPY.noLogs}
        </p>
      ) : (
      /* Live Logs Section */
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-section">Live Deployment Logs</h2>
          {/* No region recorded (a GitHub App row, D8-D8): no console link to a guessed region. */}
          {deployment.awsRegion ? (
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
          ) : null}
        </div>

        {/* Live Log Viewer Component */}
        <LiveLogViewer
          deploymentId={deploymentId}
          logGroupName="/aws/ecs/deployments"
          logStreamName={deploymentId}
        />
      </div>
      )}
      </>
      )}
    </div>
  );
}
