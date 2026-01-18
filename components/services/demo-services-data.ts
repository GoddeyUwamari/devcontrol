import { Server, Globe, Database, Cloud, Layers } from 'lucide-react';
import type { ServiceHealth } from '@/components/dashboard/service-health-grid';
import type { ServiceDetail } from './service-detail-slide-over';

// Extended service type that combines both interfaces
export interface ExtendedService extends ServiceHealth {
  description?: string;
  techStack: string;
  team: string;
  teamMembers?: { name: string; role: string }[];
  monthlyCoste?: number;
  activeAlerts?: number;
  recentDeployments?: {
    id: string;
    version: string;
    status: 'success' | 'failed' | 'in_progress';
    deployedAt: Date;
    deployedBy: string;
  }[];
  repositoryUrl?: string;
}

// Convert ExtendedService to ServiceDetail for slide-over
export function toServiceDetail(service: ExtendedService): ServiceDetail {
  return {
    id: service.id,
    name: service.name,
    status: service.status,
    description: service.description,
    techStack: service.techStack,
    environment: service.environment || 'production',
    version: service.version,
    team: service.team,
    teamMembers: service.teamMembers,
    uptime: service.uptime,
    responseTime: service.responseTime,
    errorRate: service.errorRate,
    monthlyCoste: service.monthlyCoste,
    activeAlerts: service.activeAlerts,
    recentDeployments: service.recentDeployments,
    repositoryUrl: service.repositoryUrl,
    lastDeployment: service.lastDeployment,
  };
}

