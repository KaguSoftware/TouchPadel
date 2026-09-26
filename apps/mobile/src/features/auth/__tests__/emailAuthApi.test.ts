import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { RESET_REDIRECT, VERIFY_REDIRECT, sendPasswordReset, signUpWithEmail, validateSignUp } from '../api';

/**
 * Email + password accounts, restored beside phone (2026-09-20). What must not
 * drift: the sign-up carries the SAME metadata the phone sign-up does (so
 * app.handle_new_user writes the phone and the guest never meets
 * PHONE_REQUIRED), every mail names its deep-link target (or GoTrue falls back
 * to the Site URL and the link dead-ends), and the email is checked in the
 * form's order.
 */

function fakeAuth() {
  const auth = {
    signUp: vi.fn(async (_args: unknown) => ({ data: { user: null, session: null }, error: null })),
    resetPasswordForEmail: vi.fn(async (_email: string, _opts: unknown) => ({ data: {}, error: null })),
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}

describe('signUpWithEmail', () => {
  it('sends email + password, the redirect and the profile metadata the trigger reads', async () => {
    const { auth, client } = fakeAuth();
    await signUpWithEmail(
      client as never,
      {
        firstName: ' Sara ',
        lastName: ' Ali ',
        email: ' Sara@Example.com ',
        phone: '+9647701234567',
        password: 'hunter22!',
        preferredLang: 'ar',
      },
      'exp://192.168.1.5:8081/--/verify-email',
    );
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'Sara@Example.com',
      password: 'hunter22!',
      options: {
        emailRedirectTo: 'exp://192.168.1.5:8081/--/verify-email',
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

  it('defaults the redirect to the built app scheme', async () => {
    const { auth, client } = fakeAuth();
    await signUpWithEmail(client as never, {
      firstName: 'a',
      lastName: 'b',
      email: 'a@b.co',
      phone: '+1',
      password: 'x',
      preferredLang: 'en',
    });
    expect(auth.signUp.mock.calls[0]?.[0]).toMatchObject({
      options: { emailRedirectTo: VERIFY_REDIRECT },
    });
  });

  it('throws GoTrue refusals so the screen can name them', async () => {
    const { auth, client } = fakeAuth();
    auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'email_exists' } as never });
    await expect(
      signUpWithEmail(client as never, {
        firstName: 'a',
        lastName: 'b',
        email: 'a@b.co',
        phone: '+1',
        password: 'x',
        preferredLang: 'en',
      }),
    ).rejects.toMatchObject({ code: 'email_exists' });
  });
});

describe('sendPasswordReset', () => {
  it('names the reset-password deep link, trimmed address', async () => {
    const { auth, client } = fakeAuth();
    await sendPasswordReset(client as never, ' sara@example.com ');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('sara@example.com', {
      redirectTo: RESET_REDIRECT,
    });
    expect(RESET_REDIRECT).toBe('touchpadel://reset-password');
  });
});

describe('validateSignUp with an email', () => {
  const ok = {
    firstName: 'Sara',
    lastName: 'Ali',
    email: 'sara@example.com',
    phoneNational: '770 123 4567',
    password: '12345678',
  };

  it('passes a complete form', () => {
    expect(validateSignUp(ok)).toBeNull();
  });

  it('checks the email after the names and before the phone — the form order', () => {
    expect(validateSignUp({ ...ok, firstName: '', email: 'nope' })).toBe('FIRST_NAME_REQUIRED');
    expect(validateSignUp({ ...ok, email: 'nope', phoneNational: '' })).toBe('EMAIL_INVALID');
    expect(validateSignUp({ ...ok, email: '' })).toBe('EMAIL_INVALID');
    expect(validateSignUp({ ...ok, phoneNational: '' })).toBe('PHONE_REQUIRED');
  });

  it('still requires the phone on the email segment (spec 05.3)', () => {
    expect(validateSignUp({ ...ok, phoneNational: '  ' })).toBe('PHONE_REQUIRED');
  });

  it('skips the email rule when the form has no email field (phone segment)', () => {
    const { email: _email, ...phoneForm } = ok;
    expect(validateSignUp(phoneForm)).toBeNull();
  });
});
