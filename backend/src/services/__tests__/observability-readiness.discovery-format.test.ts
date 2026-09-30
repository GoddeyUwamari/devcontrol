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
} from '../observability-readiness.service';

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
    expect(source).toContain("errors.join('; ')");
  });

  it('a fatal error is written unprefixed (error.message only), which the gate treats as unrecognized', () => {
    expect(source).toMatch(/SET status = \$1, completed_at = NOW\(\), error_message = \$2[\s\S]{0,80}\['failed', error\.message, jobId\]/);
  });
});
