/**
 * Coverage for the Phase 1 security foundation's frontend removal of
 * custom_script: the rule-type <select> must never offer it (or
 * relationship_check, never actually implemented by the backend evaluator),
 * and the "Load Example" button must never populate a JavaScript payload for
 * either. The backend independently rejects both at the API boundary
 * regardless of what this UI offers (see
 * backend/src/controllers/compliance-frameworks.controller.ts's
 * checkRuleTypeAndConditions) -- this test covers the UI side of that same
 * guarantee, not a substitute for it.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CreateRuleModal } from '../CreateRuleModal'

function renderModal() {
  return render(
    <CreateRuleModal open={true} onClose={() => {}} onSubmit={async () => {}} />
  )
}

describe('CreateRuleModal -- V1 rule vocabulary only', () => {
  it('the rule-type select offers exactly the V1 vocabulary, never custom_script or relationship_check', () => {
    renderModal()
    const select = screen.getByLabelText(/rule type/i) as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)

    expect(optionValues).toEqual(['property_check', 'tag_required', 'tag_pattern', 'metadata_check'])
    expect(optionValues).not.toContain('custom_script')
    expect(optionValues).not.toContain('relationship_check')
  })

  it('"Load Example" never populates a JavaScript script payload for any selectable rule type', () => {
    renderModal()
    const select = screen.getByLabelText(/rule type/i) as HTMLSelectElement
    const loadExampleButton = screen.getByText('Load Example')
    const conditionsField = () => screen.getByLabelText(/conditions/i) as HTMLTextAreaElement

    for (const value of Array.from(select.options).map((o) => o.value)) {
      fireEvent.change(select, { target: { value } })
      fireEvent.click(loadExampleButton)
      expect(conditionsField().value).not.toMatch(/script/i)
      expect(conditionsField().value).not.toMatch(/new Function/i)
    }
  })
})