// Comprehensive demo services generator (12 services with varied states)
export function generateExtendedDemoServices(): ExtendedService[] {
  const now = new Date();

  return [
    {
      id: 'svc-001',
      name: 'payment-api',
      icon: Server,
      status: 'healthy',
      description: 'Core payment processing service handling all transactions',
      techStack: 'Node.js',
      environment: 'production',
      version: '2.4.1',
      team: 'Backend',
      teamMembers: [
        { name: 'Sarah Chen', role: 'Lead Engineer' },
        { name: 'Mike Torres', role: 'SRE' },
      ],
      uptime: 99.99,
      responseTime: 45,
      errorRate: 0.12,
      monthlyCoste: 780,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd1', version: '2.4.1', status: 'success', deployedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), deployedBy: 'Sarah Chen' },
        { id: 'd2', version: '2.4.0', status: 'success', deployedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), deployedBy: 'Mike Torres' },
        { id: 'd3', version: '2.3.9', status: 'success', deployedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), deployedBy: 'Sarah Chen' },
      ],
      repositoryUrl: 'https://github.com/acme/payment-api',
    },
    {
      id: 'svc-002',
      name: 'user-service',
      icon: Server,
      status: 'healthy',
      description: 'User authentication and profile management',
      techStack: 'Go',
      environment: 'production',
      version: '3.1.0',
      team: 'Platform',
      teamMembers: [
        { name: 'Alex Kim', role: 'Staff Engineer' },
        { name: 'Jordan Lee', role: 'Backend Dev' },
      ],
      uptime: 99.95,
      responseTime: 28,
      errorRate: 0.08,
      monthlyCoste: 450,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd4', version: '3.1.0', status: 'success', deployedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), deployedBy: 'Alex Kim' },
        { id: 'd5', version: '3.0.9', status: 'success', deployedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), deployedBy: 'Jordan Lee' },
      ],
      repositoryUrl: 'https://github.com/acme/user-service',
    },
    {
      id: 'svc-003',
      name: 'web-dashboard',
      icon: Globe,
      status: 'healthy',
      description: 'Customer-facing dashboard application',
      techStack: 'Next.js',
      environment: 'production',
      version: '4.2.3',
      team: 'Frontend',
      teamMembers: [
        { name: 'Emma Wilson', role: 'Frontend Lead' },
        { name: 'Chris Park', role: 'UI Engineer' },
      ],
      uptime: 99.98,
      responseTime: 120,
      errorRate: 0.15,
      monthlyCoste: 320,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 6 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd6', version: '4.2.3', status: 'success', deployedAt: new Date(now.getTime() - 6 * 60 * 60 * 1000), deployedBy: 'Emma Wilson' },
        { id: 'd7', version: '4.2.2', status: 'success', deployedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000), deployedBy: 'Chris Park' },
      ],
      repositoryUrl: 'https://github.com/acme/web-dashboard',
    },
    {
      id: 'svc-004',
      name: 'postgres-primary',
      icon: Database,
      status: 'warning',
      description: 'Primary PostgreSQL database cluster',
      techStack: 'PostgreSQL',
      environment: 'production',
      version: '15.2',
      team: 'Data',
      teamMembers: [
        { name: 'David Zhang', role: 'DBA' },
        { name: 'Lisa Martinez', role: 'Data Engineer' },
      ],
      uptime: 99.5,
      responseTime: 85,
      errorRate: 1.8,
      monthlyCoste: 650,
      activeAlerts: 2,
      lastDeployment: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd8', version: '15.2', status: 'success', deployedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), deployedBy: 'David Zhang' },
      ],
      repositoryUrl: 'https://github.com/acme/db-configs',
    },
    {
      id: 'svc-005',
      name: 'notification-service',
      icon: Server,
      status: 'healthy',
      description: 'Email, SMS, and push notification delivery',
      techStack: 'Python',
      environment: 'production',
      version: '1.8.4',
      team: 'Backend',
      teamMembers: [
        { name: 'Rachel Green', role: 'Senior Engineer' },
      ],
      uptime: 99.9,
      responseTime: 65,
      errorRate: 0.3,
      monthlyCoste: 280,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd9', version: '1.8.4', status: 'success', deployedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), deployedBy: 'Rachel Green' },
        { id: 'd10', version: '1.8.3', status: 'failed', deployedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000), deployedBy: 'Rachel Green' },
      ],
      repositoryUrl: 'https://github.com/acme/notification-service',
    },
    {
      id: 'svc-006',
      name: 'analytics-engine',
      icon: Cloud,
      status: 'healthy',
      description: 'Real-time analytics and reporting engine',
      techStack: 'Python',
      environment: 'production',
      version: '2.1.0',
      team: 'Data',
      teamMembers: [
        { name: 'James Wu', role: 'ML Engineer' },
        { name: 'Nina Patel', role: 'Data Scientist' },
      ],
      uptime: 99.85,
      responseTime: 180,
      errorRate: 0.45,
      monthlyCoste: 520,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd11', version: '2.1.0', status: 'success', deployedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), deployedBy: 'James Wu' },
      ],
      repositoryUrl: 'https://github.com/acme/analytics-engine',
    },
    {
      id: 'svc-007',
      name: 'order-processor',
      icon: Server,
      status: 'critical',
      description: 'Order fulfillment and processing pipeline',
      techStack: 'Node.js',
      environment: 'production',
      version: '3.0.2',
      team: 'Backend',
      teamMembers: [
        { name: 'Tom Brown', role: 'Senior Engineer' },
        { name: 'Amy Liu', role: 'Backend Dev' },
      ],
      uptime: 95.2,
      responseTime: 450,
      errorRate: 4.8,
      monthlyCoste: 380,
      activeAlerts: 5,
      lastDeployment: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd12', version: '3.0.2', status: 'in_progress', deployedAt: new Date(now.getTime() - 15 * 60 * 1000), deployedBy: 'Tom Brown' },
        { id: 'd13', version: '3.0.1', status: 'failed', deployedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), deployedBy: 'Tom Brown' },
        { id: 'd14', version: '3.0.0', status: 'success', deployedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), deployedBy: 'Amy Liu' },
      ],
      repositoryUrl: 'https://github.com/acme/order-processor',
    },
    {
      id: 'svc-008',
      name: 'inventory-api',
      icon: Server,
      status: 'healthy',
      description: 'Inventory management and stock tracking',
      techStack: 'Go',
      environment: 'production',
      version: '1.5.2',
      team: 'Backend',
      teamMembers: [
        { name: 'Kevin Nguyen', role: 'Engineer' },
      ],
      uptime: 99.92,
      responseTime: 35,
      errorRate: 0.1,
      monthlyCoste: 220,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd15', version: '1.5.2', status: 'success', deployedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), deployedBy: 'Kevin Nguyen' },
      ],
      repositoryUrl: 'https://github.com/acme/inventory-api',
    },
    {
      id: 'svc-009',
      name: 'redis-cache',
      icon: Database,
      status: 'warning',
      description: 'Distributed caching layer',
      techStack: 'Redis',
      environment: 'production',
      version: '7.0.5',
      team: 'Platform',
      teamMembers: [
        { name: 'Alex Kim', role: 'Staff Engineer' },
      ],
      uptime: 99.7,
      responseTime: 12,
      errorRate: 1.2,
      monthlyCoste: 180,
      activeAlerts: 1,
      lastDeployment: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd16', version: '7.0.5', status: 'success', deployedAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), deployedBy: 'Alex Kim' },
      ],
      repositoryUrl: 'https://github.com/acme/redis-config',
    },
    {
      id: 'svc-010',
      name: 'mobile-bff',
      icon: Globe,
      status: 'healthy',
      description: 'Backend for Frontend - Mobile apps',
      techStack: 'Node.js',
      environment: 'production',
      version: '2.0.8',
      team: 'Frontend',
      teamMembers: [
        { name: 'Chris Park', role: 'UI Engineer' },
        { name: 'Sam Taylor', role: 'Mobile Dev' },
      ],
      uptime: 99.88,
      responseTime: 95,
      errorRate: 0.25,
      monthlyCoste: 290,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd17', version: '2.0.8', status: 'success', deployedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), deployedBy: 'Sam Taylor' },
      ],
      repositoryUrl: 'https://github.com/acme/mobile-bff',
    },
    {
      id: 'svc-011',
      name: 'ml-inference',
      icon: Cloud,
      status: 'healthy',
      description: 'Machine learning model inference service',
      techStack: 'Python',
      environment: 'production',
      version: '1.2.0',
      team: 'ML',
      teamMembers: [
        { name: 'Nina Patel', role: 'Data Scientist' },
        { name: 'James Wu', role: 'ML Engineer' },
      ],
      uptime: 99.75,
      responseTime: 250,
      errorRate: 0.5,
      monthlyCoste: 820,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd18', version: '1.2.0', status: 'success', deployedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), deployedBy: 'Nina Patel' },
      ],
      repositoryUrl: 'https://github.com/acme/ml-inference',
    },
    {
      id: 'svc-012',
      name: 'search-service',
      icon: Server,
      status: 'healthy',
      description: 'Elasticsearch-powered search functionality',
      techStack: 'Go',
      environment: 'staging',
      version: '0.9.5',
      team: 'Backend',
      teamMembers: [
        { name: 'Jordan Lee', role: 'Backend Dev' },
      ],
      uptime: 99.6,
      responseTime: 55,
      errorRate: 0.2,
      monthlyCoste: 150,
      activeAlerts: 0,
      lastDeployment: new Date(now.getTime() - 4 * 60 * 60 * 1000),
      recentDeployments: [
        { id: 'd19', version: '0.9.5', status: 'success', deployedAt: new Date(now.getTime() - 4 * 60 * 60 * 1000), deployedBy: 'Jordan Lee' },
        { id: 'd20', version: '0.9.4', status: 'success', deployedAt: new Date(now.getTime() - 8 * 60 * 60 * 1000), deployedBy: 'Jordan Lee' },
      ],
      repositoryUrl: 'https://github.com/acme/search-service',
    },
  ];
}

// Calculate aggregate metrics from services
export function calculateServiceMetrics(services: ExtendedService[]) {
  const totalServices = services.length;
  const healthyServices = services.filter(s => s.status === 'healthy').length;
  const warningServices = services.filter(s => s.status === 'warning').length;
  const criticalServices = services.filter(s => s.status === 'critical').length;

  const totalCost = services.reduce((sum, s) => sum + (s.monthlyCoste || 0), 0);
  const totalAlerts = services.reduce((sum, s) => sum + (s.activeAlerts || 0), 0);

  // Count deployments this week
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const deploymentsThisWeek = services.reduce((sum, s) => {
    const recentDeps = s.recentDeployments?.filter(d => d.deployedAt > oneWeekAgo) || [];
    return sum + recentDeps.length;
  }, 0);

  return {
    totalServices,
    healthyServices,
    warningServices,
    criticalServices,
    totalCost,
    totalAlerts,
    deploymentsThisWeek,
    healthyPercentage: totalServices > 0 ? Math.round((healthyServices / totalServices) * 100) : 0,
  };
}
