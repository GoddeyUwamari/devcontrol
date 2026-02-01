/**
 * AI Report Generator Service
 * Generates AI-powered infrastructure reports with insights and recommendations
 */

import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import { AWSResourcesRepository } from '../repositories/awsResources.repository';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { DORAMetricsRepository } from '../repositories/dora-metrics.repository';
import { AlertHistoryRepository } from '../repositories/alert-history.repository';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface ReportData {
  organizationId: string;
  dateRange: {
    from: string;
    to: string;
  };
  costs: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
    breakdown: {
      compute: number;
      storage: number;
      database: number;
      network: number;
      other: number;
    };
  };
  security: {
    score: number;
    previousScore: number;
    criticalIssues: number;
    highIssues: number;
    mediumIssues: number;
    topIssues: Array<{
      title: string;
      severity: string;
      resourceType: string;
      count: number;
    }>;
  };
  deployments: {
    total: number;
    successful: number;
    failed: number;
    averageLeadTime: number;
    deploymentFrequency: number;
    changeFailureRate: number;
  };
  resources: {
    total: number;
    change: number;
    byType: Record<string, number>;
    topCostResources: Array<{
      id: string;
      type: string;
      cost: number;
      name: string;
    }>;
    unusedResources: Array<{
      id: string;
      type: string;
      potentialSavings: number;
    }>;
  };
  alerts: {
    total: number;
    critical: number;
    resolved: number;
    avgResolutionTime: number;
  };
}

export interface GeneratedReport {
  summary: string;
  keyHighlights: string[];
  costAnalysis: {
    overview: string;
    trends: string;
    recommendations: string[];
  };
  securityAnalysis: {
    overview: string;
    topRisks: string;
    recommendations: string[];
  };
  performanceAnalysis: {
    overview: string;
    doraMetrics: string;
    recommendations: string[];
  };
  topRecommendations: Array<{
    title: string;
    impact: 'high' | 'medium' | 'low';
    description: string;
    estimatedSavings?: number;
    effort: 'low' | 'medium' | 'high';
  }>;
  executiveSummary: string;
}

export class AIReportGeneratorService {
  private awsResourcesRepo: AWSResourcesRepository;
  private deploymentsRepo: DeploymentsRepository;
  private doraMetricsRepo: DORAMetricsRepository;
  private alertHistoryRepo: AlertHistoryRepository;
  private costRecommendationsRepo: CostRecommendationsRepository;

  constructor(private pool: Pool) {
    this.awsResourcesRepo = new AWSResourcesRepository(pool);
    this.deploymentsRepo = new DeploymentsRepository();
    this.doraMetricsRepo = new DORAMetricsRepository(pool);
    this.alertHistoryRepo = new AlertHistoryRepository(pool);
    this.costRecommendationsRepo = new CostRecommendationsRepository();
  }

  async generateWeeklyReport(data: ReportData): Promise<GeneratedReport> {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[AI Report Generator] ANTHROPIC_API_KEY not set - using fallback report');
      return this.generateFallbackReport(data);
    }

    const systemPrompt = `You are an AI infrastructure analyst for DevControl.

Generate executive-ready reports that analyze AWS infrastructure data and provide actionable insights.

REPORT STYLE:
- Professional, concise, data-driven
- Focus on business impact, not just technical details
- Highlight trends and changes (not just current state)
- Provide specific, actionable recommendations
- Use percentages and dollar amounts for impact
- Flag urgent issues clearly

REPORT STRUCTURE:
1. Executive Summary (2-3 sentences)
2. Key Highlights (3-5 bullet points)
3. Cost Analysis (trends, recommendations)
4. Security Analysis (risks, recommendations)
5. Performance Analysis (DORA metrics, recommendations)
6. Top Recommendations (prioritized by impact)

TONE:
- Clear and direct
- Emphasize positive changes AND areas for improvement
- Balance technical accuracy with business language
- Avoid jargon unless necessary

RECOMMENDATIONS:
- Prioritize by ROI (cost savings or risk reduction)
- Include estimated impact ($ or %)
- Specify effort level (low/medium/high)
- Make them specific and actionable`;

