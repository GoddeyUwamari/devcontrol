/**
 * GET /api/aws/accounts `connection` (AWS connect PR B): the one rule every
 * page uses for "is AWS connected". It comes from the server's connection
 * state only, never from the row count or AWS-derived data.
 */
import { describe, it, expect } from 'vitest'
import { parseAwsConnection } from '../aws-accounts.service'

describe('parseAwsConnection', () => {
  it.each(['connected', 'not_connected', 'ambiguous'] as const)('passes the server state %s through', (state) => {
    expect(parseAwsConnection({ state }, [])).toBe(state)
  })

  it('the server state wins over the rows: rows that exist but are not active are not a connection', () => {
    expect(parseAwsConnection({ state: 'not_connected' }, [{ id: 'a', status: 'disconnected' }])).toBe('not_connected')
    expect(parseAwsConnection({ state: 'not_connected' }, [{ id: 'a', status: 'active' }])).toBe('not_connected')
  })

  it('an unrecognized state is an error, never "not connected" or "connected"', () => {
    expect(() => parseAwsConnection({ state: 'yes' }, [{ id: 'a', status: 'active' }])).toThrow()
    expect(() => parseAwsConnection({}, [])).toThrow()
    expect(() => parseAwsConnection(null, [])).toThrow()
  })

  describe('a server from before the field (frontend deployed first)', () => {
    it('applies the same rule from the rows\' own status: exactly one active row', () => {
      expect(parseAwsConnection(undefined, [])).toBe('not_connected')
      expect(parseAwsConnection(undefined, [{ id: 'a', status: 'active' }])).toBe('connected')
      expect(parseAwsConnection(undefined, [{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }])).toBe('ambiguous')
    })

    it('a row that exists but is not active is not connected (the old rule was "any row")', () => {
      expect(parseAwsConnection(undefined, [{ id: 'a', status: 'disconnected' }])).toBe('not_connected')
      expect(parseAwsConnection(undefined, [{ id: 'a' }])).toBe('not_connected')
    })

    it('a body that is not a list is an error', () => {
      expect(() => parseAwsConnection(undefined, { rows: [] })).toThrow()
    })
  })
})
