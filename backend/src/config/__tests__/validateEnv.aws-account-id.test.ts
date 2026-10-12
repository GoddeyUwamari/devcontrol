/**
 * validateEnv: AWS_ACCOUNT_ID is required, and must be 12 digits, in production.
 *
 * It is the principal in the trust policy every organization creates to
 * connect its AWS account, and it has no default (routes/aws.routes.ts).
 */
import { validateEnv } from '../validateEnv';

const BASE_ENV = {
  JWT_SECRET: 'x'.repeat(48),
  ENCRYPTION_KEY: 'k'.repeat(32),
  DB_HOST: 'db.internal.example',
  DB_NAME: 'platform_portal',
  DB_USER: 'devcontrol',
  DB_PASSWORD: 'not-a-real-password',
  FRONTEND_URL: 'https://app.example.com',
};
const MANAGED_KEYS = [...Object.keys(BASE_ENV), 'NODE_ENV', 'AWS_ACCOUNT_ID', 'STRIPE_SECRET_KEY', 'DB_PORT', 'PORT'];

const saved: Record<string, string | undefined> = {};
// process.env.NODE_ENV is typed read-only; assign through this alias.
const env: Record<string, string | undefined> = process.env;

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, BASE_ENV);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.restoreAllMocks();
});

describe('validateEnv -- AWS_ACCOUNT_ID', () => {
  it('fails in production when AWS_ACCOUNT_ID is not set', () => {
    env.NODE_ENV = 'production';
    expect(() => validateEnv()).toThrow(/AWS_ACCOUNT_ID is required in production/);
  });

  it('fails in production when AWS_ACCOUNT_ID is blank', () => {
    env.NODE_ENV = 'production';
    env.AWS_ACCOUNT_ID = '   ';
    expect(() => validateEnv()).toThrow(/AWS_ACCOUNT_ID is required in production/);
  });

  it.each([
    ['11 digits', '12345678901'],
    ['13 digits', '1234567890123'],
    ['letters', 'abcdefghijkl'],
    ['digits with a letter', '12345678901a'],
    ['an ARN', 'arn:aws:iam::123456789012:root'],
    ['a double-quoted value', '"123456789012"'],
    ['a single-quoted value', "'123456789012'"],
    ['digits split by a space', '123456 789012'],
  ])('fails in production when AWS_ACCOUNT_ID is %s, without echoing it', (_label, value) => {
    env.NODE_ENV = 'production';
    env.AWS_ACCOUNT_ID = value;

    let message = '';
    try {
      validateEnv();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/AWS_ACCOUNT_ID must be a 12-digit AWS account ID in production/);
    expect(message).not.toContain(value);
    expect(message).not.toContain('123456789012');
  });

  it('passes in production when AWS_ACCOUNT_ID is 12 digits', () => {
    env.NODE_ENV = 'production';
    env.AWS_ACCOUNT_ID = '123456789012';
    expect(() => validateEnv()).not.toThrow();
  });

  it('passes in production when the 12 digits have surrounding whitespace, as the connect route does', () => {
    env.NODE_ENV = 'production';
    env.AWS_ACCOUNT_ID = ' 123456789012\n';
    expect(() => validateEnv()).not.toThrow();
  });

  it('does not require it outside production', () => {
    env.NODE_ENV = 'test';
    expect(() => validateEnv()).not.toThrow();
  });
});