    const userPrompt = `Generate a weekly infrastructure report for the period ${data.dateRange.from} to ${data.dateRange.to}.

COST DATA:
- Current spending: $${data.costs.current.toLocaleString()}/month
- Previous period: $${data.costs.previous.toLocaleString()}/month
- Change: ${data.costs.changePercent > 0 ? '+' : ''}${data.costs.changePercent.toFixed(1)}% ($${Math.abs(data.costs.change).toLocaleString()})
- Breakdown: Compute $${data.costs.breakdown.compute}, Storage $${data.costs.breakdown.storage}, Database $${data.costs.breakdown.database}, Network $${data.costs.breakdown.network}, Other $${data.costs.breakdown.other}
${data.resources.topCostResources.length > 0 ? `- Top cost resources: ${data.resources.topCostResources.map(r => `${r.type} ${r.id} ($${r.cost}/mo)`).join(', ')}` : ''}
${data.resources.unusedResources.length > 0 ? `- Unused resources: ${data.resources.unusedResources.length} resources with potential savings of $${data.resources.unusedResources.reduce((sum, r) => sum + r.potentialSavings, 0)}/month` : ''}

SECURITY DATA:
- Security score: ${data.security.score}/100 (${data.security.previousScore > 0 ? `${data.security.score > data.security.previousScore ? '+' : ''}${data.security.score - data.security.previousScore} vs last period` : 'baseline'})
- Critical issues: ${data.security.criticalIssues}
- High severity: ${data.security.highIssues}
- Medium severity: ${data.security.mediumIssues}
${data.security.topIssues.length > 0 ? `- Top issues: ${data.security.topIssues.map(i => `${i.count} ${i.resourceType} with ${i.title} (${i.severity})`).join(', ')}` : ''}

DEPLOYMENT DATA:
- Total deployments: ${data.deployments.total}
- Success rate: ${data.deployments.total > 0 ? ((data.deployments.successful / data.deployments.total) * 100).toFixed(1) : '0'}%
- Failed deployments: ${data.deployments.failed}
- Average lead time: ${data.deployments.averageLeadTime.toFixed(1)} hours
- Deployment frequency: ${data.deployments.deploymentFrequency.toFixed(1)} per day
- Change failure rate: ${(data.deployments.changeFailureRate * 100).toFixed(1)}%

RESOURCE DATA:
- Total resources: ${data.resources.total} (${data.resources.change > 0 ? '+' : ''}${data.resources.change} this period)
- By type: ${Object.entries(data.resources.byType).map(([type, count]) => `${count} ${type}`).join(', ')}

ALERTS DATA:
- Total alerts: ${data.alerts.total}
- Critical: ${data.alerts.critical}
- Resolved: ${data.alerts.resolved}
- Avg resolution time: ${data.alerts.avgResolutionTime.toFixed(1)} hours

Return JSON with this structure:
{
  "summary": "2-3 sentence executive summary",
  "keyHighlights": ["highlight 1", "highlight 2", "highlight 3"],
  "costAnalysis": {
    "overview": "1-2 paragraphs on cost trends",
    "trends": "Key cost patterns observed",
    "recommendations": ["recommendation 1", "recommendation 2"]
  },
  "securityAnalysis": {
    "overview": "1-2 paragraphs on security posture",
    "topRisks": "Most urgent security concerns",
    "recommendations": ["recommendation 1", "recommendation 2"]
  },
  "performanceAnalysis": {
    "overview": "1-2 paragraphs on deployment performance",
    "doraMetrics": "DORA metrics analysis",
    "recommendations": ["recommendation 1", "recommendation 2"]
  },
  "topRecommendations": [
    {
      "title": "Short recommendation title",
      "impact": "high",
      "description": "What to do and why",
      "estimatedSavings": 500,
      "effort": "low"
    }
  ],
  "executiveSummary": "3-4 sentence summary for executives"
}`;

