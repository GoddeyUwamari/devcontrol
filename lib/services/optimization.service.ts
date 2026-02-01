/**
 * Optimization Service (Frontend)
 * Client for cost optimization API
 */

import { OptimizationRecommendation, OptimizationSummary } from '@/types/optimization.types';

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
