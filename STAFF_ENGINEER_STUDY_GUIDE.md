# DevControl: Staff Engineer Study Guide

**Project**: DevControl - Open Source Internal Developer Portal for AWS Teams
**Status**: Production-Ready Multi-Tenant Platform
**Tech Stack**: Next.js 15, React 19, TypeScript, Express.js, PostgreSQL, Prometheus/Grafana
**Date**: December 2025

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Core Features & Implementation](#core-features--implementation)
4. [Technical Deep Dives](#technical-deep-dives)
5. [Key Patterns & Best Practices](#key-patterns--best-practices)
6. [Study & Practice Areas](#study--practice-areas)

---

## Executive Summary

### What is DevControl?

DevControl is a production-ready internal developer portal (IDP) built specifically for AWS teams. It's a Backstage alternative that prioritizes:
- **Speed**: 2-minute setup with `npm install && docker-compose up`
- **AWS Integration**: Real-time cost tracking via AWS Cost Explorer API
- **Developer Experience**: Vercel-quality UI, not enterprise gray boxes
- **Multi-Tenancy**: Complete organization workspace isolation

### Problem It Solves

**Before DevControl**:
- No visibility into AWS infrastructure costs
- Service catalog scattered across wikis and spreadsheets
- No deployment history tracking
- Teams manually tracking microservices
- No DevOps metrics (DORA)

**After DevControl**:
- Real-time AWS cost tracking per service
- Centralized service catalog with ownership
- Complete deployment history across environments
- AI-powered cost optimization recommendations
- DORA metrics dashboard for engineering excellence

### Key Metrics

- **29+ Files Created**: Authentication, multi-tenancy, settings pages
- **4,500+ Lines of Code**: Production TypeScript/React
- **8 Database Migrations**: PostgreSQL with Row-Level Security
- **15+ Backend Services**: Auth, AWS, metrics, compliance
- **20+ React Components**: UI library built on Radix UI
- **6 AWS Resource Types**: EC2, RDS, S3, Lambda, ECS, ELB

---

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js 15)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Pages     │  │  Components  │  │   Services   │       │
│  │  - Auth     │  │  - UI Lib    │  │  - Auth API  │       │
│  │  - Dashboard│  │  - Modals    │  │  - Orgs API  │       │
│  │  - Settings │  │  - Layout    │  │  - AWS API   │       │
│  └─────────────┘  └──────────────┘  └──────────────┘       │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP/REST + WebSocket
┌───────────────────────────▼─────────────────────────────────┐
│                   Backend API (Express.js)                   │
│  ┌────────────┐  ┌─────────────┐  ┌────────────────┐       │
│  │Controllers │  │  Services   │  │  Repositories  │       │
│  │ - Auth     │  │  - AWS Cost │  │  - Users       │       │
│  │ - AWS      │  │  - Discovery│  │  - Resources   │       │
│  │ - Metrics  │  │  - Compliance│ │  - Deployments │       │
│  └────────────┘  └─────────────┘  └────────────────┘       │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │      Middleware                                │         │
│  │  - JWT Authentication                          │         │
│  │  - Organization Context Injection (RLS)        │         │
│  │  - Error Handling                              │         │
│  └────────────────────────────────────────────────┘         │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐   ┌─────────────────┐   ┌──────────────┐
│  PostgreSQL  │   │   AWS Services   │   │  Prometheus  │
│  - RLS       │   │  - Cost Explorer │   │  + Grafana   │
│  - Multi-Org │   │  - EC2, RDS, S3  │   │  Monitoring  │
│  - Encrypted │   │  - CloudWatch    │   │              │
└──────────────┘   └─────────────────┘   └──────────────┘
```

### Tech Stack Deep Dive

#### Frontend
- **Next.js 15**: App Router with Server Components
- **React 19**: Latest features with concurrent rendering
- **TypeScript 5**: Full type safety
- **Tailwind v4**: Utility-first CSS
- **Radix UI**: Accessible component primitives
- **React Query**: Server state management
- **Zustand**: Client state management
- **React Hook Form + Zod**: Form validation

#### Backend
- **Express.js**: REST API framework
- **PostgreSQL 14**: Primary database with RLS
- **Node.js 20+**: Runtime environment
- **AWS SDK v3**: Cloud integration
- **bcrypt**: Password hashing
- **JWT**: Token-based authentication
- **AES-256-GCM**: Credential encryption
- **prom-client**: Prometheus metrics

#### DevOps
- **Docker**: Containerization
- **Prometheus**: Metrics collection
- **Grafana**: Visualization dashboards
- **WebSocket**: Real-time updates

---

## Core Features & Implementation

### 1. Multi-Tenancy & Authentication

#### Architecture Pattern: Row-Level Security (RLS)

**Problem**: How to isolate data between organizations in a single PostgreSQL database?

**Solution**: PostgreSQL Row-Level Security with organization context injection

```sql
-- Every table has organization_id
CREATE TABLE services (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  ...
);

-- Enable RLS
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- Create isolation policy
CREATE POLICY services_isolation_policy ON services
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );
```

**Backend Middleware** (`backend/src/middleware/org-context.middleware.ts`):
```typescript
// Injects organization ID into PostgreSQL session
app.use(async (req, res, next) => {
  const organizationId = req.user.currentOrganizationId;
  await pool.query(
    `SET LOCAL app.current_organization_id = $1`,
    [organizationId]
  );
  next();
});
```

**Key Learnings**:
- RLS enforces data isolation at database level
- No N+1 query issues (single connection pool)
- Impossible to accidentally leak data between orgs
- PostgreSQL session variables for context passing

#### Authentication Flow

**Registration** (`app/(auth)/register/page.tsx`):
```typescript
1. User submits email + password + name
2. Backend validates input with Zod
3. Password hashed with bcrypt (10 rounds)
4. User created in PostgreSQL
5. Auto-creates personal organization
6. JWT token generated (7-day access, 30-day refresh)
7. Token stored in localStorage
8. Auto-login and redirect to dashboard
```

**Login** (`app/(auth)/login/page.tsx`):
```typescript
1. User submits email + password
2. Backend finds user by email
3. bcrypt compares password hash
4. JWT token generated with user + organization
5. Token stored in localStorage
6. Fetch organizations and set current org
7. Redirect to dashboard
```

**Token Structure**:
```typescript
interface JWTPayload {
  userId: string;
  email: string;
  currentOrganizationId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  iat: number;
  exp: number;
}
```

#### Organization Switching

**Frontend Context** (`lib/contexts/auth-context.tsx`):
```typescript
const AuthContext = createContext<{
  user: User | null;
  organizations: Organization[];
  currentOrganization: Organization | null;
  switchOrganization: (orgId: string) => Promise<void>;
  logout: () => void;
}>()

// Switch organization
const switchOrganization = async (orgId: string) => {
  // Call API to update user's current org
  await organizationsService.switch(orgId);

  // Refresh organizations
  await refreshOrganizations();

  // Reload page to clear cached data
  window.location.reload();
};
```

**API Endpoint** (`backend/src/controllers/organization.controller.ts`):
```typescript
POST /api/organizations/switch
Body: { organizationId: string }

1. Verify user is member of target organization
2. Update users.current_organization_id
3. Generate new JWT with new organization_id
4. Return new token
5. Frontend stores new token
6. Page reload triggers RLS with new org context
```

### 2. AWS Cost Tracking & Optimization

#### Real-Time Cost Sync

**Architecture**:
```
Frontend Button → API Endpoint → AWS Cost Explorer → Database → Prometheus
```

**Implementation** (`backend/src/services/aws-cost.service.ts`):

```typescript
async function syncAWSCosts(organizationId: string) {
  // 1. Get encrypted AWS credentials for organization
  const credentials = await getOrganizationAWSCredentials(organizationId);

  // 2. Decrypt credentials using AES-256-GCM
  const decrypted = decrypt(credentials.encryptedAccessKey);

  // 3. Initialize AWS Cost Explorer client
  const costExplorer = new CostExplorerClient({
    credentials: {
      accessKeyId: decrypted.accessKeyId,
      secretAccessKey: decrypted.secretAccessKey,
    },
    region: credentials.region,
  });

  // 4. Fetch current month costs
  const costs = await costExplorer.send(new GetCostAndUsageCommand({
    TimePeriod: {
      Start: '2025-12-01',
      End: '2025-12-31',
    },
    Granularity: 'MONTHLY',
    Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
  }));

  // 5. Parse and store in database
  for (const service of costs.ResultsByTime[0].Groups) {
    await upsertInfrastructureResource({
      organizationId,
      name: service.Keys[0],
      type: 'aws_service',
      costPerMonth: parseFloat(service.Metrics.UnblendedCost.Amount),
      source: 'aws_api',
    });
  }

  return { totalCost, resourcesSynced };
}
```

**Encryption Service** (`backend/src/services/encryption.service.ts`):
```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

#### Cost Optimization Recommendations

**AI-Powered Analysis** (`backend/src/services/cost-optimization.service.ts`):

```typescript
async function analyzeResourcesForOptimization() {
  const recommendations: CostRecommendation[] = [];

  // 1. Get all EC2 instances
  const instances = await describeEC2Instances();

  for (const instance of instances) {
    // 2. Fetch 7-day CPU utilization from CloudWatch
    const metrics = await cloudWatch.send(new GetMetricStatisticsCommand({
      Namespace: 'AWS/EC2',
      MetricName: 'CPUUtilization',
      Dimensions: [{ Name: 'InstanceId', Value: instance.InstanceId }],
      StartTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      EndTime: new Date(),
      Period: 3600,
      Statistics: ['Average'],
    }));

    // 3. Calculate average CPU
    const avgCPU = average(metrics.Datapoints.map(d => d.Average));

    // 4. Generate recommendation if idle
    if (avgCPU < 5) {
      recommendations.push({
        severity: 'HIGH',
        resourceType: 'EC2',
        resourceId: instance.InstanceId,
        issue: 'Idle EC2 instance detected',
        description: `Instance ${instance.InstanceId} has ${avgCPU.toFixed(1)}% average CPU over 7 days`,
        recommendation: 'Stop or terminate this instance to save costs',
        potentialMonthlySavings: getInstanceMonthlyCost(instance.InstanceType),
      });
    }
  }

  // 5. Store in database
  await saveCostRecommendations(recommendations);
}
```

**Key Learnings**:
- CloudWatch integration for real metrics
- 7-day analysis window for accuracy
- HIGH/MEDIUM/LOW severity scoring
- Potential savings calculation
- One-click resolution tracking

### 3. AWS Resource Inventory & Discovery

#### Auto-Discovery System

**Database Schema** (`database/migrations/008_create_aws_resources.sql`):

```sql
CREATE TABLE aws_resources (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,

  -- AWS Identification
  resource_arn VARCHAR(255) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  resource_name VARCHAR(255),
  resource_type VARCHAR(50) NOT NULL, -- ec2, rds, s3, lambda, ecs, elb
  region VARCHAR(50) NOT NULL,

  -- Details
  tags JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  status VARCHAR(50),

  -- Cost
  estimated_monthly_cost DECIMAL(10,2),
  actual_monthly_cost DECIMAL(10,2),

  -- Compliance
  is_encrypted BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT false,
  has_backup BOOLEAN DEFAULT false,
  compliance_issues JSONB DEFAULT '[]',

  -- Tracking
  last_synced_at TIMESTAMP,
  first_discovered_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(organization_id, resource_arn)
);

-- GIN index for fast JSONB queries
CREATE INDEX idx_aws_resources_tags ON aws_resources USING GIN(tags);
```

**Discovery Service** (`backend/src/services/awsResourceDiscovery.ts`):

```typescript
async function discoverAllResources(organizationId: string) {
  const job = await createDiscoveryJob(organizationId);

  try {
    const resources = [];

    // 1. Discover EC2 instances
    const ec2Client = new EC2Client({ region: 'us-east-1' });
    const instances = await ec2Client.send(new DescribeInstancesCommand({}));

    for (const reservation of instances.Reservations) {
      for (const instance of reservation.Instances) {
        resources.push({
          resourceArn: `arn:aws:ec2:us-east-1:${accountId}:instance/${instance.InstanceId}`,
          resourceId: instance.InstanceId,
          resourceName: instance.Tags?.find(t => t.Key === 'Name')?.Value,
          resourceType: 'ec2',
          region: 'us-east-1',
          status: instance.State.Name,
          tags: Object.fromEntries(instance.Tags?.map(t => [t.Key, t.Value]) || []),
          metadata: {
            instanceType: instance.InstanceType,
            platform: instance.Platform || 'linux',
            launchTime: instance.LaunchTime,
            privateIpAddress: instance.PrivateIpAddress,
            publicIpAddress: instance.PublicIpAddress,
          },
          estimatedMonthlyCost: getEC2MonthlyCost(instance.InstanceType),
        });
      }
    }

    // 2. Discover RDS databases
    const rdsClient = new RDSClient({ region: 'us-east-1' });
    const databases = await rdsClient.send(new DescribeDBInstancesCommand({}));

    for (const db of databases.DBInstances) {
      resources.push({
        resourceArn: db.DBInstanceArn,
        resourceId: db.DBInstanceIdentifier,
        resourceType: 'rds',
        region: 'us-east-1',
        status: db.DBInstanceStatus,
        metadata: {
          engine: db.Engine,
          engineVersion: db.EngineVersion,
          instanceClass: db.DBInstanceClass,
          allocatedStorage: db.AllocatedStorage,
          multiAZ: db.MultiAZ,
        },
        isEncrypted: db.StorageEncrypted,
        hasBackup: db.BackupRetentionPeriod > 0,
        estimatedMonthlyCost: getRDSMonthlyCost(db.DBInstanceClass),
      });
    }

    // 3. Discover S3 buckets
    const s3Client = new S3Client({ region: 'us-east-1' });
    const buckets = await s3Client.send(new ListBucketsCommand({}));

    for (const bucket of buckets.Buckets) {
      // Check encryption
      const encryption = await s3Client.send(
        new GetBucketEncryptionCommand({ Bucket: bucket.Name })
      ).catch(() => null);

      // Check public access
      const publicAccess = await s3Client.send(
        new GetPublicAccessBlockCommand({ Bucket: bucket.Name })
      ).catch(() => null);

      resources.push({
        resourceArn: `arn:aws:s3:::${bucket.Name}`,
        resourceId: bucket.Name,
        resourceType: 's3',
        region: 'us-east-1',
        status: 'active',
        isEncrypted: !!encryption,
        isPublic: !publicAccess?.PublicAccessBlockConfiguration?.BlockPublicAcls,
        estimatedMonthlyCost: 5, // Base estimate
      });
    }

    // 4. Bulk upsert to database
    await bulkUpsertResources(organizationId, resources);

    // 5. Update job status
    await updateDiscoveryJob(job.id, {
      status: 'completed',
      resourcesDiscovered: resources.length,
      completedAt: new Date(),
    });

    return resources;
  } catch (error) {
    await updateDiscoveryJob(job.id, {
      status: 'failed',
      errorMessage: error.message,
    });
    throw error;
  }
}
```

#### Compliance Scanner

**Security Scanning** (`backend/src/services/complianceScanner.ts`):

```typescript
async function scanResourceCompliance(resource: AWSResource) {
  const issues: ComplianceIssue[] = [];

  // 1. Check encryption
  if (resource.resourceType === 'rds' && !resource.isEncrypted) {
    issues.push({
      severity: 'HIGH',
      issue: 'RDS instance not encrypted',
      recommendation: 'Enable encryption at rest for compliance',
      complianceStandard: 'CIS AWS Foundations v1.4.0 - 2.3.1',
    });
  }

  // 2. Check public access
  if (resource.resourceType === 's3' && resource.isPublic) {
    issues.push({
      severity: 'CRITICAL',
      issue: 'S3 bucket publicly accessible',
      recommendation: 'Enable Block Public Access settings',
      complianceStandard: 'CIS AWS Foundations v1.4.0 - 2.1.5',
    });
  }

  // 3. Check backups
  if (resource.resourceType === 'rds' && !resource.hasBackup) {
    issues.push({
      severity: 'MEDIUM',
      issue: 'RDS backup disabled',
      recommendation: 'Enable automated backups with 7+ day retention',
      complianceStandard: 'AWS Well-Architected Framework',
    });
  }

  // 4. Check tagging
  const requiredTags = ['Environment', 'Owner', 'CostCenter'];
  const missingTags = requiredTags.filter(tag => !resource.tags[tag]);

  if (missingTags.length > 0) {
    issues.push({
      severity: 'LOW',
      issue: `Missing required tags: ${missingTags.join(', ')}`,
      recommendation: 'Add tags for cost allocation and governance',
      complianceStandard: 'Tagging Best Practices',
    });
  }

  // 5. Update database
  await updateResourceComplianceIssues(resource.id, issues);

  return issues;
}
```

**Key Learnings**:
- Multi-service discovery (EC2, RDS, S3)
- JSONB for flexible metadata storage
- GIN indexes for fast tag queries
- Job tracking for async operations
- Compliance standards mapping (CIS, WAF)

### 4. DORA Metrics Dashboard

#### The 4 Key Metrics

**Background**: Google's DevOps Research and Assessment (DORA) team identified 4 key metrics that distinguish elite engineering teams:

1. **Deployment Frequency**: How often code ships to production
2. **Lead Time for Changes**: Time between commits
3. **Change Failure Rate**: Percentage of deployments causing failures
4. **Mean Time to Recovery (MTTR)**: Time to fix production issues

**Implementation** (`backend/src/services/dora-metrics.service.ts`):

```typescript
async function calculateDORAMetrics(organizationId: string, options: {
  dateRange: '7d' | '30d' | '90d';
  environment?: string;
  serviceId?: string;
}) {
  const days = parseInt(options.dateRange);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 1. Deployment Frequency
  const deployments = await pool.query(`
    SELECT COUNT(*) as count, service_id
    FROM deployments
    WHERE organization_id = $1
      AND created_at >= $2
      AND ($3::text IS NULL OR environment = $3)
    GROUP BY service_id
  `, [organizationId, startDate, options.environment]);

  const deploymentFrequency = {
    total: deployments.rows.reduce((sum, r) => sum + r.count, 0),
    perDay: deployments.rows.reduce((sum, r) => sum + r.count, 0) / days,
    perWeek: (deployments.rows.reduce((sum, r) => sum + r.count, 0) / days) * 7,
    classification: classifyDeploymentFrequency(deploymentsPerDay),
    // Elite: Multiple per day, High: Once per day, Medium: Weekly, Low: Monthly
  };

  // 2. Lead Time for Changes
  const leadTimes = await pool.query(`
    SELECT
      d1.created_at - d2.created_at as lead_time,
      d1.service_id
    FROM deployments d1
    LEFT JOIN deployments d2 ON
      d1.service_id = d2.service_id AND
      d2.created_at < d1.created_at
    WHERE d1.organization_id = $1
      AND d1.created_at >= $2
    ORDER BY d2.created_at DESC
    LIMIT 1
  `, [organizationId, startDate]);

  const avgLeadTime = average(leadTimes.rows.map(r => r.lead_time));

  const leadTimeForChanges = {
    average: avgLeadTime,
    median: median(leadTimes.rows.map(r => r.lead_time)),
    p95: percentile(leadTimes.rows.map(r => r.lead_time), 95),
    classification: classifyLeadTime(avgLeadTime),
    // Elite: < 1 hour, High: < 1 day, Medium: < 1 week, Low: > 1 month
  };

  // 3. Change Failure Rate
  const failures = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) as total
    FROM deployments
    WHERE organization_id = $1
      AND created_at >= $2
  `, [organizationId, startDate]);

  const failureRate = (failures.rows[0].failed / failures.rows[0].total) * 100;

  const changeFailureRate = {
    percentage: failureRate,
    total: failures.rows[0].total,
    failed: failures.rows[0].failed,
    classification: classifyFailureRate(failureRate),
    // Elite: < 15%, High: < 20%, Medium: < 30%, Low: > 30%
  };

  // 4. Mean Time to Recovery
  const incidents = await pool.query(`
    SELECT
      resolved_at - created_at as recovery_time
    FROM incidents
    WHERE organization_id = $1
      AND created_at >= $2
      AND resolved_at IS NOT NULL
  `, [organizationId, startDate]);

  const avgRecoveryTime = average(incidents.rows.map(r => r.recovery_time));

  const mttr = {
    average: avgRecoveryTime,
    median: median(incidents.rows.map(r => r.recovery_time)),
    classification: classifyMTTR(avgRecoveryTime),
    // Elite: < 1 hour, High: < 1 day, Medium: < 1 week, Low: > 1 week
  };

  return {
    deploymentFrequency,
    leadTimeForChanges,
    changeFailureRate,
    mttr,
    overallClassification: determineOverallClassification([
      deploymentFrequency.classification,
      leadTimeForChanges.classification,
      changeFailureRate.classification,
      mttr.classification,
    ]),
  };
}
```

**Frontend Dashboard** (`app/(app)/dashboard/page.tsx`):
- 4 metric cards with trend indicators
- Service breakdown table
- Time range selector (7d/30d/90d)
- Environment filter
- Benchmark comparison chart
- Export to CSV/PDF

**Key Learnings**:
- Industry-standard metrics for DevOps
- SQL window functions for lead time
- Percentile calculations (p50, p95, p99)
- Elite/High/Medium/Low classification
- Visual trend indicators

### 5. Real-Time WebSocket Features

#### WebSocket Server

**Implementation** (`backend/src/websocket/server.ts`):

```typescript
import { WebSocketServer } from 'ws';
import { verify } from 'jsonwebtoken';

