import { describe, expect, it } from 'vitest';
import { mapOtpError } from '../phoneOtp';
import { mapErrorToKey } from '../../booking/errors';

// 0449: the club banned this account. GoTrue refuses the sign-in (user_banned)
// and the API refuses every call (CUSTOMER_BANNED); both read as the guest's
// own line, never the desk's "lift the ban on their record".
describe('a banned account', () => {
  it('reads the sign-in refusal as blocked', () => {
    expect(mapOtpError({ code: 'user_banned', message: 'User is banned' })).toBe('errors.accountBanned');
  });

  it('reads an API refusal as blocked', () => {
    expect(mapErrorToKey({ message: 'CUSTOMER_BANNED', code: 'P0001' })).toBe('errors.accountBanned');
  });
});
