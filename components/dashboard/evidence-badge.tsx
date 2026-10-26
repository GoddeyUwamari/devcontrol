import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

/**
 * Small status chip for the Dashboard's top sections. Callers pass the text
 * color they already use (the existing badge objects carry only a color);
 * the chip's tint is looked up from it so every badge stays on the theme's
 * own success / warning / danger / accent tokens. On its tint, status text
 * uses the -strong ink, which keeps 4.5:1 on the --bg-* tints.
 */
const TONES: Record<string, { background: string; fillClass: string; text: string }> = {
  'var(--text-success)': { background: 'var(--bg-success)', fillClass: 'bg-[color:var(--fill-success)]', text: 'var(--app-color-ink-success-strong)' },
  'var(--text-warning)': { background: 'var(--bg-warning)', fillClass: 'bg-[color:var(--fill-warning)]', text: 'var(--app-color-ink-warning-strong)' },
  'var(--text-danger)': { background: 'var(--bg-danger)', fillClass: 'bg-[color:var(--fill-danger)]', text: 'var(--app-color-ink-danger-strong)' },
  'var(--text-accent)': { background: 'var(--bg-accent)', fillClass: 'bg-[color:var(--text-accent)]', text: 'var(--text-accent)' },
}
const NEUTRAL = { background: 'var(--surface-1)', fillClass: 'bg-[color:var(--text-secondary)]' }

export const NEUTRAL_COLOR = 'var(--text-secondary)'

export function toneBackground(color: string): string {
  return (TONES[color] ?? NEUTRAL).background
}

/** The text colour for a status colour on its own tint: the -strong ink for success / warning / danger. */
export function toneText(color: string): string {
  return TONES[color]?.text ?? color
}

/** Literal class strings so Tailwind generates them. */
export function toneFillClass(color: string): string {
  return (TONES[color] ?? NEUTRAL).fillClass
}

export interface EvidenceBadgeProps {
  label: string
  color: string
  /** Trend arrow for comparison badges; omit for plain status chips. */
  direction?: 'up' | 'down' | 'flat'
  testId?: string
}

export function EvidenceBadge({ label, color, direction, testId }: EvidenceBadgeProps) {
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : direction === 'flat' ? Minus : null
  return (
    <span
      data-testid={testId}
      className="inline-flex items-center gap-1 text-label font-semibold px-2 py-0.5 rounded-full border border-border whitespace-nowrap max-w-full"
      style={{ color: toneText(color), background: toneBackground(color) }}
    >
      {Icon && <Icon size={12} aria-hidden="true" className="shrink-0" />}
      <span className="truncate">{label}</span>
    </span>
  )
}

/** The evidence-state chip shown wherever the backend marked a score partial. */
export function PartialBadge({ testId }: { testId?: string }) {
  return <EvidenceBadge label="Partial" color={NEUTRAL_COLOR} testId={testId} />
}
