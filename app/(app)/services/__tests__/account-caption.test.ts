import { describe, it, expect } from 'vitest'
import { connectedAccountsCaption } from '../accountCaption'

describe('connectedAccountsCaption', () => {
  it('names the count the backend reported', () => {
    expect(connectedAccountsCaption(0)).toBe('No AWS account connected')
    expect(connectedAccountsCaption(1)).toBe('1 AWS account connected; not every region is scanned')
    expect(connectedAccountsCaption(3)).toBe('3 AWS accounts connected; not every region is scanned')
  })

  it.each([undefined, null, -1, 1.5, NaN])('is null for %s: nothing is claimed', (value) => {
    expect(connectedAccountsCaption(value as number | null | undefined)).toBeNull()
  })
})
