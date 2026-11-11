'use client'

import { useState, type ReactNode } from 'react'
import customerRoleInlinePolicy from '@/lib/aws/customer-role-inline-policy.json'
import {
  COPIED,
  DISCONNECT_AFTER,
  DISCONNECT_BEFORE,
  DISCONNECT_LINK,
  SUPPORT_MAILTO,
} from './connectAwsCopy'

/** The inline policy exactly as the page shows and copies it (the file the backend IAM coverage test checks). */
export const INLINE_POLICY_JSON = JSON.stringify(customerRoleInlinePolicy, null, 2)

/** How many actions the inline policy's Deny statement lists: counted from the file, never hard-coded. */
export const INLINE_POLICY_DENY_COUNT = customerRoleInlinePolicy.Statement
  .filter((statement) => statement.Effect === 'Deny')
  .reduce((n, statement) => n + (Array.isArray(statement.Action) ? statement.Action.length : 1), 0)

/** A policy document on a dark code block: the only light-on-dark text on the Connect AWS page. */
export function PolicyJson({ json, testId }: { json: string; testId?: string }) {
  return (
    <div className="bg-slate-900 rounded-xl p-4 mb-3 overflow-x-auto">
      <pre data-testid={testId} className="text-ui text-slate-200 font-mono whitespace-pre-wrap break-words leading-relaxed">{json}</pre>
    </div>
  )
}

/** A link to the support mailbox (PE-D2). */
export function ContactLink({ children }: { children: ReactNode }) {
  return (
    <a href={SUPPORT_MAILTO} className="text-ink-accent font-medium underline hover:text-violet-800">
      {children}
    </a>
  )
}

/** "To disconnect or change accounts, contact us." with the link. */
export function DisconnectSentence() {
  return (
    <span data-testid="disconnect-sentence">
      {DISCONNECT_BEFORE}<ContactLink>{DISCONNECT_LINK}</ContactLink>{DISCONNECT_AFTER}
    </span>
  )
}

/** A button that copies `text` and shows "✓ Copied!" for two seconds. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
      className={className ?? 'border border-slate-200 rounded-lg px-3.5 py-1.5 text-ui font-medium text-ink-muted hover:text-ink hover:border-slate-300 cursor-pointer transition-colors bg-transparent'}
    >
      {copied ? COPIED : label}
    </button>
  )
}
