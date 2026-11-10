/**
 * Trial PR, at the Stripe SDK boundary: exactly what Checkout sends with and
 * without the free trial, and what a plan change sends during a trial. The
 * `stripe` module is replaced with a fake client, so no request can be made;
 * every id is a test placeholder.
 */
const fakeClient = {
  checkout: { sessions: { create: jest.fn() } },
  subscriptions: { retrieve: jest.fn(), update: jest.fn(), cancel: jest.fn() },
};
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => fakeClient) }));

import stripeService, { TrialIntervalChangeError } from '../stripe.service';
import { TRIAL_PERIOD_DAYS } from '../../config/trial';

const IDS = {
  customer: 'cus_test_trial_params',
  price: 'price_test_trial_params',
  newPrice: 'price_test_trial_params_new',
  subscription: 'sub_test_trial_params',
  item: 'si_test_trial_params',
};

beforeEach(() => {
  for (const level of ['log', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {});
  fakeClient.checkout.sessions.create.mockResolvedValue({ id: 'cs_test_trial_params', url: 'https://checkout.example/x' });
});
afterEach(() => {
  jest.restoreAllMocks();
  fakeClient.checkout.sessions.create.mockReset();
  fakeClient.subscriptions.retrieve.mockReset();
  fakeClient.subscriptions.update.mockReset();
  fakeClient.subscriptions.cancel.mockReset();
});

const baseParams = {
  customer: IDS.customer,
  mode: 'subscription',
  payment_method_types: ['card'],
  line_items: [{ price: IDS.price, quantity: 1 }],
  success_url: 'https://app.example/success',
  cancel_url: 'https://app.example/cancel',
  expires_at: 1900000000,
  metadata: { organizationId: 'org-trial-params' },
  allow_promotion_codes: true,
};

async function createSession(trial?: boolean) {
  await stripeService.createCheckoutSession(
    IDS.customer, IDS.price, 'org-trial-params', baseParams.success_url, baseParams.cancel_url,
    { expiresAt: baseParams.expires_at, idempotencyKey: 'checkout-reservation-x', ...(trial === undefined ? {} : { trial }) }
  );
  return fakeClient.checkout.sessions.create.mock.calls[0];
}

describe('Checkout parameters', () => {
  it('the trial is exactly 14 days, card required, canceled (not paused) if the card is removed', async () => {
    expect(TRIAL_PERIOD_DAYS).toBe(14);
    const [params, options] = await createSession(true);
    expect(params).toEqual({
      ...baseParams,
      payment_method_collection: 'always',
      subscription_data: {
        metadata: { organizationId: 'org-trial-params' },
        trial_period_days: 14,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      },
    });
    expect(options).toEqual({ idempotencyKey: 'checkout-reservation-x' });
    expect(JSON.stringify(params)).not.toMatch(/trial_end|if_required/);
  });

  it.each([[false], [undefined]])('without the trial (trial=%s) the parameters are exactly as before this PR', async (trial) => {
    const [params] = await createSession(trial as boolean | undefined);
    expect(params).toEqual({ ...baseParams, subscription_data: { metadata: { organizationId: 'org-trial-params' } } });
  });
});

describe('plan change during a trial', () => {
  const trialing = (interval: 'month' | 'year') => ({
    id: IDS.subscription,
    status: 'trialing',
    trial_end: 1900000000,
    items: { data: [{ id: IDS.item, price: { id: IDS.price, recurring: { interval } } }] },
  });

  it('a tier change in the same interval keeps the trial end fixed and prorates nothing', async () => {
    fakeClient.subscriptions.retrieve.mockResolvedValue(trialing('month'));
    fakeClient.subscriptions.update.mockResolvedValue({ id: IDS.subscription, status: 'trialing' });
    await stripeService.updateSubscription(IDS.subscription, IDS.newPrice, 'monthly');
    expect(fakeClient.subscriptions.update).toHaveBeenCalledWith(IDS.subscription, {
      items: [{ id: IDS.item, price: IDS.newPrice }],
      proration_behavior: 'none',
      trial_end: 1900000000,
    });
  });

  it.each([
    ['month', 'annual'],
    ['year', 'monthly'],
  ] as const)('a %s trial cannot switch to %s: refused before any update', async (current, requested) => {
    fakeClient.subscriptions.retrieve.mockResolvedValue(trialing(current));
    await expect(stripeService.updateSubscription(IDS.subscription, IDS.newPrice, requested)).rejects.toBeInstanceOf(TrialIntervalChangeError);
    expect(fakeClient.subscriptions.update).not.toHaveBeenCalled();
  });

  it('outside a trial the interval may change and prorations are created, as before', async () => {
    fakeClient.subscriptions.retrieve.mockResolvedValue({
      id: IDS.subscription, status: 'active', trial_end: null,
      items: { data: [{ id: IDS.item, price: { id: IDS.price, recurring: { interval: 'month' } } }] },
    });
    fakeClient.subscriptions.update.mockResolvedValue({ id: IDS.subscription, status: 'active' });
    await stripeService.updateSubscription(IDS.subscription, IDS.newPrice, 'annual');
    expect(fakeClient.subscriptions.update).toHaveBeenCalledWith(IDS.subscription, {
      items: [{ id: IDS.item, price: IDS.newPrice }],
      proration_behavior: 'create_prorations',
    });
  });

  it('a duplicate trial is canceled with an idempotency key, so a retried webhook cancels once', async () => {
    fakeClient.subscriptions.cancel.mockResolvedValue({ id: IDS.subscription, status: 'canceled' });
    await stripeService.cancelSubscription(IDS.subscription, { idempotencyKey: `cancel-duplicate-trial-${IDS.subscription}` });
    expect(fakeClient.subscriptions.cancel).toHaveBeenCalledWith(IDS.subscription, {}, { idempotencyKey: `cancel-duplicate-trial-${IDS.subscription}` });
  });
});
