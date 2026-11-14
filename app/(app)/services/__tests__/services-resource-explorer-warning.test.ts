/**
 * Multi-region PR 1 fix round (founder-approved copy, Nov 14): the warnings
 * resource_explorer_no_index and resource_explorer_no_view have their own text,
 * naming the home region, instead of the generic UNKNOWN_WARNING_TEXT.
 *
 *   "Resource Explorer isn't turned on in {region}, so some resource types (such as
 *    ECS, VPC and DynamoDB) weren't listed. Everything else was checked."
 *
 * Both codes give that one sentence, once. Without a home region they are not
 * described (the generic line, existing copy). Other codes keep their behaviour.
 */
import { describe, it, expect } from 'vitest'
import { DELETION_DETECTION_PAUSED_TEXT, DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'
import {
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW,
  UNKNOWN_WARNING_TEXT,
  resourceExplorerOffText,
  warningNotes,
} from '../coverage'

const SENTENCE = "Resource Explorer isn't turned on in eu-central-1, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked."
const bodies = (notes: { body: string }[]) => notes.map((n) => n.body)

describe('Resource Explorer warnings on the Services page', () => {
  it('the approved sentence, with the home region', () => {
    expect(resourceExplorerOffText('eu-central-1')).toBe(SENTENCE)
  })

  it.each([
    ['no index', [DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX]],
    ['no default view', [DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW]],
    ['both', [DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX, DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW]],
  ])('%s: the sentence once, never the generic line', (_label, codes) => {
    const notes = warningNotes(codes, [], 'eu-central-1')
    expect(notes).toEqual([{ key: 'resource-explorer-off', tone: 'warn', body: SENTENCE }])
    expect(bodies(notes)).not.toContain(UNKNOWN_WARNING_TEXT)
  })

  it('from a scan in this tab too', () => {
    expect(bodies(warningNotes([], [DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX], 'eu-central-1'))).toEqual([SENTENCE])
  })

  it('beside other codes: each keeps its own line; an unknown code still adds the generic line', () => {
    const notes = warningNotes([DISCOVERY_WARNING_TRUNCATED_INDEX, DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW, 'future_code'], [], 'eu-central-1')
    expect(bodies(notes)).toEqual([DELETION_DETECTION_PAUSED_TEXT, SENTENCE, UNKNOWN_WARNING_TEXT])
  })

  it.each([undefined, null, ''])('without a home region (%p): not described; the generic line, as before', (home) => {
    expect(bodies(warningNotes([DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX], [], home))).toEqual([UNKNOWN_WARNING_TEXT])
  })

  it('no Resource Explorer code: no sentence', () => {
    expect(bodies(warningNotes([DISCOVERY_WARNING_TRUNCATED_INDEX], [], 'eu-central-1'))).toEqual([DELETION_DETECTION_PAUSED_TEXT])
  })
})
