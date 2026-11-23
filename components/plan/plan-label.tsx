import { cn } from '@/lib/utils'

/**
 * The plan a feature needs, as a small solid label beside a tag or heading (the Dashboard preview's
 * AI assistant card, the Engineering Intelligence locked board). Text only: a plan's customer-facing
 * name (PLAN_DISPLAY_NAME), never an internal tier id. Not interactive.
 */
export function PlanLabel({ children, testId = 'plan-label', className }: { children: string; testId?: string; className?: string }) {
  return (
    <span className={cn('text-label leading-none rounded-full px-3 py-1.5 bg-foreground text-background', className)} data-testid={testId}>
      {children}
    </span>
  )
}
