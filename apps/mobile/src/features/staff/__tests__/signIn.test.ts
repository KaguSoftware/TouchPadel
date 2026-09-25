import { describe, expect, it } from 'vitest';
import { isActiveStaffRow, postSignInStep, refusesSocialSignIn, signedInWithProvider } from '../../auth/social';
import { noSessionGate } from '../../auth/gate';

/**
 * Staff sign-in (build-contracts-2026-09-23 §6.5, §6.6): an email sign-in that
 * lands on an active staff row goes to Today before any guest step; a Google
 * or Apple one is refused; and the signed-out-only screens send a staff
 * session to the staff area instead of the tabs. The guest cases of all three
 * are pinned where they always were (auth/__tests__), unchanged.
 */
const COMPLETE = { phone: '+9647701234567', full_name: 'Sara' };
const NO_PHONE = { phone: null, full_name: 'Sara' };

describe('postSignInStep with the own staff row', () => {
  it('sends an active staff row to Today, ahead of the guest profile steps', () => {
    expect(postSignInStep(NO_PHONE, false, { is_active: true })).toBe('staff');
    expect(postSignInStep(NO_PHONE, true, { is_active: true })).toBe('staff');
    expect(postSignInStep(COMPLETE, false, { is_active: true })).toBe('staff');
  });

  it('leaves a guest, and a switched-off row, to the guest steps', () => {
    for (const staffRow of [undefined, null, { is_active: false }, {}]) {
      expect(postSignInStep(COMPLETE, false, staffRow)).toBe('continue');
      expect(postSignInStep(NO_PHONE, true, staffRow)).toBe('complete-profile');
      expect(postSignInStep(NO_PHONE, false, staffRow)).toBe('await-gate');
    }
  });

  it('counts only is_active = true as active', () => {
    expect(isActiveStaffRow({ is_active: true })).toBe(true);
    expect(isActiveStaffRow({ is_active: null })).toBe(false);
    expect(isActiveStaffRow(null)).toBe(false);
  });
});

describe('the social refusal', () => {
  it('refuses a Google or Apple sign-in that lands on an active staff row, and nothing else', () => {
    expect(refusesSocialSignIn({ is_active: true })).toBe(true);
    expect(refusesSocialSignIn({ is_active: false })).toBe(false);
    expect(refusesSocialSignIn(null)).toBe(false);
  });
});

describe('a provider session', () => {
  const jwt = (claims: unknown) =>
    ['{"alg":"HS256"}', JSON.stringify(claims), 'sig'].map((p) => Buffer.from(p).toString('base64url')).join('.');

  it('is a session whose amr names oauth (a Google or Apple ID-token sign-in)', () => {
    expect(signedInWithProvider(jwt({ sub: 'u', amr: [{ method: 'oauth', timestamp: 1 }] }))).toBe(true);
    // Arabic in user_metadata rides in the same payload and must not break the read.
    expect(signedInWithProvider(jwt({ user_metadata: { full_name: 'سارة' }, amr: [{ method: 'oauth' }] }))).toBe(true);
  });

  it('is not a password, phone-code or anonymous session, nor anything unreadable', () => {
    for (const method of ['password', 'otp', 'anonymous']) {
      expect(signedInWithProvider(jwt({ amr: [{ method }] })), method).toBe(false);
    }
    expect(signedInWithProvider(jwt({ sub: 'u' }))).toBe(false);
    expect(signedInWithProvider(jwt(null))).toBe(false);
    for (const token of [null, undefined, '', 'test-access-token', 'a.%%%.c']) {
      expect(signedInWithProvider(token), String(token)).toBe(false);
    }
  });
});

describe('noSessionGate with the staff status', () => {
  const signedIn = { initializing: false, hasSession: true, hasPendingSlot: false, profile: 'incomplete' as const };

  it('waits while a hinted staff read is in flight', () => {
    expect(noSessionGate({ ...signedIn, staff: 'pending' })).toBe('loading');
  });

  it('sends staff, switched-off and too-new accounts to the staff area before the complete-profile branch', () => {
    for (const staff of ['staff', 'revoked', 'unsupported'] as const) {
      expect(noSessionGate({ ...signedIn, staff }), staff).toBe('redirect-staff');
    }
  });

  it('waits while the signed-in account’s own row is unread: unread, a staff account looks like a guest', () => {
    expect(noSessionGate({ ...signedIn, staff: 'guest', staffAnswered: false })).toBe('loading');
    expect(noSessionGate({ ...signedIn, profile: 'complete', staff: 'guest', staffAnswered: false })).toBe('loading');
    expect(noSessionGate({ ...signedIn, staff: 'guest', staffAnswered: true })).toBe('redirect-complete-profile');
    // Signed out, nothing is read and nothing waits.
    expect(noSessionGate({ ...signedIn, hasSession: false, staff: 'none', staffAnswered: true })).toBe('allow');
  });

  it('answers a guest exactly as it did without the input', () => {
    expect(noSessionGate({ ...signedIn, staff: 'guest' })).toBe(noSessionGate(signedIn));
    expect(noSessionGate({ ...signedIn, profile: 'complete', staff: 'guest' })).toBe('redirect');
  });

  it('keeps the pending-slot exemption and the initializing wait ahead of it', () => {
    expect(noSessionGate({ ...signedIn, hasPendingSlot: true, staff: 'staff' })).toBe('allow');
    expect(noSessionGate({ ...signedIn, initializing: true, staff: 'staff' })).toBe('loading');
  });
});