const wss = new WebSocketServer({ port: 8081 });

interface Client {
  socket: WebSocket;
  userId: string;
  organizationId: string;
}

const clients = new Map<string, Client>();

wss.on('connection', (socket, req) => {
  // 1. Extract JWT from query params
  const token = new URL(req.url!, 'ws://localhost').searchParams.get('token');

  if (!token) {
    socket.close(1008, 'Missing authentication token');
    return;
  }

  try {
    // 2. Verify JWT
    const payload = verify(token, process.env.JWT_SECRET!) as JWTPayload;

    // 3. Store client
    const clientId = `${payload.userId}-${Date.now()}`;
    clients.set(clientId, {
      socket,
      userId: payload.userId,
      organizationId: payload.currentOrganizationId,
    });

    // 4. Send connection confirmation
    socket.send(JSON.stringify({
      type: 'connection',
      status: 'connected',
      clientId,
    }));

    // 5. Handle disconnection
    socket.on('close', () => {
      clients.delete(clientId);
    });

  } catch (error) {
    socket.close(1008, 'Invalid authentication token');
  }
});

// Broadcast to organization
export function broadcastToOrganization(
  organizationId: string,
  event: {
    type: string;
    data: any;
  }
) {
  for (const [clientId, client] of clients.entries()) {
    if (client.organizationId === organizationId) {
      client.socket.send(JSON.stringify(event));
    }
  }
}
```

**Events Emitted**:
```typescript
// Deployment events
broadcastToOrganization(organizationId, {
  type: 'deployment.created',
  data: {
    deploymentId: 'uuid',
    serviceName: 'api-gateway',
    environment: 'production',
    version: 'v1.2.3',
    status: 'running',
  },
});

