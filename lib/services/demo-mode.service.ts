import { DEMO_AWS_RESOURCES, DEMO_STATS } from '../demo-data/demo-generator';

class DemoModeService {
  private DEMO_MODE_KEY = 'devcontrol_demo_mode';

  /**
   * Check if demo mode is enabled
   */
  isEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(this.DEMO_MODE_KEY) === 'true';
  }

  /**
   * Enable demo mode
   */
  enable() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.DEMO_MODE_KEY, 'true');
    window.location.reload();
  }

  /**
   * Disable demo mode
   */
  disable() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.DEMO_MODE_KEY);
    window.location.reload();
  }

  /**
   * Toggle demo mode
   */
  toggle() {
    if (this.isEnabled()) {
      this.disable();
    } else {
      this.enable();
    }
  }

  /**
   * Get demo AWS resources
   */
  getDemoResources() {
    return DEMO_AWS_RESOURCES;
  }

  /**
   * Get demo statistics
   */
  getDemoStats() {
    return DEMO_STATS;
  }

  /**
   * Get demo cost optimization recommendations
   */
  getDemoOptimizations() {
    return [
      {
        id: 'demo-opt-1',
        type: 'idle_resource',
        resourceName: 'staging-old-server',
        resourceType: 'EC2',
        region: 'us-east-1',
        currentCost: 178,
        monthlySavings: 178,
        annualSavings: 2136,
        risk: 'caution',
        effort: 'low',
        priority: 8,
        confidence: 95,
        title: 'Idle EC2 instance: staging-old-server',
        description: 'This instance has averaged 2.1% CPU over 14 days',
        reasoning: 'Extremely low CPU usage suggests this instance is not being used',
        action: 'Stop instance or terminate if confirmed unused',
        status: 'pending',
      },
      {
        id: 'demo-opt-2',
        type: 'oversized_instance',
        resourceName: 'dev-testing-environment',
        resourceType: 'EC2',
        region: 'us-east-1',
        currentCost: 445,
        monthlySavings: 223,
        annualSavings: 2676,
        risk: 'caution',
        effort: 'medium',
        priority: 7,
        confidence: 85,
        title: 'Oversized EC2 instance: dev-testing-environment',
        description: 'CPU usage averaging 18% suggests instance is oversized',
        reasoning: 'Low CPU utilization indicates you can downsize to t3.xlarge',
        action: 'Resize to smaller instance type',
        status: 'pending',
      },
      {
        id: 'demo-opt-3',
        type: 'unattached_volume',
        resourceName: 'old-backup-volume',
        resourceType: 'EBS',
        region: 'us-east-1',
        currentCost: 25,
        monthlySavings: 25,
        annualSavings: 300,
        risk: 'safe',
        effort: 'low',
        priority: 9,
        confidence: 98,
        title: 'Unattached EBS volume: old-backup-volume',
        description: 'This volume is not attached to any instance',
        reasoning: 'Unattached volumes still incur costs',
        action: 'Create snapshot, then delete volume',
        status: 'pending',
      },
      {
        id: 'demo-opt-4',
        type: 'unattached_volume',
        resourceName: 'testing-snapshot-volume',
        resourceType: 'EBS',
        region: 'us-east-1',
        currentCost: 10,
        monthlySavings: 10,
        annualSavings: 120,
        risk: 'safe',
        effort: 'low',
        priority: 9,
        confidence: 98,
        title: 'Unattached EBS volume: testing-snapshot-volume',
        description: 'This volume is not attached to any instance',
        reasoning: 'Unattached volumes still incur costs',
        action: 'Create snapshot, then delete volume',
        status: 'pending',
      },
      {
        id: 'demo-opt-5',
        type: 'unused_elastic_ip',
        resourceName: 'old-staging-ip',
        resourceType: 'ElasticIP',
        region: 'us-east-1',
        currentCost: 3.65,
        monthlySavings: 3.65,
        annualSavings: 43.8,
        risk: 'safe',
        effort: 'low',
        priority: 8,
        confidence: 99,
        title: 'Unused Elastic IP: old-staging-ip',
        description: 'This Elastic IP is not associated with any instance',
        reasoning: 'Unassociated Elastic IPs incur charges',
        action: 'Release Elastic IP',
        status: 'pending',
      },
      {
        id: 'demo-opt-6',
        type: 'lambda_memory',
        resourceName: 'webhook-handler',
        resourceType: 'Lambda',
        region: 'us-east-1',
        currentCost: 78.9,
        monthlySavings: 31.56,
        annualSavings: 378.72,
        risk: 'safe',
        effort: 'low',
        priority: 7,
        confidence: 85,
        title: 'Over-provisioned Lambda: webhook-handler',
        description: 'Memory utilization only 28%',
        reasoning: 'Lambda is allocated more memory than needed',
        action: 'Reduce Lambda memory from 2048MB to 1024MB',
        status: 'pending',
      },
    ];
  }

  /**
   * Get demo anomalies
   */
  getDemoAnomalies() {
    return [
      {
        id: 'demo-anom-1',
        type: 'cpu_spike',
        severity: 'critical',
        resourceName: 'production-worker-overloaded',
        resourceType: 'EC2',
        region: 'us-east-1',
        metric: 'cpu_utilization',
        currentValue: 92,
        expectedValue: 45,
        deviation: 104.4,
        confidence: 95,
        title: 'High CPU Detected: production-worker-overloaded',
        description: 'CPU utilization at 92.0% (104% above normal)',
        aiExplanation: 'The CPU spike is likely caused by increased background job processing. Historical data shows normal CPU averaging 45%, but current load has more than doubled. This suggests either a traffic surge, inefficient code deployment, or a background job queue backup.',
        impact: 'High CPU utilization can lead to slow response times, request timeouts, and potential service degradation. If sustained, this could impact customer experience and may require immediate scaling or optimization.',
        recommendation: '1. Check application logs for errors or slow queries\n2. Review recent deployments for performance regressions\n3. Consider scaling horizontally by adding more instances\n4. Investigate background job queue depth and processing efficiency',
        status: 'active',
        detectedAt: new Date(Date.now() - 1000 * 60 * 45), // 45 minutes ago
      },
      {
        id: 'demo-anom-2',
        type: 'invocation_spike',
        severity: 'warning',
        resourceName: 'payment-processor',
        resourceType: 'Lambda',
        region: 'us-east-1',
        metric: 'invocations',
        currentValue: 8900000,
        expectedValue: 3200000,
        deviation: 178.1,
        confidence: 90,
        title: 'Lambda Invocation Spike: payment-processor',
        description: 'Invocations increased 178% (8,900,000 vs avg 3,200,000)',
        aiExplanation: 'The Lambda function is experiencing a 178% increase in invocations compared to the 30-day average. This dramatic spike could indicate a retry loop, a sudden traffic surge, or an integration issue causing repeated invocations.',
        impact: 'The invocation spike has increased Lambda costs from ~$350/month to ~$968/month. If this pattern continues, monthly costs could exceed budget by $600+. Additionally, high invocation rates may indicate wasted compute from retries or errors.',
        recommendation: '1. Check CloudWatch Logs for error patterns or retry loops\n2. Review error rate metrics - high errors often trigger excessive retries\n3. Verify upstream services aren\'t inadvertently calling the function repeatedly\n4. Consider implementing exponential backoff for retries if not already in place',
        status: 'active',
        detectedAt: new Date(Date.now() - 1000 * 60 * 120), // 2 hours ago
      },
      {
        id: 'demo-anom-3',
        type: 'cost_spike',
        severity: 'warning',
        resourceName: 'Organization-wide',
        resourceType: 'Account',
        region: 'global',
        metric: 'total_cost',
        currentValue: 6847.2,
        expectedValue: 5983.5,
        deviation: 14.4,
        confidence: 88,
        title: 'AWS Cost Spike Detected: 14.4% increase',
        description: 'Total AWS costs increased from $5,983.50 to $6,847.20',
        aiExplanation: 'The 14.4% cost increase ($864 additional spend) appears to be driven primarily by the Lambda invocation spike in payment-processor and increased CPU usage across production instances. This suggests either organic traffic growth or an efficiency issue.',
        impact: 'At current rates, this represents an additional $10,368 in annual AWS costs. The spike correlates with increased Lambda invocations and CPU usage, suggesting it may be partially addressable through optimization.',
        recommendation: '1. Address the Lambda invocation spike in payment-processor (primary driver)\n2. Investigate CPU spikes on production-worker-overloaded\n3. Review auto-scaling policies to ensure they\'re optimized\n4. Consider Reserved Instances for baseline capacity to reduce EC2 costs',
        status: 'active',
        detectedAt: new Date(Date.now() - 1000 * 60 * 180), // 3 hours ago
      },
    ];
  }
}

export const demoModeService = new DemoModeService();
