import { describe, expect, it } from 'vitest'
import { HEALTH_FAILING_HELP } from '../connectAwsCopy'
import { CONNECTION_FAILING_HELP } from '../../../../backend/src/config/weekly-email-copy'

// The weekly summary email repeats the Connect AWS page's failing-connection help (WE-2).
describe('weekly summary email: connection help text', () => {
  it('is the Connect AWS page text, word for word', () => {
    expect(CONNECTION_FAILING_HELP).toBe(HEALTH_FAILING_HELP)
  })
})
