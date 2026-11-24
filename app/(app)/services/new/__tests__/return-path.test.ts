/**
 * /services/new: where it goes once the service is created (D8b-2). "Create a
 * service →" on the GitHub page sends returnTo=/settings/integrations/github;
 * only a same-site path is followed, anything else goes to /services.
 */
import { describe, expect, it } from 'vitest'
import { returnPathAfterCreate } from '../return-path'

describe('returnPathAfterCreate', () => {
  it('follows the GitHub page return path', () => {
    expect(returnPathAfterCreate('?returnTo=%2Fsettings%2Fintegrations%2Fgithub')).toBe('/settings/integrations/github')
  })
  it('no returnTo -> /services', () => {
    expect(returnPathAfterCreate('')).toBe('/services')
  })
  it.each(['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '%2F%2Fevil.example', '/%2e%2e//evil.example'])(
    'refuses %s -> /services', (value) => {
      expect(returnPathAfterCreate(`?returnTo=${encodeURIComponent(value)}`)).toBe('/services')
    })
})
