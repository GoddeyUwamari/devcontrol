/**
 * Security V2 F3b, founder answer Q2: adding, editing and deleting a rule are member-or-above on the server
 * (requireMember on POST /:id/rules, PUT and DELETE /rules/:ruleId). A viewer sees each control disabled with one
 * short sentence; a role not read yet fails closed with no sentence; the server stays the boundary.
 */
const m = vi.hoisted(() => ({ role: 'viewer' as string | null, rules: [] as unknown[] }))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FrameworkDetailsModal, RULE_VIEWER_REASONS } from '../FrameworkDetailsModal'
import type { ComplianceFramework } from '@/lib/services/compliance-frameworks.service'

vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => m.role }))
vi.mock('@/lib/hooks/useComplianceFrameworks', () => ({
  useFrameworkDetails: () => ({ rules: m.rules, loading: false, createRule: vi.fn(), updateRule: vi.fn(), deleteRule: vi.fn() }),
}))

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const FRAMEWORK = { id: 'fw-1', name: 'Example baseline', description: null } as ComplianceFramework
const RULE = {
  id: 'r-1', framework_id: 'fw-1', rule_code: 'EX-1', title: 'Example rule', description: null, severity: 'high', category: 'tagging',
  rule_type: 'tag_required', conditions: {}, resource_types: [], recommendation: 'Example', remediation_url: null, enabled: true,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
}

const show = () => render(<FrameworkDetailsModal open onClose={() => {}} framework={FRAMEWORK} />)

beforeEach(() => {
  m.role = 'viewer'
  m.rules = [RULE]
})

describe('rule actions by role (Q2)', () => {
  it('a viewer: Add Rule, edit and delete are disabled, each with its sentence', () => {
    show()
    expect(screen.getByRole('button', { name: /Add Rule/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Add Rule/ })).toHaveAccessibleDescription(RULE_VIEWER_REASONS.add)
    expect(screen.getByRole('button', { name: 'Edit rule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit rule' })).toHaveAccessibleDescription("Viewers can't edit rules.")
    expect(screen.getByRole('button', { name: 'Delete rule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete rule' })).toHaveAccessibleDescription("Viewers can't delete rules.")
    expect(RULE_VIEWER_REASONS.add).toBe("Viewers can't add rules.")
  })
  it('a viewer with no rules: "Add Your First Rule" is disabled with the add sentence', () => {
    m.rules = []
    show()
    for (const button of screen.getAllByRole('button', { name: /Add (Rule|Your First Rule)/ })) {
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription("Viewers can't add rules.")
    }
  })
  it('a role not read yet fails closed, with no sentence', () => {
    m.role = null
    show()
    expect(screen.getByRole('button', { name: /Add Rule/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit rule' })).toBeDisabled()
    expect(document.body.textContent).not.toContain('Viewers can')
  })
  it.each(['member', 'admin', 'owner'])('%s: every rule action is enabled, with no sentence', (role) => {
    m.role = role
    show()
    expect(screen.getByRole('button', { name: /Add Rule/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit rule' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete rule' })).toBeEnabled()
    expect(document.body.textContent).not.toContain('Viewers can')
  })
})
