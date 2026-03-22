import axios from 'axios';
import type {
  ServiceHealth,
  SystemHealth,
  HealthStatus,
  OverallSystemStatus,
  GatewayHealthResponse,
  MicroserviceHealthResponse,
} from '../types';

// Service configuration
export interface ServiceConfig {
  name: string;
  url: string;
  port: number;
  healthPath: string;
  serviceKey?: string; // Key used in gateway response
}

export const SERVICES: ServiceConfig[] = [
  {
    name: 'API Gateway',
    url: 'http://localhost',
    port: 8080,
    healthPath: '/health',
  },
  {
    name: 'Auth Service',
    url: 'http://localhost',
    port: 3001,
    healthPath: '/health',
    serviceKey: 'auth-service',
  },
  {
    name: 'Billing Service',
    url: 'http://localhost',
    port: 3002,
    healthPath: '/health',
    serviceKey: 'billing-service',
  },
  {
    name: 'Payment Service',
    url: 'http://localhost',
    port: 3003,
    healthPath: '/health',
    serviceKey: 'payment-service',
  },
  {
    name: 'Notification Service',
    url: 'http://localhost',
    port: 3004,
    healthPath: '/health',
    serviceKey: 'notification-service',
  },
];

// Database services configuration
export const DATABASE_SERVICES = [
  { name: 'PostgreSQL', serviceKey: 'postgresql' },
  { name: 'Redis', serviceKey: 'redis' },
];

/**
 * Normalize status string to HealthStatus type
 */
const normalizeStatus = (status: string | undefined, responseTime?: number): HealthStatus => {
  if (!status) return 'unhealthy';

  const statusLower = status.toLowerCase();

  if (statusLower === 'healthy') {
    // Check if response time is slow
    if (responseTime && responseTime > 1000) {
      return 'degraded';
    }
    return 'healthy';
  }

  if (statusLower === 'degraded') return 'degraded';
  return 'unhealthy';
};

/**
 * Check health of a single microservice directly
 */
