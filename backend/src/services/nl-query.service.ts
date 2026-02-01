/**
 * Natural Language Query Service
 * Parses user queries into structured navigation intents
 */

import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import { NLQueryAnalyticsService } from './nl-query-analytics.service';

export interface NLQueryIntent {
  action: 'navigate' | 'filter' | 'search';
  target: 'infrastructure' | 'services' | 'deployments' | 'alerts' | 'costs' | 'teams';
  filters?: {
    resourceType?: string;
    environment?: string;
    status?: string;
    severity?: string;
    dateRange?: string;
    awsRegion?: string;
    template?: string;
    costMin?: string;
    costMax?: string;
  };
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
}

interface CacheEntry {
  intent: NLQueryIntent;
  timestamp: number;
}

export class NLQueryService {
  private anthropic: Anthropic | null = null;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
  private analytics: NLQueryAnalyticsService;

  constructor(private pool: Pool) {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      console.log('[NL Query] Service initialized with Anthropic API');
    } else {
      console.warn('[NL Query] ANTHROPIC_API_KEY not found - using fallback parser');
    }

    // Initialize analytics
    this.analytics = new NLQueryAnalyticsService(pool);
    this.analytics.initializeTable().catch((err) => {
      console.error('[NL Query] Failed to initialize analytics table:', err);
    });

    // Clean up expired cache entries every minute
    setInterval(() => this.cleanCache(), 60 * 1000);
  }

  private cleanCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[NL Query] Cleaned ${cleaned} expired cache entries`);
    }
  }

  private getCacheKey(query: string, organizationId: string): string {
    return `${organizationId}:${query.toLowerCase().trim()}`;
  }

  private getFromCache(query: string, organizationId: string): NLQueryIntent | null {
    const key = this.getCacheKey(query, organizationId);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const age = Date.now() - entry.timestamp;
    if (age > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    console.log(`[NL Query] Cache hit for: "${query}" (age: ${Math.round(age / 1000)}s)`);
    return entry.intent;
  }

  private saveToCache(query: string, organizationId: string, intent: NLQueryIntent): void {
    const key = this.getCacheKey(query, organizationId);
    this.cache.set(key, {
      intent,
      timestamp: Date.now(),
    });
    console.log(`[NL Query] Cached query: "${query}" (cache size: ${this.cache.size})`);
  }

  /**
   * Parse natural language queries into structured filters
   *
   * ROUTING STRATEGY:
   * - Infrastructure: Specific resources + filters (90% of queries)
   *   Examples: "ec2 instances", "expensive resources", "unencrypted s3"
   * - Services: Application services and deployments
   * - Costs: General cost overview only (no filters)
   *   Examples: "total costs", "spending trends"
   * - Deployments: Deployment history and tracking
   * - Alerts: Active alerts and incidents
   *
   * KEY PRINCIPLE: If query has filters or mentions specific resource types,
   * use "infrastructure" target with filters, not "costs" target.
   *
   * FILTER TYPES:
   * - Cost: costMin, costMax (routes to infrastructure)
   * - Security: encrypted, publicAccess, hasBackup (routes to infrastructure)
   * - Resource: resourceType, status, awsRegion (routes to infrastructure)
   * - Deployment: environment, status (routes to deployments)
   * - Alert: severity, status, dateRange (routes to alerts)
   */
  async parseQuery(query: string, organizationId: string): Promise<NLQueryIntent> {
    const startTime = Date.now();
    let wasCached = false;

    // Check cache first
    const cached = this.getFromCache(query, organizationId);
    if (cached) {
      wasCached = true;
      const responseTime = Date.now() - startTime;

      // Log analytics
      this.analytics.logQuery({
        organizationId,
        query,
        target: cached.target,
        action: cached.action,
        filterCount: cached.filters ? Object.keys(cached.filters).length : 0,
        confidence: cached.confidence,
        wasCached: true,
        responseTime,
      });

      return cached;
    }

    // Quick keyword detection - if it looks like a keyword, skip AI
    if (this.isKeywordQuery(query)) {
      const intent = this.fallbackParse(query);
      this.saveToCache(query, organizationId, intent);

      const responseTime = Date.now() - startTime;
      this.analytics.logQuery({
        organizationId,
        query,
        target: intent.target,
        action: intent.action,
        filterCount: intent.filters ? Object.keys(intent.filters).length : 0,
        confidence: intent.confidence,
        wasCached: false,
        responseTime,
      });

      return intent;
    }

    if (!this.anthropic) {
      const intent = this.fallbackParse(query);
      this.saveToCache(query, organizationId, intent);

      const responseTime = Date.now() - startTime;
      this.analytics.logQuery({
        organizationId,
        query,
        target: intent.target,
        action: intent.action,
        filterCount: intent.filters ? Object.keys(intent.filters).length : 0,
        confidence: intent.confidence,
        wasCached: false,
        responseTime,
      });

      return intent;
    }

    try {
      const prompt = this.buildPrompt(query);

      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });

      const response = this.extractTextContent(message.content);
      const intent = this.parseResponse(response, query);

      // Cache successful parse
      this.saveToCache(query, organizationId, intent);

      const responseTime = Date.now() - startTime;
      this.analytics.logQuery({
        organizationId,
        query,
        target: intent.target,
        action: intent.action,
        filterCount: intent.filters ? Object.keys(intent.filters).length : 0,
        confidence: intent.confidence,
        wasCached: false,
        responseTime,
      });

      return intent;
    } catch (error: any) {
      console.error('[NL Query] Parse error:', error.message);
      const intent = this.fallbackParse(query);
      this.saveToCache(query, organizationId, intent);

      const responseTime = Date.now() - startTime;
      this.analytics.logQuery({
        organizationId,
        query,
        target: intent.target,
        action: intent.action,
        filterCount: intent.filters ? Object.keys(intent.filters).length : 0,
        confidence: intent.confidence,
        wasCached: false,
        responseTime,
      });

      return intent;
    }
  }

  /**
   * Get analytics stats
   */
  async getAnalytics(organizationId: string, days: number = 30) {
    return this.analytics.getStats(organizationId, days);
  }

  private buildPrompt(query: string): string {
    return `Parse this user query into a navigation intent for a DevOps platform.

