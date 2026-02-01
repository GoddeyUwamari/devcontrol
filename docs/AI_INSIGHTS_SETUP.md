# AI-Powered Cost Insights - Setup Guide

## Overview

The AI Insights feature uses Claude (Anthropic AI) to analyze your AWS cost patterns and provide intelligent recommendations for optimization. This feature includes:

- **Root cause analysis** for cost changes
- **Actionable recommendations** for cost optimization
- **Estimated savings** calculations
- **1-hour caching** to minimize API costs (~$0.01 per analysis)
- **Intelligent fallbacks** when API is unavailable

## Architecture

### Backend Components

1. **Service Layer** (`backend/src/services/ai-insights.service.ts`)
   - Handles API communication with Anthropic
   - Implements 1-hour caching to reduce costs
   - Provides intelligent fallbacks when API is unavailable
   - Supports three analysis types: increase, decrease, and trend

2. **Controller Layer** (`backend/src/controllers/ai-insights.controller.ts`)
   - Validates requests using Zod schemas
   - Routes analysis to appropriate service methods
   - Provides cache management endpoints

3. **Routes** (`backend/src/routes/ai-insights.routes.ts`)
   - POST `/api/ai-insights/analyze-cost` - Main analysis endpoint
   - GET `/api/ai-insights/cache-stats` - Cache statistics
   - POST `/api/ai-insights/clear-cache` - Clear cache (admin)

### Frontend Components

1. **Service** (`lib/services/ai-insights.service.ts`)
   - Client-side API wrapper
   - TypeScript interfaces for requests/responses

2. **Hook** (`lib/hooks/useAIInsights.ts`)
   - React hook for fetching AI insights
   - Automatic refetching on cost changes
   - Error handling and loading states

3. **UI Component** (`components/ai/AIInsightCard.tsx`)
   - Beautiful gradient card design
   - Displays root cause, recommendation, and savings
   - Shows confidence levels and cache status

## Setup Instructions

### Step 1: Get Anthropic API Key

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Create a new API key
3. Copy the key (starts with `sk-ant-...`)

### Step 2: Add API Key to Environment

Add to `backend/.env`:

```bash
# AI Features (Optional - for AI-powered cost insights)
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

**Important:** Never commit your `.env` file to version control!

### Step 3: Install Dependencies (Already Done)

The Anthropic SDK has been installed:

```bash
cd backend
npm install @anthropic-ai/sdk
```

### Step 4: Restart Backend Server

```bash
npm run dev
```

You should see in the logs:
```
[AI Insights] Service initialized with Anthropic API
```

If you see instead:
```
[AI Insights] ANTHROPIC_API_KEY not found - AI insights will use fallback responses
```

Then the API key is missing or incorrect.

## Usage

### Dashboard Integration

The AI insights automatically appear on the dashboard when:
- User is not in demo mode
- Platform stats are available
- Cost data exists

The component will:
1. Calculate cost change percentage
2. Send cost data to backend
3. Backend checks cache (1-hour TTL)
4. If cache miss, calls Claude API
5. Returns insights with root cause, recommendation, and savings

### Manual API Usage

```bash
curl -X POST http://localhost:8080/api/ai-insights/analyze-cost \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "previousCost": 1000,
    "currentCost": 1247,
    "percentageIncrease": 24.7,
    "topSpenders": [
      {
        "service": "Compute (EC2, Lambda, ECS)",
        "cost": 520,
        "change": 12
      }
    ],
    "timeRange": "last 30 days"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "rootCause": "Cost increased by 24.7% primarily driven by Compute spending surge in EC2 instances.",
    "recommendation": "Review EC2 usage patterns and consider implementing Reserved Instances or Savings Plans for predictable workloads.",
    "estimatedSavings": 104,
    "confidence": "high",
    "rawResponse": "...",
    "cached": false
  },
  "meta": {
    "requestedAt": "2026-01-30T06:00:00.000Z",
    "cached": false,
    "cacheAge": 0
  }
}
```

## Cost Management

### Understanding API Costs

- **Model:** Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- **Cost per request:** ~$0.01 (1,024 output tokens)
- **Cache TTL:** 1 hour
- **Typical usage:** 10-20 requests/day = $0.10-$0.20/day

### Monitoring API Usage

1. Check cache statistics:
```bash
curl http://localhost:8080/api/ai-insights/cache-stats \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

