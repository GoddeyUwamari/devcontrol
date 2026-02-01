# AI-Powered Auto-Generated Reports - Implementation Guide

## ✅ Completed: Phase 1 - Backend Service

**File Created:** `backend/src/services/ai-report-generator.service.ts`

This service provides:
- ✅ AI-powered report generation using Claude API
- ✅ Fallback report generation when AI unavailable
- ✅ Report data structure with costs, security, deployments, resources, alerts
- ✅ Database save/fetch functionality
- ✅ Mock data fetching (ready for real implementation)

---

## 🚀 Quick Start Guide

### Test Report Generation

```typescript
import { AIReportGeneratorService } from './services/ai-report-generator.service';
import { pool } from './config/database';

const service = new AIReportGeneratorService(pool);

// Fetch data (currently returns mock data)
const data = await service.fetchReportData(organizationId, {
  from: '2026-01-24',
  to: '2026-01-31'
});

// Generate report
const report = await service.generateWeeklyReport(data);

// Save to database
const reportId = await service.saveGeneratedReport(
  organizationId,
  report,
  data.dateRange
);
```

---

## 📋 Next Steps to Complete Feature

### Phase 2: Database Schema (15 minutes)

Create: `database/migrations/016_create_ai_reports.sql`

```sql
-- Scheduled reports configuration
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,

  frequency VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'monthly'
  day_of_week INTEGER, -- 0-6 for weekly (0 = Sunday)
  day_of_month INTEGER, -- 1-31 for monthly
  time_of_day TIME NOT NULL DEFAULT '09:00:00',
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',

  recipients JSONB NOT NULL DEFAULT '[]',
  report_types JSONB NOT NULL DEFAULT '["executive", "cost", "security"]',

  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMP WITH TIME ZONE,
  next_scheduled_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

-- Generated reports history
CREATE TABLE IF NOT EXISTS generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheduled_report_id UUID REFERENCES scheduled_reports(id) ON DELETE SET NULL,

  report_type VARCHAR(50) NOT NULL,
  date_range_from DATE NOT NULL,
  date_range_to DATE NOT NULL,

  report_data JSONB NOT NULL,

  sent_to JSONB,
  sent_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_scheduled_reports_org ON scheduled_reports(organization_id);
CREATE INDEX idx_scheduled_reports_next_run ON scheduled_reports(next_scheduled_at) WHERE enabled = true;
CREATE INDEX idx_generated_reports_org ON generated_reports(organization_id);
CREATE INDEX idx_generated_reports_date ON generated_reports(date_range_to DESC);
```

Run migration:
```bash
cd backend
psql $DATABASE_URL < database/migrations/016_create_ai_reports.sql
```

### Phase 3: Backend Controllers & Routes (30 minutes)

Create: `backend/src/controllers/ai-reports.controller.ts`

```typescript
import { Request, Response } from 'express';
import { AIReportGeneratorService } from '../services/ai-report-generator.service';
import { pool } from '../config/database';

const service = new AIReportGeneratorService(pool);

export class AIReportsController {
  // Generate report on-demand
  async generateReport(req: Request, res: Response) {
    try {
      const { dateRange } = req.body;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      // Fetch data
      const data = await service.fetchReportData(organizationId, dateRange || {
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0]
      });

      // Generate report
      const report = await service.generateWeeklyReport(data);

      // Save to database
      const reportId = await service.saveGeneratedReport(organizationId, report, data.dateRange);

      return res.json({
        success: true,
        data: {
          ...report,
          reportId
        }
      });

    } catch (error: any) {
      console.error('Generate report error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate report'
      });
    }
  }

  // Get report history
  async getReportHistory(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      const { limit = 10 } = req.query;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const reports = await service.fetchReportHistory(organizationId, Number(limit));

      return res.json({
        success: true,
        data: reports
      });

    } catch (error: any) {
      console.error('Get report history error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch report history'
      });
    }
  }

  // Get single report
  async getReport(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const result = await pool.query(
        `SELECT * FROM generated_reports
         WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Report not found'
        });
      }

      return res.json({
        success: true,
        data: result.rows[0]
      });

    } catch (error: any) {
      console.error('Get report error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch report'
      });
    }
  }
}

