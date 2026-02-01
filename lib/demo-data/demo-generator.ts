import { v4 as uuidv4 } from 'uuid';

const DEMO_ORG_ID = 'demo-org-12345';

export const DEMO_AWS_RESOURCES = [
  // Production EC2 instances
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'i-prod-web-01',
    resourceName: 'production-web-server-1',
    resourceType: 'ec2',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      cpu_avg: '45',
      cpu_max: '78',
      memory_avg: '62',
      estimated_monthly_cost: '245.50',
      state: 'running',
      instance_type: 't3.large',
      days_observed: '30',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'i-prod-web-02',
    resourceName: 'production-web-server-2',
    resourceType: 'ec2',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      cpu_avg: '38',
      cpu_max: '65',
      memory_avg: '58',
      estimated_monthly_cost: '245.50',
      state: 'running',
      instance_type: 't3.large',
      days_observed: '30',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'i-prod-api-01',
    resourceName: 'production-api-server',
    resourceType: 'ec2',
    region: 'us-west-2',
    tags: {
      environment: 'production',
      cpu_avg: '67',
      cpu_max: '89',
      memory_avg: '71',
      estimated_monthly_cost: '389.00',
      state: 'running',
      instance_type: 't3.xlarge',
      days_observed: '30',
    },
  },
  // IDLE instance (for optimization)
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'i-staging-old-01',
    resourceName: 'staging-old-server',
    resourceType: 'ec2',
    region: 'us-east-1',
    tags: {
      environment: 'staging',
      cpu_avg: '2.1',
      cpu_max: '8.5',
      memory_avg: '15',
      estimated_monthly_cost: '178.00',
      state: 'running',
      instance_type: 't3.medium',
      days_observed: '14',
    },
  },
  // OVERSIZED instance
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'i-dev-testing-01',
    resourceName: 'dev-testing-environment',
    resourceType: 'ec2',
    region: 'us-east-1',
    tags: {
      environment: 'development',
      cpu_avg: '18',
      cpu_max: '32',
      memory_avg: '28',
      estimated_monthly_cost: '445.00',
      state: 'running',
      instance_type: 't3.2xlarge',
      days_observed: '20',
    },
  },
  // HIGH CPU (for anomaly)
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'i-prod-worker-01',
    resourceName: 'production-worker-overloaded',
    resourceType: 'ec2',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      cpu_avg: '92',
      cpu_max: '98',
      cpu_historical_avg: '45',
      memory_avg: '87',
      estimated_monthly_cost: '289.00',
      state: 'running',
      instance_type: 't3.large',
      days_observed: '30',
    },
  },

  // RDS Databases
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'db-prod-postgres-01',
    resourceName: 'production-postgres-primary',
    resourceType: 'rds',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      engine: 'postgres',
      connections_avg: '245',
      storage_gb: '500',
      estimated_monthly_cost: '456.80',
      instance_class: 'db.r5.xlarge',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'db-prod-postgres-replica',
    resourceName: 'production-postgres-replica',
    resourceType: 'rds',
    region: 'us-west-2',
    tags: {
      environment: 'production',
      engine: 'postgres',
      connections_avg: '89',
      storage_gb: '500',
      estimated_monthly_cost: '456.80',
      instance_class: 'db.r5.xlarge',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'db-staging-mysql',
    resourceName: 'staging-mysql-database',
    resourceType: 'rds',
    region: 'us-east-1',
    tags: {
      environment: 'staging',
      engine: 'mysql',
      connections_avg: '12',
      storage_gb: '100',
      estimated_monthly_cost: '89.50',
      instance_class: 'db.t3.medium',
    },
  },

  // Lambda Functions
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'lambda-api-gateway',
    resourceName: 'api-gateway-handler',
    resourceType: 'lambda',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      invocations: '2500000',
      invocations_avg: '2400000',
      memory_mb: '512',
      memory_utilization: '65',
      estimated_monthly_cost: '145.30',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'lambda-image-processor',
    resourceName: 'image-processing-worker',
    resourceType: 'lambda',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      invocations: '580000',
      invocations_avg: '550000',
      memory_mb: '1024',
      memory_utilization: '78',
      estimated_monthly_cost: '234.60',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'lambda-email-sender',
    resourceName: 'email-notification-service',
    resourceType: 'lambda',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      invocations: '125000',
      invocations_avg: '120000',
      memory_mb: '256',
      memory_utilization: '45',
      estimated_monthly_cost: '12.50',
    },
  },
  // SPIKE (for anomaly)
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'lambda-payment-processor',
    resourceName: 'payment-processor',
    resourceType: 'lambda',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      invocations: '8900000',
      invocations_avg: '3200000',
      memory_mb: '512',
      memory_utilization: '72',
      estimated_monthly_cost: '967.80',
      error_rate: '0.8',
    },
  },
  // OVER-PROVISIONED (for optimization)
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'lambda-webhook-handler',
    resourceName: 'webhook-handler',
    resourceType: 'lambda',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      invocations: '45000',
      invocations_avg: '43000',
      memory_mb: '2048',
      memory_utilization: '28',
      estimated_monthly_cost: '78.90',
    },
  },

  // S3 Buckets
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 's3-prod-assets',
    resourceName: 'production-static-assets',
    resourceType: 's3',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      storage_gb: '2400',
      requests_per_month: '45000000',
      estimated_monthly_cost: '67.80',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 's3-backups',
    resourceName: 'database-backups',
    resourceType: 's3',
    region: 'us-west-2',
    tags: {
      environment: 'production',
      storage_gb: '8900',
      requests_per_month: '12000',
      estimated_monthly_cost: '234.50',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 's3-logs',
    resourceName: 'application-logs',
    resourceType: 's3',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      storage_gb: '1200',
      requests_per_month: '8900000',
      estimated_monthly_cost: '45.60',
    },
  },

  // EBS Volumes
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'vol-prod-web-01-root',
    resourceName: 'production-web-1-root',
    resourceType: 'ebs',
    region: 'us-east-1',
    tags: {
      attached: 'true',
      instance_id: 'i-prod-web-01',
      size_gb: '100',
      volume_type: 'gp3',
      estimated_monthly_cost: '8.00',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'vol-prod-api-01-data',
    resourceName: 'production-api-data',
    resourceType: 'ebs',
    region: 'us-west-2',
    tags: {
      attached: 'true',
      instance_id: 'i-prod-api-01',
      size_gb: '500',
      volume_type: 'gp3',
      estimated_monthly_cost: '40.00',
    },
  },
  // UNATTACHED (for optimization)
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'vol-old-backup-01',
    resourceName: 'old-backup-volume',
    resourceType: 'ebs',
    region: 'us-east-1',
    tags: {
      state: 'available',
      attached: 'false',
      size_gb: '250',
      volume_type: 'gp2',
      estimated_monthly_cost: '25.00',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'vol-test-snapshot',
    resourceName: 'testing-snapshot-volume',
    resourceType: 'ebs',
    region: 'us-east-1',
    tags: {
      state: 'available',
      attached: 'false',
      size_gb: '100',
      volume_type: 'gp2',
      estimated_monthly_cost: '10.00',
    },
  },

  // Elastic IPs
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'eipalloc-prod-web-lb',
    resourceName: 'production-load-balancer-ip',
    resourceType: 'elastic_ip',
    region: 'us-east-1',
    tags: {
      associated: 'true',
      instance_id: 'i-prod-web-01',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'eipalloc-prod-api-lb',
    resourceName: 'production-api-load-balancer',
    resourceType: 'elastic_ip',
    region: 'us-west-2',
    tags: {
      associated: 'true',
      instance_id: 'i-prod-api-01',
    },
  },
  // UNUSED (for optimization)
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'eipalloc-old-staging',
    resourceName: 'old-staging-ip',
    resourceType: 'elastic_ip',
    region: 'us-east-1',
    tags: {
      associated: 'false',
    },
  },

  // Load Balancers
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'alb-prod-web',
    resourceName: 'production-web-alb',
    resourceType: 'elb',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      type: 'application',
      active_connections: '2456',
      estimated_monthly_cost: '89.50',
    },
  },
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'alb-prod-api',
    resourceName: 'production-api-alb',
    resourceType: 'elb',
    region: 'us-west-2',
    tags: {
      environment: 'production',
      type: 'application',
      active_connections: '1234',
      estimated_monthly_cost: '89.50',
    },
  },

  // ECS Services
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'ecs-prod-containers',
    resourceName: 'production-microservices',
    resourceType: 'ecs',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      task_count: '12',
      cpu_units: '4096',
      memory_mb: '8192',
      estimated_monthly_cost: '234.80',
    },
  },

  // CloudFront
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'cf-prod-cdn',
    resourceName: 'production-cdn-distribution',
    resourceType: 'cloudfront',
    region: 'global',
    tags: {
      environment: 'production',
      requests_per_month: '125000000',
      data_transfer_gb: '4500',
      estimated_monthly_cost: '567.90',
    },
  },

  // ElastiCache
  {
    id: uuidv4(),
    organizationId: DEMO_ORG_ID,
    resourceId: 'redis-prod-cache',
    resourceName: 'production-redis-cluster',
    resourceType: 'elasticache',
    region: 'us-east-1',
    tags: {
      environment: 'production',
      engine: 'redis',
      node_type: 'cache.r5.large',
      nodes: '3',
      estimated_monthly_cost: '234.60',
    },
  },
];

export const calculateDemoTotalCost = (): number => {
  return DEMO_AWS_RESOURCES.reduce((total, resource) => {
    const cost = parseFloat(resource.tags.estimated_monthly_cost || '0');
    return total + cost;
  }, 0);
};

export const DEMO_STATS = {
  totalResources: DEMO_AWS_RESOURCES.length,
  totalMonthlyCost: calculateDemoTotalCost(),
  costChange: 14.3, // percentage
  resourcesByType: {
    ec2: DEMO_AWS_RESOURCES.filter(r => r.resourceType === 'ec2').length,
    rds: DEMO_AWS_RESOURCES.filter(r => r.resourceType === 'rds').length,
    lambda: DEMO_AWS_RESOURCES.filter(r => r.resourceType === 'lambda').length,
    s3: DEMO_AWS_RESOURCES.filter(r => r.resourceType === 's3').length,
    ebs: DEMO_AWS_RESOURCES.filter(r => r.resourceType === 'ebs').length,
    elb: DEMO_AWS_RESOURCES.filter(r => r.resourceType === 'elb').length,
  },
};
