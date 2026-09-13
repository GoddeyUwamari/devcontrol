/**
 * Security Truthfulness #40: CreateTicketDialog's auto-generated ticket content must
 * treat a resource's is_encrypted === false as confirmed remediation work, but must never
 * treat is_encrypted === null (unknown/unavailable evidence) as confirmed work -- a
 * remediation ticket should contain confirmed issues only.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CreateTicketDialog } from '../CreateTicketDialog'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function baseResource(overrides: Record<string, any>) {
  return {
    resource_id: 'r-1',
    resource_name: 'r-1',
    resource_type: 'ec2',
    region: 'us-east-1',
    compliance_issues: [],
    is_public: false,
    ...overrides,
  }
}

describe('CreateTicketDialog — is_encrypted truthiness safety (Security Truthfulness #40)', () => {
  it('counts only is_encrypted === false resources as "unencrypted", never null (unknown)', () => {
    const selectedResources = [
      baseResource({ resource_id: 'r-false', is_encrypted: false }),
      baseResource({ resource_id: 'r-null', is_encrypted: null }),
      baseResource({ resource_id: 'r-true', is_encrypted: true }),
    ]

    render(
      <CreateTicketDialog
        open={true}
        onOpenChange={() => {}}
        selectedResourceIds={['r-false', 'r-null', 'r-true']}
        selectedResources={selectedResources}
      />
    )

    fireEvent.click(screen.getByText('Auto-generate Title & Description'))

    const title = screen.getByLabelText(/Title/i) as HTMLInputElement
    const description = screen.getByLabelText(/Description/i) as HTMLTextAreaElement

    // Only the one confirmed-false resource counts -- not two.
    expect(title.value).toMatch(/^1 unencrypted AWS resource/)
    expect(title.value).not.toMatch(/^2 unencrypted/)

    // The description's per-resource "Not encrypted" annotation appears exactly once
    // (for r-false), never for r-null.
    const notEncryptedMatches = description.value.match(/⚠️ Not encrypted/g) || []
    expect(notEncryptedMatches).toHaveLength(1);
  });

  it('a resource list containing only null (unknown) and true resources generates no "unencrypted" claim at all', () => {
    const selectedResources = [
      baseResource({ resource_id: 'r-null', is_encrypted: null }),
      baseResource({ resource_id: 'r-true', is_encrypted: true }),
    ]

    render(
      <CreateTicketDialog
        open={true}
        onOpenChange={() => {}}
        selectedResourceIds={['r-null', 'r-true']}
        selectedResources={selectedResources}
      />
    )

    fireEvent.click(screen.getByText('Auto-generate Title & Description'))

    const title = screen.getByLabelText(/Title/i) as HTMLInputElement
    const description = screen.getByLabelText(/Description/i) as HTMLTextAreaElement

    expect(title.value).not.toMatch(/unencrypted/i)
    expect(description.value).not.toMatch(/⚠️ Not encrypted/)
  });
});
