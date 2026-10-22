/**
 * lifecycleStateLabel: an EBS volume's 'available' reads "available
 * (unattached)"; every other state, and 'available' of any other type, is shown
 * as discovered; no state is "—".
 */
import { describe, it, expect } from 'vitest'
import { isRunningOrNormalState, isStoppedOrPendingState, lifecycleStateLabel } from '../stateLabel'

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

describe('isStoppedOrPendingState / isRunningOrNormalState -- the cards\' rule for each state', () => {
  it('T7.5 an EBS volume in a failure or transitional state counts as stopped or pending; attached or unattached never does', () => {
    for (const state of ['error', 'creating', 'deleting', 'deleted']) {
      expect(isStoppedOrPendingState('ebs', state)).toBe(true)
      expect(isRunningOrNormalState('ebs', state)).toBe(false)
    }
    for (const state of ['available', 'in-use']) {
      expect(isStoppedOrPendingState('ebs', state)).toBe(false)
      expect(isRunningOrNormalState('ebs', state)).toBe(true)
    }
  })

  it('T7.5 every other type keeps stopped / pending and running', () => {
    expect(isStoppedOrPendingState('ec2', 'stopped')).toBe(true)
    expect(isStoppedOrPendingState('ec2', 'pending')).toBe(true)
    expect(isStoppedOrPendingState('ec2', 'running')).toBe(false)
    expect(isStoppedOrPendingState('cloudfront', 'available')).toBe(false)
    expect(isRunningOrNormalState('ec2', 'running')).toBe(true)
    expect(isRunningOrNormalState('rds', 'available')).toBe(false)
    expect(isStoppedOrPendingState('s3', null)).toBe(false)
    expect(isRunningOrNormalState('s3', null)).toBe(false)
  })
})
