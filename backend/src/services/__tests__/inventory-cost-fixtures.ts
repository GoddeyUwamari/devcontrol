/**
 * One legacy fixture inventory for the placeholder-costs PR 1 surface tests: every
 * flat placeholder stored the old way (a value, no basis), a VPC 0, an Aurora
 * cluster with two member rows, a stopped EC2 instance, a Lambda without usage, and
 * two rows whose basis is established (an RDS MySQL db.m5.large, a gp2 volume).
 * Fictional names only.
 */
export const PLACEHOLDER_AMOUNTS = ['9.00', '73.00', '3.00', '3.50', '25.00', '150.00', '0.40', '0.50', '5.00', '50.00', '75.00', '74.83', '8.50'];
/** The never-zero money-zero pattern (never-zero Stage A §G). */
export const MONEY_ZERO = /(?<![<\d.,])\$0(?:\.0{1,2})?(?![.\d])/;

const recent = new Date().toISOString();
export const legacyRow = (name: string, type: string, stored: string | null, extra: Record<string, unknown> = {}) => ({
  resource_name: name, resource: name, resource_id: `${type}-${name}`, resource_type: type, region: 'us-east-1', status: 'active',
  metadata: {}, stored_monthly_cost: stored, estimated_monthly_cost: stored, last_synced_at: recent,
  team: 'Unassigned', env: 'Unknown', team_name: null, service_name: null, environment: null, ...extra,
});

/** The legacy fixture inventory. */
export const LEGACY_ROWS = [
  legacyRow('ecs-svc', 'ecs', '9.00'),
  legacyRow('eks-cluster', 'eks', '73.00'),
  legacyRow('ddb-table', 'dynamodb', '3.00'),
  legacyRow('rest-api', 'api-gateway', '3.50'),
  legacyRow('cache', 'elasticache', '25.00'),
  legacyRow('aurora-cluster', 'aurora', '150.00', { status: 'available', metadata: { engine: 'aurora-mysql' } }),
  legacyRow('aurora-writer', 'rds', '75.00', { status: 'available', metadata: { engine: 'aurora-mysql', multi_az: false, db_instance_class: 'db.r6g.large' } }),
  legacyRow('aurora-reader', 'rds', '75.00', { status: 'available', metadata: { engine: 'aurora-mysql', multi_az: false, db_instance_class: 'db.r6g.large' } }),
  legacyRow('queue', 'sqs', '0.40'),
  legacyRow('topic', 'sns', '0.50'),
  legacyRow('bucket', 's3', '5.00'),
  legacyRow('ec2-unknown', 'ec2', '50.00', { status: 'running', metadata: { instance_type: 'x9.mega' } }),
  legacyRow('rds-unknown', 'rds', '75.00', { status: 'available', metadata: { engine: 'postgres', multi_az: false, db_instance_class: 'db.x9.huge' } }),
  legacyRow('alb', 'load-balancer', '74.83'),
  legacyRow('cdn', 'cloudfront', '8.50'),
  legacyRow('network', 'vpc', '0.00'),
  legacyRow('lambda-no-usage', 'lambda', null, { metadata: { usage_state: 'unavailable', architecture: 'x86_64' } }),
  legacyRow('ec2-stopped', 'ec2', '60.00', { status: 'stopped', metadata: { instance_type: 't3.large', instance_state: 'stopped' } }),
  // Stored 'stopped' but AWS reported "stopping" (fix round 1, ruling 8): No price, and inside N.
  legacyRow('ec2-stopping', 'ec2', '60.00', { status: 'stopped', metadata: { instance_type: 't3.large', instance_state: 'stopping' } }),
  // Established basis: priced.
  legacyRow('orders-db', 'rds', '124.83', { status: 'available', env: 'production', team: 'Payments', metadata: { engine: 'mysql', multi_az: false, db_instance_class: 'db.m5.large' } }),
  legacyRow('data-vol', 'ebs', '20.00', { status: 'in-use', env: 'production', team: 'Payments', metadata: { volume_type: 'gp2', size_gb: 200 } }),
];