export const aiReportsController = new AIReportsController();
```

Create: `backend/src/routes/ai-reports.routes.ts`

```typescript
import express from 'express';
import { authenticate as authenticateToken } from '../middleware/auth.middleware';
import { aiReportsController } from '../controllers/ai-reports.controller';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Generate report on-demand
router.post('/generate', aiReportsController.generateReport);

// Get report history
router.get('/history', aiReportsController.getReportHistory);

// Get single report
router.get('/:id', aiReportsController.getReport);

export default router;
```

Update: `backend/src/routes/index.ts`

```typescript
import aiReportsRoutes from './ai-reports.routes';

// Add with other routes
router.use('/ai-reports', aiReportsRoutes);
```

### Phase 4: Frontend Service (20 minutes)

Create: `lib/services/ai-reports.service.ts`

```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface GenerateReportRequest {
  dateRange?: {
    from: string;
    to: string;
  };
}

class AIReportsServiceClient {
  async generateReport(data: GenerateReportRequest) {
    const token = localStorage.getItem('accessToken');

    const response = await fetch(`${API_BASE_URL}/api/ai-reports/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to generate report');
    }

    return response.json();
  }

  async getReportHistory(limit: number = 10) {
    const token = localStorage.getItem('accessToken');

    const response = await fetch(
      `${API_BASE_URL}/api/ai-reports/history?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch report history');
    }

    return response.json();
  }

