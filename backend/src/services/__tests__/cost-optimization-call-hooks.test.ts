/**
 * Multi-region PR 1b: analyzeAllResources()'s optional call hooks.
 *   - signal (review M-2): the discovery scan's deadline aborts the detectors' calls;
 *   - onCall (item 7): the cost pass's CloudWatch calls are counted for the home
 *     region's log line.
 * Both reach the clients through the call policy (withCallPolicyOnClients). Without
 * them (every other caller, and a scan without the multi-region flag) the policy is the
 * service's own, the same object as before. No database, no AWS call: the clients say
 * AWS is not connected, so no detector runs.
 */
import * as callPolicy from '../../utils/awsCallPolicy';
import costOptimizationService from '../cost-optimization.service';

const ORG = '00000000-0000-4000-8000-000000000001';
const scanContext = {
  organizationId: ORG,
  region: 'us-east-1',
  connectionIdentity: 'placeholder-connection',
  clientsFor: () => ({ enabled: false, region: 'us-east-1' }),
} as any;

afterEach(() => jest.restoreAllMocks());

describe('analyzeAllResources call hooks (PR 1b)', () => {
  it('no hooks: the clients get the service\'s own policy object, unchanged', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const wrap = jest.spyOn(callPolicy, 'withCallPolicyOnClients');
    await costOptimizationService.analyzeAllResources(ORG, scanContext);
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(wrap.mock.calls[0][1]).toBe((costOptimizationService as any).callPolicy);
  });

  it('signal and onCall: both reach the clients\' policy; everything else is the service\'s own', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const wrap = jest.spyOn(callPolicy, 'withCallPolicyOnClients');
    const signal = new AbortController().signal;
    const onCall = jest.fn();
    await costOptimizationService.analyzeAllResources(ORG, scanContext, { signal, onCall });
    const policy = wrap.mock.calls[0][1]!;
    expect(policy.signal).toBe(signal);
    expect(policy.onCall).toBe(onCall);
    const own = (costOptimizationService as any).callPolicy;
    expect({ ...policy, signal: undefined, onCall: undefined }).toEqual({ ...own, signal: undefined, onCall: undefined });
  });

  it('a call made with that policy is counted and stopped by the signal', async () => {
    const controller = new AbortController();
    const onCall = jest.fn();
    const client = callPolicy.withCallPolicy({ send: (_command: unknown) => new Promise(() => undefined) }, {
      ...callPolicy.DEFAULT_AWS_CALL_POLICY,
      signal: controller.signal,
      onCall,
    });
    const pending = client.send({ placeholder: true }).catch((error: unknown) => error);
    controller.abort(new Error('placeholder deadline'));
    expect(await pending).toEqual(new Error('placeholder deadline'));
    expect(onCall).toHaveBeenCalledTimes(1);
  });
});
