import Anthropic from '@anthropic-ai/sdk';
import { AnomalyDetection, AnomalyType, AnomalySeverity } from '../types/anomaly.types';

export class AnomalyAIService {
  private client: Anthropic | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      console.log('[Anomaly AI] Service initialized with Anthropic API');
    } else {
      console.warn('[Anomaly AI] No ANTHROPIC_API_KEY — using statistical fallbacks');
    }
  }

  /**
   * Primary entry point called by AnomalyDetectionJob.
   * Validates statistical candidates with Claude, filters false positives,
   * classifies into 4 detection types, scores severity, and enriches with
   * actionable executive-grade insights.
   */
  async explainAnomalies(anomalies: AnomalyDetection[]): Promise<AnomalyDetection[]> {
    if (anomalies.length === 0) return [];

    console.log(`[Anomaly AI] Validating and enriching ${anomalies.length} candidates...`);

    if (!this.client) {
      console.warn('[Anomaly AI] No API client — applying statistical fallbacks');
      return anomalies.map(a => this.applyFallback(a));
    }

    // Process in batches of 5 to avoid rate limits
    const batchSize = 5;
    const results: AnomalyDetection[] = [];

    for (let i = 0; i < anomalies.length; i += batchSize) {
      const batch = anomalies.slice(i, i + batchSize);
      const enriched = await Promise.all(batch.map(a => this.validateAndEnrich(a)));
      // Filter out anomalies Claude determined are statistical noise (confidence < 40)
      results.push(...enriched.filter(a => a.confidence >= 40));
    }

    console.log(`[Anomaly AI] Complete: ${results.length} confirmed anomalies (${anomalies.length - results.length} filtered as noise)`);
    return results;
  }

  /**
   * Claude validates whether this is a real anomaly, classifies it into
   * one of the 4 detection types, scores severity and confidence,
   * and generates executive-grade insights.
   */
  private async validateAndEnrich(anomaly: AnomalyDetection): Promise<AnomalyDetection> {
    try {
      const prompt = this.buildValidationPrompt(anomaly);

      const message = await this.client!.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText = this.extractText(message.content);
      const parsed = this.parseValidationResponse(responseText);

      return {
        ...anomaly,
        // Claude may reclassify the type if the statistical detector mislabelled it
        type: parsed.confirmedType ?? anomaly.type,
        severity: parsed.severity ?? anomaly.severity,
        confidence: parsed.confidence ?? 50,
        title: parsed.title ?? anomaly.title,
        description: parsed.description ?? anomaly.description,
        aiExplanation: parsed.explanation,
        impact: parsed.impact,
        recommendation: parsed.recommendation,
      };
    } catch (err) {
      console.error('[Anomaly AI] Claude call failed, applying fallback:', err);
      return this.applyFallback(anomaly);
    }
  }

  /**
   * Structured prompt that asks Claude to:
   * 1. Confirm whether this is a real anomaly or noise
   * 2. Classify it into one of the 4 pricing-page detection types
   * 3. Score severity and confidence
   * 4. Generate executive-grade explanation, impact, and recommendation
   */
  private buildValidationPrompt(anomaly: AnomalyDetection): string {
    return `You are an AWS infrastructure AI analyst for DevControl, a platform used by CTOs, engineering directors, and CFOs to manage cloud infrastructure.

A statistical detector has flagged a potential anomaly. Your job is to:
1. Validate whether this is a genuine anomaly or statistical noise
2. Classify it into exactly one of the 4 detection types below
3. Score severity and confidence
4. Generate concise, executive-grade insights

STATISTICAL CANDIDATE:
Type (statistical): ${anomaly.type}
Severity (statistical): ${anomaly.severity}
Resource: ${anomaly.resourceName || 'Organization-wide'} (${anomaly.resourceType || 'unknown'})
Metric: ${anomaly.metric}
Current Value: ${anomaly.currentValue.toFixed(2)}
Expected Value: ${anomaly.expectedValue.toFixed(2)}
Deviation: ${anomaly.deviation.toFixed(1)}%
Historical Average: ${anomaly.historicalAverage.toFixed(2)}
Historical Std Dev: ${anomaly.historicalStdDev.toFixed(2)}
Time Window: ${anomaly.timeWindow}
Region: ${anomaly.region || 'unknown'}

THE 4 DETECTION TYPES (classify into exactly one):
- COST_ANOMALY: Unexpected spend increases, budget overruns, cost allocation shifts, reserved capacity waste
- SECURITY_ANOMALY: Unusual access patterns, permission changes, error rate spikes suggesting attacks, suspicious API calls
- PERFORMANCE_ANOMALY: CPU/memory spikes, latency increases, throughput degradation, service degradation
- CAPACITY_ANOMALY: Invocation spikes, traffic drops, scaling events, resource saturation, deployment impacts

Respond in this EXACT format with no preamble:

CONFIRMED: YES or NO
TYPE: COST_ANOMALY or SECURITY_ANOMALY or PERFORMANCE_ANOMALY or CAPACITY_ANOMALY
SEVERITY: info or warning or critical
CONFIDENCE: 0-100 (how certain you are this is a real anomaly, not noise)
TITLE: [8 words max — executive-grade headline]
DESCRIPTION: [One sentence — what happened, plain English]
EXPLANATION: [2-3 sentences — root cause analysis. Why did this happen? Reference common AWS patterns.]
IMPACT: [1-2 sentences — business and technical impact. Quantify where possible.]
RECOMMENDATION: [3 specific numbered actions an engineer should take immediately. Be AWS-specific.]`;
  }

  /**
   * Parse Claude's structured response into typed fields.
   */
  private parseValidationResponse(response: string): {
    confirmed: boolean;
    confirmedType: AnomalyType | null;
    severity: AnomalySeverity | null;
    confidence: number;
    title: string;
    description: string;
    explanation: string;
    impact: string;
    recommendation: string;
  } {
    const get = (key: string) => {
      const match = response.match(new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 's'));
      return match?.[1]?.trim() ?? '';
    };

    const confirmed = get('CONFIRMED').toUpperCase() === 'YES';
    const confidence = parseInt(get('CONFIDENCE')) || (confirmed ? 70 : 20);

    // Map Claude's classification back to AnomalyType values
    const typeMap: Record<string, AnomalyType> = {
      COST_ANOMALY:        'cost_spike',
      SECURITY_ANOMALY:    'error_rate_spike',
      PERFORMANCE_ANOMALY: 'cpu_spike',
      CAPACITY_ANOMALY:    'invocation_spike',
    };
    const rawType = get('TYPE').toUpperCase();
    const confirmedType = typeMap[rawType] ?? null;

    const severityRaw = get('SEVERITY').toLowerCase();
    const severity: AnomalySeverity | null =
      ['info', 'warning', 'critical'].includes(severityRaw)
        ? (severityRaw as AnomalySeverity)
        : null;

    return {
      confirmed,
      confirmedType,
      severity,
      confidence,
      title:          get('TITLE')          || 'Anomaly Detected',
      description:    get('DESCRIPTION')    || 'An anomaly was detected in your infrastructure.',
      explanation:    get('EXPLANATION')    || this.getFallbackExplanation(confirmedType),
      impact:         get('IMPACT')         || 'Infrastructure performance or cost may be affected.',
      recommendation: get('RECOMMENDATION') || 'Investigate the affected resource and review recent changes.',
    };
  }

  /**
   * Applied when Claude is unavailable — preserves statistical detection
   * with dignified fallback copy.
   */
  private applyFallback(anomaly: AnomalyDetection): AnomalyDetection {
    return {
      ...anomaly,
      confidence: 50,
      aiExplanation: this.getFallbackExplanation(anomaly.type),
      impact:         this.getFallbackImpact(anomaly.type),
      recommendation: this.getFallbackRecommendation(anomaly.type),
    };
  }

  private getFallbackExplanation(type: AnomalyType | null): string {
    const map: Partial<Record<AnomalyType, string>> = {
      cost_spike:         'AWS costs have increased significantly beyond historical baseline. This may indicate unintended resource scaling, data transfer charges, or new workloads.',
      cost_drop:          'AWS costs have dropped unexpectedly, which may indicate services going offline or reduced usage.',
      cpu_spike:          'CPU utilization has exceeded normal operating thresholds. This typically indicates increased load, inefficient code execution, or a need for horizontal scaling.',
      error_rate_spike:   'Error rates have risen above acceptable thresholds, which may signal application issues, upstream dependency failures, or a security event.',
      invocation_spike:   'Function or service invocations have spiked beyond normal patterns, suggesting unusual traffic or a runaway process.',
      traffic_drop:       'Traffic has dropped significantly below baseline, which may indicate a service outage, DNS issue, or upstream dependency failure.',
      deployment_impact:  'A recent deployment appears to have impacted service performance or reliability metrics.',
      memory_spike:       'Memory utilization has exceeded normal thresholds, potentially causing performance degradation or OOM conditions.',
    };
    return map[type ?? 'cost_spike'] ?? 'An anomaly was detected in your AWS infrastructure.';
  }

  private getFallbackImpact(type: AnomalyType | null): string {
    const map: Partial<Record<AnomalyType, string>> = {
      cost_spike:         'Unexpected costs may exceed budget thresholds if not addressed promptly.',
      cost_drop:          'Reduced costs may indicate service degradation affecting end users.',
      cpu_spike:          'High CPU utilization may degrade response times and user experience.',
      error_rate_spike:   'Elevated error rates directly impact user experience and may indicate a security incident.',
      invocation_spike:   'Invocation spikes increase costs and may cause throttling or downstream failures.',
      traffic_drop:       'Traffic drops may indicate user-facing service disruption.',
      deployment_impact:  'Deployment-related degradation may be affecting production users.',
      memory_spike:       'Memory pressure may lead to process crashes or severe performance degradation.',
    };
    return map[type ?? 'cost_spike'] ?? 'This anomaly may impact infrastructure performance or cost.';
  }

  private getFallbackRecommendation(type: AnomalyType | null): string {
    const map: Partial<Record<AnomalyType, string>> = {
      cost_spike:         '1. Check AWS Cost Explorer for service-level breakdown. 2. Review auto-scaling activity and recent resource creation. 3. Set billing alerts to catch future spikes early.',
      cost_drop:          '1. Verify all critical services are running. 2. Check for unintended terminations in EC2 and ECS. 3. Review CloudWatch for service health.',
      cpu_spike:          '1. Check CloudWatch metrics for the affected instance. 2. Review application logs for the spike window. 3. Consider scaling the instance type or enabling auto-scaling.',
      error_rate_spike:   '1. Review CloudWatch Logs for error patterns. 2. Check recent deployments and configuration changes. 3. Investigate potential DDoS or brute-force activity in GuardDuty.',
      invocation_spike:   '1. Check Lambda or API Gateway metrics for unexpected callers. 2. Review access logs for unusual patterns. 3. Consider rate limiting or WAF rules.',
      traffic_drop:       '1. Check Route 53 health checks and DNS records. 2. Verify load balancer target group health. 3. Review CloudFront distribution status if applicable.',
      deployment_impact:  '1. Review the most recent deployment for configuration changes. 2. Consider rolling back if metrics do not recover. 3. Check application logs immediately post-deployment.',
      memory_spike:       '1. Check for memory leaks in application logs. 2. Review CloudWatch memory metrics trend. 3. Consider instance right-sizing or memory optimization.',
    };
    return map[type ?? 'cost_spike'] ?? '1. Investigate the affected resource. 2. Review recent changes. 3. Monitor for recurrence.';
  }

  private extractText(content: Anthropic.Messages.ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }
}