// Metrics events
broadcastToOrganization(organizationId, {
  type: 'metrics.updated',
  data: {
    totalServices: 15,
    totalDeployments: 234,
    infrastructureCost: 1234.56,
  },
});

// Resource discovery events
broadcastToOrganization(organizationId, {
  type: 'discovery.completed',
  data: {
    resourcesDiscovered: 47,
    jobId: 'uuid',
  },
});
```

**Frontend Hook** (`hooks/use-websocket.ts`):

```typescript
export function useWebSocket() {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!user) return;

    const token = localStorage.getItem('authToken');
    const ws = new WebSocket(`ws://localhost:8081?token=${token}`);

    ws.onopen = () => {
      setIsConnected(true);
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('WebSocket disconnected');
    };

    socketRef.current = ws;

    return () => {
      ws.close();
    };
  }, [user]);

  return { isConnected, socket: socketRef.current };
}
```

**Real-Time UI Updates**:
```typescript
// Dashboard auto-updates when metrics change
function handleWebSocketMessage(message: WebSocketMessage) {
  switch (message.type) {
    case 'metrics.updated':
      queryClient.invalidateQueries(['dashboard-stats']);
      toast.success('Dashboard updated');
      break;

    case 'deployment.created':
      queryClient.invalidateQueries(['deployments']);
      toast.info(`New deployment: ${message.data.serviceName}`);
      break;

    case 'discovery.completed':
      queryClient.invalidateQueries(['aws-resources']);
      toast.success(`Discovered ${message.data.resourcesDiscovered} resources`);
      break;
  }
}
```

**Key Learnings**:
- JWT authentication for WebSocket
- Organization-scoped broadcasting
- React Query invalidation on events
- Connection status indicator
- Auto-reconnect on disconnect

### 6. Monitoring & Observability

#### Prometheus Metrics Export

**Implementation** (`backend/src/metrics/prometheus.ts`):

```typescript
import promClient from 'prom-client';

