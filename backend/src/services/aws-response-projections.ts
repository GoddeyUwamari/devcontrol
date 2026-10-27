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
