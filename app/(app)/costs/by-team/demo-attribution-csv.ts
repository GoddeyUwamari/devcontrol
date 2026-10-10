/**
 * The /costs/by-team CSV export, which exists only in demo mode: every figure
 * in it is sample data. The file says so twice -- in its name and in its first
 * row -- so a downloaded copy cannot be mistaken for a real cost allocation
 * once it leaves the page.
 */

export const DEMO_CSV_NOTICE = 'Demo data: sample figures, not your AWS account'

export interface DemoAttribution {
  by_team: Array<{ team_name: string; cost: number }>
  by_service: Array<{ service_name: string; cost: number }>
  by_resource_type: Array<{ resource_type: string; cost: number }>
}

export function demoAttributionCsvFilename(now: Date): string {
  return `cost-attribution-demo-data-${now.toISOString().split('T')[0]}.csv`
}

export function demoAttributionCsv(data: DemoAttribution): string {
  const rows: Array<Array<string | number>> = [
    [DEMO_CSV_NOTICE],
    ['Category', 'Name', 'Monthly Cost'],
    ...data.by_team.map(d => ['Team', d.team_name, d.cost]),
    ...data.by_service.map(d => ['Service', d.service_name, d.cost]),
    ...data.by_resource_type.map(d => ['Resource Type', d.resource_type, d.cost]),
  ]
  return rows.map(r => r.join(',')).join('\n')
}