// Initialize registry
const register = new promClient.Registry();

// Default metrics (CPU, memory, event loop)
promClient.collectDefaultMetrics({ register });

// Custom business metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5],
});

const totalServices = new promClient.Gauge({
  name: 'platform_services_total',
  help: 'Total number of services registered',
});

const totalDeployments = new promClient.Gauge({
  name: 'platform_deployments_total',
  help: 'Total number of deployments',
});

const infrastructureCost = new promClient.Gauge({
  name: 'infrastructure_cost_monthly_total',
  help: 'Monthly infrastructure cost in USD',
});

register.registerMetric(httpRequestDuration);
register.registerMetric(totalServices);
register.registerMetric(totalDeployments);
register.registerMetric(infrastructureCost);

// Middleware to track HTTP requests
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode.toString())
      .observe(duration);
  });

  next();
});

// Update business metrics every 30 seconds
setInterval(async () => {
  const stats = await getDashboardStats();

  totalServices.set(stats.totalServices);
  totalDeployments.set(stats.totalDeployments);
  infrastructureCost.set(stats.infrastructureCost);
}, 30000);

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

#### Grafana Dashboards

**4 Pre-Built Dashboards**:

1. **API Performance** (`monitoring/grafana/dashboards/api-performance.json`):
   - Request rate (requests/sec)
   - Response time (p50, p95, p99)
   - Error rate (5xx errors)
   - Top slowest endpoints
   - HTTP status code distribution

