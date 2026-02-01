'use client'

import { useState, useEffect } from 'react'
import { useAIReports } from '@/lib/hooks/useAIReports'
import { GeneratedReport, ReportHistoryItem } from '@/lib/services/ai-reports.service'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Sparkles, TrendingUp, Shield, Rocket, AlertCircle, Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

export default function AIReportsPage() {
  const { generateReport, getReportHistory, deleteReport, isGenerating, isFetchingHistory, error } = useAIReports()
  const [currentReport, setCurrentReport] = useState<GeneratedReport | null>(null)
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([])

  // Fetch report history on mount
  useEffect(() => {
    loadReportHistory()
  }, [])

  const loadReportHistory = async () => {
    const history = await getReportHistory(10)
    setReportHistory(history)
  }

  const handleGenerateReport = async () => {
    toast.info('Generating AI report...', {
      icon: <Sparkles className="h-4 w-4 animate-pulse" />
    })

    const report = await generateReport({
      dateRange: {
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0]
      },
      reportType: 'weekly_summary'
    })

    if (report) {
      setCurrentReport(report)
      toast.success('Report generated successfully!', {
        icon: <Sparkles className="h-4 w-4" />
      })
      loadReportHistory()
    } else {
      toast.error(error || 'Failed to generate report')
    }
  }

  const handleDeleteReport = async (reportId: string) => {
    const success = await deleteReport(reportId)
    if (success) {
      toast.success('Report deleted')
      loadReportHistory()
      if (currentReport?.reportId === reportId) {
        setCurrentReport(null)
      }
    } else {
      toast.error('Failed to delete report')
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-purple-600" />
            AI-Powered Reports
          </h1>
          <p className="text-muted-foreground mt-2">
            Automatic executive summaries and insights powered by Claude AI
          </p>
        </div>
        <Button
          onClick={handleGenerateReport}
          disabled={isGenerating}
          size="lg"
          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Report
            </>
          )}
        </Button>
      </div>

      {/* Current Report */}
      {currentReport && (
        <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Latest Report</span>
              {currentReport.metadata && (
                <span className="text-xs font-normal text-muted-foreground">
                  Generated in {currentReport.metadata.generationTime}ms
                  {currentReport.metadata.wasFallback && ' (Fallback)'}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Executive Summary */}
            <div>
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-600" />
                Executive Summary
              </h3>
              <p className="text-sm leading-relaxed">{currentReport.executive_summary}</p>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-white p-4 rounded-lg border">
                <div className="text-2xl font-bold">${currentReport.key_metrics.totalCost.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Cost</div>
                <div className="text-xs text-green-600">{currentReport.key_metrics.costChange}</div>
              </div>
              <div className="bg-white p-4 rounded-lg border">
                <div className="text-2xl font-bold">{currentReport.key_metrics.securityScore}</div>
                <div className="text-xs text-muted-foreground">Security Score</div>
              </div>
              <div className="bg-white p-4 rounded-lg border">
                <div className="text-2xl font-bold">{currentReport.key_metrics.deploymentCount}</div>
                <div className="text-xs text-muted-foreground">Deployments</div>
              </div>
              <div className="bg-white p-4 rounded-lg border">
                <div className="text-2xl font-bold">{currentReport.key_metrics.resourceCount}</div>
                <div className="text-xs text-muted-foreground">Resources</div>
              </div>
              <div className="bg-white p-4 rounded-lg border">
                <div className="text-2xl font-bold">{currentReport.alerts_summary.critical}</div>
                <div className="text-xs text-muted-foreground">Critical Alerts</div>
              </div>
            </div>

            {/* Top Recommendations */}
            {currentReport.recommendations.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-blue-600" />
                  Top Recommendations
                </h3>
                <div className="space-y-2">
                  {currentReport.recommendations.slice(0, 3).map((rec, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-lg border flex items-start gap-3">
                      <div className={`mt-0.5 ${
                        rec.priority === 'high' ? 'text-red-600' :
                        rec.priority === 'medium' ? 'text-yellow-600' :
                        'text-blue-600'
                      }`}>
                        {rec.category === 'cost' ? <TrendingUp className="h-4 w-4" /> :
                         rec.category === 'security' ? <Shield className="h-4 w-4" /> :
                         <AlertCircle className="h-4 w-4" />}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm">{rec.title}</div>
                        <div className="text-xs text-muted-foreground">{rec.description}</div>
                        <div className="text-xs text-green-600 mt-1">{rec.estimated_impact}</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        rec.priority === 'high' ? 'bg-red-100 text-red-700' :
                        rec.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {rec.priority}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Report History */}
      <Card>
        <CardHeader>
          <CardTitle>Report History</CardTitle>
          <CardDescription>Previously generated AI reports</CardDescription>
        </CardHeader>
        <CardContent>
          {isFetchingHistory ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : reportHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>No reports yet. Generate your first AI-powered report!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reportHistory.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="font-medium text-sm">
                      {item.report_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(item.date_range_from)} - {formatDate(item.date_range_to)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(item.created_at)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCurrentReport(item.report_data)}
                    >
                      View
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteReport(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
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
