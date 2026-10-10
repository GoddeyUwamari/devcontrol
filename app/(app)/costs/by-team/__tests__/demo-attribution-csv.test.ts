/**
 * The /costs/by-team export is demo data only; the downloaded file must say so
 * in its name and its first row, since it travels without the page around it.
 */
import { describe, it, expect } from 'vitest'
import { DEMO_CSV_NOTICE, demoAttributionCsv, demoAttributionCsvFilename } from '../demo-attribution-csv'

describe('demo attribution CSV', () => {
  it('names the file as demo data', () => {
    expect(demoAttributionCsvFilename(new Date('2026-10-10T12:00:00Z'))).toBe('cost-attribution-demo-data-2026-10-10.csv')
  })

  it('opens with a demo-data notice row, before the header and the sample rows', () => {
    const lines = demoAttributionCsv({
      by_team: [{ team_name: 'Platform', cost: 10 }],
      by_service: [{ service_name: 'api', cost: 5 }],
      by_resource_type: [{ resource_type: 'EC2', cost: 7 }],
    }).split('\n')
    expect(lines[0]).toBe(DEMO_CSV_NOTICE)
    expect(lines[0]).toMatch(/^Demo data/)
    expect(lines.slice(1)).toEqual(['Category,Name,Monthly Cost', 'Team,Platform,10', 'Service,api,5', 'Resource Type,EC2,7'])
  })
})