2. **Infrastructure Costs** (`monitoring/grafana/dashboards/infrastructure.json`):
   - Total monthly cost (gauge)
   - Cost by service (pie chart)
   - Cost trend over time (line graph)
   - Top 10 most expensive resources
   - Cost by environment

3. **Service Health** (`monitoring/grafana/dashboards/service-health.json`):
   - Services registered (counter)
   - Deployments last 24h (counter)
   - Deployment success rate (gauge)
   - DORA metrics panel
   - Service status table

4. **System Resources** (`monitoring/grafana/dashboards/system.json`):
   - CPU usage (%)
   - Memory usage (GB)
   - Event loop lag (ms)
   - Database connections
   - WebSocket connections

**Alert Rules** (`monitoring/prometheus/alerts/platform-alerts.yml`):

```yaml
groups:
  - name: platform_alerts
    interval: 30s
    rules:
      # API Down
      - alert: APIDown
        expr: up{job="platform-backend"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Platform API is down"
          description: "The backend API has been down for 1 minute"

      # High Error Rate
      - alert: HighErrorRate
        expr: |
          rate(http_requests_total{status=~"5.."}[5m]) /
          rate(http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"

      # High Infrastructure Cost
      - alert: HighInfrastructureCost
        expr: infrastructure_cost_monthly_total > 5000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Infrastructure costs exceeding budget"
          description: "Monthly cost is ${{ $value }}"

      # Slow Response Time
      - alert: SlowResponseTime
        expr: |
          histogram_quantile(0.95,
            rate(http_request_duration_seconds_bucket[5m])
          ) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow API response time"
          description: "p95 latency is {{ $value }}s"
```

**Key Learnings**:
- prom-client for Node.js metrics
- Histogram for latency percentiles
- Gauge for point-in-time values
- Counter for cumulative values
- PromQL for complex queries
- Alert routing to Slack/PagerDuty

---

## Technical Deep Dives

### Deep Dive 1: Row-Level Security Implementation

**Challenge**: How to implement multi-tenancy in PostgreSQL without N+1 queries or data leakage?

**Solution**: PostgreSQL Row-Level Security (RLS) with session variables

**Step-by-Step Implementation**:

1. **Database Schema** (every table):
```sql
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  version VARCHAR(50) NOT NULL,
  environment VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

2. **Enable RLS**:
```sql
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
```

3. **Create Policies**:
```sql
-- SELECT, UPDATE, DELETE policy
CREATE POLICY deployments_isolation_policy ON deployments
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- INSERT policy
CREATE POLICY deployments_insert_policy ON deployments
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );
```

4. **Backend Middleware**:
```typescript
export async function setOrganizationContext(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const organizationId = req.user.currentOrganizationId;

    // Set PostgreSQL session variable
    await pool.query(
      `SET LOCAL app.current_organization_id = $1`,
      [organizationId]
    );

    next();
  } catch (error) {
    next(error);
  }
}

// Apply to all routes
app.use('/api', authenticate, setOrganizationContext);
```

5. **Query Anywhere** (RLS automatically filters):
```typescript
// This query automatically filters by organization_id
// No need to add WHERE organization_id = ...
const deployments = await pool.query(`
  SELECT * FROM deployments
  WHERE service_id = $1
  ORDER BY created_at DESC
`, [serviceId]);
```

**Benefits**:
- **Security**: Impossible to leak data between orgs
- **Performance**: No N+1 query issues
- **Simplicity**: No WHERE clauses in every query
- **Database-Level**: Protection even if app has bugs

**Gotchas**:
- Session variable must be set on every request
- Use connection pools carefully (variables are per-transaction)
- Superuser bypasses RLS (use application user)

### Deep Dive 2: JWT Authentication Flow

**Token Structure**:
```typescript
interface JWTPayload {
  userId: string;
  email: string;
  currentOrganizationId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  iat: number; // Issued at
  exp: number; // Expires at
}
```

**Token Generation** (`backend/src/services/auth.service.ts`):
```typescript
import jwt from 'jsonwebtoken';

