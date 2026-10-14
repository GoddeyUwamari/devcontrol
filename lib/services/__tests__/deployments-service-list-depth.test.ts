/**
 * deploymentsService.getAll -- the unpaged list the command palette searches.
 *
 * GET /api/deployments now defaults to a page of 25. The palette asks for 50
 * explicitly, so it searches the same depth it did when 50 was the default.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosAdapter } from 'axios'
import api from '@/lib/api'
import { deploymentsService } from '../deployments.service'

const urls: string[] = []
const originalAdapter = api.defaults.adapter
const adapter: AxiosAdapter = async (config) => {
  urls.push(config.url ?? '')
  return {
    data: { success: true, data: [{ id: 'd1', service_id: 's1', status: 'success', cost_estimate: null }], total: 1 },
    status: 200, statusText: 'OK', headers: {}, config,
  }
}

describe('deploymentsService.getAll', () => {
  beforeEach(() => {
    urls.length = 0
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it('sends the limit it is given, and still returns a plain array', async () => {
    const rows = await deploymentsService.getAll({ limit: 50 })
    expect(urls).toEqual(['/api/deployments?limit=50'])
    expect(Array.isArray(rows)).toBe(true)
    expect(rows[0]).toMatchObject({ id: 'd1', serviceId: 's1', costEstimate: null })
  })

  it('the command palette asks for 50', () => {
    const source = readFileSync(join(process.cwd(), 'components/command-palette.tsx'), 'utf8')
    expect(source).toContain('deploymentsService.getAll({ limit: 50 })')
    expect(source).not.toContain('deploymentsService.getAll()')
  })
})
