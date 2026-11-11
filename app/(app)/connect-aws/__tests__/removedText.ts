/**
 * The Connect AWS page's forbidden-text scan, shared by its test suites (not a test file itself).
 * Strings PR E removed, plus the ones AWS connect PR D1 retires: never rendered again, in any state.
 */
import { expect } from 'vitest'

export const REMOVED_STRINGS = [
  '✅ Connection verified — redirecting to your dashboard...',
  'Verifying connection...',
  'Our setup guide walks through the exact IAM role configuration step by step.',
  'Cost and usage reports',
  'or other stored data',
  'Disconnect it first',
  'Read-only by default',
  'AES-256 encrypted at rest',
  'SOC 2 readiness planning underway',
  'If you leave before that, nothing is saved.',
  'Set up a read-only IAM role so DevControl can analyse',
  // PR D1: the old ALREADY_CONNECTED (B1) and discovery (B2) wording, and a status the page never claims.
  'in Settings',
  'Connected and working',
]

export function expectNoRemovedText() {
  const text = document.body.textContent ?? ''
  for (const removed of REMOVED_STRINGS) expect(text, removed).not.toContain(removed)
  // A substring check, stricter than "standalone": textContent runs adjacent elements together,
  // so a word boundary can't be relied on.
  expect(text).not.toMatch(/verified/i)
  expect(text).not.toContain('✅')
}
