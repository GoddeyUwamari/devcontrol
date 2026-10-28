/**
 * Field lists for AWS list responses whose items carry more configuration
 * than DevControl uses. Each projection copies only the fields named here and
 * runs on the response page right after the SDK call, before anything else
 * reads it. Fields not listed are never read, so nothing outside this list is
 * stored, logged or returned.
 *
 * __tests__/aws-response-classification.static.test.ts checks that every
 * response of these commands goes through its projection; the projection
 * tests are in services/__tests__/aws-response-projections.test.ts.
 */
import type { FunctionConfiguration } from '@aws-sdk/client-lambda';
import type { DistributionSummary } from '@aws-sdk/client-cloudfront';
import type { CompositeAlarm, MetricAlarm } from '@aws-sdk/client-cloudwatch';

/** The function fields discovery and the cost detectors read from ListFunctions. */
export type LambdaFunctionFields = Pick<
  FunctionConfiguration,
  | 'FunctionArn'
  | 'FunctionName'
  | 'Runtime'
  | 'MemorySize'
  | 'Timeout'
  | 'LastModified'
  | 'CodeSize'
  | 'Handler'
  | 'Architectures'
  | 'State'
>;

export function projectLambdaFunction(fn: FunctionConfiguration): LambdaFunctionFields {
  return {
    FunctionArn: fn.FunctionArn,
    FunctionName: fn.FunctionName,
    Runtime: fn.Runtime,
    MemorySize: fn.MemorySize,
    Timeout: fn.Timeout,
    LastModified: fn.LastModified,
    CodeSize: fn.CodeSize,
    Handler: fn.Handler,
    Architectures: fn.Architectures?.slice(),
    State: fn.State,
  };
}

/** The distribution fields discovery reads from ListDistributions. */
export interface CloudFrontDistributionFields
  extends Pick<
    DistributionSummary,
    'ARN' | 'Id' | 'DomainName' | 'Status' | 'PriceClass' | 'Enabled' | 'HttpVersion' | 'LastModifiedTime'
  > {
  /** Each origin's domain name, in the distribution's order. */
  OriginDomainNames: Array<string | undefined>;
}

export function projectCloudFrontDistribution(distribution: DistributionSummary): CloudFrontDistributionFields {
  return {
    ARN: distribution.ARN,
    Id: distribution.Id,
    DomainName: distribution.DomainName,
    Status: distribution.Status,
    PriceClass: distribution.PriceClass,
    Enabled: distribution.Enabled,
    HttpVersion: distribution.HttpVersion,
    LastModifiedTime: distribution.LastModifiedTime,
    OriginDomainNames: (distribution.Origins?.Items ?? []).map((origin) => origin.DomainName),
  };
}

/**
 * The metric alarm fields readiness and the alarms endpoint read from
 * DescribeAlarms. Descriptions, state reasons, metric-math queries and every
 * action ARN are left out: actions are kept only as whether any alarm action
 * exists, and metric math only as whether the alarm uses it.
 */
export interface MetricAlarmFields
  extends Pick<
    MetricAlarm,
    | 'AlarmName'
    | 'AlarmArn'
    | 'StateValue'
    | 'StateTransitionedTimestamp'
    | 'Namespace'
    | 'MetricName'
    | 'ComparisonOperator'
    | 'Threshold'
    | 'TreatMissingData'
    | 'ActionsEnabled'
  > {
  Dimensions: Array<{ Name: string | undefined; Value: string | undefined }>;
  HasAlarmActions: boolean;
  UsesMetricMath: boolean;
}

export function projectMetricAlarm(alarm: MetricAlarm): MetricAlarmFields {
  return {
    AlarmName: alarm.AlarmName,
    AlarmArn: alarm.AlarmArn,
    StateValue: alarm.StateValue,
    StateTransitionedTimestamp: alarm.StateTransitionedTimestamp,
    Namespace: alarm.Namespace,
    MetricName: alarm.MetricName,
    ComparisonOperator: alarm.ComparisonOperator,
    Threshold: alarm.Threshold,
    TreatMissingData: alarm.TreatMissingData,
    ActionsEnabled: alarm.ActionsEnabled,
    Dimensions: (alarm.Dimensions ?? []).map((d) => ({ Name: d.Name, Value: d.Value })),
    HasAlarmActions: (alarm.AlarmActions ?? []).length > 0,
    UsesMetricMath: (alarm.Metrics ?? []).length > 0,
  };
}

/** The composite alarm fields the alarms endpoint reads: no rule, description, actions or ARN. */
export type CompositeAlarmFields = Pick<CompositeAlarm, 'AlarmName' | 'StateValue' | 'StateTransitionedTimestamp'>;

export function projectCompositeAlarm(alarm: CompositeAlarm): CompositeAlarmFields {
  return {
    AlarmName: alarm.AlarmName,
    StateValue: alarm.StateValue,
    StateTransitionedTimestamp: alarm.StateTransitionedTimestamp,
  };
}
