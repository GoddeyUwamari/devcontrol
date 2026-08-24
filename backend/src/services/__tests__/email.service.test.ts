/**
 * Unit coverage for EmailService, the shared Resend wrapper backing the
 * invitation/verification/password-reset flows. Resend itself is mocked
 * (`jest.mock('resend')`) -- no network calls, no real email is ever sent.
 * Templates are the real files under backend/src/templates/*.html, so this
 * also exercises real Handlebars compilation/rendering, not a fixture stub.
 *
 * EmailService reads RESEND_API_KEY at construction time (matching
 * WeeklyAISummaryJob's setupResendClient pattern), so each test that cares
 * about the configured/unconfigured distinction uses jest.resetModules() +
 * a fresh require to get a fresh constructor run under controlled env vars.
 */

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

const ORIGINAL_ENV = { ...process.env };

function loadFreshEmailService(env: Record<string, string | undefined>) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../email.service');
  return mod.EmailService as typeof import('../email.service').EmailService;
}

describe('EmailService', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockSend.mockReset();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('when RESEND_API_KEY is configured', () => {
    const EmailServiceClass = () =>
      loadFreshEmailService({
        RESEND_API_KEY: 'test-api-key',
        EMAIL_FROM: 'DevControl <noreply@test.devcontrol.app>',
        FRONTEND_URL: 'https://app.example.com',
      });

    it('sends the verification email with correct sender, recipient, subject, and link', async () => {
      mockSend.mockResolvedValueOnce({ data: { id: 'email_123' }, error: null });
      const EmailService = EmailServiceClass();
      const service = new EmailService();

      const result = await service.sendVerificationEmail({
        to: 'newuser@example.com',
        fullName: 'Ada Lovelace',
        verificationToken: 'abc123token',
      });

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.from).toBe('DevControl <noreply@test.devcontrol.app>');
      expect(call.to).toBe('newuser@example.com');
      expect(call.subject).toBe('Verify your email address');
      expect(call.html).toContain('https://app.example.com/verify-email?token&#x3D;abc123token');
      expect(call.html).toContain('Ada Lovelace');
    });

    it('renders the verification template with the correct link and no unrendered handlebars', async () => {
      mockSend.mockResolvedValueOnce({ data: { id: 'email_124' }, error: null });
      const EmailService = EmailServiceClass();
      const service = new EmailService();

      await service.sendVerificationEmail({
        to: 'newuser@example.com',
        fullName: 'Ada Lovelace',
        verificationToken: 'abc123token',
      });

      const html = mockSend.mock.calls[0][0].html;
      expect(html).not.toContain('{{');
      expect(html).toContain('24 hours');
    });

    it('sends the password reset email with the correct link', async () => {
      mockSend.mockResolvedValueOnce({ data: { id: 'email_125' }, error: null });
      const EmailService = EmailServiceClass();
      const service = new EmailService();

      const result = await service.sendPasswordResetEmail({
        to: 'user@example.com',
        resetToken: 'reset-token-xyz',
      });

      expect(result).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe('user@example.com');
      expect(call.subject).toBe('Reset your DevControl password');
      expect(call.html).toContain('https://app.example.com/reset-password?token&#x3D;reset-token-xyz');
      expect(call.html).toContain('1 hour');
    });

    it('sends the invitation email with org/role context and the correct link', async () => {
      mockSend.mockResolvedValueOnce({ data: { id: 'email_126' }, error: null });
      const EmailService = EmailServiceClass();
      const service = new EmailService();

      const result = await service.sendInvitationEmail({
        to: 'invitee@example.com',
        organizationName: 'Acme Corp',
        role: 'admin',
        invitationToken: 'invite-token-789',
      });

      expect(result).toBe(true);
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe('invitee@example.com');
      expect(call.subject).toBe("You've been invited to join Acme Corp on DevControl");
      expect(call.html).toContain('https://app.example.com/accept-invitation?token&#x3D;invite-token-789');
      expect(call.html).toContain('Acme Corp');
      expect(call.html).toContain('admin');
      expect(call.html).toContain('7 days');
    });

    it('falls back to the default sender when EMAIL_FROM is not set', async () => {
      mockSend.mockResolvedValueOnce({ data: { id: 'email_127' }, error: null });
      const EmailService = loadFreshEmailService({
        RESEND_API_KEY: 'test-api-key',
        EMAIL_FROM: undefined,
        FRONTEND_URL: 'https://app.example.com',
      });
      const service = new EmailService();

      await service.sendPasswordResetEmail({ to: 'user@example.com', resetToken: 'tok' });

      expect(mockSend.mock.calls[0][0].from).toBe('DevControl <noreply@devcontrol.app>');
    });

    it('falls back to localhost when FRONTEND_URL is not set', async () => {
      mockSend.mockResolvedValueOnce({ data: { id: 'email_128' }, error: null });
      const EmailService = loadFreshEmailService({
        RESEND_API_KEY: 'test-api-key',
        EMAIL_FROM: 'DevControl <noreply@test.devcontrol.app>',
        FRONTEND_URL: undefined,
      });
      const service = new EmailService();

      await service.sendPasswordResetEmail({ to: 'user@example.com', resetToken: 'tok' });

      expect(mockSend.mock.calls[0][0].html).toContain('http://localhost:3010/reset-password?token&#x3D;tok');
    });

    it('returns false and logs safely (no token) when Resend returns an error response', async () => {
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { name: 'validation_error', message: 'Invalid `from` field', statusCode: 422 },
      });
      const EmailService = EmailServiceClass();
      const service = new EmailService();

      const result = await service.sendPasswordResetEmail({
        to: 'user@example.com',
        resetToken: 'super-secret-token',
      });

      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedArgs = consoleErrorSpy.mock.calls.flat().map(String).join(' ');
      expect(loggedArgs).not.toContain('super-secret-token');
      expect(loggedArgs).not.toContain('test-api-key');
    });

    it('returns false and logs safely (no token, no stack dump) when the Resend call throws', async () => {
      mockSend.mockRejectedValueOnce(new Error('network timeout'));
      const EmailService = EmailServiceClass();
      const service = new EmailService();

      const result = await service.sendInvitationEmail({
        to: 'invitee@example.com',
        organizationName: 'Acme Corp',
        role: 'member',
        invitationToken: 'super-secret-invite-token',
      });

      expect(result).toBe(false);
      const loggedArgs = consoleErrorSpy.mock.calls.flat().map(String).join(' ');
      expect(loggedArgs).not.toContain('super-secret-invite-token');
      expect(loggedArgs).toContain('network timeout');
    });

    it('returns false and logs safely (no token, no template data) when template rendering throws', async () => {
      const EmailService = EmailServiceClass();
      const service = new EmailService();

      // Force a rendering failure without a new mocking seam -- same
      // (service as any) pattern already used elsewhere in this suite --
      // to prove send()'s try/catch now also covers template(templateData),
      // not just the Resend network call.
      (service as any).passwordResetTemplate = () => {
        throw new Error('template render boom');
      };

      const result = await service.sendPasswordResetEmail({
        to: 'user@example.com',
        resetToken: 'super-secret-reset-token',
      });

      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled(); // never reached Resend at all
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedArgs = consoleErrorSpy.mock.calls.flat().map(String).join(' ');
      expect(loggedArgs).toContain('template render boom');
      expect(loggedArgs).not.toContain('super-secret-reset-token');
      expect(loggedArgs).not.toContain('test-api-key');
    });

    it('never throws out of sendVerificationEmail even on failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('boom'));
      const EmailService = EmailServiceClass();
      const service = new EmailService();

      await expect(
        service.sendVerificationEmail({
          to: 'user@example.com',
          fullName: 'Test User',
          verificationToken: 'tok',
        })
      ).resolves.toBe(false);
    });
  });

  describe('when RESEND_API_KEY is not configured', () => {
    it('skips sending and returns false without calling Resend', async () => {
      const EmailService = loadFreshEmailService({ RESEND_API_KEY: undefined });
      const service = new EmailService();

      const result = await service.sendPasswordResetEmail({
        to: 'user@example.com',
        resetToken: 'tok',
      });

      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });
});
