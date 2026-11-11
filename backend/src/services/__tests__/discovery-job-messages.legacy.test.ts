/**
 * B2/B3 (AWS connect PR D1a, CP-D12 note): the failed-discovery text now names
 * the Connect AWS page; rows stored by earlier releases with the old "in
 * Settings" text are shown as the new text when read, with no data migration.
 * The readiness gate reads both as unrecognized (neither starts with a
 * discovery error prefix).
 */
import {
  DISCOVERY_FAILED_MESSAGE,
  DISCOVERY_STEPS_INCOMPLETE_MESSAGE,
  LEGACY_DISCOVERY_MESSAGES,
  approvedDiscoveryMessages,
  publicDiscoveryErrorMessage,
} from '../discovery-job-messages';
import { DISCOVERY_ERROR_PREFIXES, evaluateDiscoveryGate } from '../observability-readiness.service';
import { PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../platform-sts';

const OLD = 'Discovery could not complete. Check the AWS connection in Settings, then try again.';
const NEW = 'Discovery could not complete. Check the AWS connection on the Connect AWS page, then try again.';

describe('the failed-discovery message (B2) and the old one on read (B3)', () => {
  it('is the approved B2 text, and the old text is mapped to it', () => {
    expect(DISCOVERY_FAILED_MESSAGE).toBe(NEW);
    expect(LEGACY_DISCOVERY_MESSAGES).toEqual({ [OLD]: NEW });
    expect(approvedDiscoveryMessages()).toContain(NEW);
    expect(approvedDiscoveryMessages()).not.toContain(OLD);
  });

  it('old -> new; new passes; both appear once', () => {
    expect(publicDiscoveryErrorMessage(OLD)).toBe(NEW);
    expect(publicDiscoveryErrorMessage(NEW)).toBe(NEW);
    expect(publicDiscoveryErrorMessage(`${OLD}; ${NEW}`)).toBe(NEW);
  });

  it('old with an approved tail keeps the tail; old with raw text keeps no raw text', () => {
    expect(publicDiscoveryErrorMessage(`${OLD}; ${PLATFORM_AWS_UNAVAILABLE_MESSAGE}`)).toBe(`${NEW}; ${PLATFORM_AWS_UNAVAILABLE_MESSAGE}`);
    expect(publicDiscoveryErrorMessage(`${OLD}; EC2: AccessDenied arn:aws:iam::123456789012:role/x`)).toBe(`${NEW}; ${DISCOVERY_STEPS_INCOMPLETE_MESSAGE}`);
    // The old text with something appended (no separator) is not the old text.
    expect(publicDiscoveryErrorMessage(`${OLD} arn:aws:iam::123456789012:role/x`)).toBe(DISCOVERY_STEPS_INCOMPLETE_MESSAGE);
  });

  it('neither text starts with a readiness prefix; the gate reads both as unrecognized', () => {
    for (const text of [OLD, NEW]) {
      expect(DISCOVERY_ERROR_PREFIXES.some((p) => text.startsWith(p))).toBe(false);
      const gate = evaluateDiscoveryGate({
        id: 'job', status: 'failed', startedAt: new Date(), completedAt: new Date(), resourceTypes: ['ec2'], errorMessage: text,
      }, 'ec2');
      expect(gate).toEqual({ kind: 'error', reason: 'the latest discovery run failed with an unrecognized error' });
    }
  });
});
