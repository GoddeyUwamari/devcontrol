'use client'

/**
 * The only place trial wording lives. Every trial button and trial line on
 * the marketing site and in the app renders through here, so the trial is
 * offered only while the server's switch is on (GET /api/billing/offer, read
 * by useBillingOffer, fail closed), and never with "no credit card".
 *
 * In-app pages already know whether this organization may start a trial
 * (the billing summary's trial.eligible, which applies the same switch) and
 * pass `eligible` instead; they make no public request.
 */
import type { CSSProperties } from 'react'
import { Check, CheckCircle2, Zap } from 'lucide-react'
import limits from '@/lib/plan/plan-limits.json'
import { PLAN_NAME, type Tier } from '@/lib/plan/plan-names'
import { useBillingOffer } from '@/lib/hooks/use-billing-offer'

export const DEFAULT_DAYS = limits.trial.days
/** The self-serve plans with a trial, as named everywhere ("Cost Control and Optimization Engine"). */
export const TRIAL_PLAN_NAMES = trialPlanNames(limits.trial.plans)

function trialPlanNames(plans: readonly string[], conjunction: 'and' | 'or' = 'and'): string {
  const names = plans
    .filter((p): p is Tier => Object.prototype.hasOwnProperty.call(PLAN_NAME, p))
    .map((p) => PLAN_NAME[p])
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}` : names.join('')
}

/** Every trial string, exactly as approved (catalog-step1.md, CAT-1 §3.2). */
export const TRIAL_COPY = {
  ctaOff: 'Get started',
  ctaOn: (days: number) => `Start ${days}-day trial`,
  sentence: (days: number, plans: string) => `${days}-day free trial on ${plans} (card required)`,
  table: (days: number, plans: string) => `${plans} include a ${days}-day free trial (card required).`,
  chip: (days: number) => `${days}-day free trial (card required)`,
  inApp: (days: number) => `${days}-day free trial. Card required; you're charged when the trial ends unless you cancel.`,
  /** Checkout success, while this organization's trial runs. */
  started: (days: number) => `Your ${days}-day free trial has started!`,
  noTrial: 'Free Visibility plan',
  /** Pricing FAQ, shown only while the trial is on. */
  faqAfterQuestion: 'What happens after my free trial?',
  faqAfterAnswer: (days: number) =>
    `When the ${days}-day trial ends, your plan continues and your card is charged, unless you cancel before then. Cancel before the trial ends and you aren't charged.`,
  faqIncludedQuestion: (days: number) => `What's included in the ${days}-day free trial?`,
  faqIncludedAnswer: (days: number, plansOr: string) =>
    `Everything in the plan you choose, for ${days} days, on ${plansOr}. A card is required; you're charged when the trial ends unless you cancel.`,
} as const

export const SIGN_UP_HREF = '/register'
/** After sign-up, the plan picker, where Checkout starts the trial. */
export const TRIAL_SIGN_UP_HREF = `/register#from=${encodeURIComponent('/settings/billing/upgrade')}`

interface TrialCtaProps {
  className?: string
  style?: CSSProperties
  /** A plan without a trial (free, enterprise) always shows the plain button. */
  plan?: Tier
  children?: never
}

/** A sign-up button: "Get started", or "Start 14-day trial" while the trial is on. */
export function TrialCta({ className, style, plan }: TrialCtaProps) {
  const offer = useBillingOffer()
  const on = offer.trialOn && (plan === undefined || offer.plans.includes(plan))
  return (
    <a href={on ? TRIAL_SIGN_UP_HREF : SIGN_UP_HREF} className={className} style={style} data-trial={on ? 'on' : 'off'}>
      {on ? TRIAL_COPY.ctaOn(offer.days) : TRIAL_COPY.ctaOff}
    </a>
  )
}

type PublicVariant = 'trust' | 'chip' | 'sentence' | 'table'

/** Icons a trial line can show before its text (chosen by name so server pages can pass it). */
const ICONS = { zap: Zap, check: Check, 'check-circle': CheckCircle2 } as const
export type TrialLineIcon = keyof typeof ICONS

/**
 * Props are plain data only (strings, numbers, style objects): server pages
 * render this client component, and a function prop can't cross that boundary
 * ("Functions cannot be passed directly to Client Components").
 */
interface TrialLineProps {
  variant: PublicVariant
  /** Trust row only: the items after the trial item, joined with " · ". */
  rest?: readonly string[]
  className?: string
  style?: CSSProperties
  /** An icon before the text, e.g. on a chip. */
  icon?: TrialLineIcon
  iconSize?: number
  iconClassName?: string
  iconStyle?: CSSProperties
  /** Put the text in its own <span> (next to an icon). */
  textSpan?: boolean
  /** Text around the trial wording, e.g. " " before and "." after a sentence. */
  prefix?: string
  suffix?: string
}

/** The trial line for public pages. Off: nothing, or "Free Visibility plan" in a trust row. */
export function TrialLine({
  variant, rest = [], className, style, icon, iconSize, iconClassName, iconStyle, textSpan, prefix = '', suffix = '',
}: TrialLineProps) {
  const offer = useBillingOffer()
  const plans = trialPlanNames(offer.plans)
  let text: string | null
  if (!offer.trialOn) {
    text = variant === 'trust' ? TRIAL_COPY.noTrial : null
  } else if (variant === 'trust' || variant === 'sentence') {
    text = TRIAL_COPY.sentence(offer.days, plans)
  } else if (variant === 'table') {
    text = TRIAL_COPY.table(offer.days, plans)
  } else {
    text = TRIAL_COPY.chip(offer.days)
  }
  const parts = variant === 'trust' ? [text, ...rest].filter((p): p is string => !!p) : text ? [text] : []
  if (parts.length === 0) return null
  const joined = `${prefix}${parts.join(' · ')}${suffix}`
  const Icon = icon ? ICONS[icon] : null
  return (
    <span className={className} style={style} data-trial={offer.trialOn ? 'on' : 'off'}>
      {Icon && <Icon size={iconSize} className={iconClassName} style={iconStyle} />}
      {textSpan ? <span>{joined}</span> : joined}
    </span>
  )
}

/** In-app trial line: shown only when the billing summary says this organization may start a trial. */
export function InAppTrialLine({ eligible, className }: { eligible: boolean; className?: string }) {
  if (!eligible) return null
  return <p className={className}>{TRIAL_COPY.inApp(DEFAULT_DAYS)}</p>
}

/** Public FAQ entries about the trial appear only while it is on. */
export function useTrialOn(): { on: boolean; days: number; plans: string; plansOr: string } {
  const offer = useBillingOffer()
  return { on: offer.trialOn, days: offer.days, plans: trialPlanNames(offer.plans), plansOr: trialPlanNames(offer.plans, 'or') }
}
