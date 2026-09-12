import { Pool } from 'pg'
import { CloudWatchService } from './cloudwatch.service'
import {
  SloIndicator,
  SloResourceType,
  SloWindow,
  SloEvaluationResult,
  SLI_RESOURCE_TYPE,
  SUPPORTED_SLIS,
  SUPPORTED_WINDOWS,
  evaluateSlo,
} from './slo-evaluation'

export interface SloDefinition {
  id: string
  organizationId: string
  name: string
  resourceType: SloResourceType
  resourceId: string
  sli: SloIndicator
  targetValue: number
  evaluationWindow: SloWindow
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateSloPayload {
  name: string
  resourceId: string
  sli: SloIndicator
  targetValue: number
  evaluationWindow?: SloWindow
}

export interface UpdateSloPayload {
  name?: string
  resourceId?: string
  targetValue?: number
  evaluationWindow?: SloWindow
  enabled?: boolean
}

export class SloValidationError extends Error {}
export class SloNotFoundError extends Error {}

/**
 * Validates a create payload against the canonical supported domain
 * (SUPPORTED_SLIS/SUPPORTED_WINDOWS from slo-evaluation.ts) rather than trusting
 * arbitrary client input — the UI is expected to only ever offer these same choices
 * (see lib/services/slo.service.ts on the frontend), but the backend is the actual
 * boundary, same as every other Enterprise-gated write in this codebase.
 */
function validateCreatePayload(payload: CreateSloPayload): { resourceType: SloResourceType; targetValue: number; evaluationWindow: SloWindow } {
  if (!payload.name?.trim()) throw new SloValidationError('name is required')
  if (!payload.resourceId?.trim()) throw new SloValidationError('resourceId is required')
  if (!SUPPORTED_SLIS.includes(payload.sli)) {
    throw new SloValidationError(`Unsupported sli "${payload.sli}". Supported: ${SUPPORTED_SLIS.join(', ')}`)
  }

  const evaluationWindow = payload.evaluationWindow ?? '7d'
  if (!SUPPORTED_WINDOWS.includes(evaluationWindow)) {
    throw new SloValidationError(`Unsupported evaluationWindow "${evaluationWindow}". Supported: ${SUPPORTED_WINDOWS.join(', ')}`)
  }

  const targetValue = payload.targetValue
  if (typeof targetValue !== 'number' || !Number.isFinite(targetValue)) {
    throw new SloValidationError('targetValue must be a finite number')
  }

  const resourceType = SLI_RESOURCE_TYPE[payload.sli]
  const isPercentSli = payload.sli !== 'alb_latency_avg'
  if (isPercentSli && (targetValue <= 0 || targetValue >= 100)) {
    throw new SloValidationError('targetValue for a percentage-based SLI must be strictly between 0 and 100')
  }
  if (!isPercentSli && targetValue <= 0) {
    throw new SloValidationError('targetValue for alb_latency_avg must be greater than 0')
  }

  return { resourceType, targetValue, evaluationWindow }
}

function mapRow(row: any): SloDefinition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    sli: row.sli,
    targetValue: parseFloat(row.target_value),
    evaluationWindow: row.evaluation_window,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SloService {
  constructor(
    private pool: Pool,
    private cloudWatchService: CloudWatchService = new CloudWatchService()
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────
  // Every query is organization-scoped in the SQL itself (defense in depth on top of
  // RLS's app.current_organization_id session tag — see auth.middleware.ts), matching
  // custom-anomaly-rules.service.ts's convention.

  async listSlos(organizationId: string): Promise<SloDefinition[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM slo_definitions WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId]
    )
    return rows.map(mapRow)
  }

  async getSlo(id: string, organizationId: string): Promise<SloDefinition> {
    const { rows } = await this.pool.query(
      `SELECT * FROM slo_definitions WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    )
    if (rows.length === 0) throw new SloNotFoundError('SLO not found')
    return mapRow(rows[0])
  }

  async createSlo(organizationId: string, payload: CreateSloPayload): Promise<SloDefinition> {
    const { resourceType, targetValue, evaluationWindow } = validateCreatePayload(payload)

    const { rows } = await this.pool.query(
      `INSERT INTO slo_definitions
         (organization_id, name, resource_type, resource_id, sli, target_value, evaluation_window)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [organizationId, payload.name.trim(), resourceType, payload.resourceId.trim(), payload.sli, targetValue, evaluationWindow]
    )
    return mapRow(rows[0])
  }