  async getReport(id: string) {
    const token = localStorage.getItem('accessToken');

    const response = await fetch(`${API_BASE_URL}/api/ai-reports/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch report');
    }

    return response.json();
  }
}

export const aiReportsService = new AIReportsServiceClient();
```

### Phase 5: Frontend Reports Page (45 minutes)

Create: `app/(app)/ai-reports/page.tsx`

```typescript
'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { FileText, Download, Clock, TrendingUp, Shield, Sparkles, Loader2 } from 'lucide-react'
import { aiReportsService } from '@/lib/services/ai-reports.service'
import { toast } from 'sonner'

export default function AIReportsPage() {
  const [isGenerating, setIsGenerating] = useState(false)

  const { data: historyData, refetch } = useQuery({
    queryKey: ['ai-reports-history'],
    queryFn: () => aiReportsService.getReportHistory(10),
  })

  const handleGenerateReport = async () => {
    setIsGenerating(true)
    try {
      const result = await aiReportsService.generateReport({
        dateRange: {
          from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          to: new Date().toISOString().split('T')[0],
        },
      })

      toast.success('Report generated successfully!', {
        description: 'Your AI-powered infrastructure report is ready.',
      })

      refetch()
    } catch (error) {
      toast.error('Failed to generate report', {
        description: error.message,
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const reports = historyData?.data || []

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">AI-Generated Reports</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Automated infrastructure insights and executive summaries powered by AI
        </p>
      </div>

      {/* Hero Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{reports.length}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Reports Generated</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">AI</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Powered Analysis</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">Weekly</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Automated</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Generate Button */}
      <div>
        <Button onClick={handleGenerateReport} size="lg" disabled={isGenerating}>
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Report...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Report Now
            </>
          )}
        </Button>
      </div>

      {/* Report Types */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center mb-4">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <CardTitle>Executive Summary</CardTitle>
            <CardDescription>
              High-level overview for leadership with key metrics and trends
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Cost trends and analysis</li>
              <li>• Security posture score</li>
              <li>• DORA metrics overview</li>
              <li>• Top 5 recommendations</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/20 flex items-center justify-center mb-4">
              <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>Cost Analysis</CardTitle>
            <CardDescription>
              Detailed cost breakdown with optimization opportunities
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Cost by service category</li>
              <li>• Trend analysis</li>
              <li>• Unused resources</li>
              <li>• Savings recommendations</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/20 flex items-center justify-center mb-4">
              <Shield className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle>Security Report</CardTitle>
            <CardDescription>
              Compliance status and security risk analysis
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>• Critical vulnerabilities</li>
              <li>• Compliance status</li>
              <li>• Risk score trends</li>
              <li>• Remediation steps</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Report History */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Reports</CardTitle>
          <CardDescription>View past AI-generated reports</CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No reports generated yet</p>
              <p className="text-sm mt-2">Click "Generate Report Now" to create your first AI-powered report</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map((report: any) => (
                <div
                  key={report.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center gap-4">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <div>
                      <div className="font-medium">{report.report_type} Report</div>
                      <div className="text-sm text-gray-500">
                        {new Date(report.date_range_from).toLocaleDateString()} -{' '}
                        {new Date(report.date_range_to).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">
                      {new Date(report.created_at).toLocaleDateString()}
                    </span>
                    <Button variant="ghost" size="sm">
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

---

## 🧪 Testing Guide

### 1. Test Backend Report Generation

```bash
# Start backend
cd backend && npm run dev

# Test API endpoint
curl -X POST http://localhost:8080/api/ai-reports/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dateRange": {"from": "2026-01-24", "to": "2026-01-31"}}'
```

### 2. Test Frontend

```bash
# Start frontend
npm run dev

# Navigate to http://localhost:3000/ai-reports
# Click "Generate Report Now"
# Verify report appears in history
```

### 3. Verify Report Quality

Check generated report includes:
- ✅ Executive summary (2-3 sentences)
- ✅ Key highlights (3-5 bullet points)
- ✅ Cost analysis with trends
- ✅ Security analysis with risks
- ✅ Performance analysis with DORA metrics
- ✅ Top recommendations with estimated impact

---

## 📊 Expected Report Structure

```json
{
  "summary": "Infrastructure costs increased by 11.1% to $5,000/month...",
  "keyHighlights": [
    "AWS spending increased by 11.1% ($500)",
    "2 critical security issues require attention",
    ...
  ],
  "costAnalysis": {
    "overview": "AWS costs are currently $5,000/month...",
    "trends": "Cost growth of 11.1% observed...",
    "recommendations": [...]
  },
  "securityAnalysis": {...},
  "performanceAnalysis": {...},
  "topRecommendations": [{
    "title": "Optimize Unused Resources",
    "impact": "high",
    "description": "Remove or rightsize 2 unused resources",
    "estimatedSavings": 80,
    "effort": "low"
  }],
  "executiveSummary": "This week's infrastructure performance..."
}
```

---

## 🚀 Production Deployment Checklist

- [ ] Database migration applied
- [ ] ANTHROPIC_API_KEY set in environment
- [ ] Backend routes registered
- [ ] Frontend page accessible at `/ai-reports`
- [ ] Test report generation end-to-end
- [ ] Verify report saves to database
- [ ] Check report history displays correctly
- [ ] Confirm AI analysis is insightful
- [ ] Test fallback report (without API key)

---

## 🎯 Success Criteria

✅ Reports generate in <5 seconds
✅ AI analysis is insightful and actionable
✅ Reports save to database correctly
✅ History is viewable
✅ No errors in console
✅ Fallback works when AI unavailable

---

## 📝 Future Enhancements

1. **Scheduled Reports** - Cron job for weekly/monthly auto-generation
2. **Email Delivery** - Send reports via email to stakeholders
3. **PDF Export** - Download reports as PDF
4. **Custom Date Ranges** - User-selectable reporting periods
5. **Report Templates** - Cost-only, security-only, exec-only templates
6. **Sharing** - Share reports with team members
7. **Trending** - Compare multiple reports over time

---

The core feature is now implemented! Test it out and let me know if you need help with any of the remaining phases.
