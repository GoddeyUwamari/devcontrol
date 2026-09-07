/**
 * Phase 2, rule 2 (ec2_old_generation) — classification engine only. See
 * ec2-generation.ts's header for why this is not yet wired into a
 * savings-producing detector.
 */
import { classifyEC2Generation, isEC2PreviousGeneration, EC2_PREVIOUS_GENERATION_FAMILIES } from '../ec2-generation';

describe('classifyEC2Generation: known previous-generation types', () => {
  it.each([
    'm1.small', 'm1.large', 'm2.xlarge', 'm3.medium', 'm3.2xlarge', 'm4.large', 'm4.16xlarge',
    'c1.medium', 'c3.large', 'c4.xlarge',
    'r3.large', 'r4.2xlarge',
    'i2.xlarge',
    'g3.4xlarge',
    'p3.2xlarge', 'p3dn.24xlarge',
    't1.micro',
  ])('classifies %s as previous_generation', (instanceType) => {
    expect(classifyEC2Generation(instanceType)).toBe('previous_generation');
  });
});

describe('classifyEC2Generation: known current-generation types', () => {
  it.each([
    't2.micro', 't3.small', 't3.large',
    'm5.large', 'm5.2xlarge', 'm6i.large',
    'c5.xlarge', 'c6i.large',
    'r5.large', 'r6i.xlarge',
    'i3.large', 'd3.xlarge',
  ])('classifies %s as current_generation', (instanceType) => {
    expect(classifyEC2Generation(instanceType)).toBe('current_generation');
  });
});

describe('classifyEC2Generation: Graviton types', () => {
  it('classifies A1 (1st-gen Graviton) as previous_generation -- Graviton itself is not immune to deprecation', () => {
    expect(classifyEC2Generation('a1.large')).toBe('previous_generation');
  });

  it('classifies later Graviton generations as current_generation -- not flagged merely for being ARM', () => {
    expect(classifyEC2Generation('m6g.large')).toBe('current_generation');
    expect(classifyEC2Generation('t4g.micro')).toBe('current_generation');
    expect(classifyEC2Generation('c7g.xlarge')).toBe('current_generation');
  });

  it('does not classify a current-generation, non-Graviton type as previous_generation merely for lacking a "g" suffix', () => {
    expect(classifyEC2Generation('m5.large')).toBe('current_generation');
    expect(classifyEC2Generation('c5.large')).toBe('current_generation');
  });
});

describe('classifyEC2Generation: unknown/new types default safely to current_generation', () => {
  it.each([
    'm9.large',     // hypothetical future generation this module has never seen
    'z2.metal',     // unrecognized family
    'x9tz.2xlarge', // unrecognized family with unusual suffix
  ])('does not flag unrecognized type %s as previous_generation', (instanceType) => {
    expect(classifyEC2Generation(instanceType)).toBe('current_generation');
  });
});

describe('classifyEC2Generation: edge cases', () => {
  it('handles an instance type with no dot (malformed) without throwing', () => {
    expect(() => classifyEC2Generation('malformed')).not.toThrow();
    expect(classifyEC2Generation('malformed')).toBe('current_generation');
  });

  it('handles an empty string without throwing', () => {
    expect(() => classifyEC2Generation('')).not.toThrow();
    expect(classifyEC2Generation('')).toBe('current_generation');
  });

  it('is case-insensitive on the family token', () => {
    expect(classifyEC2Generation('M4.large')).toBe('previous_generation');
    expect(classifyEC2Generation('M5.LARGE')).toBe('current_generation');
  });
});

describe('isEC2PreviousGeneration', () => {
  it('is a boolean-returning equivalent of the classifier', () => {
    expect(isEC2PreviousGeneration('m4.large')).toBe(true);
    expect(isEC2PreviousGeneration('m5.large')).toBe(false);
  });
});

describe('EC2_PREVIOUS_GENERATION_FAMILIES: registry integrity', () => {
  it('contains no duplicate-effect entries and is a non-empty curated set', () => {
    expect(EC2_PREVIOUS_GENERATION_FAMILIES.size).toBeGreaterThan(0);
    for (const family of EC2_PREVIOUS_GENERATION_FAMILIES) {
      expect(family).toBe(family.toLowerCase());
    }
  });
});
