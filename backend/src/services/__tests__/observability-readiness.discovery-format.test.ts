/**
 * Pins the readiness discovery gate to the exact error format runDiscovery()
 * writes into resource_discovery_jobs.error_message. The gate fails closed on
 * any segment it does not recognize, so a renamed or added errors.push()
 * prefix in awsResourceDiscovery.ts must fail here -- not silently turn every
 * failed run into an "unrecognized error" (or, worse, a type failure into
 * "usable").
 *
 * Reads the real source text; no database, AWS, or network access.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DISCOVERY_ERROR_PREFIXES,
  DISCOVERY_ERROR_SEPARATOR,
  evaluateDiscoveryGate,
} from '../observability-readiness.service';
import { DISCOVERY_FAILED_MESSAGE } from '../awsResourceDiscovery';
import { PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../platform-sts';
import { DISCOVERY_WARNING_TRUNCATED_INDEX, joinDiscoveryMessage, splitDiscoveryMessage } from '../discovery-warnings';

const source = readFileSync(join(__dirname, '..', 'awsResourceDiscovery.ts'), 'utf8');

describe('readiness discovery gate -- pinned to runDiscovery() error format', () => {
  it('every errors.push() in runDiscovery uses a `<Prefix>: ${...}` template the gate knows, and no other', () => {
    const pushes = source.match(/errors\.push\(/g) ?? [];
    const prefixed = [...source.matchAll(/errors\.push\(`([^`$]+?: )\$\{/g)].map(m => m[1]);

    // Every push is a recognized template shape -- none uses a bare message.
    expect(pushes.length).toBeGreaterThan(0);
    expect(prefixed).toHaveLength(pushes.length);
    expect(new Set(prefixed)).toEqual(new Set(DISCOVERY_ERROR_PREFIXES));
    expect(DISCOVERY_ERROR_PREFIXES).toHaveLength(new Set(DISCOVERY_ERROR_PREFIXES).size);
  });

  it('the EC2 and RDS scans push under exactly the prefixes the gate checks per type', () => {
    expect(source).toContain('errors.push(`EC2: ${error.message}`)');
    expect(source).toContain('errors.push(`RDS: ${error.message}`)');
    expect(DISCOVERY_ERROR_PREFIXES).toContain('EC2: ');
    expect(DISCOVERY_ERROR_PREFIXES).toContain('RDS: ');
  });

  it('segments are joined with the separator the gate splits on', () => {
    expect(DISCOVERY_ERROR_SEPARATOR).toBe('; ');
    expect(source).toContain('joinDiscoveryMessage(errors, warnings)');
    expect(joinDiscoveryMessage(['EC2: a', 'RDS: b'], [])).toBe(['EC2: a', 'RDS: b'].join(DISCOVERY_ERROR_SEPARATOR));
  });

  it('a warning stored beside errors is neither an error nor an unrecognized segment', () => {
    const errorMessage = joinDiscoveryMessage(['S3: AccessDenied'], [DISCOVERY_WARNING_TRUNCATED_INDEX]);
    const run = { id: 'run', status: 'failed' as const, startedAt: new Date(), completedAt: new Date(), resourceTypes: ['ec2', 'rds'], errorMessage };
    // getGatedRun() passes the gate only the errors.
    const gated = { ...run, errorMessage: splitDiscoveryMessage(errorMessage).errorMessage };
    expect(evaluateDiscoveryGate(gated, 'ec2')).toEqual({ kind: 'usable', run: gated });
    expect(source).not.toContain('errors.push(DISCOVERY_WARNING');
  });

  it('a fatal error is written as a fixed unprefixed message, which the gate treats as unrecognized', () => {
    expect(source).toMatch(/SET status = \$1, completed_at = NOW\(\), error_message = \$2[\s\S]{0,80}\['failed', fatalDiscoveryErrorMessage\(error\), jobId\]/);
    for (const errorMessage of [DISCOVERY_FAILED_MESSAGE, PLATFORM_AWS_UNAVAILABLE_MESSAGE]) {
      const run = { id: 'run', status: 'failed' as const, startedAt: new Date(), completedAt: new Date(), resourceTypes: ['ec2', 'rds'], errorMessage };
      for (const type of ['ec2', 'rds'] as const) {
        expect(evaluateDiscoveryGate(run, type)).toEqual({ kind: 'error', reason: 'the latest discovery run failed with an unrecognized error' });
      }
    }
  });
});
