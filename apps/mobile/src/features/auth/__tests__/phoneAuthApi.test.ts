import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fullNameOf, sendPasswordResetCode, signInWithPhone, signUpWithPhone, validateSignUp } from '../api';

/**
 * Phone + password accounts (owner decision 2026-09-15). What must not drift:
 * the sign-up carries the metadata app.handle_new_user builds the profile from,
 * sign-in spends no code, and recovery can never create an account.
 */

function fakeAuth() {
  const auth = {
    signUp: vi.fn(async (_args: unknown) => ({ data: { user: null, session: null }, error: null })),
    signInWithPassword: vi.fn(async (_args: unknown) => ({ data: { user: null, session: null }, error: null })),
    signInWithOtp: vi.fn(async (_args: unknown) => ({ data: {}, error: null })),
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}

describe('signUpWithPhone', () => {
  it('sends phone + password with the profile metadata the trigger reads', async () => {
    const { auth, client } = fakeAuth();
    await signUpWithPhone(client as never, {
      firstName: ' Sara ',
      lastName: ' Ali ',
      phone: '+9647701234567',
      password: 'hunter22!',
      preferredLang: 'ar',
    });
    expect(auth.signUp).toHaveBeenCalledWith({
      phone: '+9647701234567',
      password: 'hunter22!',
      options: {
        data: {
          full_name: 'Sara Ali',
          given_name: 'Sara',
          family_name: 'Ali',
          phone: '+9647701234567',
          preferred_lang: 'ar',
        },
      },
    });
  });

  it('throws GoTrue refusals so the screen can name them', async () => {
    const { auth, client } = fakeAuth();
    auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'phone_exists' } as never });
    await expect(
      signUpWithPhone(client as never, { firstName: 'a', lastName: 'b', phone: '+1', password: 'x', preferredLang: 'en' }),
    ).rejects.toMatchObject({ code: 'phone_exists' });
  });
});

describe('signInWithPhone', () => {
  it('is a password grant on the number — no code is sent', async () => {
    const { auth, client } = fakeAuth();
    await signInWithPhone(client as never, '+447700900123', 'pw');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ phone: '+447700900123', password: 'pw' });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe('sendPasswordResetCode', () => {
  it('never creates an account for a number nobody owns', async () => {
    const { auth, client } = fakeAuth();
    await sendPasswordResetCode(client as never, '+9647701234567');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      phone: '+9647701234567',
      options: { shouldCreateUser: false },
    });
  });
});

describe('validateSignUp', () => {
  const ok = { firstName: 'Sara', lastName: 'Ali', phoneNational: '770 123 4567', password: '12345678' };

  it('passes a complete form', () => {
    expect(validateSignUp(ok)).toBeNull();
  });

  it('corrects the guest in the form order', () => {
    expect(validateSignUp({ ...ok, firstName: ' ', lastName: '', password: '' })).toBe('FIRST_NAME_REQUIRED');
    expect(validateSignUp({ ...ok, lastName: '  ', phoneNational: '' })).toBe('LAST_NAME_REQUIRED');
    expect(validateSignUp({ ...ok, phoneNational: '', password: '' })).toBe('PHONE_REQUIRED');
    expect(validateSignUp({ ...ok, password: '1234567' })).toBe('PASSWORD_TOO_SHORT');
  });
});

describe('fullNameOf', () => {
  it('joins trimmed parts with one space', () => {
    expect(fullNameOf(' Sara ', ' Ali ')).toBe('Sara Ali');
    expect(fullNameOf('Sara', '')).toBe('Sara');
  });
});
