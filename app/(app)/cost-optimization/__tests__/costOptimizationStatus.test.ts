import { describe, it, expect } from 'vitest'
import { deriveAnalysisStatus, pickLatestAnalysis } from '../costOptimizationStatus'

const discoveryJob = (overrides: Partial<{
  status: 'pending' | 'running' | 'completed' | 'failed'
  cost_analysis_completed: boolean
  completed_at: string | null
  error_message: string | null
  created_at: string
}> = {}) => ({
  status: 'completed' as const,
  cost_analysis_completed: true,
  completed_at: '2026-09-06T00:00:00Z',
  error_message: null,
  created_at: '2026-09-06T00:00:00Z',
  ...overrides,
})

const analysisRun = (overrides: Partial<{
  status: 'running' | 'completed' | 'failed'
  completed_at: string | null
  error_message: string | null
  created_at: string
}> = {}) => ({
  status: 'completed' as const,
  completed_at: '2026-09-06T00:00:00Z',
  error_message: null,
  created_at: '2026-09-06T00:00:00Z',
  ...overrides,
})

describe('pickLatestAnalysis', () => {
  it('returns undefined when neither source has ever run', () => {
    expect(pickLatestAnalysis({})).toBeUndefined()
  })

  it('returns the scheduled job normalized when only it exists', () => {
    const result = pickLatestAnalysis({ latestDiscoveryJob: discoveryJob() })
    expect(result).toEqual({ source: 'scheduled', status: 'completed', completedAt: '2026-09-06T00:00:00Z', errorMessage: null })
  })

  it('returns the manual run normalized when only it exists', () => {
    const result = pickLatestAnalysis({ latestAnalysisRun: analysisRun() })
    expect(result).toEqual({ source: 'manual', status: 'completed', completedAt: '2026-09-06T00:00:00Z', errorMessage: null })
  })

  it('picks whichever of the two is more recent by created_at -- manual newer', () => {
    const result = pickLatestAnalysis({
      latestDiscoveryJob: discoveryJob({ created_at: '2026-09-05T18:00:00Z' }),
      latestAnalysisRun: analysisRun({ created_at: '2026-09-06T02:00:00Z' }),
    })
    expect(result?.source).toBe('manual')
  })

  it('picks whichever of the two is more recent by created_at -- scheduled newer', () => {
    const result = pickLatestAnalysis({
      latestDiscoveryJob: discoveryJob({ created_at: '2026-09-06T06:00:00Z' }),
      latestAnalysisRun: analysisRun({ created_at: '2026-09-06T02:00:00Z' }),
    })
    expect(result?.source).toBe('scheduled')
  })

  it('normalizes a discovery job with status="pending" to "running"', () => {
    const result = pickLatestAnalysis({ latestDiscoveryJob: discoveryJob({ status: 'pending', completed_at: null }) })
    expect(result?.status).toBe('running')
  })

  it('normalizes a "completed" discovery job whose cost analysis specifically never finished to "failed"', () => {
    const result = pickLatestAnalysis({ latestDiscoveryJob: discoveryJob({ status: 'completed', cost_analysis_completed: false }) })
    expect(result?.status).toBe('failed')
  })
})

describe('deriveAnalysisStatus', () => {
  it('is "loading" while the AWS-connection check is still in flight', () => {
    expect(deriveAnalysisStatus({ awsConnected: undefined, latestAnalysis: undefined, activeCount: 0, totalEverCount: 0 })).toBe('loading')
  })

  it('is "not_connected" when there is no AWS account, regardless of analysis history', () => {
    expect(deriveAnalysisStatus({ awsConnected: false, latestAnalysis: { source: 'manual', status: 'completed', completedAt: '2026-09-06T00:00:00Z', errorMessage: null }, activeCount: 3, totalEverCount: 3 })).toBe('not_connected')
  })

  it('is "never_analyzed" when AWS is connected but neither source has ever run', () => {
    expect(deriveAnalysisStatus({ awsConnected: true, latestAnalysis: undefined, activeCount: 0, totalEverCount: 0 })).toBe('never_analyzed')
  })

  it('is "in_progress" for a running analysis, scheduled or manual', () => {
    expect(deriveAnalysisStatus({ awsConnected: true, latestAnalysis: { source: 'manual', status: 'running', completedAt: null, errorMessage: null }, activeCount: 0, totalEverCount: 0 })).toBe('in_progress')
  })

  it('is "failed" when the latest analysis (whichever source) failed', () => {
    expect(deriveAnalysisStatus({ awsConnected: true, latestAnalysis: { source: 'scheduled', status: 'failed', completedAt: '2026-09-06T00:00:00Z', errorMessage: 'boom' }, activeCount: 0, totalEverCount: 0 })).toBe('failed')
  })

  it('is "completed_with_opportunities" when the latest analysis succeeded and active recommendations exist', () => {
    expect(deriveAnalysisStatus({ awsConnected: true, latestAnalysis: { source: 'manual', status: 'completed', completedAt: '2026-09-06T00:00:00Z', errorMessage: null }, activeCount: 7, totalEverCount: 7 })).toBe('completed_with_opportunities')
  })

  it('is "completed_all_resolved" when the latest analysis succeeded, nothing is active, but recommendations existed historically', () => {
    expect(deriveAnalysisStatus({ awsConnected: true, latestAnalysis: { source: 'scheduled', status: 'completed', completedAt: '2026-09-06T00:00:00Z', errorMessage: null }, activeCount: 0, totalEverCount: 5 })).toBe('completed_all_resolved')
  })

  it('is "completed_clean" when the latest analysis succeeded and nothing has ever been found', () => {
    expect(deriveAnalysisStatus({ awsConnected: true, latestAnalysis: { source: 'manual', status: 'completed', completedAt: '2026-09-06T00:00:00Z', errorMessage: null }, activeCount: 0, totalEverCount: 0 })).toBe('completed_clean')
  })
})
