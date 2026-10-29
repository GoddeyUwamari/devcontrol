/**
 * OB2: fetchMetricDataBatchWithStatus() -- how each GetMetricData query ended,
 * which fetchMetricDataBatch()'s `null` cannot say. Pure mechanics, like
 * cloudwatch-metric-batch.util.test.ts.
 *
 * Proves: Forbidden is access_denied, never empty; InternalError, PartialData,
 * and a missing Id are query_failed; an Id that spans NextToken pages is the
 * whole of its pages (OB3), its outcome decided as described on mergePages; a
 * throttled or refused request marks every query in that request only;
 * Complete with no values is empty (a completed query); and the `results` map
 * is exactly what fetchMetricDataBatch() returns for the same responses.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch'
import { fetchMetricDataBatch, fetchMetricDataBatchWithStatus, reduceSeriesToScalar, BatchMetricQuery } from '../cloudwatch-metric-batch.util'
import { MAX_LISTING_PAGES } from '../../utils/awsCallPolicy'

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

  // OB3 replaced D5's stopgap (an Id on two pages was query_failed) with the append.
  it('(T7) an Id whose results span NextToken pages is complete with every page\'s datapoints', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [1], Timestamps: [t1] }], NextToken: 'next' })
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [2], Timestamps: [t2] }, { Id: 'b', StatusCode: 'Complete', Values: [4], Timestamps: [t2] }] })
    const { statuses, results } = await fetchMetricDataBatchWithStatus(client(send), [query('a'), query('b')], startTime, endTime)
    expect(statuses.get('a')).toEqual({ outcome: 'complete', newestTimestamp: t2 })
    expect(results.get('a')).toEqual({ timestamps: [t1, t2], values: [1, 2] })
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
    // OB3: d's two pages appended (it used to be the last page's [9] only).
    expect(legacy.get('d')).toEqual({ timestamps: [t1, t2], values: [1, 9] })
  })
})

describe('fetchMetricDataBatchWithStatus: paging (OB3)', () => {
  const t3 = new Date('2026-01-01T00:50:00Z')
  afterEach(() => jest.restoreAllMocks())

  it('(P1) a query continued across three pages is every page appended; newest timestamp across all pages', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [3], Timestamps: [t3] }], NextToken: 'p2' })
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [1], Timestamps: [t1] }], NextToken: 'p3' })
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [2], Timestamps: [t2] }] })
    const { statuses, results } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(send).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.map((c) => c[0].input.NextToken)).toEqual([undefined, 'p2', 'p3'])
    expect(results.get('a')).toEqual({ timestamps: [t3, t1, t2], values: [3, 1, 2] })
    expect(statuses.get('a')).toEqual({ outcome: 'complete', newestTimestamp: t3 })
  })

  it('(P2) a query complete on page 1 keeps page 1 while another continues', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        MetricDataResults: [
          { Id: 'a', StatusCode: 'Complete', Values: [7], Timestamps: [t1] },
          { Id: 'b', StatusCode: 'PartialData', Values: [1], Timestamps: [t1] },
        ],
        NextToken: 'p2',
      })
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'b', StatusCode: 'Complete', Values: [2], Timestamps: [t2] }] })
    const { statuses, results } = await fetchMetricDataBatchWithStatus(client(send), [query('a'), query('b')], startTime, endTime)
    expect(results.get('a')).toEqual({ timestamps: [t1], values: [7] })
    expect(statuses.get('a')?.outcome).toBe('complete')
    expect(results.get('b')).toEqual({ timestamps: [t1, t2], values: [1, 2] })
    expect(statuses.get('b')?.outcome).toBe('complete')
  })

  it('(P3) PartialData on a query\'s last page is query_failed, though no NextToken follows; the legacy map keeps its values', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [1], Timestamps: [t1] }], NextToken: 'p2' })
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [2], Timestamps: [t2] }] })
    const { statuses, results } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(statuses.get('a')).toEqual({ outcome: 'query_failed', newestTimestamp: null })
    expect(results.get('a')).toEqual({ timestamps: [t1, t2], values: [1, 2] })
  })

  it('(P4) a chunk still paging at the page limit is query_failed for every query in it; another chunk is unaffected', async () => {
    const queries = Array.from({ length: 501 }, (_, i) => query(`q${i}`))
    const send = jest.fn().mockImplementation(async (command: any) => {
      const ids: string[] = command.input.MetricDataQueries.map((q: any) => q.Id)
      if (ids.includes('q500')) return { MetricDataResults: [{ Id: 'q500', StatusCode: 'Complete', Values: [1], Timestamps: [t1] }] }
      // The first chunk never stops paging; q0 even reports Complete on every page.
      return { MetricDataResults: [{ Id: 'q0', StatusCode: 'Complete', Values: [1], Timestamps: [new Date(startTime.getTime() + send.mock.calls.length * 1000)] }], NextToken: 'more' }
    })
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const { statuses } = await fetchMetricDataBatchWithStatus(client(send), queries, startTime, endTime)
    expect(send).toHaveBeenCalledTimes(MAX_LISTING_PAGES + 1)
    expect(statuses.get('q0')).toEqual({ outcome: 'query_failed', newestTimestamp: null })
    expect(statuses.get('q499')?.outcome).toBe('query_failed')
    expect(statuses.get('q500')?.outcome).toBe('complete')
  })

  it('(P4b) a chunk that finishes on exactly the page limit is complete', async () => {
    let page = 0
    const send = jest.fn().mockImplementation(async () => {
      page += 1
      const last = page === MAX_LISTING_PAGES
      return {
        MetricDataResults: [{ Id: 'a', StatusCode: last ? 'Complete' : 'PartialData', Values: [page], Timestamps: [new Date(startTime.getTime() + page * 1000)] }],
        ...(last ? {} : { NextToken: `p${page + 1}` }),
      }
    })
    const { statuses, results } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(send).toHaveBeenCalledTimes(MAX_LISTING_PAGES)
    expect(statuses.get('a')?.outcome).toBe('complete')
    expect(results.get('a')?.values).toHaveLength(MAX_LISTING_PAGES)
  })

  it('(P5) Forbidden or InternalError on any page decides the outcome, whatever the last page says', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        MetricDataResults: [
          { Id: 'a', StatusCode: 'Forbidden', Values: [], Timestamps: [] },
          { Id: 'b', StatusCode: 'InternalError', Values: [], Timestamps: [] },
        ],
        NextToken: 'p2',
      })
      .mockResolvedValueOnce({
        MetricDataResults: [
          { Id: 'a', StatusCode: 'Complete', Values: [2], Timestamps: [t2] },
          { Id: 'b', StatusCode: 'Complete', Values: [3], Timestamps: [t2] },
        ],
      })
    const { statuses } = await fetchMetricDataBatchWithStatus(client(send), [query('a'), query('b')], startTime, endTime)
    expect(statuses.get('a')).toEqual({ outcome: 'access_denied', newestTimestamp: null })
    expect(statuses.get('b')).toEqual({ outcome: 'query_failed', newestTimestamp: null })
  })

  it('(P6) a timestamp a later page repeats is query_failed with no series: never counted twice', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [5], Timestamps: [t1] }], NextToken: 'p2' })
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [5, 6], Timestamps: [t1, t2] }] })
    const { statuses, results } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(statuses.get('a')).toEqual({ outcome: 'query_failed', newestTimestamp: null })
    expect(results.get('a')).toBeNull()
    const legacy = await fetchMetricDataBatch(
      client(
        jest
          .fn()
          .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [5], Timestamps: [t1] }], NextToken: 'p2' })
          .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [5, 6], Timestamps: [t1, t2] }] })
      ),
      [query('a')],
      startTime,
      endTime
    )
    expect(legacy.get('a')).toBeNull()
  })

  it('(P7) a request failing on page 2 fails the whole chunk: page 1 is never reported complete', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [1], Timestamps: [t1] }], NextToken: 'p2' })
      .mockRejectedValueOnce(awsError('ThrottlingException'))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const { statuses, results } = await fetchMetricDataBatchWithStatus(client(send), [query('a')], startTime, endTime)
    expect(statuses.get('a')).toEqual({ outcome: 'throttled', newestTimestamp: null })
    expect(results.get('a')).toBeNull()
  })

  it('(P11) every statistic reduces over all pages: Sum, Average, Minimum, Maximum', async () => {
    const pages = () =>
      jest
        .fn()
        .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'PartialData', Values: [1], Timestamps: [t1] }], NextToken: 'p2' })
        .mockResolvedValueOnce({ MetricDataResults: [{ Id: 'a', StatusCode: 'Complete', Values: [2], Timestamps: [t2] }] })
    const series = (await fetchMetricDataBatch(client(pages()), [query('a')], startTime, endTime)).get('a') ?? null
    expect(reduceSeriesToScalar(series, 'Sum')).toBe(3)
    expect(reduceSeriesToScalar(series, 'Average')).toBe(1.5)
    expect(reduceSeriesToScalar(series, 'Minimum')).toBe(1)
    expect(reduceSeriesToScalar(series, 'Maximum')).toBe(2)
  })
})
