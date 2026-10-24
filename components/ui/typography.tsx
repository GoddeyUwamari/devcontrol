import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * App type roles (typography plan §4.1) as components, for the signed-in app
 * only: the text-* and ink-* tokens they use have values only on the app
 * surface (app/globals.css, APP SURFACE block).
 */

/**
 * The page title and subtitle roles. PageHeader uses them, and so does any page that lays out its own h1 (the
 * pre-connect dashboard), so the two cannot drift; layout classes go alongside them through cn().
 */
const PAGE_TITLE_CLASS = "text-title text-ink"
const PAGE_SUBTITLE_CLASS = "text-subtitle text-ink-muted"

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Buttons or links beside the title; they wrap below it on a phone. */
  actions?: React.ReactNode
  /** For a section that is named by the page title (aria-labelledby). */
  titleId?: string
  className?: string
}

/** The page's one h1 (28/36 semibold) and an optional subtitle (15/22, muted). */
function PageHeader({ title, subtitle, actions, titleId, className }: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}
    >
      <div className="min-w-0">
        <h1 id={titleId} className={PAGE_TITLE_CLASS}>
          {title}
        </h1>
        {subtitle && <p className={cn(PAGE_SUBTITLE_CLASS, "mt-2 max-w-[70ch]")}>{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/**
 * Costs, counts and percentages in running text: tabular figures, so digits
 * line up and don't jitter.
 */
function Num({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="num" className={cn("tabular-nums", className)} {...props} />
}

export { PageHeader, Num, PAGE_TITLE_CLASS, PAGE_SUBTITLE_CLASS }
