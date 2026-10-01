import { describe, expect, it } from 'vitest';
import { AppRpcError } from '../../../lib/appRpc';
import { EdgeError } from '../../../lib/edge';
import { errorToMessageKey } from '../../../lib/errors';
import { fieldErrorOf } from './CustomerCreate';

/**
 * desk-customer-create answers `{error: CODE, message}`; lib/edge.ts keeps the
 * code as EdgeError.code, so the form reads it and nothing else (no guessing
 * from the English message any more).
 */
describe('fieldErrorOf', () => {
  it('puts the three field refusals on their field, by code', () => {
    expect(
      fieldErrorOf(
        new EdgeError(
          409,
          'UNKNOWN',
          'a customer with this phone already exists',
          'DUPLICATE_PHONE',
        ),
      ),
    ).toBe('DUPLICATE_PHONE');
    expect(
      fieldErrorOf(new EdgeError(409, 'UNKNOWN', 'already been registered', 'DUPLICATE_EMAIL')),
    ).toBe('DUPLICATE_EMAIL');
    expect(
      fieldErrorOf(new EdgeError(400, 'UNKNOWN', 'phone must carry 7-15 digits', 'INVALID_PHONE')),
    ).toBe('INVALID_PHONE');
  });

  it('never reads the message: a 409 or 400 without one of those codes is said under the form', () => {
    expect(fieldErrorOf(new EdgeError(409, 'UNKNOWN', 'email already exists'))).toBeNull();
    expect(fieldErrorOf(new EdgeError(400, 'UNKNOWN', 'phone is weird', 'BAD_REQUEST'))).toBeNull();
    expect(fieldErrorOf(new EdgeError(500, 'UPSTREAM', 'DUPLICATE_PHONE', 'INTERNAL'))).toBeNull();
    expect(fieldErrorOf(new AppRpcError('DUPLICATE_PHONE', 'DUPLICATE_PHONE'))).toBeNull();
    expect(fieldErrorOf(new Error('DUPLICATE_PHONE'))).toBeNull();
  });

  it('what lands under the form has its own line', () => {
    expect(
      errorToMessageKey(
        new EdgeError(400, 'UNKNOWN', 'fullName must be 1-80 characters', 'BAD_REQUEST'),
      ),
    ).toBe('errors.validation');
    expect(errorToMessageKey(new EdgeError(400, 'UNKNOWN', 'NAME_LENGTH', 'NAME_LENGTH'))).toBe(
      'op.errors.NAME_LENGTH',
    );
  });
});