User query: "${query}"

Available pages and filters:

1. infrastructure
   - resourceType: ec2, rds, s3, vpc, lambda, cloudfront, elb
   - status: running, stopped, terminated, pending
   - awsRegion: us-east-1, us-east-2, us-west-1, us-west-2, eu-west-1, ap-southeast-1
   - costMin: minimum cost threshold (number)
   - costMax: maximum cost threshold (number)
   - encrypted: true/false
   - hasBackup: true/false
   - publicAccess: true/false

2. services
   - status: active, inactive, deploying, failed
   - template: api, microservices

3. deployments
   - environment: production, staging, development
   - status: running, stopped, deploying, failed

4. alerts
   - severity: critical, warning
   - status: firing, acknowledged, resolved
   - dateRange: 7d, 30d, 90d

5. costs (general cost overview ONLY - no filters)
6. teams (navigate only, no filters)

CRITICAL ROUTING RULES (READ CAREFULLY):

1. Resource-specific queries → ALWAYS use "infrastructure" target
   Examples: EC2, RDS, S3, Lambda, ECS, VPC queries

2. Queries with filters → ALWAYS use "infrastructure" target
   Filters include: cost, region, encryption, backups, status, tags

3. Security/compliance queries → ALWAYS use "infrastructure" target
   Examples: encrypted, public, exposed, vulnerable, compliant

4. ONLY use "costs" target for general cost overview WITHOUT specific resource types or filters:
   - "what are my total costs"
   - "show me spending trends"
   - "cost breakdown overview"

