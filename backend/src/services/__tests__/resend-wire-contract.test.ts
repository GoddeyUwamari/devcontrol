/**
 * EmailService through the real resend SDK, against a local fake of the
 * Resend API (helpers/fake-resend-api): the request the SDK actually sends
 * for one email, and how each kind of failure comes back. The other email
 * tests replace the SDK with a mock; this one pins what it puts on the wire.
 *
 * No email is ever sent: the fake listens on 127.0.0.1, the key is one the
 * real API refuses, and the fetch guard refuses any request to another host.
 */
import { FAKE_RESEND_KEY, FakeResendApi, FetchGuard, guardFetch, startFakeResendApi } from '../../__tests__/helpers/fake-resend-api';
import type { EmailService } from '../email.service';

const SENDER = 'DevControl Test <noreply@example.com>';
const TOKEN = 'verification-token-must-never-be-logged';

const savedEnv = { ...process.env };
let api: FakeResendApi;
let guard: FetchGuard;
let emailService: EmailService;
let errorLog: jest.SpyInstance;
let logLine: jest.SpyInstance;

beforeAll(async () => {
  api = await startFakeResendApi();
  process.env.RESEND_API_KEY = FAKE_RESEND_KEY;
  process.env.EMAIL_FROM = SENDER;
  process.env.FRONTEND_URL = 'https://app.example.com';
  emailService = api.loadAgainst(() => require('../email.service').emailService);
});

afterAll(async () => {
  process.env = savedEnv;
  await api.close();
});

beforeEach(() => {
  api.requests.length = 0;
  guard = guardFetch();
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  logLine = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  guard.restore();
  jest.restoreAllMocks();
  expect(guard.refused).toEqual([]);
});

const send = () => emailService.sendVerificationEmail({ to: 'new.user@example.com', fullName: 'New User', verificationToken: TOKEN });
const everythingLogged = () => [...errorLog.mock.calls, ...logLine.mock.calls].map((call) => call.map(String).join(' ')).join('\n');
const ourLines = () => everythingLogged().split('\n').filter((line) => line.startsWith('[Email Service]'));

describe('EmailService through the real resend SDK', () => {
  it('sends one JSON POST to /emails with the key, the SDK user agent and exactly our fields', async () => {
    api.reply(200, { id: 'wire-1' });

    await expect(send()).resolves.toBe(true);

    expect(api.requests).toHaveLength(1);
    const [request] = api.requests;
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/emails');
    expect(request.headers.authorization).toBe(`Bearer ${FAKE_RESEND_KEY}`);
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['user-agent']).toMatch(/^resend-node:\d+\.\d+\.\d+$/);
    expect(Object.keys(request.body).sort()).toEqual(['from', 'html', 'subject', 'to']);
    expect(request.body).toMatchObject({ from: SENDER, to: 'new.user@example.com', subject: 'Verify your email address' });
    // Handlebars escapes "=" in the rendered link.
    expect(request.body.html).toContain(`https://app.example.com/verify-email#token&#x3D;${TOKEN}`);
    expect(ourLines()).toEqual(['[Email Service] verification email sent to new.user@example.com (id: wire-1)']);
  });

  it.each([
    ['an API error response', 422, { name: 'validation_error', message: 'The to field is invalid.', statusCode: 422 }, 'validation_error'],
    ['a server error that is not JSON', 500, '<html>upstream failure</html>', 'application_error'],
  ])('%s is a failed send: false, never thrown, logged by name without the token', async (_label, status, body, name) => {
    api.reply(status, body);

    await expect(send()).resolves.toBe(false);

    expect(api.requests).toHaveLength(1);
    expect(ourLines()).toHaveLength(1);
    expect(ourLines()[0]).toMatch(new RegExp(`^\\[Email Service\\] verification email to new\\.user@example\\.com failed: ${name} `));
    expect(everythingLogged()).not.toContain(TOKEN);
  });

  it('an unreachable API is a failed send: false, never thrown, without the token', async () => {
    const unreachable = await startFakeResendApi();
    const offline: EmailService = unreachable.loadAgainst(() => require('../email.service').emailService);
    await unreachable.close();

    await expect(offline.sendVerificationEmail({ to: 'new.user@example.com', fullName: 'New User', verificationToken: TOKEN })).resolves.toBe(false);

    expect(ourLines()).toHaveLength(1);
    expect(ourLines()[0]).toMatch(/^\[Email Service\] verification email to new\.user@example\.com failed: application_error /);
    expect(everythingLogged()).not.toContain(TOKEN);
  });
});
