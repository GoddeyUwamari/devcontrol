import axios from 'axios';
import type { ServiceHealth, SystemHealth, OverallSystemStatus } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface BackendHealthResponse {
  status: 'ok' | 'error';
  timestamp?: string;
  database?: 'connected' | 'disconnected';
  environment?: string;
}

/**
 * Get overall system health by checking the real backend's /health endpoint
 * (single monolithic EC2 backend — see backend/src/server.ts).
 */
export const getSystemHealth = async (): Promise<SystemHealth> => {
  const startTime = Date.now();
  const lastUpdate = new Date().toISOString();
  const healthUrl = `${API_BASE_URL}/health`;

  try {
    const response = await axios.get<BackendHealthResponse>(healthUrl, {
      timeout: 5000,
    });

    const responseTime = Date.now() - startTime;
    const isOk = response.data.status === 'ok';
    const status: OverallSystemStatus = isOk ? 'operational' : 'disrupted';

    const backendService: ServiceHealth = {
      name: 'Backend API',
      url: healthUrl,
      status: isOk ? 'healthy' : 'unhealthy',
      responseTime,
      uptime: 0,
      lastCheck: lastUpdate,
      error: isOk ? undefined : `Database ${response.data.database ?? 'disconnected'}`,
    };

    return {
      status,
      servicesUp: isOk ? 1 : 0,
      totalServices: 1,
      healthPercentage: isOk ? 100 : 0,
      services: [backendService],
      lastUpdate,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      status: 'disrupted',
      servicesUp: 0,
      totalServices: 1,
      healthPercentage: 0,
      services: [
        {
          name: 'Backend API',
          url: healthUrl,
          status: 'unhealthy',
          responseTime,
          uptime: 0,
          lastCheck: lastUpdate,
          error: error instanceof Error ? error.message : 'Unable to reach backend',
        },
      ],
      lastUpdate,
    };
  }
};

export const monitoringService = {
  getSystemHealth,
};
