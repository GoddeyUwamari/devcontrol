/**
 * Phase 4 verification for the automated-remediation safety guard added to
 * RemediationService.execute(): the ENABLE_AUTOMATED_REMEDIATION kill-switch
 * and the DevControl-own-infrastructure self-protection check.
 *
 * Deliberately mock-only — no real Pool, no real AWS credentials, no network
 * calls. These tests exist specifically so the guard can be verified without
 * ever making a live call against production or the real DevControl instance.
 */

import { RemediationService } from '../remediation.service';

/** Minimal fake Pool — only .query() is used by RemediationService. */
function makeFakePool(workflowRow: Record<string, any>) {
  const query = jest.fn().mockResolvedValue({ rows: [workflowRow] });
  return { query } as any;
}

const IDLE_EC2_WORKFLOW = {
  id: 'wf-1',
  organization_id: 'org-normal',
  recommendation_id: 'rec-1',
  resource_id: 'i-harmlesstest123',
  resource_type: 'EC2',
  action_type: 'stop_instance',
  action_params: { resource_id: 'i-harmlesstest123', region: 'us-east-1' },
  estimated_savings: 30,
  risk_level: 'low',
  status: 'approved',
};

describe('RemediationService safety guard (Phase 2/4)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  describe('(1) kill-switch dry-run fallback', () => {
    it('blocks execution and makes zero AWS calls when ENABLE_AUTOMATED_REMEDIATION is unset', async () => {
      delete process.env.ENABLE_AUTOMATED_REMEDIATION;
      delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
      delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;

      const pool = makeFakePool(IDLE_EC2_WORKFLOW);
      const service = new RemediationService(pool);

      await expect(
        service.execute('wf-1', 'org-normal', 'user-1')
      ).rejects.toThrow(/^DRY_RUN_MODE:/);

      // Only the initial getWorkflow SELECT ran — no status update to
      // 'executing', no STS/EC2 call, nothing else touched the DB or AWS.
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(pool.query.mock.calls[0][0]).toMatch(/SELECT \* FROM remediation_workflows/);
    });

    it('blocks execution when ENABLE_AUTOMATED_REMEDIATION=false explicitly', async () => {
      process.env.ENABLE_AUTOMATED_REMEDIATION = 'false';
      delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
      delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;

      const pool = makeFakePool(IDLE_EC2_WORKFLOW);
      const service = new RemediationService(pool);

      await expect(
        service.execute('wf-1', 'org-normal', 'user-1')
      ).rejects.toThrow(/^DRY_RUN_MODE:/);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('logs the [REMEDIATION BLOCKED] dry-run message', async () => {
      delete process.env.ENABLE_AUTOMATED_REMEDIATION;
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const pool = makeFakePool(IDLE_EC2_WORKFLOW);
      const service = new RemediationService(pool);

      await expect(service.execute('wf-1', 'org-normal', 'user-1')).rejects.toThrow();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[REMEDIATION BLOCKED] Dry-run mode enabled')
      );
    });
  });

  describe('(2) self-protection guard — DevControl operational infrastructure', () => {
    it('blocks when resource_id matches DEVCONTROL_PROD_INSTANCE_ID, even with the kill-switch ON', async () => {
      // Kill-switch enabled on purpose: proves the self-protection guard is
      // independent of it and still blocks, per the "regardless of what the
      // kill-switch env var says" requirement.
      process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
      process.env.DEVCONTROL_PROD_INSTANCE_ID = 'i-0c3e55c290844ec59';
      delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;

      const protectedWorkflow = { ...IDLE_EC2_WORKFLOW, resource_id: 'i-0c3e55c290844ec59' };
      const pool = makeFakePool(protectedWorkflow);
      const service = new RemediationService(pool);

      await expect(
        service.execute('wf-1', 'org-normal', 'user-1')
      ).rejects.toThrow(/^REMEDIATION_BLOCKED:.*DEVCONTROL_PROD_INSTANCE_ID/);

      // Blocked before the kill-switch check even runs, and before any
      // AWS SDK call (STS AssumeRole, EC2 DescribeInstances, etc.) fires.
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('blocks when organization_id matches DEVCONTROL_OPERATIONAL_ORG_ID, even with the kill-switch ON', async () => {
      process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
      delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
      process.env.DEVCONTROL_OPERATIONAL_ORG_ID = '347a8e90-4cf0-4fd4-8779-dc8128901fca';

      const ownOrgWorkflow = {
        ...IDLE_EC2_WORKFLOW,
        organization_id: '347a8e90-4cf0-4fd4-8779-dc8128901fca',
      };
      const pool = makeFakePool(ownOrgWorkflow);
      const service = new RemediationService(pool);

      await expect(
        service.execute('wf-1', '347a8e90-4cf0-4fd4-8779-dc8128901fca', 'user-1')
      ).rejects.toThrow(/^REMEDIATION_BLOCKED:.*DEVCONTROL_OPERATIONAL_ORG_ID/);

      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('does NOT block an unrelated instance/org even when both protected env vars are set', async () => {
      // Negative control — confirms the guard is a targeted match, not a
      // false-positive that blocks everything once the env vars are set.
      process.env.ENABLE_AUTOMATED_REMEDIATION = 'false'; // stop before any real AWS call
      process.env.DEVCONTROL_PROD_INSTANCE_ID = 'i-0c3e55c290844ec59';
      process.env.DEVCONTROL_OPERATIONAL_ORG_ID = '347a8e90-4cf0-4fd4-8779-dc8128901fca';

      const pool = makeFakePool(IDLE_EC2_WORKFLOW); // resource_id/org_id both unrelated
      const service = new RemediationService(pool);

      // Falls through the self-protection guard cleanly and hits the
      // kill-switch block instead — proves the guard doesn't over-match.
      await expect(
        service.execute('wf-1', 'org-normal', 'user-1')
      ).rejects.toThrow(/^DRY_RUN_MODE:/);
    });
  });
});
