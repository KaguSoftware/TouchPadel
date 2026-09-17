import { describe, expect, it } from 'vitest';
import { AppRpcError } from '../../../lib/appRpc';
import { EdgeError } from '../../../lib/edge';
import { approvesWithPin, holdsPin, looksLikeEmail, pinFormatOk, staffRefusal } from './staffModel';

describe('pinFormatOk', () => {
  // The field used to stop at 6 digits while its hint promised "4 to 6", and
  // the server (0078) wants 6 to 12 — so a 4-digit PIN left Save dead.
  it('matches app.set_staff_pin: 6 to 12 digits, nothing else', () => {
    expect(pinFormatOk('1234')).toBe(false);
    expect(pinFormatOk('482913')).toBe(true);
    expect(pinFormatOk('482913570146')).toBe(true);
    expect(pinFormatOk('4829135701468')).toBe(false);
    expect(pinFormatOk('48291a')).toBe(false);
  });
});

describe('holdsPin / approvesWithPin', () => {
  const roles = ['cashier', 'prep', 'court_desk', 'manager', 'owner'];
  it('every role holds a PIN since 0105 (breaks, idle lock)', () => {
    expect(roles.map((r) => holdsPin(r as never))).toEqual([true, true, true, true, true]);
  });
  it('only managers and owners approve with it', () => {
    expect(roles.map((r) => approvesWithPin(r as never))).toEqual([false, false, false, true, true]);
  });
});

describe('looksLikeEmail', () => {
  it('catches a name typed into the email box, and nothing stricter', () => {
    expect(looksLikeEmail('Sara')).toBe(false);
    expect(looksLikeEmail('sara@touch')).toBe(false);
    expect(looksLikeEmail(' sara@touch.iq ')).toBe(true);
  });
});

describe('staffRefusal', () => {
  it('names the refusals this screen explains in its own words', () => {
    expect(staffRefusal(new AppRpcError('PIN_WEAK', 'PIN_WEAK'))).toBe('pinWeak');
    expect(staffRefusal(new AppRpcError('PIN_FORMAT', 'PIN_FORMAT'))).toBe('pinFormat');
    expect(staffRefusal(new AppRpcError('LAST_OWNER', 'LAST_OWNER'))).toBe('lastOwner');
    expect(staffRefusal(new EdgeError(409, 'UNKNOWN', 'dup', 'EMAIL_IN_USE'))).toBe('emailInUse');
  });

  it('leaves everything else to the shared error text', () => {
    expect(staffRefusal(new AppRpcError('FORBIDDEN', 'FORBIDDEN'))).toBeNull();
    expect(staffRefusal(new EdgeError(500, 'UPSTREAM', 'boom'))).toBeNull();
    expect(staffRefusal(new Error('x'))).toBeNull();
  });
});
