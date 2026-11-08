/**
 * Billing safety PR B (B-2): no log line in stripe.service.ts names a Stripe
 * customer, subscription, price, session, refund or payment intent id --
 * neither the success lines of createSubscription, cancel,
 * cancel-at-period-end, resume, update-price, the portal and refunds, nor
 * the error lines (a Stripe error's message quotes the id it was refused on;
 * only its name and code are logged).
 *
 * The `stripe` SDK module is replaced with a fake client, so no request can
 * be made; every id below is a test placeholder.
 */
const fakeClient = {
  subscriptions: { create: jest.fn(), cancel: jest.fn(), update: jest.fn(), retrieve: jest.fn() },
  billingPortal: { sessions: { create: jest.fn() } },
  refunds: { create: jest.fn() },
  checkout: { sessions: { retrieve: jest.fn(), expire: jest.fn() } },
};
jest.mock('stripe', () => ({ __esModule: true, default: jest.fn(() => fakeClient) }));

import stripeService from '../stripe.service';

const IDS = {
  customer: 'cus_test_redaction_customer',
  subscription: 'sub_test_redaction_subscription',
  price: 'price_test_redaction_price',
  item: 'si_test_redaction_item',
  session: 'cs_test_redaction_session',
  refund: 're_test_redaction_refund',
  paymentIntent: 'pi_test_redaction_intent',
};

const stripeError = (id: string) =>
  Object.assign(new Error(`No such resource: '${id}'`), { name: 'StripeInvalidRequestError', code: 'resource_missing' });

let logged: () => string;
beforeEach(() => {
  const spies = (['log', 'warn', 'error', 'info'] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
  logged = () =>
    spies
      .flatMap((s) => s.mock.calls.flat())
      .map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)))
      .join('\n');
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const group of Object.values(fakeClient)) {
    for (const fn of Object.values(group)) {
      if (typeof fn === 'function') (fn as jest.Mock).mockReset();
      else for (const inner of Object.values(fn as Record<string, jest.Mock>)) inner.mockReset();
    }
  }
});

function expectNoIds(text: string) {
  for (const id of Object.values(IDS)) expect(text).not.toContain(id);
}

describe('success lines', () => {
  it('createSubscription, cancel, cancel at period end, resume, update price, portal and refund log no id', async () => {
    const subscription = { id: IDS.subscription, customer: IDS.customer, items: { data: [{ id: IDS.item, price: { id: IDS.price } }] } };
    fakeClient.subscriptions.create.mockResolvedValue(subscription);
    fakeClient.subscriptions.cancel.mockResolvedValue(subscription);
    fakeClient.subscriptions.update.mockResolvedValue(subscription);
    fakeClient.subscriptions.retrieve.mockResolvedValue(subscription);
    fakeClient.billingPortal.sessions.create.mockResolvedValue({ id: IDS.session, url: 'https://billing.example/x' });
    fakeClient.refunds.create.mockResolvedValue({ id: IDS.refund });

    await stripeService.createSubscription(IDS.customer, IDS.price);
    await stripeService.cancelSubscription(IDS.subscription);
    await stripeService.cancelSubscriptionAtPeriodEnd(IDS.subscription);
    await stripeService.resumeSubscription(IDS.subscription);
    await stripeService.updateSubscription(IDS.subscription, IDS.price);
    await stripeService.createPortalSession(IDS.customer, 'https://app.example/settings/billing');
    await stripeService.createRefund({ payment_intent: IDS.paymentIntent });

    const text = logged();
    expect(text).toContain('Canceled a subscription');
    expect(text).toContain('Updated a subscription to a new price');
    expectNoIds(text);
  });
});

describe('error lines: name and code only', () => {
  it.each([
    ['createSubscription', () => stripeService.createSubscription(IDS.customer, IDS.price), () => fakeClient.subscriptions.create],
    ['cancelSubscription', () => stripeService.cancelSubscription(IDS.subscription), () => fakeClient.subscriptions.cancel],
    ['cancelSubscriptionAtPeriodEnd', () => stripeService.cancelSubscriptionAtPeriodEnd(IDS.subscription), () => fakeClient.subscriptions.update],
    ['resumeSubscription', () => stripeService.resumeSubscription(IDS.subscription), () => fakeClient.subscriptions.update],
    ['updateSubscription', () => stripeService.updateSubscription(IDS.subscription, IDS.price), () => fakeClient.subscriptions.retrieve],
    ['getSubscription', () => stripeService.getSubscription(IDS.subscription), () => fakeClient.subscriptions.retrieve],
    ['createPortalSession', () => stripeService.createPortalSession(IDS.customer, 'https://app.example/x'), () => fakeClient.billingPortal.sessions.create],
    ['createRefund', () => stripeService.createRefund({ payment_intent: IDS.paymentIntent }), () => fakeClient.refunds.create],
    ['retrieveCheckoutSession', () => stripeService.retrieveCheckoutSession(IDS.session), () => fakeClient.checkout.sessions.retrieve],
    ['expireCheckoutSession', () => stripeService.expireCheckoutSession(IDS.session), () => fakeClient.checkout.sessions.expire],
  ])('%s', async (_name, call, method) => {
    method().mockRejectedValue(stripeError(Object.values(IDS).join(' ')));
    await expect(call()).rejects.toThrow('No such resource');
    const text = logged();
    expect(text).toContain('StripeInvalidRequestError');
    expect(text).toContain('resource_missing');
    expectNoIds(text);
  });
});
