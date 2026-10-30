import { safeErrorFields, redactErrorMessage } from '../safe-error-log';

describe('safeErrorFields', () => {
  it('keeps name and code, and redacts AWS identifiers, emails and ids from the message', () => {
    const err = Object.assign(
      new Error(
        'User: arn:aws:sts::123456789012:assumed-role/Sentinel/x is not authorized on i-1234567890abcdef0 ' +
          'for owner@example.com in org 00000000-0000-4000-8000-000000000005 (account 123456789012)'
      ),
      { code: 'AccessDenied' }
    );

    const fields = safeErrorFields(err);

    expect(fields).toEqual({
      name: 'Error',
      code: 'AccessDenied',
      message:
        'User: [arn] is not authorized on [resource-id] for [email] in org [id] (account [account-id])',
    });
  });

  it('never returns the stack, a database detail or other properties', () => {
    const err = Object.assign(new Error('duplicate key'), {
      code: '23505',
      detail: 'Key (email)=(owner@example.com) already exists.',
      stack: 'STACK-SENTINEL',
    });

    const fields = safeErrorFields(err);

    expect(Object.keys(fields).sort()).toEqual(['code', 'message', 'name']);
    expect(JSON.stringify(fields)).not.toMatch(/STACK-SENTINEL|owner@example\.com/);
  });

  it('drops a name or code that is not a short token', () => {
    const err = Object.assign(new Error('x'), { name: 'Bad name with spaces', code: { nested: true } });

    expect(safeErrorFields(err)).toEqual({ name: undefined, code: undefined, message: 'x' });
  });

  it('accepts anything that can be thrown', () => {
    expect(safeErrorFields(null)).toEqual({ name: undefined, code: undefined, message: undefined });
    expect(safeErrorFields(undefined)).toEqual({ name: undefined, code: undefined, message: undefined });
    expect(safeErrorFields({})).toEqual({ name: undefined, code: undefined, message: undefined });
    expect(safeErrorFields('thrown 123456789012')).toEqual({
      name: undefined,
      code: undefined,
      message: 'thrown [account-id]',
    });
  });

  it('shortens long messages before redacting them', () => {
    const message = redactErrorMessage('a'.repeat(1000));

    expect(message).toHaveLength(300);
  });
});
