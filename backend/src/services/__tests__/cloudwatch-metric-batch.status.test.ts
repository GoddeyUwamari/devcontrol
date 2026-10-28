/**
 * OB2: fetchMetricDataBatchWithStatus() -- how each GetMetricData query ended,
 * which fetchMetricDataBatch()'s `null` cannot say. Pure mechanics, like
 * cloudwatch-metric-batch.util.test.ts.
 *
 * Proves: Forbidden is access_denied, never empty; InternalError, PartialData,
 * a missing Id and an Id that spans NextToken pages are query_failed; a
 * throttled or refused request marks every query in that request only;
 * Complete with no values is empty (a completed query); and the `results` map
 * is exactly what fetchMetricDataBatch() returns for the same responses.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch'
import { fetchMetricDataBatch, fetchMetricDataBatchWithStatus, BatchMetricQuery } from '../cloudwatch-metric-batch.util'

const startTime = new Date('2026-01-01T00:00:00Z')
const endTime = new Date('2026-01-01T01:00:00Z')
const t1 = new Date('2026-01-01T00:10:00Z')
const t2 = new Date('2026-01-01T00:40:00Z')

function client(send: jest.Mock): CloudWatchClient {
  const c = new CloudWatchClient({ region: 'us-east-1' })
  ;(c as any).send = send
  return c
}

function query(id: string): BatchMetricQuery {
  return { id, namespace: 'AWS/EC2', metricName: 'CPUUtilization', dimensions: [{ Name: 'InstanceId', Value: 'i-test' }], period: 300, stat: 'Average' }
}

const awsError = (name: string) => Object.assign(new Error(name), { name, $metadata: {} })

describe('fetchMetricDataBatchWithStatus', () => {
  it('(T1) Forbidden is access_denied; a sibling with values is complete with its newest timestamp', async () => {
    const send = jest.fn().mockResolvedValue({
      MetricDataResults: [
        { Id: 'a', StatusCode: 'Forbidden', Values: [], Timestamps: [] },
        { Id: 'b', StatusCode: 'Complete', Values: [1, 2], Timestamps: [t1, t2] },
      ],
    })
    const { statuses } = await fetchMetricDataBatchWithStatus(client(send), [query('a'), query('b')], startTime, endTime)
    expect(statuses.get('a')).toEqual({ outcome: 'access_denied', newestTimestamp: null })
    expect(statuses.get('b')).toEqual({ outcome: 'complete', newestTimestamp: t2 })
  })

  it('(T2) InternalError is query_failed', async () => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [{ Id: 'a', StatusCode: 'InternalError', Values: [], Timestamps: [] }] })
    const { statuses } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(statuses.get('a')?.outcome).toBe('query_failed')
  })

  it('(T3) a throttled request marks every query in its chunk throttled, and no other chunk', async () => {
    const queries = Array.from({ length: 501 }, (_, i) => query(`q${i}`))
    const send = jest
      .fn()
      .mockRejectedValueOnce(awsError('ThrottlingException'))
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'q500', StatusCode: 'Complete', Values: [3], Timestamps: [t1] }] })
    const { statuses } = await fetchMetricDataBatchWithStatus(client(send), queries, startTime, endTime)
    expect(send).toHaveBeenCalledTimes(2)
    expect(statuses.get('q0')?.outcome).toBe('throttled')
    expect(statuses.get('q499')?.outcome).toBe('throttled')
    expect(statuses.get('q500')?.outcome).toBe('complete')
  })

  it('(T4) a refused request is access_denied; any other failure is query_failed', async () => {
    const denied = await fetchMetricDataBatchWithStatus(client(jest.fn().mockRejectedValue(awsError('AccessDeniedException'))), [query('a')], startTime, endTime)
    expect(denied.statuses.get('a')?.outcome).toBe('access_denied')
    const broken = await fetchMetricDataBatchWithStatus(client(jest.fn().mockRejectedValue(new Error('socket hang up'))), [query('a')], startTime, endTime)
    expect(broken.statuses.get('a')?.outcome).toBe('query_failed')
  })

  it('(T5) Complete with no values is empty: the query completed and found nothing', async () => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [], Timestamps: [] }] })
    const { statuses, results } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(statuses.get('a')).toEqual({ outcome: 'empty', newestTimestamp: null })
    expect(results.get('a')).toBeNull()
  })

  it('(T6) PartialData is query_failed even with values', async () => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [5], Timestamps: [t1] }] })
    const { statuses } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(statuses.get('a')?.outcome).toBe('query_failed')
  })

  it('(T7) an Id whose results span NextToken pages is query_failed (D5; the append fix is OB3)', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [1], Timestamps: [t1] }], NextToken: 'next' })
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [2], Timestamps: [t2] }, { Id: 'b', StatusCode: 'Complete', Values: [4], Timestamps: [t2] }] })
    const { statuses } = await fetchMetricDataBatchWithStatus(client(send), [query('a'), query('b')], startTime, endTime)
    expect(statuses.get('a')?.outcome).toBe('query_failed')
    expect(statuses.get('b')?.outcome).toBe('complete')
  })

  it('(T8) an Id missing from the response is query_failed', async () => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [] })
    const { statuses } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(statuses.get('a')?.outcome).toBe('query_failed')
  })

  it('(T9) its results map equals fetchMetricDataBatch() for the same responses', async () => {
    const responses = () =>
      jest
        .fn()
        .mockResolvedValueOnce({
          MetricDataResults: [
            { Id: 'a', StatusCode: 'Forbidden', Values: [], Timestamps: [] },
            { Id: 'b', StatusCode: 'PartialData', Values: [5], Timestamps: [t1] },
            { Id: 'c', StatusCode: 'Complete', Values: [], Timestamps: [] },
            { Id: 'd', StatusCode: 'Complete', Values: [1], Timestamps: [t1] },
          ],
          NextToken: 'next',
        })
        .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'd', StatusCode: 'Complete', Values: [9], Timestamps: [t2] }] })
    const queries = ['a', 'b', 'c', 'd', 'e'].map(query)
    const legacy = await fetchMetricDataBatch(client(responses()), queries, startTime, endTime)
    const { results } = await fetchMetricDataBatchWithStatus(client(responses()), queries, startTime, endTime)
    expect(results).toEqual(legacy)
    expect(legacy.get('b')).toEqual({ timestamps: [t1], values: [5] })
    expect(legacy.get('d')).toEqual({ timestamps: [t2], values: [9] })
  })
})
