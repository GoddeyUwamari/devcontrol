import type { BenchmarkLevel } from '@/lib/types'
import { COPY, LEVEL_NAME } from '../_lib/dora-page'

/**
 * Level, target and Planned chips. Colours are the app's ink tokens on their 50
 * tints (app/globals.css), so no chip needs a colour of its own.
 */
const LEVEL_TONE: Record<BenchmarkLevel, string> = {
  elite: 'bg-green-50 border-green-200 text-ink-success-strong',
  high: 'bg-blue-50 border-blue-200 text-ink-info',
  medium: 'bg-amber-50 border-amber-200 text-ink-warning-strong',
  low: 'bg-red-50 border-red-200 text-ink-danger-strong',
}

const CHIP = 'inline-flex items-center text-label px-2 py-0.5 rounded-full border whitespace-nowrap'

export function LevelChip({ level, testId }: { level: BenchmarkLevel; testId?: string }) {
  return <span data-testid={testId} data-level={level} className={`${CHIP} ${LEVEL_TONE[level]}`}>{LEVEL_NAME[level]}</span>
}

/** Met: the accent (purple). Missed: amber, so the two never look alike; the text says which. */
const TARGET_MET = 'bg-violet-50 border-violet-200 text-ink-accent'
const TARGET_MISSED = 'bg-amber-50 border-amber-200 text-ink-warning-strong'

export function TargetChip({ meets, testId }: { meets: boolean; testId?: string }) {
  return (
    <span
      data-testid={testId}
      data-meets={meets ? 'true' : 'false'}
      className={`${CHIP} ${meets ? TARGET_MET : TARGET_MISSED}`}
    >
      {meets ? COPY.meetsTarget : COPY.missesTarget}
    </span>
  )
}

export function PlannedChip() {
  return <span className={`${CHIP} border-dashed border-slate-300 bg-white text-ink-muted`}>{COPY.planned}</span>
}
