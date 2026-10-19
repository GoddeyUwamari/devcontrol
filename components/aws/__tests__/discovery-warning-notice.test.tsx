/**
 * The deletion-detection notice: shown, with this exact text, wherever
 * discovery status is shown, when the latest discovery run reported the
 * truncated-index warning (backend/src/services/discovery-warnings.ts).
 *
 * The services page's own behavior is in
 * app/(app)/services/__tests__/services-status-truthfulness.test.tsx; the
 * cost-optimization and infrastructure pages are checked by source here, as
 * page-terminology-and-wiring.test.ts does, since rendering them needs many
 * live queries mocked.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DiscoveryWarningNotice,
  DELETION_DETECTION_PAUSED_TEXT,
  DISCOVERY_WARNING_TRUNCATED_INDEX,
} from '../discovery-warning-notice'

const root = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf-8')

describe('DiscoveryWarningNotice', () => {
  it('shows the exact text for the truncated-index warning', () => {
    render(<DiscoveryWarningNotice warnings={[DISCOVERY_WARNING_TRUNCATED_INDEX]} />)
    expect(screen.getByRole('status').textContent).toBe(
      'Deletion detection is paused for some resource types: your inventory exceeds 1,000 indexed resources.'
    )
    expect(DELETION_DETECTION_PAUSED_TEXT).toBe(
      'Deletion detection is paused for some resource types: your inventory exceeds 1,000 indexed resources.'
    )
  })

  it.each([[[]], [undefined], [null], [['some_other_warning']]])('shows nothing for warnings %p', (warnings) => {
    const { container } = render(<DiscoveryWarningNotice warnings={warnings} />)
    expect(container.textContent).toBe('')
  })

  it('uses the code the backend writes', () => {
    expect(read('backend/src/services/discovery-warnings.ts')).toContain(
      `DISCOVERY_WARNING_TRUNCATED_INDEX = '${DISCOVERY_WARNING_TRUNCATED_INDEX}'`
    )
  })
})

describe('the pages that show discovery status show the notice', () => {
  it("cost optimization: under the analysis status, from the latest discovery job's warnings", () => {
    const source = read('app/(app)/cost-optimization/page.tsx')
    expect(source).toMatch(/<AnalysisStatusBanner[\s\S]{0,200}\/>\s*\{[^}]*\}\s*<DiscoveryWarningNotice warnings=\{discoveryJobs\?\.\[0\]\?\.warnings\}/)
  })

  it('infrastructure: beside the sync result, from the run it just started', () => {
    const source = read('app/(app)/infrastructure/page.tsx')
    expect(source).toContain('if (hasDeletionDetectionPaused(result.warnings)) toast.warning(DELETION_DETECTION_PAUSED_TEXT)')
  })
})