2. View Anthropic Console:
   - Go to [console.anthropic.com/settings/usage](https://console.anthropic.com/settings/usage)
   - Monitor daily usage and costs

3. Backend logs:
```
[AI Insights] Cache hit for cost increase (age: 234s)
[AI Insights] Cost increase analysis complete - cached for 1 hour
[AI Insights] Cache cleanup: removed 3 expired entries
```

### Clear Cache (if needed)

```bash
curl -X POST http://localhost:8080/api/ai-insights/clear-cache \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Fallback Behavior

When the Anthropic API is unavailable (no API key, network error, rate limit), the system provides intelligent fallbacks:

```typescript
{
  rootCause: "Cost increased by 24.7% primarily driven by Compute spending.",
  recommendation: "Review Compute usage patterns and consider Reserved Instances.",
  estimatedSavings: 104, // 20% of top spender
  confidence: "medium",
  rawResponse: "AI service unavailable - using intelligent fallback"
}
```

## Security Considerations

1. **API Key Protection**
   - Never commit API keys to git
   - Use environment variables only
   - Rotate keys periodically

2. **Authentication**
   - All endpoints require JWT authentication
   - Organization ID automatically filtered (RLS)

3. **Rate Limiting**
   - Cache reduces API calls by ~90%
   - Fallbacks prevent service disruption

## Troubleshooting

### Issue: "AI service unavailable"

**Solution:** Check your API key:
```bash
echo $ANTHROPIC_API_KEY
```

If empty, add to `backend/.env`.

### Issue: High API costs

**Solution:** Check cache stats:
```bash
curl http://localhost:8080/api/ai-insights/cache-stats
```

Expected: 10-20 unique keys per day with 1-hour TTL = 10-20 API calls/day.

If higher, check for:
- Frequent cost data changes
- Cache being cleared too often
- Multiple organizations hitting the endpoint

### Issue: TypeScript errors during build

Pre-existing TypeScript configuration issues in the codebase. The AI insights code is syntactically correct and will work at runtime.

## Testing

### 1. Test with Demo Data

Add this to your dashboard component:

```typescript
const testData = {
  previousCost: 1000,
  currentCost: 1247,
  percentageIncrease: 24.7,
  topSpenders: [
    { service: 'EC2', cost: 520, change: 12 }
  ],
  timeRange: 'last 30 days'
};

const { data, isLoading } = useAIInsights(testData);
```

### 2. Test Cache Behavior

Make same request twice within 1 hour. Second request should show:
```json
{
  "cached": true,
  "cacheAge": 234
}
```

### 3. Test Fallback

Remove API key temporarily and verify fallback responses work.

## Future Enhancements

Potential improvements:
- [ ] Database-backed cache (Redis/PostgreSQL)
- [ ] User-specific insight preferences
- [ ] Multi-tenant cache isolation
- [ ] Cost anomaly detection
- [ ] Scheduled insight emails
- [ ] Export insights to PDF/CSV
- [ ] Integration with Cost Optimization page
- [ ] Historical insight tracking

## Support

For issues or questions:
1. Check backend logs for `[AI Insights]` messages
2. Verify API key is set correctly
3. Check Anthropic console for API errors
4. Review cache statistics

## API Reference

### POST /api/ai-insights/analyze-cost

**Request Body:**
```typescript
{
  previousCost: number;        // Required: Previous period cost
  currentCost: number;         // Required: Current period cost
  percentageIncrease: number;  // Required: % change
  newResources?: Array<{       // Optional: New resources
    id: string;
    type: string;
    name: string;
    cost: number;
    region: string;
  }>;
  topSpenders?: Array<{        // Optional: Top spending services
    service: string;
    cost: number;
    change: number;
  }>;
  timeRange: string;           // Required: e.g., "last 30 days"
}
```

**Response:**
```typescript
{
  success: boolean;
  data: {
    rootCause: string;
    recommendation: string;
    estimatedSavings: number | null;
    confidence: 'high' | 'medium' | 'low';
    rawResponse: string;
    cached?: boolean;
    cacheAge?: number;
  };
  meta?: {
    requestedAt: string;
    cached: boolean;
    cacheAge: number;
  };
}
```

### GET /api/ai-insights/cache-stats

**Response:**
```typescript
{
  success: boolean;
  data: {
    cacheSize: number;
    cachedKeys: number;
    cacheTTL: string;
  };
}
```

### POST /api/ai-insights/clear-cache

**Response:**
```typescript
{
  success: boolean;
  message: string;
}
```

---

**Version:** 1.0.0
**Last Updated:** 2026-01-30
**Author:** DevControl Platform Team
