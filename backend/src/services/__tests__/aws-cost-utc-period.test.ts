/**
 * Cost Explorer time periods are UTC calendar dates. The helpers read only
 * UTC fields of the instant they are given, so a server whose local time zone
 * is not UTC cannot shift a month start or a day boundary. The instants below
 * sit just before and just after UTC midnight, where a local-time computation
 * in a non-UTC zone would land on the wrong date. No AWS call is made.
 */
import { Granularity } from '@aws-sdk/client-cost-explorer';
import { monthToDatePeriodUtc, trendPeriodUtc } from '../aws-cost.service';

describe('monthToDatePeriodUtc', () => {
  it('is the UTC month to date, End exclusive (tomorrow), just before UTC midnight at month end', () => {
    expect(monthToDatePeriodUtc(new Date('2026-03-31T23:30:00Z'))).toEqual({ start: '2026-03-01', end: '2026-04-01' });
  });

  it('starts a new month at UTC midnight, not at local midnight', () => {
    expect(monthToDatePeriodUtc(new Date('2026-04-01T00:30:00Z'))).toEqual({ start: '2026-04-01', end: '2026-04-02' });
  });

  it('crosses the year boundary', () => {
    expect(monthToDatePeriodUtc(new Date('2026-12-31T23:59:59Z'))).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(monthToDatePeriodUtc(new Date('2027-01-01T00:00:00Z'))).toEqual({ start: '2027-01-01', end: '2027-01-02' });
  });
});

describe('trendPeriodUtc', () => {
  it('daily ranges count back whole UTC days and include today', () => {
    expect(trendPeriodUtc('7d', new Date('2026-03-01T00:10:00Z'))).toEqual({ start: '2026-02-22', end: '2026-03-02', granularity: Granularity.DAILY });
    expect(trendPeriodUtc('30d', new Date('2026-03-31T23:50:00Z'))).toEqual({ start: '2026-03-01', end: '2026-04-01', granularity: Granularity.DAILY });
    expect(trendPeriodUtc('90d', new Date('2026-01-15T12:00:00Z'))).toEqual({ start: '2025-10-17', end: '2026-01-16', granularity: Granularity.DAILY });
  });

  it('monthly ranges align to UTC calendar months, current partial month included', () => {
    expect(trendPeriodUtc('6mo', new Date('2026-01-15T12:00:00Z'))).toEqual({ start: '2025-08-01', end: '2026-02-01', granularity: Granularity.MONTHLY });
    expect(trendPeriodUtc('1yr', new Date('2026-03-31T23:30:00Z'))).toEqual({ start: '2025-04-01', end: '2026-04-01', granularity: Granularity.MONTHLY });
    expect(trendPeriodUtc('6mo', new Date('2026-04-01T00:05:00Z'))).toEqual({ start: '2025-11-01', end: '2026-05-01', granularity: Granularity.MONTHLY });
  });
});
