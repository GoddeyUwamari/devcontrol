import { AnomalyDetection, AnomalyStats } from '@/types/anomaly.types';
import { demoModeService } from './demo-mode.service';

class AnomalyService {
  private baseUrl = process.env.NEXT_PUBLIC_API_URL
    ? `${process.env.NEXT_PUBLIC_API_URL}/api/anomalies`
    : 'http://localhost:8080/api/anomalies';

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * Get active anomalies
   */
  async getAnomalies(status?: 'active' | 'all'): Promise<{
    anomalies: AnomalyDetection[];
    stats: AnomalyStats;
  }> {
    // Return demo data if demo mode is enabled
    if (demoModeService.isEnabled()) {
      const anomalies = demoModeService.getDemoAnomalies() as AnomalyDetection[];
      const filteredAnomalies = status === 'all'
        ? anomalies
        : anomalies.filter(a => a.status === 'active');

      const stats: AnomalyStats = {
        total: filteredAnomalies.length,
        active: filteredAnomalies.filter(a => a.status === 'active').length,
        bySeverity: {
          info: filteredAnomalies.filter(a => a.severity === 'info').length,
          warning: filteredAnomalies.filter(a => a.severity === 'warning').length,
          critical: filteredAnomalies.filter(a => a.severity === 'critical').length,
        },
        byType: {
          cpu_spike: filteredAnomalies.filter(a => a.type === 'cpu_spike').length,
          invocation_spike: filteredAnomalies.filter(a => a.type === 'invocation_spike').length,
          cost_spike: filteredAnomalies.filter(a => a.type === 'cost_spike').length,
          cost_drop: filteredAnomalies.filter(a => a.type === 'cost_drop').length,
          memory_spike: filteredAnomalies.filter(a => a.type === 'memory_spike').length,
          error_rate_spike: filteredAnomalies.filter(a => a.type === 'error_rate_spike').length,
          traffic_drop: filteredAnomalies.filter(a => a.type === 'traffic_drop').length,
          deployment_impact: filteredAnomalies.filter(a => a.type === 'deployment_impact').length,
        },
        mttr: 2.5,
        falsePositiveRate: 0.05,
      };

      return { anomalies: filteredAnomalies, stats };
    }

    const url = status === 'all'
      ? `${this.baseUrl}?status=all`
      : this.baseUrl;

    const response = await fetch(url, {
      credentials: 'include',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const err = new Error('Failed to fetch anomalies');
      (err as any).status = response.status;
      throw err;
    }

    return response.json();
  }

  /**
   * Trigger manual scan
   */
  async triggerScan(): Promise<{
    success: boolean;
    anomalies: AnomalyDetection[];
    count: number;
    message: string;
  }> {
    const response = await fetch(`${this.baseUrl}/scan`, {
      method: 'POST',
      credentials: 'include',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to trigger scan');
    }

    return response.json();
  }

  /**
   * Acknowledge anomaly
   */
  async acknowledge(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}/acknowledge`, {
      method: 'PATCH',
      credentials: 'include',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to acknowledge anomaly');
    }
  }

  /**
   * Resolve anomaly
   */
  async resolve(id: string, notes?: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}/resolve`, {
      method: 'PATCH',
      credentials: 'include',
      headers: this.getHeaders(),
      body: JSON.stringify({ notes }),
    });

    if (!response.ok) {
      throw new Error('Failed to resolve anomaly');
    }
  }

  /**
   * Mark as false positive
   */
  async markFalsePositive(id: string, notes?: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}/false-positive`, {
      method: 'PATCH',
      credentials: 'include',
      headers: this.getHeaders(),
      body: JSON.stringify({ notes }),
    });

    if (!response.ok) {
      throw new Error('Failed to mark as false positive');
    }
  }

  /**
   * Get timestamp of most recent scan for this org
   */
  async getLastScan(): Promise<Date | null> {
    if (demoModeService.isEnabled()) {
      return new Date(Date.now() - 1000 * 60 * 8); // 8 minutes ago in demo
    }

    try {
      const response = await fetch(`${this.baseUrl}/last-scan`, {
        credentials: 'include',
        headers: this.getHeaders(),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.lastScan ? new Date(data.lastScan) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get stats
   */
  async getStats(): Promise<AnomalyStats> {
    const response = await fetch(`${this.baseUrl}/stats`, {
      credentials: 'include',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch stats');
    }

    const data = await response.json();
    return data.stats;
  }
}

export const anomalyService = new AnomalyService();
