/**
 * EC2 instance-generation classification for the ec2_old_generation rule.
 *
 * Deliberately NOT wired into cost-optimization.service.ts yet -- see the
 * Phase 2 implementation report. This module classifies an instance type as
 * previous- or current-generation using AWS's own official designation; it
 * does not compute cost or savings. A savings-bearing detector needs either
 * verified current on-demand pricing for these previous-generation families
 * (not available in the existing estimateEC2Cost table, which only covers
 * t2/t3/m5/c5/r5) or a schema change to let a recommendation exist without a
 * dollar amount (cost_recommendations.potential_savings is currently
 * DECIMAL(10,2) NOT NULL DEFAULT 0.00) -- both deferred to Phase 3.
 *
 * Classification source: AWS's own "Specifications for Amazon EC2 previous
 * generation instances" page, fetched 2026-09-06:
 * https://docs.aws.amazon.com/ec2/latest/instancetypes/pg.html
 *
 * Deliberately a fixed, curated set rather than "anything older than the
 * newest generation per family" -- AWS ships new generations every year, so
 * tracking "the current newest" would require near-constant updates and
 * would drift stale immediately. A family only moves from current to
 * previous-generation when AWS itself formally redesignates it (which this
 * list already reflects), so this only needs updating when AWS adds to its
 * own previous-generation list -- rare, and each addition is a one-line
 * change here.
 *
 * Important: this list is NOT "everything non-Graviton" or "everything
 * pre-5th-generation" -- A1 (Graviton/arm64) is itself previous-generation
 * per AWS's current designation, and plenty of non-Graviton families (t2,
 * t3, m5, c5, r5, i3, d2, etc.) are current-generation. Classification here
 * depends only on this authoritative list, nothing else.
 */

export const EC2_PREVIOUS_GENERATION_FAMILIES: ReadonlySet<string> = new Set([
  'a1',   // Graviton (1st gen) -- superseded by later Graviton generations; previous-gen despite being ARM
  'c1', 'c3', 'c4',
  'g3',
  'i2',
  'm1', 'm2', 'm3', 'm4',
  'p3', 'p3dn',
  'r3', 'r4',
  't1',
]);

export type EC2GenerationClassification = 'previous_generation' | 'current_generation';

/**
 * Classifies an EC2 instance type by its family token (everything before the
 * first '.', e.g. "m4" from "m4.large"). Any family not in the curated
 * previous-generation set -- including unrecognized/future instance types
 * this module has never seen -- is treated as current-generation. This is a
 * deliberate safe default: we only ever positively assert "previous
 * generation" from a known, authoritative match, never infer it from
 * unfamiliarity.
 */
export function classifyEC2Generation(instanceType: string): EC2GenerationClassification {
  const family = instanceType?.split('.')[0]?.toLowerCase();
  if (family && EC2_PREVIOUS_GENERATION_FAMILIES.has(family)) {
    return 'previous_generation';
  }
  return 'current_generation';
}

export function isEC2PreviousGeneration(instanceType: string): boolean {
  return classifyEC2Generation(instanceType) === 'previous_generation';
}
