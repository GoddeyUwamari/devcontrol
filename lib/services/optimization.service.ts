/**
 * Optimization Service (Frontend)
 * Client for cost optimization API
 */

import { OptimizationRecommendation, OptimizationSummary } from '@/types/optimization.types';
import { demoModeService } from './demo-mode.service';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

class OptimizationService {
  private getAuthToken(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('accessToken') || '';
  }

  private getHeaders(): HeadersInit {
    const token = this.getAuthToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  /**
   * Trigger optimization scan
   */
  async scan(): Promise<{
    recommendations: OptimizationRecommendation[];
    summary: OptimizationSummary;
  }> {
    const response = await fetch(`${API_BASE_URL}/api/optimizations/scan`, {
      method: 'POST',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to scan' }));
      throw new Error(error.error || 'Failed to scan optimizations');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get all recommendations
   */
  async getRecommendations(status?: string): Promise<{
    recommendations: OptimizationRecommendation[];
    summary: OptimizationSummary;
  }> {
    // Return demo data if demo mode is enabled
    if (demoModeService.isEnabled()) {
      const recommendations = demoModeService.getDemoOptimizations() as OptimizationRecommendation[];
      const filteredRecs = status
        ? recommendations.filter(r => r.status === status)
        : recommendations;

      const getTypeStats = (type: string) => {
        const recs = filteredRecs.filter(r => r.type === type);
        return {
          count: recs.length,
          savings: recs.reduce((sum, r) => sum + r.monthlySavings, 0),
        };
      };

      const summary: OptimizationSummary = {
        totalRecommendations: filteredRecs.length,
        totalMonthlySavings: filteredRecs.reduce((sum, r) => sum + r.monthlySavings, 0),
        totalAnnualSavings: filteredRecs.reduce((sum, r) => sum + r.annualSavings, 0),
        byType: {
          idle_resource: getTypeStats('idle_resource'),
          oversized_instance: getTypeStats('oversized_instance'),
          unattached_volume: getTypeStats('unattached_volume'),
          unused_elastic_ip: getTypeStats('unused_elastic_ip'),
          lambda_memory: getTypeStats('lambda_memory'),
          old_snapshot: getTypeStats('old_snapshot'),
          reserved_instance: getTypeStats('reserved_instance'),
          idle_load_balancer: getTypeStats('idle_load_balancer'),
        },
        byRisk: {
          safe: filteredRecs.filter(r => r.risk === 'safe').length,
          caution: filteredRecs.filter(r => r.risk === 'caution').length,
          risky: filteredRecs.filter(r => r.risk === 'risky').length,
        },
        byStatus: {
          pending: filteredRecs.filter(r => r.status === 'pending').length,
          approved: filteredRecs.filter(r => r.status === 'approved').length,
          applied: filteredRecs.filter(r => r.status === 'applied').length,
          dismissed: filteredRecs.filter(r => r.status === 'dismissed').length,
        },
      };

      return { recommendations: filteredRecs, summary };
    }

    const url = status
      ? `${API_BASE_URL}/api/optimizations?status=${status}`
      : `${API_BASE_URL}/api/optimizations`;

    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch' }));
      throw new Error(error.error || 'Failed to fetch recommendations');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get summary
   */
  async getSummary(): Promise<OptimizationSummary> {
    const response = await fetch(`${API_BASE_URL}/api/optimizations/summary`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch' }));
      throw new Error(error.error || 'Failed to fetch summary');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Update recommendation status
   */
  async updateStatus(id: string, status: 'approved' | 'applied' | 'dismissed'): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/optimizations/${id}/status`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update' }));
      throw new Error(error.error || 'Failed to update status');
    }
  }

  /**
   * Cleanup old dismissed recommendations
   */
  async cleanup(daysOld: number = 90): Promise<number> {
    const response = await fetch(`${API_BASE_URL}/api/optimizations/cleanup?daysOld=${daysOld}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to cleanup' }));
      throw new Error(error.error || 'Failed to cleanup');
    }

    const result = await response.json();
    return result.data.count;
  }
}

export const optimizationService = new OptimizationService();