function generateTokens(user: User) {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    currentOrganizationId: user.currentOrganizationId,
    role: user.role,
  };

  // Access token (7 days)
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: '7d',
  });

  // Refresh token (30 days)
  const refreshToken = jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '30d' }
  );

  return { accessToken, refreshToken };
}
```

**Authentication Middleware** (`backend/src/middleware/auth.middleware.ts`):
```typescript
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // 1. Extract token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }

    const token = authHeader.substring(7);

    // 2. Verify token
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;

    // 3. Fetch user from database
    const user = await pool.query(
      `SELECT * FROM users WHERE id = $1`,
      [payload.userId]
    );

    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    // 4. Attach to request
    req.user = {
      ...user.rows[0],
      currentOrganizationId: payload.currentOrganizationId,
      role: payload.role,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }

    return res.status(401).json({ error: 'Invalid token' });
  }
}
```

**Token Refresh Flow**:
```typescript
POST /api/auth/refresh
Body: { refreshToken: string }

async function refreshAccessToken(refreshToken: string) {
  // 1. Verify refresh token
  const payload = jwt.verify(
    refreshToken,
    process.env.JWT_REFRESH_SECRET!
  ) as { userId: string };

  // 2. Fetch user
  const user = await getUserById(payload.userId);

  // 3. Generate new access token
  const newAccessToken = generateAccessToken(user);

  return { accessToken: newAccessToken };
}
```

**Frontend Token Storage** (`lib/services/auth.service.ts`):
```typescript
class AuthService {
  private TOKEN_KEY = 'authToken';
  private REFRESH_TOKEN_KEY = 'refreshToken';

  setTokens(accessToken: string, refreshToken: string) {
    localStorage.setItem(this.TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
  }

  getAccessToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  getRefreshToken() {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  clearTokens() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
  }

  // Auto-refresh before expiration
  async refreshIfNeeded() {
    const token = this.getAccessToken();

    if (!token) return;

    const decoded = jwt.decode(token) as JWTPayload;
    const expiresAt = decoded.exp * 1000;
    const now = Date.now();

    // Refresh if expiring in next 5 minutes
    if (expiresAt - now < 5 * 60 * 1000) {
      const refreshToken = this.getRefreshToken();
      const response = await this.refresh(refreshToken!);
      this.setTokens(response.accessToken, refreshToken!);
    }
  }
}
```

**Axios Interceptor for Auto-Refresh**:
```typescript
import axios from 'axios';

// Request interceptor: Add token
axios.interceptors.request.use((config) => {
  const token = authService.getAccessToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Response interceptor: Handle 401
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not a retry
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Try to refresh token
        const refreshToken = authService.getRefreshToken();
        const response = await authService.refresh(refreshToken!);

        authService.setTokens(response.accessToken, refreshToken!);

        // Retry original request
        originalRequest.headers.Authorization = `Bearer ${response.accessToken}`;
        return axios(originalRequest);
      } catch (refreshError) {
        // Refresh failed, logout user
        authService.clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
```

**Key Learnings**:
- Access token: Short-lived (7 days), sent with every request
- Refresh token: Long-lived (30 days), used to get new access token
- Auto-refresh before expiration prevents user disruption
- Axios interceptors handle 401 gracefully
- LocalStorage for web, SecureStore for mobile

### Deep Dive 3: AES-256-GCM Encryption

**Why Encrypt AWS Credentials?**
- Stored in PostgreSQL database
- Database backups might be exposed
- Developers shouldn't see production credentials
- Compliance requirements (SOC 2, PCI-DSS)

**Encryption Algorithm**: AES-256-GCM
- AES: Advanced Encryption Standard
- 256: Key size in bits (very secure)
- GCM: Galois/Counter Mode (authenticated encryption)

**Benefits of GCM**:
- **Confidentiality**: Data is encrypted
- **Integrity**: Detects tampering
- **Authentication**: Auth tag prevents modification

**Implementation** (`backend/src/services/encryption.service.ts`):

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

// Generate encryption key once
// Store in environment variable
// openssl rand -hex 32
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');

export function encrypt(plaintext: string): string {
  // 1. Generate random Initialization Vector (IV)
  // IV must be unique for each encryption
  const iv = crypto.randomBytes(IV_LENGTH);

  // 2. Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  // 3. Encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // 4. Get authentication tag
  const authTag = cipher.getAuthTag();

  // 5. Combine iv + authTag + encrypted
  // Format: {iv}:{authTag}:{ciphertext}
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  // 1. Split components
  const [ivHex, authTagHex, encrypted] = ciphertext.split(':');

  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid ciphertext format');
  }

  // 2. Convert from hex
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  // 3. Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  // 4. Set auth tag (verifies integrity)
  decipher.setAuthTag(authTag);

  try {
    // 5. Decrypt
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error('Decryption failed - data may be tampered');
  }
}

// Example usage
const awsCredentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};

const encrypted = encrypt(JSON.stringify(awsCredentials));
// Stored in database:
// "a1b2c3....:d4e5f6....:g7h8i9...."

const decrypted = decrypt(encrypted);
// Returns original JSON string
```

**Database Storage**:
```sql
CREATE TABLE organization_aws_credentials (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  encrypted_access_key_id TEXT NOT NULL, -- AES-256-GCM encrypted
  encrypted_secret_access_key TEXT NOT NULL, -- AES-256-GCM encrypted
  region VARCHAR(50) NOT NULL,
  account_id VARCHAR(12),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(organization_id)
);
```

**Usage in AWS Services**:
```typescript
async function getAWSClient(organizationId: string) {
  // 1. Fetch encrypted credentials
  const creds = await pool.query(`
    SELECT encrypted_access_key_id, encrypted_secret_access_key, region
    FROM organization_aws_credentials
    WHERE organization_id = $1
  `, [organizationId]);

  if (creds.rows.length === 0) {
    throw new Error('AWS credentials not configured');
  }

  // 2. Decrypt
  const accessKeyId = decrypt(creds.rows[0].encrypted_access_key_id);
  const secretAccessKey = decrypt(creds.rows[0].encrypted_secret_access_key);

  // 3. Create AWS client
  return new EC2Client({
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    region: creds.rows[0].region,
  });
}
```

**Security Best Practices**:
1. **Key Management**:
   - Generate key with `openssl rand -hex 32`
   - Store in environment variable (never in code)
   - Rotate keys periodically
   - Use KMS in production (AWS KMS, HashiCorp Vault)

2. **IV (Initialization Vector)**:
   - Generate new random IV for each encryption
   - Never reuse IVs with same key
   - Store IV with ciphertext

3. **Auth Tag**:
   - Verifies data hasn't been tampered
   - Throws error if modified
   - Prevents bit-flipping attacks

**Key Learnings**:
- AES-256-GCM provides encryption + authentication
- IV must be unique for each encryption
- Auth tag detects tampering
- Store IV:AuthTag:Ciphertext together
- Never log decrypted values

---

## Key Patterns & Best Practices

### 1. Error Handling Pattern

**Centralized Error Handler** (`backend/src/middleware/error.middleware.ts`):

```typescript
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
    });
  }

  // Unexpected error - log and return generic message
  console.error('Unexpected error:', err);

  return res.status(500).json({
    error: 'An unexpected error occurred',
  });
}

// Usage
app.use(errorHandler);
```

**Controller Pattern**:
```typescript
export async function createDeployment(req: Request, res: Response, next: NextFunction) {
  try {
    const { serviceId, version, environment } = req.body;

    // Validate
    if (!serviceId || !version || !environment) {
      throw new AppError(400, 'Missing required fields');
    }

    // Check service exists
    const service = await getServiceById(serviceId);

    if (!service) {
      throw new AppError(404, 'Service not found');
    }

    // Create deployment
    const deployment = await createDeploymentRecord({
      serviceId,
      version,
      environment,
      organizationId: req.user.currentOrganizationId,
    });

    res.status(201).json({ data: deployment });
  } catch (error) {
    next(error); // Pass to error handler
  }
}
```

### 2. API Response Pattern

**Consistent Response Format**:
```typescript
// Success responses
{
  "data": { ... }, // Single object or array
  "meta": { // Optional
    "total": 100,
    "page": 1,
    "perPage": 20
  }
}

// Error responses
{
  "error": "Error message",
  "details": { // Optional
    "field": "email",
    "issue": "already exists"
  }
}
```

**Helper Functions**:
```typescript
export function success(data: any, meta?: any) {
  return {
    data,
    ...(meta && { meta }),
  };
}

export function error(message: string, details?: any) {
  return {
    error: message,
    ...(details && { details }),
  };
}

// Usage
res.json(success(deployments, { total: 100, page: 1 }));
res.status(400).json(error('Validation failed', { field: 'email' }));
```

### 3. Repository Pattern

**Separation of Concerns**:
- Controllers: Handle HTTP requests/responses
- Services: Business logic
- Repositories: Database queries

**Example** (`backend/src/repositories/deployment.repository.ts`):

```typescript
export class DeploymentRepository {
  async create(data: CreateDeploymentData): Promise<Deployment> {
    const result = await pool.query(`
      INSERT INTO deployments (
        organization_id, service_id, version, environment, status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      data.organizationId,
      data.serviceId,
      data.version,
      data.environment,
      'pending',
    ]);

    return result.rows[0];
  }

