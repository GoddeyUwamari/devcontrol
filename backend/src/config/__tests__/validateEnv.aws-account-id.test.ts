/**
 * validateEnv: AWS_ACCOUNT_ID is required in production.
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
    process.env.NODE_ENV = 'production';
    expect(() => validateEnv()).toThrow(/AWS_ACCOUNT_ID is required in production/);
  });

  it('fails in production when AWS_ACCOUNT_ID is blank', () => {
    process.env.NODE_ENV = 'production';
    process.env.AWS_ACCOUNT_ID = '   ';
    expect(() => validateEnv()).toThrow(/AWS_ACCOUNT_ID is required in production/);
  });

  it('passes in production when AWS_ACCOUNT_ID is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.AWS_ACCOUNT_ID = '123456789012';
    expect(() => validateEnv()).not.toThrow();
  });

  it('does not require it outside production', () => {
    process.env.NODE_ENV = 'test';
    expect(() => validateEnv()).not.toThrow();
  });
});
