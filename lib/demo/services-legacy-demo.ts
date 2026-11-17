/**
 * The legacy Services page's demo rows (NEXT_PUBLIC_SERVICES_V2 off, demo or
 * sales-demo mode), moved here unchanged from app/(app)/services/page.tsx so
 * the Services route folder holds no AWS region literal (PR 3b static check).
 * Placeholder data only; nothing here is requested from an API.
 */
import type { AWSService, AWSServicesStats } from '@/lib/services/aws-services.service'

const _now = Date.now()

export const DEMO_SERVICES: AWSService[] = [
  { id: '1', name: 'api-gateway',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',    uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 45).toISOString(),         owner: 'sarah.chen',   team: 'Platform Team',  monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '2', name: 'auth-service',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',    uptime: 99.7, lastDeployed: new Date(_now - 1000 * 60 * 120).toISOString(),        owner: 'mike.johnson', team: 'Auth Team',      monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '3', name: 'payment-processor',    environment: 'staging',    region: 'us-west-2', status: 'warning', type: 'lambda', uptime: 98.2, lastDeployed: new Date(_now - 1000 * 60 * 5).toISOString(),           owner: 'alex.wong',    team: 'Payments Team',  monthly_cost: null, metadata: {}, priority_severity: 'high',   needs_attention: true,  reason: 'Lambda invocation spike detected (+178%) · retry loop suspected' } as any,
  { id: '4', name: 'notification-service', environment: 'production', region: 'us-east-1', status: 'healthy', type: 'lambda', uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 60 * 6).toISOString(),      owner: 'emma.davis',   team: 'Platform Team',  monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '5', name: 'analytics-worker',     environment: 'production', region: 'eu-west-1', status: 'healthy', type: 'ec2',    uptime: 99.5, lastDeployed: new Date(_now - 1000 * 60 * 60 * 24).toISOString(),     owner: 'david.kim',    team: 'Data Team',      monthly_cost: 623.4, metadata: {}, priority_severity: 'medium', needs_attention: true,  reason: 'Cost inefficiency detected — over-provisioned' } as any,
]

export const DEMO_STATS: AWSServicesStats = { total: 5, healthy: 3, needs_attention: 2, avg_uptime: 99.4, aws_accounts_connected: 1 }