  async findById(id: string): Promise<Deployment | null> {
    const result = await pool.query(`
      SELECT * FROM deployments WHERE id = $1
    `, [id]);

    return result.rows[0] || null;
  }

  async findByService(serviceId: string, options: {
    limit?: number;
    offset?: number;
    environment?: string;
  }): Promise<Deployment[]> {
    let query = `
      SELECT * FROM deployments
      WHERE service_id = $1
    `;

    const params: any[] = [serviceId];

    if (options.environment) {
      query += ` AND environment = $${params.length + 1}`;
      params.push(options.environment);
    }

    query += ` ORDER BY created_at DESC`;

    if (options.limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(options.limit);
    }

    if (options.offset) {
      query += ` OFFSET $${params.length + 1}`;
      params.push(options.offset);
    }

    const result = await pool.query(query, params);
    return result.rows;
  }

  async update(id: string, data: Partial<Deployment>): Promise<Deployment> {
    const fields = Object.keys(data);
    const values = Object.values(data);

    const setClause = fields
      .map((field, i) => `${field} = $${i + 2}`)
      .join(', ');

    const result = await pool.query(`
      UPDATE deployments
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id, ...values]);

    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    await pool.query(`DELETE FROM deployments WHERE id = $1`, [id]);
  }
}

export const deploymentRepository = new DeploymentRepository();
```

### 4. Frontend: Custom Hooks Pattern

**Data Fetching Hook** (`hooks/use-deployments.ts`):
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useDeployments(serviceId: string, options?: {
  environment?: string;
}) {
  return useQuery({
    queryKey: ['deployments', serviceId, options],
    queryFn: () => deploymentsService.getByService(serviceId, options),
    staleTime: 30000, // 30 seconds
  });
}

export function useCreateDeployment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deploymentsService.create,
    onSuccess: (deployment) => {
      // Invalidate deployments query
      queryClient.invalidateQueries({ queryKey: ['deployments'] });

      // Show toast
      toast.success(`Deployment created: ${deployment.version}`);
    },
    onError: (error) => {
      toast.error(`Failed to create deployment: ${error.message}`);
    },
  });
}

// Usage in component
function DeploymentsPage() {
  const { data: deployments, isLoading } = useDeployments(serviceId);
  const createDeployment = useCreateDeployment();

  const handleCreate = () => {
    createDeployment.mutate({
      serviceId,
      version: 'v1.2.3',
      environment: 'production',
    });
  };

  if (isLoading) return <Spinner />;

  return <DeploymentsList deployments={deployments} />;
}
```

### 5. Form Validation with Zod

**Schema Definition** (`lib/validations/deployment.schema.ts`):
```typescript
import { z } from 'zod';

export const createDeploymentSchema = z.object({
  serviceId: z.string().uuid('Invalid service ID'),
  version: z
    .string()
    .min(1, 'Version is required')
    .max(50, 'Version too long')
    .regex(/^v?\d+\.\d+\.\d+$/, 'Version must be in format: v1.2.3'),
  environment: z.enum(['development', 'staging', 'production'], {
    errorMap: () => ({ message: 'Invalid environment' }),
  }),
  notes: z
    .string()
    .max(500, 'Notes too long')
    .optional(),
});