CORRECT ROUTING EXAMPLES:
✅ "resources over $100" → TARGET: infrastructure, FILTERS: {"costMin": 100}
✅ "resources costing over $100" → TARGET: infrastructure, FILTERS: {"costMin": 100}
✅ "expensive resources" → TARGET: infrastructure, FILTERS: {"costMin": 100}
✅ "unencrypted s3 buckets" → TARGET: infrastructure, FILTERS: {"resourceType": "s3", "encrypted": false}
✅ "rds databases without backups" → TARGET: infrastructure, FILTERS: {"resourceType": "rds", "hasBackup": false}
✅ "publicly accessible databases" → TARGET: infrastructure, FILTERS: {"resourceType": "rds", "publicAccess": true}
✅ "ec2 instances in production over $200" → TARGET: infrastructure, FILTERS: {"resourceType": "ec2", "costMin": 200}

WRONG ROUTING EXAMPLES (DON'T DO THIS):
❌ "resources over $100" → TARGET: costs
❌ "unencrypted buckets" → TARGET: security
❌ "expensive instances" → TARGET: costs

Remember: If the query mentions a specific resource type OR has filters, use "infrastructure" target!

Synonyms to understand:
- "expensive" = costMin: 100
- "cheap" = costMax: 50
- "unencrypted" or "not encrypted" = encrypted: false
- "public" or "exposed" = publicAccess: true
- "without backups" or "no backups" = hasBackup: false
- "idle" or "unused" = status: "stopped"

IMPORTANT: You can apply MULTIPLE filters for the same page.

Respond ONLY in this exact format:

TARGET: [infrastructure|services|deployments|alerts|costs|teams]
ACTION: [navigate|filter]
FILTERS: [JSON object with filter key-value pairs, or null]
EXPLANATION: [One clear sentence explaining what the user will see]
CONFIDENCE: [high|medium|low]

Examples:

Query: "show me all EC2 instances"
TARGET: infrastructure
ACTION: filter
FILTERS: {"resourceType": "ec2"}
EXPLANATION: Showing all EC2 instances in your infrastructure
CONFIDENCE: high

Query: "ec2 in us-east-1"
TARGET: infrastructure
ACTION: filter
FILTERS: {"resourceType": "ec2", "awsRegion": "us-east-1"}
EXPLANATION: Showing EC2 instances in us-east-1 region
CONFIDENCE: high

Query: "stopped rds databases"
TARGET: infrastructure
ACTION: filter
FILTERS: {"resourceType": "rds", "status": "stopped"}
EXPLANATION: Showing stopped RDS databases
CONFIDENCE: high

Query: "running ec2 instances in us-west-2"
TARGET: infrastructure
ACTION: filter
FILTERS: {"resourceType": "ec2", "status": "running", "awsRegion": "us-west-2"}
EXPLANATION: Showing running EC2 instances in us-west-2
CONFIDENCE: high

Query: "production deployments"
TARGET: deployments
ACTION: filter
FILTERS: {"environment": "production"}
EXPLANATION: Showing all production deployments
CONFIDENCE: high

Query: "failed production deployments"
TARGET: deployments
ACTION: filter
FILTERS: {"environment": "production", "status": "failed"}
EXPLANATION: Showing failed deployments in production
CONFIDENCE: high

Query: "failed services"
TARGET: services
ACTION: filter
FILTERS: {"status": "failed"}
EXPLANATION: Showing services in failed state
CONFIDENCE: high

Query: "critical alerts this week"
TARGET: alerts
ACTION: filter
FILTERS: {"severity": "critical", "dateRange": "7d"}
EXPLANATION: Showing critical alerts from the past 7 days
CONFIDENCE: high

Query: "critical firing alerts"
TARGET: alerts
ACTION: filter
FILTERS: {"severity": "critical", "status": "firing"}
EXPLANATION: Showing critical alerts that are currently firing
CONFIDENCE: high

Query: "warning alerts in the last month"
TARGET: alerts
ACTION: filter
FILTERS: {"severity": "warning", "dateRange": "30d"}
EXPLANATION: Showing warning alerts from the past 30 days
CONFIDENCE: high

Query: "resources costing over $100"
TARGET: infrastructure
ACTION: filter
FILTERS: {"costMin": 100}
EXPLANATION: Showing resources costing more than $100 per month
CONFIDENCE: high

Query: "unencrypted s3 buckets"
TARGET: infrastructure
ACTION: filter
FILTERS: {"resourceType": "s3", "encrypted": false}
EXPLANATION: Showing S3 buckets without encryption
CONFIDENCE: high

Query: "rds databases without backups"
TARGET: infrastructure
ACTION: filter
FILTERS: {"resourceType": "rds", "hasBackup": false}
EXPLANATION: Showing RDS databases without backup enabled
CONFIDENCE: high

Query: "publicly accessible databases"
TARGET: infrastructure
ACTION: filter
FILTERS: {"resourceType": "rds", "publicAccess": true}
EXPLANATION: Showing RDS databases with public access
CONFIDENCE: high

Query: "expensive ec2 in us-east-1"
TARGET: infrastructure
ACTION: filter
FILTERS: {"resourceType": "ec2", "awsRegion": "us-east-1", "costMin": 100}
EXPLANATION: Showing EC2 instances in us-east-1 costing over $100/month
CONFIDENCE: high

Now parse: "${query}"`;
  }

  private parseResponse(response: string, originalQuery: string): NLQueryIntent {
    const lines = response.split('\n').filter((line) => line.trim());

    let target: any = 'infrastructure';
    let action: any = 'navigate';
    let filters: any = null;
    let explanation = `Navigating to ${target}`;
    let confidence: any = 'medium';

    for (const line of lines) {
      if (line.includes('TARGET:')) {
        target = line.replace('TARGET:', '').trim();
      } else if (line.includes('ACTION:')) {
        action = line.replace('ACTION:', '').trim();
      } else if (line.includes('FILTERS:')) {
        const filtersStr = line.replace('FILTERS:', '').trim();
        try {
          filters = filtersStr !== 'null' ? JSON.parse(filtersStr) : null;
        } catch {
          filters = null;
        }
      } else if (line.includes('EXPLANATION:')) {
        explanation = line.replace('EXPLANATION:', '').trim();
      } else if (line.includes('CONFIDENCE:')) {
        confidence = line.replace('CONFIDENCE:', '').trim();
      }
    }

    return {
      action,
      target,
      filters,
      explanation,
      confidence,
    };
  }

  private isKeywordQuery(query: string): boolean {
    // Single word, no spaces, likely a service name
    if (!query.includes(' ') && query.length < 30) {
      return true;
    }
    // Contains special chars typical of IDs
    if (/[_\-.]/.test(query)) {
      return true;
    }
    return false;
  }

  private fallbackParse(query: string): NLQueryIntent {
    const lower = query.toLowerCase();
    const filters: any = {};

    // Detect resource types
    let resourceType: string | undefined;
    if (lower.includes('ec2') || (lower.includes('instance') && !lower.includes('rds'))) {
      resourceType = 'ec2';
    } else if (lower.includes('rds') || lower.includes('database')) {
      resourceType = 'rds';
    } else if (lower.includes('s3') || lower.includes('bucket')) {
      resourceType = 's3';
    } else if (lower.includes('lambda') || lower.includes('function')) {
      resourceType = 'lambda';
    } else if (lower.includes('vpc')) {
      resourceType = 'vpc';
    } else if (lower.includes('cloudfront')) {
      resourceType = 'cloudfront';
    } else if (lower.includes('elb') || lower.includes('load balancer')) {
      resourceType = 'elb';
    }

    // Detect AWS regions
    let awsRegion: string | undefined;
    if (lower.includes('us-east-1') || lower.includes('virginia')) {
      awsRegion = 'us-east-1';
    } else if (lower.includes('us-east-2') || lower.includes('ohio')) {
      awsRegion = 'us-east-2';
    } else if (lower.includes('us-west-1') || lower.includes('california')) {
      awsRegion = 'us-west-1';
    } else if (lower.includes('us-west-2') || lower.includes('oregon')) {
      awsRegion = 'us-west-2';
    } else if (lower.includes('eu-west-1') || lower.includes('ireland')) {
      awsRegion = 'eu-west-1';
    } else if (lower.includes('ap-southeast-1') || lower.includes('singapore')) {
      awsRegion = 'ap-southeast-1';
    }

    // Detect status
    let status: string | undefined;
    if (lower.includes('running')) {
      status = 'running';
    } else if (lower.includes('stopped')) {
      status = 'stopped';
    } else if (lower.includes('terminated')) {
      status = 'terminated';
    } else if (lower.includes('failed') || lower.includes('failing')) {
      status = 'failed';
    } else if (lower.includes('pending')) {
      status = 'pending';
    }

    // Infrastructure queries
    if (resourceType) {
      if (resourceType) filters.resourceType = resourceType;
      if (awsRegion) filters.awsRegion = awsRegion;
      if (status) filters.status = status;

      let explanation = `Showing ${resourceType.toUpperCase()}`;
      if (status) explanation += ` ${status}`;
      if (awsRegion) explanation += ` in ${awsRegion}`;

      return {
        action: 'filter',
        target: 'infrastructure',
        filters,
        explanation,
        confidence: 'medium',
      };
    }

    // Deployment queries
    const deployFilters: any = {};
    let isDeploymentQuery = lower.includes('deploy');

    if (lower.includes('production')) {
      deployFilters.environment = 'production';
      isDeploymentQuery = true;
    } else if (lower.includes('staging')) {
      deployFilters.environment = 'staging';
      isDeploymentQuery = true;
    } else if (lower.includes('development') || lower.includes('dev ')) {
      deployFilters.environment = 'development';
      isDeploymentQuery = true;
    }

    if (status) deployFilters.status = status;

    if (isDeploymentQuery && Object.keys(deployFilters).length > 0) {
      let explanation = 'Showing';
      if (deployFilters.status) explanation += ` ${deployFilters.status}`;
      if (deployFilters.environment) explanation += ` ${deployFilters.environment}`;
      explanation += ' deployments';

      return {
        action: 'filter',
        target: 'deployments',
        filters: deployFilters,
        explanation,
        confidence: 'high',
      };
    }

    // Alert queries
    if (lower.includes('alert') || lower.includes('critical') || lower.includes('warning')) {
      const alertFilters: any = {};

      if (lower.includes('critical')) {
        alertFilters.severity = 'critical';
      } else if (lower.includes('warning')) {
        alertFilters.severity = 'warning';
      }

      if (lower.includes('firing')) {
        alertFilters.status = 'firing';
      } else if (lower.includes('acknowledged')) {
        alertFilters.status = 'acknowledged';
      } else if (lower.includes('resolved')) {
        alertFilters.status = 'resolved';
      }

      if (lower.includes('week') || lower.includes('7')) {
        alertFilters.dateRange = '7d';
      } else if (lower.includes('month') || lower.includes('30')) {
        alertFilters.dateRange = '30d';
      } else if (lower.includes('90')) {
        alertFilters.dateRange = '90d';
      }

      let explanation = 'Showing';
      if (alertFilters.severity) explanation += ` ${alertFilters.severity}`;
      if (alertFilters.status) explanation += ` ${alertFilters.status}`;
      explanation += ' alerts';
      if (alertFilters.dateRange) explanation += ` from past ${alertFilters.dateRange}`;

      return {
        action: Object.keys(alertFilters).length > 0 ? 'filter' : 'navigate',
        target: 'alerts',
        filters: Object.keys(alertFilters).length > 0 ? alertFilters : undefined,
        explanation,
        confidence: 'medium',
      };
    }

    // Cost queries - route to infrastructure with cost filters
    if (lower.includes('cost') || lower.includes('expensive') || lower.includes('cheap')) {
      const costFilters: any = {};

      // Detect cost thresholds
      if (lower.includes('over') || lower.includes('more than') || lower.includes('above') || lower.includes('expensive')) {
        // Extract number if present, default to 100
        const match = lower.match(/\$?(\d+)/);
        costFilters.costMin = match ? parseInt(match[1]) : 100;
      } else if (lower.includes('under') || lower.includes('less than') || lower.includes('below') || lower.includes('cheap')) {
        const match = lower.match(/\$?(\d+)/);
        costFilters.costMax = match ? parseInt(match[1]) : 50;
      }

      // If specific resource type mentioned, include it
      if (resourceType) {
        costFilters.resourceType = resourceType;
      }
      if (awsRegion) {
        costFilters.awsRegion = awsRegion;
      }
      if (status) {
        costFilters.status = status;
      }

      let explanation = 'Showing';
      if (costFilters.costMin) explanation += ` resources costing over $${costFilters.costMin}/month`;
      else if (costFilters.costMax) explanation += ` resources costing under $${costFilters.costMax}/month`;
      else explanation += ' cost information';

      if (costFilters.resourceType) explanation = explanation.replace('resources', `${costFilters.resourceType.toUpperCase()}`);

      return {
        action: 'filter',
        target: 'infrastructure',
        filters: Object.keys(costFilters).length > 0 ? costFilters : undefined,
        explanation,
        confidence: 'medium',
      };
    }

    // Security/compliance queries - route to infrastructure with security filters
    if (lower.includes('encrypt') || lower.includes('public') || lower.includes('exposed') ||
        lower.includes('backup') || lower.includes('vulnerable') || lower.includes('secure')) {
      const securityFilters: any = {};

      // Detect encryption status
      if (lower.includes('unencrypt') || lower.includes('not encrypt') || lower.includes('without encrypt')) {
        securityFilters.encrypted = false;
      } else if (lower.includes('encrypt')) {
        securityFilters.encrypted = true;
      }

      // Detect public access
      if (lower.includes('public') || lower.includes('exposed') || lower.includes('accessible')) {
        securityFilters.publicAccess = true;
      }

      // Detect backup status
      if (lower.includes('without backup') || lower.includes('no backup')) {
        securityFilters.hasBackup = false;
      } else if (lower.includes('backup')) {
        securityFilters.hasBackup = true;
      }

      // If specific resource type mentioned, include it
      if (resourceType) {
        securityFilters.resourceType = resourceType;
      }
      if (awsRegion) {
        securityFilters.awsRegion = awsRegion;
      }
      if (status) {
        securityFilters.status = status;
      }

      let explanation = 'Showing';
      if (securityFilters.encrypted === false) explanation += ' unencrypted';
      else if (securityFilters.encrypted === true) explanation += ' encrypted';
      if (securityFilters.publicAccess) explanation += ' publicly accessible';
      if (securityFilters.hasBackup === false) explanation += ' resources without backups';
      else if (securityFilters.hasBackup === true) explanation += ' resources with backups';

      if (securityFilters.resourceType) {
        explanation += ` ${securityFilters.resourceType.toUpperCase()}`;
      } else {
        explanation += ' resources';
      }

      return {
        action: 'filter',
        target: 'infrastructure',
        filters: Object.keys(securityFilters).length > 0 ? securityFilters : undefined,
        explanation,
        confidence: 'medium',
      };
    }

    // General spending/bill queries (no specific filters) - navigate to dashboard
    if (lower.includes('spending') || lower.includes('bill') || lower.includes('total cost')) {
      return {
        action: 'navigate',
        target: 'costs',
        filters: undefined,
        explanation: 'Navigating to cost analysis',
        confidence: 'low',
      };
    }

    // Deployment queries (general)
    if (lower.includes('deploy')) {
      return {
        action: 'navigate',
        target: 'deployments',
        filters: undefined,
        explanation: 'Navigating to deployments',
        confidence: 'low',
      };
    }

    // Infrastructure queries (general)
    if (lower.includes('infrastructure') || lower.includes('resource')) {
      return {
        action: 'navigate',
        target: 'infrastructure',
        filters: undefined,
        explanation: 'Navigating to infrastructure',
        confidence: 'low',
      };
    }

    // Default: go to services
    return {
      action: 'navigate',
      target: 'services',
      filters: undefined,
      explanation: 'Searching services',
      confidence: 'low',
    };
  }

  private extractTextContent(content: any[]): string {
    const textBlock = content.find((block: any) => block.type === 'text');
    return textBlock ? textBlock.text : '';
  }
}
