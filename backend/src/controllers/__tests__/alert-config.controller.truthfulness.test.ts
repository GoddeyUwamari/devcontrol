/**
 * Coverage for the SOC 2 Readiness product-truthfulness correction (PR1 of
 * the approved SOC 2 Readiness blueprint).
 *
 * `defaultAlertTypes`'s "Compliance Violations" entry previously described
 * itself as "Stay compliant with SOC2, HIPAA, and PCI-DSS requirements" --
 * DevControl does not evaluate HIPAA, and "stay compliant" implies a
 * compliance determination DevControl does not make. This entry is served
 * verbatim to the client via `GET` config responses (`alertTypes:
 * defaultAlertTypes` in `getConfig`), so it is customer-facing, not merely
 * internal.
 */
import { Request, Response } from 'express';
import { AlertConfigController, alertConfigs } from '../alert-config.controller';

function mockReqRes(overrides: { user?: any } = {}) {
  const req = {
    user: overrides.user ?? { organizationId: 'org-1', userId: 'user-1' },
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

describe('AlertConfigController.getConfig — compliance_failure alert type truthfulness', () => {
  const controller = new AlertConfigController();

  afterEach(() => {
    alertConfigs.clear();
  });

  it('the default compliance_failure alert description never claims HIPAA support or a "stay compliant" determination', async () => {
    const { req, res, json } = mockReqRes();
    await controller.getConfig(req, res);

    expect(json).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0][0];
    const complianceType = body.data.alertTypes.find((t: any) => t.id === 'compliance_failure');

    expect(complianceType).toBeDefined();
    expect(complianceType.description).not.toMatch(/HIPAA/i);
    expect(complianceType.description).not.toMatch(/stay compliant/i);
    expect(complianceType.description).not.toMatch(/SOC\s*2\s*compliant/i);
  });

  it('the default compliance_failure alert description mentions SOC 2 readiness gaps, not a compliance guarantee', async () => {
    const { req, res, json } = mockReqRes();
    await controller.getConfig(req, res);

    const body = json.mock.calls[0][0];
    const complianceType = body.data.alertTypes.find((t: any) => t.id === 'compliance_failure');
    expect(complianceType.description).toMatch(/SOC 2 readiness gaps/i);
  });

  it('a previously stored org config (which predates this fix) is returned as-is -- this only proves the DEFAULT shown to new orgs is corrected', async () => {
    alertConfigs.set('org-1', { alertTypes: [{ id: 'compliance_failure', description: 'legacy stored value' }] });
    const { req, res, json } = mockReqRes();
    await controller.getConfig(req, res);

    const body = json.mock.calls[0][0];
    expect(body.data.alertTypes[0].description).toBe('legacy stored value');
  });
});