export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;
```

**Form Component** (`components/forms/create-deployment-form.tsx`):
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

export function CreateDeploymentForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateDeploymentInput>({
    resolver: zodResolver(createDeploymentSchema),
  });

  const createDeployment = useCreateDeployment();

  const onSubmit = async (data: CreateDeploymentInput) => {
    await createDeployment.mutateAsync(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div>
        <label>Version</label>
        <input {...register('version')} />
        {errors.version && (
          <span className="error">{errors.version.message}</span>
        )}
      </div>

      <div>
        <label>Environment</label>
        <select {...register('environment')}>
          <option value="development">Development</option>
          <option value="staging">Staging</option>
          <option value="production">Production</option>
        </select>
        {errors.environment && (
          <span className="error">{errors.environment.message}</span>
        )}
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create Deployment'}
      </button>
    </form>
  );
}
```

---

## Study & Practice Areas

### For Junior Engineers

1. **Frontend Fundamentals**:
   - Study: `app/(auth)/login/page.tsx` - Basic form handling
   - Practice: Build a registration form with validation
   - Key Concepts: React Hook Form, Zod validation, error handling

2. **API Integration**:
   - Study: `lib/services/auth.service.ts` - API service pattern
   - Practice: Create a new API service for a different resource
   - Key Concepts: Axios, async/await, error handling

3. **Component Patterns**:
   - Study: `components/ui/button.tsx` - Reusable components
   - Practice: Build a reusable Card component
   - Key Concepts: Props, TypeScript interfaces, className merging

### For Mid-Level Engineers

1. **State Management**:
   - Study: `lib/contexts/auth-context.tsx` - React Context
   - Practice: Implement a theme context for dark mode
   - Key Concepts: Context API, useContext, provider pattern

2. **Database Queries**:
   - Study: `backend/src/repositories/organization.repository.ts`
   - Practice: Add pagination and filtering to repositories
   - Key Concepts: SQL queries, parameterized queries, query builders

3. **Authentication Flow**:
   - Study: `backend/src/middleware/auth.middleware.ts`
   - Practice: Implement role-based access control middleware
   - Key Concepts: JWT, middleware pattern, authorization

### For Senior Engineers

1. **Multi-Tenancy Architecture**:
   - Study: `database/migrations/004_add_multi_tenancy.sql`
   - Practice: Implement RLS for a new feature table
   - Key Concepts: Row-Level Security, PostgreSQL policies, session variables

2. **AWS Integration**:
   - Study: `backend/src/services/awsResourceDiscovery.ts`
   - Practice: Add Lambda or DynamoDB discovery
   - Key Concepts: AWS SDK v3, async iteration, error handling

3. **Real-Time Features**:
   - Study: `backend/src/websocket/server.ts`
   - Practice: Add real-time notifications
   - Key Concepts: WebSocket, broadcasting, event-driven architecture

### For Staff Engineers

1. **System Architecture**:
   - Study: Overall architecture diagram above
   - Practice: Design a new feature (e.g., audit logs) end-to-end
   - Key Concepts: System design, scalability, data modeling

2. **Security Best Practices**:
   - Study: `backend/src/services/encryption.service.ts`
   - Practice: Implement key rotation for encrypted credentials
   - Key Concepts: Encryption, key management, security compliance

3. **Observability**:
   - Study: `backend/src/metrics/prometheus.ts`
   - Practice: Add custom business metrics
   - Key Concepts: Prometheus, Grafana, SLIs/SLOs

4. **Performance Optimization**:
   - Study: Database indexes in migrations
   - Practice: Analyze and optimize slow queries
   - Key Concepts: Query optimization, indexing strategies, caching

---

## Practice Exercises

### Exercise 1: Add a New Resource Type

**Goal**: Add support for AWS Lambda functions in the resource inventory

**Steps**:
1. Update `database/migrations/008_create_aws_resources.sql` to support Lambda
2. Implement Lambda discovery in `awsResourceDiscovery.ts`
3. Add compliance checks for Lambda (unused functions, high memory)
4. Create UI components to display Lambda functions
5. Add tests for the new functionality

**Skills**: AWS SDK, database migrations, TypeScript, React

### Exercise 2: Implement Audit Logs

**Goal**: Track all important actions (create, update, delete) across the platform

**Steps**:
1. Design audit log schema (who, what, when, before/after)
2. Create migration for `audit_logs` table with RLS
3. Implement middleware to capture and store audit events
4. Create API endpoint to query audit logs
5. Build frontend UI to view audit trail
6. Add filtering by user, resource type, date range

**Skills**: Database design, middleware, API design, React

### Exercise 3: Cost Forecasting

**Goal**: Predict next month's AWS costs based on historical data

**Steps**:
1. Collect 90 days of historical cost data
2. Implement linear regression or time series analysis
3. Create API endpoint `/api/costs/forecast`
4. Build dashboard widget showing forecasted costs
5. Add alerts when forecast exceeds budget
6. Implement confidence intervals

**Skills**: Machine learning, statistics, data analysis, visualization

### Exercise 4: SSO Integration

**Goal**: Add Google OAuth authentication

**Steps**:
1. Set up Google OAuth app
2. Implement OAuth callback endpoint
3. Store OAuth tokens securely
4. Create user from OAuth profile
5. Update login page with "Sign in with Google" button
6. Handle account linking (existing users)

**Skills**: OAuth 2.0, security, authentication flows

---

## Conclusion

**What You've Learned**:
- Multi-tenant SaaS architecture with PostgreSQL RLS
- JWT authentication and authorization
- AWS integration (Cost Explorer, EC2, RDS, S3)
- Real-time features with WebSocket
- Prometheus/Grafana observability
- DORA metrics for DevOps excellence
- Modern React patterns (hooks, context, queries)
- TypeScript best practices
- Security (encryption, RLS, RBAC)

**Next Steps for Mastery**:
1. **Deploy to Production**: AWS ECS/Fargate, RDS, CloudFront
2. **Add Tests**: Jest, React Testing Library, Supertest
3. **Performance**: Redis caching, database query optimization
4. **Scalability**: Horizontal scaling, load balancing
5. **Advanced Features**: GraphQL, microservices, event sourcing

**Resources**:
- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/)
- [DORA Metrics](https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)
- [Next.js App Router](https://nextjs.org/docs/app)

---

**Built by**: Goddey Uwamari
**Company**: WayUP Technology
**Project**: DevControl v1.0
**Date**: December 2025
