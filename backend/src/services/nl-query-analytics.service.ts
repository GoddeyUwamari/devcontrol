/**
 * NL Query Analytics Service
 * Tracks query patterns, success rates, and usage statistics
 */

import { Pool } from 'pg';

export interface QueryAnalytics {
  id: string;
  organizationId: string;
  query: string;
  target: string;
  action: string;
  filterCount: number;
  confidence: string;
  wasCached: boolean;
  responseTime: number;
  createdAt: Date;
}

export class NLQueryAnalyticsService {
  constructor(private pool: Pool) {}

  /**
   * Log a query for analytics
   */
  async logQuery(data: {
    organizationId: string;
    query: string;
    target: string;
    action: string;
    filterCount: number;
    confidence: string;
    wasCached: boolean;
    responseTime: number;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO nl_query_analytics
         (organization_id, query, target, action, filter_count, confidence, was_cached, response_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          data.organizationId,
          data.query,
          data.target,
          data.action,
          data.filterCount,
          data.confidence,
          data.wasCached,
          data.responseTime,
        ]
      );

      console.log(`[NL Analytics] Logged query: "${data.query}" -> ${data.target} (${data.responseTime}ms)`);
    } catch (error: any) {
      // Don't fail the request if analytics logging fails
      console.error('[NL Analytics] Failed to log query:', error.message);
    }
  }

  /**
   * Get query statistics
   */
  async getStats(organizationId: string, days: number = 30): Promise<{
    totalQueries: number;
    cacheHitRate: number;
    avgResponseTime: number;
    topTargets: Array<{ target: string; count: number }>;
    confidenceDistribution: { high: number; medium: number; low: number };
    topQueries: Array<{ query: string; count: number }>;
  }> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Total queries
      const totalResult = await this.pool.query(
        `SELECT COUNT(*) as total FROM nl_query_analytics
         WHERE organization_id = $1 AND created_at >= $2`,
        [organizationId, startDate]
      );

      const totalQueries = parseInt(totalResult.rows[0]?.total || '0');

      if (totalQueries === 0) {
        return {
          totalQueries: 0,
          cacheHitRate: 0,
          avgResponseTime: 0,
          topTargets: [],
          confidenceDistribution: { high: 0, medium: 0, low: 0 },
          topQueries: [],
        };
      }

      // Cache hit rate
      const cacheResult = await this.pool.query(
        `SELECT COUNT(*) as cached FROM nl_query_analytics
         WHERE organization_id = $1 AND created_at >= $2 AND was_cached = true`,
        [organizationId, startDate]
      );

      const cachedQueries = parseInt(cacheResult.rows[0]?.cached || '0');
      const cacheHitRate = (cachedQueries / totalQueries) * 100;

      // Avg response time
      const timeResult = await this.pool.query(
        `SELECT AVG(response_time) as avg_time FROM nl_query_analytics
         WHERE organization_id = $1 AND created_at >= $2`,
        [organizationId, startDate]
      );

      const avgResponseTime = parseFloat(timeResult.rows[0]?.avg_time || '0');

      // Top targets
      const targetsResult = await this.pool.query(
        `SELECT target, COUNT(*) as count FROM nl_query_analytics
         WHERE organization_id = $1 AND created_at >= $2
         GROUP BY target
         ORDER BY count DESC
         LIMIT 5`,
        [organizationId, startDate]
      );

      const topTargets = targetsResult.rows.map((row) => ({
        target: row.target,
        count: parseInt(row.count),
      }));

      // Confidence distribution
      const confResult = await this.pool.query(
        `SELECT confidence, COUNT(*) as count FROM nl_query_analytics
         WHERE organization_id = $1 AND created_at >= $2
         GROUP BY confidence`,
        [organizationId, startDate]
      );

      const confidenceDistribution = {
        high: 0,
        medium: 0,
        low: 0,
      };

      confResult.rows.forEach((row) => {
        const conf = row.confidence as 'high' | 'medium' | 'low';
        confidenceDistribution[conf] = parseInt(row.count);
      });

      // Top queries
      const queriesResult = await this.pool.query(
        `SELECT query, COUNT(*) as count FROM nl_query_analytics
         WHERE organization_id = $1 AND created_at >= $2
         GROUP BY query
         ORDER BY count DESC
         LIMIT 10`,
        [organizationId, startDate]
      );

      const topQueries = queriesResult.rows.map((row) => ({
        query: row.query,
        count: parseInt(row.count),
      }));

      return {
        totalQueries,
        cacheHitRate: Math.round(cacheHitRate * 10) / 10,
        avgResponseTime: Math.round(avgResponseTime),
        topTargets,
        confidenceDistribution,
        topQueries,
      };
    } catch (error: any) {
      console.error('[NL Analytics] Failed to get stats:', error.message);
      return {
        totalQueries: 0,
        cacheHitRate: 0,
        avgResponseTime: 0,
        topTargets: [],
        confidenceDistribution: { high: 0, medium: 0, low: 0 },
        topQueries: [],
      };
    }
  }

  /**
   * Create analytics table if it doesn't exist
   */
  async initializeTable(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS nl_query_analytics (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL,
          query TEXT NOT NULL,
          target VARCHAR(50) NOT NULL,
          action VARCHAR(50) NOT NULL,
          filter_count INTEGER DEFAULT 0,
          confidence VARCHAR(20) NOT NULL,
          was_cached BOOLEAN DEFAULT false,
          response_time INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_nl_analytics_org_created
        ON nl_query_analytics(organization_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_nl_analytics_query
        ON nl_query_analytics(query);
      `);

      console.log('[NL Analytics] Table initialized successfully');
    } catch (error: any) {
      console.error('[NL Analytics] Failed to initialize table:', error.message);
    }
  }
}