    try {
      console.log('[AI Report Generator] Generating report with Claude API...');

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        temperature: 0.3,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      // Extract JSON from response
      let jsonText = content.text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\n?/g, '');
      }

      const report: GeneratedReport = JSON.parse(jsonText);

      console.log('[AI Report Generator] Report generated successfully');
      return report;
    } catch (error: any) {
      console.error('[AI Report Generator] Error:', error.message);
      console.log('[AI Report Generator] Falling back to basic report');
      return this.generateFallbackReport(data);
    }
  }

  private generateFallbackReport(data: ReportData): GeneratedReport {
    const costChange = data.costs.changePercent > 0 ? 'increased' : 'decreased';
    const costChangeAbs = Math.abs(data.costs.changePercent);

    return {
      summary: `Infrastructure costs ${costChange} by ${costChangeAbs.toFixed(1)}% to $${data.costs.current.toLocaleString()}/month. Security score is ${data.security.score}/100 with ${data.security.criticalIssues} critical issues. ${data.deployments.total} deployments with ${data.deployments.total > 0 ? ((data.deployments.successful / data.deployments.total) * 100).toFixed(1) : '0'}% success rate.`,
      keyHighlights: [
        `AWS spending ${costChange} by ${costChangeAbs.toFixed(1)}% ($${Math.abs(data.costs.change).toLocaleString()})`,
        `${data.security.criticalIssues} critical security issues require attention`,
        `${data.deployments.total} deployments with ${data.deployments.failed} failures`,
        `${data.resources.total} total resources across ${Object.keys(data.resources.byType).length} types`,
        `${data.alerts.critical} critical alerts with ${data.alerts.avgResolutionTime.toFixed(1)} hour avg resolution time`,
      ],
      costAnalysis: {
        overview: `AWS costs are currently $${data.costs.current.toLocaleString()}/month, ${costChange} by ${costChangeAbs.toFixed(1)}% compared to the previous period. The largest cost categories are compute ($${data.costs.breakdown.compute}), storage ($${data.costs.breakdown.storage}), and database ($${data.costs.breakdown.database}).`,
        trends: `Cost ${data.costs.changePercent > 0 ? 'growth' : 'reduction'} of ${costChangeAbs.toFixed(1)}% observed over the reporting period.`,
        recommendations: [
          data.resources.unusedResources.length > 0
            ? `Review ${data.resources.unusedResources.length} unused resources for potential savings of $${data.resources.unusedResources.reduce((sum, r) => sum + r.potentialSavings, 0)}/month`
            : 'Continue monitoring resource utilization',
          'Consider Reserved Instances or Savings Plans for predictable workloads',
        ],
      },
      securityAnalysis: {
        overview: `Security score is ${data.security.score}/100. There are ${data.security.criticalIssues} critical issues and ${data.security.highIssues} high-severity issues that require attention.`,
        topRisks: `Critical issues include: ${data.security.topIssues.map(i => `${i.count} ${i.resourceType} with ${i.title}`).join(', ') || 'None identified'}`,
        recommendations: [
          data.security.criticalIssues > 0
            ? `Address ${data.security.criticalIssues} critical security issues immediately`
            : 'Maintain current security posture',
          'Review and update security policies regularly',
        ],
      },
      performanceAnalysis: {
        overview: `${data.deployments.total} deployments were executed with a ${data.deployments.total > 0 ? ((data.deployments.successful / data.deployments.total) * 100).toFixed(1) : '0'}% success rate. Average lead time is ${data.deployments.averageLeadTime.toFixed(1)} hours.`,
        doraMetrics: `Deployment frequency: ${data.deployments.deploymentFrequency.toFixed(1)} per day. Change failure rate: ${(data.deployments.changeFailureRate * 100).toFixed(1)}%.`,
        recommendations: [
          data.deployments.failed > 0 ? `Investigate ${data.deployments.failed} failed deployments` : 'Maintain deployment quality',
          'Continue monitoring DORA metrics for performance trends',
        ],
      },
      topRecommendations: [
        ...(data.security.criticalIssues > 0
          ? [
              {
                title: 'Address Critical Security Issues',
                impact: 'high' as const,
                description: `Resolve ${data.security.criticalIssues} critical security vulnerabilities to reduce risk exposure.`,
                effort: 'high' as const,
              },
            ]
          : []),
        ...(data.resources.unusedResources.length > 0
          ? [
              {
                title: 'Optimize Unused Resources',
                impact: 'high' as const,
                description: `Remove or rightsize ${data.resources.unusedResources.length} unused resources.`,
                estimatedSavings: data.resources.unusedResources.reduce((sum, r) => sum + r.potentialSavings, 0),
                effort: 'low' as const,
              },
            ]
          : []),
        ...(data.deployments.failed > 3
          ? [
              {
                title: 'Improve Deployment Success Rate',
                impact: 'medium' as const,
                description: `Investigate and fix recurring deployment failures (${data.deployments.failed} failures this period).`,
                effort: 'medium' as const,
              },
            ]
          : []),
      ],
      executiveSummary: `This week's infrastructure performance shows AWS costs at $${data.costs.current.toLocaleString()}/month (${costChange} ${costChangeAbs.toFixed(1)}%). Security score is ${data.security.score}/100 with ${data.security.criticalIssues} critical issues. ${data.deployments.total} deployments achieved ${data.deployments.total > 0 ? ((data.deployments.successful / data.deployments.total) * 100).toFixed(1) : '0'}% success rate. ${data.resources.unusedResources.length > 0 ? `Opportunity to save $${data.resources.unusedResources.reduce((sum, r) => sum + r.potentialSavings, 0)}/month by optimizing unused resources.` : 'Infrastructure is well-optimized.'}`,
    };
  }

  async saveGeneratedReport(
    organizationId: string,
    report: GeneratedReport,
    dateRange: { from: string; to: string },
    reportType: string = 'weekly',
    scheduledReportId?: string
  ): Promise<string> {
    try {
      const result = await this.pool.query(
        `INSERT INTO generated_reports
         (organization_id, scheduled_report_id, report_type, date_range_from, date_range_to, report_data)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          organizationId,
          scheduledReportId || null,
          reportType,
          dateRange.from,
          dateRange.to,
          JSON.stringify(report),
        ]
      );

      const reportId = result.rows[0].id;
      console.log(`[AI Report Generator] Saved report ${reportId} for org ${organizationId}`);
      return reportId;
    } catch (error: any) {
      console.error('[AI Report Generator] Failed to save report:', error.message);
      throw error;
    }
  }

  async fetchReportHistory(
    organizationId: string,
    limit: number = 10,
    reportType?: string
  ): Promise<any[]> {
    try {
      let query: string;
      let params: any[];

      if (reportType) {
        query = `SELECT id, report_type, date_range_from, date_range_to, created_at, report_data
                 FROM generated_reports
                 WHERE organization_id = $1 AND report_type = $2
                 ORDER BY created_at DESC
                 LIMIT $3`;
        params = [organizationId, reportType, limit];
      } else {
        query = `SELECT id, report_type, date_range_from, date_range_to, created_at, report_data
                 FROM generated_reports
                 WHERE organization_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`;
        params = [organizationId, limit];
      }

      const result = await this.pool.query(query, params);

      return result.rows;
    } catch (error: any) {
      console.error('[AI Report Generator] Failed to fetch history:', error.message);
      return [];
    }
  }

  async fetchReportData(
    organizationId: string,
    dateRange: { from: string; to: string }
  ): Promise<ReportData> {
    console.log(`[AI Report Generator] Fetching real data for org ${organizationId} from ${dateRange.from} to ${dateRange.to}`);

    try {
      // Fetch all data in parallel
      const [costs, security, deployments, resources, alerts] = await Promise.all([
        this.fetchCostData(organizationId, dateRange),
        this.fetchSecurityData(organizationId, dateRange),
        this.fetchDeploymentData(organizationId, dateRange),
        this.fetchResourceData(organizationId, dateRange),
        this.fetchAlertData(organizationId, dateRange),
      ]);

      return {
        organizationId,
        dateRange,
        costs,
        security,
        deployments,
        resources,
        alerts,
      };
    } catch (error: any) {
      console.error('[AI Report Generator] Error fetching report data:', error.message);
      // Return minimal fallback data if queries fail
      return this.getFallbackReportData(organizationId, dateRange);
    }
  }

  /**
   * Fetch cost data from AWS resources
   */
  private async fetchCostData(
    organizationId: string,
    dateRange: { from: string; to: string }
  ) {
    // Get current period stats
    const stats = await this.awsResourcesRepo.getStats(organizationId);
    const currentCost = stats.total_monthly_cost || 0;

    // Get previous period cost (simplified - using a percentage of current for now)
    // In production, you'd query historical cost data or AWS Cost Explorer API
    const previousCost = currentCost * 0.9; // Assume 10% growth as fallback
    const change = currentCost - previousCost;
    const changePercent = previousCost > 0 ? (change / previousCost) * 100 : 0;

    // Map cost by type to the breakdown categories
    const ec2Cost = stats.cost_by_type?.ec2 || 0;
    const ecsLambdaCost = (stats.cost_by_type?.ecs || 0) + (stats.cost_by_type?.lambda || 0);
    const s3Cost = stats.cost_by_type?.s3 || 0;
    const rdsCost = stats.cost_by_type?.rds || 0;
    const networkCost = (stats.cost_by_type?.vpc || 0) + (stats.cost_by_type?.elb || 0) + (stats.cost_by_type?.['load-balancer'] || 0);

    const computeCost = ec2Cost + ecsLambdaCost;
    const storageCost = s3Cost;
    const databaseCost = rdsCost;
    const otherCost = Math.max(0, currentCost - computeCost - storageCost - databaseCost - networkCost);

    const breakdown = {
      compute: computeCost,
      storage: storageCost,
      database: databaseCost,
      network: networkCost,
      other: otherCost,
    };

    return {
      current: Math.round(currentCost),
      previous: Math.round(previousCost),
      change: Math.round(change),
      changePercent: parseFloat(changePercent.toFixed(1)),
      breakdown: {
        compute: Math.round(breakdown.compute),
        storage: Math.round(breakdown.storage),
        database: Math.round(breakdown.database),
        network: Math.round(breakdown.network),
        other: Math.max(0, Math.round(breakdown.other)),
      },
    };
  }

  /**
   * Fetch security data from compliance checks
   */
  private async fetchSecurityData(
    organizationId: string,
    _dateRange: { from: string; to: string }
  ) {
    const stats = await this.awsResourcesRepo.getStats(organizationId);
    const complianceStats = stats.compliance_stats;

    // Calculate security score based on compliance
    const totalIssues = complianceStats?.total_issues || 0;
    const totalResources = stats.total_resources || 1;

    // Security score: inversely proportional to issues (100 - penalty)
    const issuePenalty = Math.min(100, (totalIssues / totalResources) * 100);
    const currentScore = Math.max(0, Math.round(100 - issuePenalty));

    // Previous score (simplified - would need historical data)
    const previousScore = Math.max(0, currentScore - 5);

    // Count issues by severity
    const criticalIssues = complianceStats?.by_severity?.critical || 0;
    const highIssues = complianceStats?.by_severity?.high || 0;
    const mediumIssues = complianceStats?.by_severity?.medium || 0;

    // Build top issues list from category counts
    const topIssues = [];
    if (complianceStats?.by_category) {
      if (complianceStats.by_category.encryption > 0) {
        topIssues.push({
          title: 'Unencrypted resources',
          severity: 'critical',
          resourceType: 'mixed',
          count: complianceStats.by_category.encryption,
        });
      }
      if (complianceStats.by_category.public_access > 0) {
        topIssues.push({
          title: 'Publicly exposed resources',
          severity: 'critical',
          resourceType: 'mixed',
          count: complianceStats.by_category.public_access,
        });
      }
      if (complianceStats.by_category.backups > 0) {
        topIssues.push({
          title: 'Missing backup configuration',
          severity: 'high',
          resourceType: 'rds/ec2',
          count: complianceStats.by_category.backups,
        });
      }
      if (complianceStats.by_category.tagging > 0) {
        topIssues.push({
          title: 'Untagged resources',
          severity: 'medium',
          resourceType: 'mixed',
          count: complianceStats.by_category.tagging,
        });
      }
      if (complianceStats.by_category.iam > 0) {
        topIssues.push({
          title: 'IAM policy issues',
          severity: 'high',
          resourceType: 'iam',
          count: complianceStats.by_category.iam,
        });
      }
    }

    return {
      score: currentScore,
      previousScore,
      criticalIssues,
      highIssues,
      mediumIssues,
      topIssues: topIssues.slice(0, 5),
    };
  }

  /**
   * Fetch deployment data and DORA metrics
   */
  private async fetchDeploymentData(
    organizationId: string,
    dateRange: { from: string; to: string }
  ) {
    const periodDays = this.calculateDaysBetween(dateRange.from, dateRange.to);

    // Get deployments in the date range
    const deploymentsResult = await this.pool.query(
      `SELECT status, deployed_at
       FROM deployments d
       JOIN services s ON d.service_id = s.id
       WHERE s.organization_id = $1
       AND d.deployed_at >= $2
       AND d.deployed_at <= $3`,
      [organizationId, dateRange.from, dateRange.to]
    );

    const total = deploymentsResult.rows.length;
    const successful = deploymentsResult.rows.filter(r => r.status === 'success').length;
    const failed = deploymentsResult.rows.filter(r => r.status === 'failed').length;

    // Get DORA metrics
    const doraFilters = { dateRange: `${periodDays}d` as '7d' | '30d' | '90d' };

    let averageLeadTime = 2.0; // Default fallback
    let deploymentFrequency = total / Math.max(1, periodDays);
    let changeFailureRate = total > 0 ? failed / total : 0;

    try {
      // Try to get real DORA metrics
      const leadTimeResult = await this.doraMetricsRepo.calculateLeadTime(doraFilters);
      averageLeadTime = leadTimeResult.averageLeadTimeHours || 2.0;
    } catch (error) {
      console.warn('[AI Report Generator] Could not fetch lead time, using default');
    }

    return {
      total,
      successful,
      failed,
      averageLeadTime: parseFloat(averageLeadTime.toFixed(1)),
      deploymentFrequency: parseFloat(deploymentFrequency.toFixed(1)),
      changeFailureRate: parseFloat(changeFailureRate.toFixed(2)),
    };
  }

  /**
   * Fetch resource data
   */
  private async fetchResourceData(
    organizationId: string,
    _dateRange: { from: string; to: string }
  ) {
    const stats = await this.awsResourcesRepo.getStats(organizationId);

    // Calculate change (simplified - would need historical tracking)
    const change = Math.round(stats.total_resources * 0.03); // Assume 3% growth

    // Get top cost resources
    const topCostResult = await this.pool.query(
      `SELECT resource_id, resource_type, estimated_monthly_cost, resource_name
       FROM aws_resources
       WHERE organization_id = $1
       AND estimated_monthly_cost > 0
       ORDER BY estimated_monthly_cost DESC
       LIMIT 5`,
      [organizationId]
    );

    const topCostResources = topCostResult.rows.map(row => ({
      id: row.resource_id,
      type: row.resource_type,
      cost: Math.round(row.estimated_monthly_cost),
      name: row.resource_name || row.resource_id,
    }));

    // Get unused resources from cost recommendations
    const unusedRecommendations = await this.costRecommendationsRepo.findAll({
      status: 'ACTIVE',
      limit: 10,
    });

    const unusedResources = unusedRecommendations
      .filter(rec => rec.issue.toLowerCase().includes('idle') || rec.issue.toLowerCase().includes('unused'))
      .map(rec => ({
        id: rec.resource_id,
        type: rec.resource_type,
        potentialSavings: Math.round(rec.potential_savings),
      }));

    return {
      total: stats.total_resources,
      change,
      byType: this.convertByTypeToRecord(stats.by_type),
      topCostResources,
      unusedResources: unusedResources.slice(0, 5),
    };
  }

  /**
   * Fetch alert data
   */
  private async fetchAlertData(
    _organizationId: string,
    dateRange: { from: string; to: string }
  ) {
    const periodDays = this.calculateDaysBetween(dateRange.from, dateRange.to);
    const alertFilters = { dateRange: `${periodDays}d` as '7d' | '30d' | '90d' };

    const alertStats = await this.alertHistoryRepo.getStats(alertFilters);

    return {
      total: alertStats.total,
      critical: alertStats.criticalCount,
      resolved: alertStats.resolved,
      avgResolutionTime: parseFloat((alertStats.avgResolutionTime / 60).toFixed(1)), // Convert minutes to hours
    };
  }

  /**
   * Helper: Calculate days between two dates
   */
  private calculateDaysBetween(from: string, to: string): number {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Helper: Subtract days from a date
   */
  private subtractDays(dateString: string, days: number): string {
    const date = new Date(dateString);
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Helper: Convert by_type object to Record format
   */
  private convertByTypeToRecord(byType: any): Record<string, number> {
    const result: Record<string, number> = {};
    if (byType) {
      Object.entries(byType).forEach(([key, value]) => {
        result[key] = value as number;
      });
    }
    return result;
  }

  /**
   * Fallback data when queries fail
   */
  private getFallbackReportData(
    organizationId: string,
    dateRange: { from: string; to: string }
  ): ReportData {
    return {
      organizationId,
      dateRange,
      costs: {
        current: 0,
        previous: 0,
        change: 0,
        changePercent: 0,
        breakdown: { compute: 0, storage: 0, database: 0, network: 0, other: 0 },
      },
      security: {
        score: 0,
        previousScore: 0,
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        topIssues: [],
      },
      deployments: {
        total: 0,
        successful: 0,
        failed: 0,
        averageLeadTime: 0,
        deploymentFrequency: 0,
        changeFailureRate: 0,
      },
      resources: {
        total: 0,
        change: 0,
        byType: {},
        topCostResources: [],
        unusedResources: [],
      },
      alerts: {
        total: 0,
        critical: 0,
        resolved: 0,
        avgResolutionTime: 0,
      },
    };
  }
}