  async updateSlo(id: string, organizationId: string, payload: UpdateSloPayload): Promise<SloDefinition> {
    const existing = await this.getSlo(id, organizationId)

    const fields: string[] = []
    const values: any[] = []
    let idx = 1

    if (payload.name !== undefined) {
      if (!payload.name.trim()) throw new SloValidationError('name cannot be empty')
      fields.push(`name = $${idx++}`)
      values.push(payload.name.trim())
    }
    if (payload.resourceId !== undefined) {
      if (!payload.resourceId.trim()) throw new SloValidationError('resourceId cannot be empty')
      fields.push(`resource_id = $${idx++}`)
      values.push(payload.resourceId.trim())
    }
    if (payload.evaluationWindow !== undefined) {
      if (!SUPPORTED_WINDOWS.includes(payload.evaluationWindow)) {
        throw new SloValidationError(`Unsupported evaluationWindow "${payload.evaluationWindow}"`)
      }
      fields.push(`evaluation_window = $${idx++}`)
      values.push(payload.evaluationWindow)
    }
    if (payload.targetValue !== undefined) {
      const isPercentSli = existing.sli !== 'alb_latency_avg'
      if (isPercentSli && (payload.targetValue <= 0 || payload.targetValue >= 100)) {
        throw new SloValidationError('targetValue for a percentage-based SLI must be strictly between 0 and 100')
      }
      if (!isPercentSli && payload.targetValue <= 0) {
        throw new SloValidationError('targetValue for alb_latency_avg must be greater than 0')
      }
      fields.push(`target_value = $${idx++}`)
      values.push(payload.targetValue)
    }
    if (payload.enabled !== undefined) {
      fields.push(`enabled = $${idx++}`)
      values.push(payload.enabled)
    }

    if (fields.length === 0) return existing

    fields.push('updated_at = NOW()')
    values.push(id, organizationId)

    const { rows, rowCount } = await this.pool.query(
      `UPDATE slo_definitions SET ${fields.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx++} RETURNING *`,
      values
    )
    if (rowCount === 0) throw new SloNotFoundError('SLO not found')
    return mapRow(rows[0])
  }

  async deleteSlo(id: string, organizationId: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM slo_definitions WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    )
    if (rowCount === 0) throw new SloNotFoundError('SLO not found')
  }

  // ── Evaluation ────────────────────────────────────────────────────────────

  /**
   * Evaluates one SLO on demand against live CloudWatch telemetry. No caching, no
   * background sweep, no persisted evaluation history — this is a live read, same
   * "no historical warehouse" boundary the whole 3A scope is built around. See
   * evaluateSlo() in slo-evaluation.ts for the actual status/error-budget math.
   */
  async evaluateSloById(id: string, organizationId: string): Promise<{ definition: SloDefinition; evaluation: SloEvaluationResult }> {
    const definition = await this.getSlo(id, organizationId)
    const observation = await this.cloudWatchService.evaluateResourceForSlo(
      organizationId,
      definition.resourceType,
      definition.resourceId,
      definition.evaluationWindow
    )
    const evaluation = evaluateSlo(definition.sli, definition.targetValue, observation !== null, observation)
    return { definition, evaluation }
  }

  /**
   * Evaluates every enabled SLO for an org. Sequential rather than Promise.all-ed on
   * purpose: each evaluation is itself already a small burst of CloudWatch calls (one
   * per metric the resource's capability declares — see cloudwatch.service.ts's
   * MetricDefinition arrays), and this method has no bound on how many SLOs an org can
   * define. Running all of them concurrently would multiply that burst by the SLO
   * count with no rate limiting — see the completed audit's §22 performance-risk
   * finding about /admin/monitoring's existing uncached-CloudWatch-calls pattern. This
   * does not fix that pre-existing pattern; it deliberately avoids making a new,
   * SLO-shaped instance of the same problem.
   */
  async evaluateAllSlos(organizationId: string): Promise<Array<{ definition: SloDefinition; evaluation: SloEvaluationResult }>> {
    const definitions = await this.listSlos(organizationId)
    const results: Array<{ definition: SloDefinition; evaluation: SloEvaluationResult }> = []
    for (const definition of definitions.filter((d) => d.enabled)) {
      const observation = await this.cloudWatchService.evaluateResourceForSlo(
        organizationId,
        definition.resourceType,
        definition.resourceId,
        definition.evaluationWindow
      )
      const evaluation = evaluateSlo(definition.sli, definition.targetValue, observation !== null, observation)
      results.push({ definition, evaluation })
    }
    return results
  }
}
