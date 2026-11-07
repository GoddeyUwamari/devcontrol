/**
 * Test fixture: the metadata a low-activity finding carries (FP PR 2b), built
 * by the production helper so its shape never drifts from what the detector
 * writes. Not a test file itself.
 */
import { lowActivityFindingMetadata, lowActivityWindow, type DayEvidence } from '../../low-activity-evaluation';

/** Low-activity metadata evaluated at `evaluatedAt` (default: now), with a quiet 30-day window. */
export function lowActivityMetadata(
  options: { evaluatedAt?: Date; extra?: Record<string, unknown> } = {}
): Record<string, unknown> {
  const evaluatedAt = options.evaluatedAt ?? new Date();
  const window = lowActivityWindow(evaluatedAt);
  const days: DayEvidence[] = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(window.start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    cpu_peak_percent: 2.5,
    network_in_bytes: 400_000,
    network_out_bytes: 300_000,
  }));
  return {
    ...lowActivityFindingMetadata({
      window,
      evaluatedAt,
      launchTime: new Date(window.start.getTime() - 86_400_000),
      days,
      worst: { cpu_peak_percent: 2.5, cpu_peak_date: days[0].date, network_bytes_max: 700_000, network_max_date: days[0].date },
      topology: {
        elbv2_target_groups: 'not_registered',
        target_groups_read: 0,
        classic_load_balancers: 'not_registered',
        classic_load_balancers_read: 0,
        auto_scaling: 'not_member',
      },
    }),
    instance_type: 't3.micro',
    price_source: 'list_table',
    savings_basis: "estimated: compute cost from DevControl's list-price table (a default estimate for unlisted instance types); not billed cost or guaranteed savings",
    ...(options.extra ?? {}),
  };
}
