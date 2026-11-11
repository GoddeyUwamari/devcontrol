/**
 * One plan-feature line from the catalog (lib/plan/plan-catalog.ts): the
 * label, an "AI" chip for AI features, and a "Coming soon" or "Beta" chip.
 * Shared by every plan list so a line reads the same everywhere.
 */
import type { CatalogFeature } from '@/lib/plan/plan-catalog'

export function FeatureBadge({ badge }: { badge: string }) {
  return (
    <span
      data-feature-badge={badge}
      className="ml-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-slate-600"
    >
      {badge}
    </span>
  )
}

export function FeatureText({ feature, aiChip = true }: { feature: CatalogFeature; aiChip?: boolean }) {
  return (
    <span data-feature-id={feature.id}>
      {aiChip && feature.ai && (
        <span className="mr-1 rounded bg-violet-50 px-1 py-0.5 text-[10px] font-bold text-violet-700">AI</span>
      )}
      <span data-feature-label>{feature.label}</span>
      {feature.badge && <> <FeatureBadge badge={feature.badge} /></>}
    </span>
  )
}
