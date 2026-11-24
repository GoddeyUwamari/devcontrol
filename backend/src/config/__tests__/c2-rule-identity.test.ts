/**
 * C2: the idle NAT gateway rule's identity is pinned, like the C1 rules'
 * (c1-rule-identity.test.ts). Every finding stores the rule verbatim with
 * rule_version, so changing the window, a metric or statistic, a threshold, the
 * scope or an exclusion without bumping `version` would make old and new
 * findings claim the same rule. Add a pinned entry (never edit one) when the
 * rule changes. Also pins the regional NAT gateway hourly price table (every
 * value as published in AWS's natgateway.json, 2026-11-23T17:10:05Z) and its
 * lookup, which never answers with another region's price.
 */
import { NAT_GATEWAY_IDLE_RULE, NAT_GATEWAY_RESOURCE_TYPE } from '../nat-gateway-idle-rule';
import { NAT_GATEWAY_HOURLY_PRICE_SOURCE, NAT_GATEWAY_HOURLY_USD_BY_REGION, natGatewayHourlyPrice } from '../aws-pricing';
import { OPTIMIZATION_RULE_SERVICES } from '../optimization-rules';
import { REGION_NAME_PATTERN } from '../../services/region-list';

const PINNED: Record<number, unknown> = {
  1: {
    id: 'nat_gateway_idle',
    version: 1,
    window: { days: 32, basis: 'complete_utc_days', settle_lag_hours: 2 },
    metrics: {
      namespace: 'AWS/NATGateway',
      dimension: 'NatGatewayId',
      period_seconds: 3600,
      every_hour_equals: 0,
      gate: [
        { metric: 'ActiveConnectionCount', stat: 'Maximum' },
        { metric: 'PacketsInFromSource', stat: 'Sum' },
        { metric: 'PacketsInFromDestination', stat: 'Sum' },
        { metric: 'BytesInFromSource', stat: 'Sum' },
        { metric: 'BytesInFromDestination', stat: 'Sum' },
      ],
    },
    completeness: {
      hours_per_day_required: 24,
      every_metric: true,
      one_datapoint_per_hour: true,
      on_missing_duplicate_or_out_of_window_datapoint: 'couldnt_check',
      created_before_window: true,
    },
    activity_wins: true,
    scope: {
      evaluated_state: 'available',
      couldnt_check_states: ['pending'],
      excluded_states: ['deleting', 'deleted', 'failed'],
      excluded_availability_modes: ['regional'],
      on_unrecognised_state_or_mode: 'couldnt_check',
    },
    routes: { source: 'describe_route_tables', role: 'evidence', on_read_failure: 'couldnt_check' },
    savings: {
      basis: 'estimate',
      price: 'regional_nat_gateway_hourly',
      hours_per_month: 730,
      missing_price: 'no_estimate',
      provisioned_bandwidth: 'no_estimate',
      includes_elastic_ip: false,
    },
  },
};

// AWS's natgateway.json, "Hourly charge for NAT Gateways", 2026-11-23T17:10:05Z
// (c2-evidence/aws-price-map-natgateway-2026-11-23.json, region names mapped with
// aws-locations.json). Every commercial region; GovCloud and Local Zones are not.
const PUBLISHED: Record<string, number> = {
  'af-south-1': 0.057, 'ap-east-1': 0.065, 'ap-east-2': 0.0558,
  'ap-northeast-1': 0.062, 'ap-northeast-2': 0.059, 'ap-northeast-3': 0.062,
  'ap-south-1': 0.056, 'ap-south-2': 0.056,
  'ap-southeast-1': 0.059, 'ap-southeast-2': 0.059, 'ap-southeast-3': 0.059, 'ap-southeast-4': 0.059,
  'ap-southeast-5': 0.05015, 'ap-southeast-6': 0.06195, 'ap-southeast-7': 0.05015,
  'ca-central-1': 0.05, 'ca-west-1': 0.05,
  'eu-central-1': 0.052, 'eu-central-2': 0.0572, 'eu-north-1': 0.046,
  'eu-south-1': 0.05, 'eu-south-2': 0.048,
  'eu-west-1': 0.048, 'eu-west-2': 0.05, 'eu-west-3': 0.05,
  'il-central-1': 0.0504, 'me-central-1': 0.0528, 'me-south-1': 0.0528, 'mx-central-1': 0.04725,
  'sa-east-1': 0.093,
  'us-east-1': 0.045, 'us-east-2': 0.045, 'us-west-1': 0.048, 'us-west-2': 0.045,
};

describe('NAT_GATEWAY_IDLE_RULE identity', () => {
  it('matches the pinned definition of its version exactly (bump the version on any change)', () => {
    expect(NAT_GATEWAY_IDLE_RULE.id).toBe('nat_gateway_idle');
    expect(JSON.parse(JSON.stringify(NAT_GATEWAY_IDLE_RULE))).toEqual(PINNED[NAT_GATEWAY_IDLE_RULE.version]);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(NAT_GATEWAY_IDLE_RULE)).toBe(true);
    expect(Object.isFrozen(NAT_GATEWAY_IDLE_RULE.metrics.gate)).toBe(true);
    expect(Object.isFrozen(NAT_GATEWAY_IDLE_RULE.metrics.gate[0])).toBe(true);
    expect(Object.isFrozen(NAT_GATEWAY_IDLE_RULE.scope.excluded_states)).toBe(true);
  });

  it('writes the NAT Gateway resource type, its catalog service', () => {
    expect(NAT_GATEWAY_RESOURCE_TYPE).toBe('NAT Gateway');
    expect(OPTIMIZATION_RULE_SERVICES).toContain(NAT_GATEWAY_RESOURCE_TYPE);
  });
});

describe('regional NAT gateway hourly price table', () => {
  it('names its source, key and publication date', () => {
    expect(NAT_GATEWAY_HOURLY_PRICE_SOURCE).toEqual({
      url: 'https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/natgateway.json',
      key: 'Hourly charge for NAT Gateways',
      published: '2026-11-23T17:10:05Z',
      retrieved: '2026-11-23',
    });
  });

  it('holds exactly the 34 commercial regions AWS published a price for, at the published price', () => {
    const table = NAT_GATEWAY_HOURLY_USD_BY_REGION;
    expect({ ...table }).toEqual(PUBLISHED);
    expect(Object.keys(table)).toHaveLength(34);
    for (const region of Object.keys(table)) {
      expect(region).toMatch(REGION_NAME_PATTERN);
      expect(region.startsWith('us-gov-')).toBe(false);
    }
    expect(Object.isFrozen(table)).toBe(true);
  });

  it('answers a region only with its own price, never another region\'s', () => {
    expect(natGatewayHourlyPrice('us-east-1')).toBe(0.045);
    expect(natGatewayHourlyPrice('sa-east-1')).toBe(0.093);
    expect(natGatewayHourlyPrice('us-gov-west-1')).toBeNull();
    expect(natGatewayHourlyPrice('us-gov-east-1')).toBeNull();
    expect(natGatewayHourlyPrice('xx-nowhere-1')).toBeNull();
    expect(natGatewayHourlyPrice('toString')).toBeNull();
    expect(natGatewayHourlyPrice('__proto__')).toBeNull();
    expect(natGatewayHourlyPrice('')).toBeNull();
    expect(natGatewayHourlyPrice(undefined)).toBeNull();
    expect(natGatewayHourlyPrice(null)).toBeNull();
  });
});
