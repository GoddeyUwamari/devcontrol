/**
 * lifecycleStateLabel: an EBS volume's 'available' reads "available
 * (unattached)"; every other state, and 'available' of any other type, is shown
 * as discovered; no state is "—".
 */
import { describe, it, expect } from 'vitest'
import { lifecycleStateLabel } from '../stateLabel'

describe('lifecycleStateLabel', () => {
  it('T4.5 explains an unattached EBS volume and shows other EBS states as-is', () => {
    expect(lifecycleStateLabel('ebs', 'available')).toBe('available (unattached)')
    expect(lifecycleStateLabel('ebs', 'in-use')).toBe('in-use')
    expect(lifecycleStateLabel('ebs', 'error')).toBe('error')
  })

  it('T4.5 leaves every other type as discovered', () => {
    expect(lifecycleStateLabel('rds', 'running')).toBe('running')
    expect(lifecycleStateLabel('cloudfront', 'available')).toBe('available')
    expect(lifecycleStateLabel('ec2', null)).toBe('—')
  })
})