const getServiceHealth = async (
  service: ServiceConfig
): Promise<ServiceHealth> => {
  const startTime = Date.now();
  const fullUrl = `${service.url}:${service.port}${service.healthPath}`;

  try {
    const response = await axios.get<MicroserviceHealthResponse>(fullUrl, {
      timeout: 5000, // 5 second timeout
    });

    const responseTime = Date.now() - startTime;
    const healthData = response.data;

    // Determine status based on response time and health data
    const status = normalizeStatus(healthData.status, responseTime);

    return {
      name: service.name,
      url: fullUrl,
      port: service.port,
      status,
      responseTime,
      uptime: healthData.uptime || 0,
      lastCheck: new Date().toISOString(),
      version: healthData.version,
    };
  } catch (error) {
    return {
      name: service.name,
      url: fullUrl,
      port: service.port,
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      uptime: 0,
      lastCheck: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

/**
 * Get health of API Gateway (which includes info about all services)
 */
const getGatewayHealth = async (): Promise<GatewayHealthResponse | null> => {
  try {
    const response = await axios.get<GatewayHealthResponse>(
      'http://localhost:8080/health',
      {
        timeout: 5000,
      }
    );
    return response.data;
  } catch (error) {
    console.error('Failed to fetch gateway health:', error);
    return null;
  }
};

/**
 * Get health of all services using optimized approach
 * Uses Gateway health endpoint for quick overview, then individual endpoints for details
 */
export const getAllServicesHealth = async (): Promise<ServiceHealth[]> => {
  const allServices: ServiceHealth[] = [];

  // Get gateway health first (this includes all service statuses)
  const gatewayHealth = await getGatewayHealth();

  if (!gatewayHealth) {
    // If gateway is down, mark all services as unhealthy
    const timestamp = new Date().toISOString();

    // Add gateway as unhealthy
    allServices.push({
      name: 'API Gateway',
      url: 'http://localhost:8080/health',
      port: 8080,
      status: 'unhealthy',
      responseTime: 0,
      uptime: 0,
      lastCheck: timestamp,
      error: 'Gateway unavailable',
    });

    // Add all other services as unhealthy
    SERVICES.slice(1).forEach((service) => {
      allServices.push({
        name: service.name,
        url: `${service.url}:${service.port}${service.healthPath}`,
        port: service.port,
        status: 'unhealthy',
        responseTime: 0,
        uptime: 0,
        lastCheck: timestamp,
        error: 'Gateway unavailable',
      });
    });

    // Add database services as unhealthy
    DATABASE_SERVICES.forEach((dbService) => {
      allServices.push({
        name: dbService.name,
        url: 'http://localhost:8080/health',
        status: 'unhealthy',
        responseTime: 0,
        uptime: 0,
        lastCheck: timestamp,
        error: 'Gateway unavailable',
      });
    });

    return allServices;
  }

  // Gateway is up - add its health
  allServices.push({
    name: 'API Gateway',
    url: 'http://localhost:8080/health',
    port: 8080,
    status: normalizeStatus(gatewayHealth.status),
    responseTime: 0, // Not tracked for gateway itself
    uptime: gatewayHealth.uptime || 0,
    lastCheck: gatewayHealth.timestamp,
    version: gatewayHealth.version,
  });

  // Get health of other microservices in parallel
  const microservicePromises = SERVICES.slice(1).map(async (service) => {
    // Try to get detailed health from individual service
    const serviceHealth = await getServiceHealth(service);

    // If individual service call failed but gateway shows it as healthy,
    // use gateway's information
    if (
      serviceHealth.status === 'unhealthy' &&
      service.serviceKey &&
      gatewayHealth.services[service.serviceKey as keyof typeof gatewayHealth.services]
    ) {
      const gatewayServiceInfo = gatewayHealth.services[service.serviceKey as keyof typeof gatewayHealth.services];
      if (gatewayServiceInfo && gatewayServiceInfo.status === 'healthy') {
        return {
          ...serviceHealth,
          status: normalizeStatus(gatewayServiceInfo.status, gatewayServiceInfo.responseTime),
          responseTime: gatewayServiceInfo.responseTime,
        };
      }
    }

    return serviceHealth;
  });

  const microserviceHealths = await Promise.all(microservicePromises);
  allServices.push(...microserviceHealths);

  // Add database services from gateway response
  DATABASE_SERVICES.forEach((dbService) => {
    const dbHealth = gatewayHealth.services[dbService.serviceKey as keyof typeof gatewayHealth.services];

    if (dbHealth && typeof dbHealth === 'object' && 'status' in dbHealth) {
      allServices.push({
        name: dbService.name,
        url: 'http://localhost:8080/health',
        status: normalizeStatus(dbHealth.status, dbHealth.responseTime),
        responseTime: dbHealth.responseTime || 0,
        uptime: 0, // Not available for DB services
        lastCheck: gatewayHealth.timestamp,
      });
    } else {
      // Database not in gateway response - mark as unhealthy
      allServices.push({
        name: dbService.name,
        url: 'http://localhost:8080/health',
        status: 'unhealthy',
        responseTime: 0,
        uptime: 0,
        lastCheck: gatewayHealth.timestamp,
        error: 'Not reported by gateway',
      });
    }
  });

  return allServices;
};

/**
 * Calculate overall system status based on service health
 */
const calculateSystemStatus = (
  servicesUp: number,
  totalServices: number
): OverallSystemStatus => {
  const percentage = (servicesUp / totalServices) * 100;

  if (percentage === 100) return 'operational';
  if (percentage >= 70) return 'degraded';
  return 'disrupted';
};

/**
 * Get overall system health including all services
 */
export const getSystemHealth = async (): Promise<SystemHealth> => {
  const services = await getAllServicesHealth();

  const servicesUp = services.filter(
    (service) => service.status === 'healthy'
  ).length;
  const totalServices = services.length;
  const healthPercentage = Math.round((servicesUp / totalServices) * 100);
  const status = calculateSystemStatus(servicesUp, totalServices);

  return {
    status,
    servicesUp,
    totalServices,
    healthPercentage,
    services,
    lastUpdate: new Date().toISOString(),
  };
};

export const monitoringService = {
  getServiceHealth,
  getAllServicesHealth,
  getSystemHealth,
};
