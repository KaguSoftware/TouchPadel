import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t, type Locale } from '@touch/i18n';
import { DeleteAccountForm, confirmationMatches } from './DeleteAccountForm';

/**
 * The web deletion flow against a fake Supabase client: sign in, type the
 * confirmation word, and app.delete_my_account is called with the same
 * p_confirm token the app sends. Every path that ends the attempt signs the
 * in-memory session out.
 */

function fakeClient(opts: { signInError?: string; rpcError?: string } = {}) {
  const rpc = vi.fn(async () =>
    opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: { deleted: true }, error: null },
  );
  const client = {
    auth: {
      signInWithPassword: vi.fn(async () =>
        opts.signInError ? { data: null, error: { message: opts.signInError } } : { data: {}, error: null },
      ),
      signOut: vi.fn(async () => ({ error: null })),
    },
    schema: vi.fn(() => ({ rpc })),
  };
  return { client, rpc };
}

function renderForm(locale: Locale, client: unknown) {
  return render(<DeleteAccountForm locale={locale} createClient={() => client as never} />);
}

function signIn(locale: Locale, identifier: string, password = 'secret-password') {
  fireEvent.change(screen.getByLabelText(t(locale, 'legal.deleteAccount.form.phoneLabel')), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText(t(locale, 'legal.deleteAccount.form.passwordLabel')), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'legal.deleteAccount.form.signIn') }));
}

describe('confirmationMatches', () => {
  it('matches the app’s rule: trimmed, case-insensitive, never empty', () => {
    expect(confirmationMatches(' delete ', 'DELETE')).toBe(true);
    expect(confirmationMatches('حذف', 'حذف')).toBe(true);
    expect(confirmationMatches('DELET', 'DELETE')).toBe(false);
    expect(confirmationMatches('', '')).toBe(false);
  });
});

describe.each(['en', 'ar'] as const)('DeleteAccountForm (%s)', (locale) => {
  it('signs in by phone, then deletes with the confirmation token', async () => {
    const { client, rpc } = fakeClient();
    renderForm(locale, client);

    signIn(locale, '0770 123 4567');
    await screen.findByText(t(locale, 'legal.deleteAccount.form.confirmPrompt', { word: t(locale, 'profile.deleteConfirmWord') }));
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647701234567',
      password: 'secret-password',
    });

    const del = screen.getByRole('button', { name: t(locale, 'legal.deleteAccount.form.delete') });
    expect((del as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: t(locale, 'profile.deleteConfirmWord') } });
    expect((del as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(del);

    await screen.findByText(t(locale, 'legal.deleteAccount.form.doneTitle'));
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(rpc).toHaveBeenCalledWith('delete_my_account', { p_confirm: 'DELETE' });
    expect(client.auth.signOut).toHaveBeenCalled();
  });

  it('signs in by email when that method is chosen', async () => {
    const { client } = fakeClient();
    renderForm(locale, client);

    fireEvent.click(screen.getByRole('radio', { name: t(locale, 'legal.deleteAccount.form.email') }));
    fireEvent.change(screen.getByLabelText(t(locale, 'legal.deleteAccount.form.emailLabel')), {
      target: { value: ' guest@example.com ' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'legal.deleteAccount.form.passwordLabel')), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'legal.deleteAccount.form.signIn') }));

    await waitFor(() =>
      expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'guest@example.com', password: 'pw' }),
    );
  });

  it('refuses a number that is not an Iraqi mobile before calling the server', async () => {
    const { client } = fakeClient();
    renderForm(locale, client);

    signIn(locale, '12345');
    expect((await screen.findByRole('alert')).textContent).toBe(t(locale, 'legal.deleteAccount.form.errors.phone'));
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('says so when the credentials do not match', async () => {
    const { client } = fakeClient({ signInError: 'Invalid login credentials' });
    renderForm(locale, client);

    signIn(locale, '07701234567');
    expect((await screen.findByRole('alert')).textContent).toBe(
      t(locale, 'legal.deleteAccount.form.errors.credentials'),
    );
  });

  it('turns a staff account away and ends the session', async () => {
    const { client } = fakeClient({ rpcError: 'FORBIDDEN' });
    renderForm(locale, client);

    signIn(locale, '07701234567');
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: t(locale, 'profile.deleteConfirmWord') } });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'legal.deleteAccount.form.delete') }));

    expect((await screen.findByRole('alert')).textContent).toBe(t(locale, 'legal.deleteAccount.form.errors.staff'));
    expect(client.auth.signOut).toHaveBeenCalled();
    // Back at sign-in, not left holding a live session on the confirm step.
    expect(screen.getByRole('button', { name: t(locale, 'legal.deleteAccount.form.signIn') })).toBeTruthy();
  });

  it('cancel signs out and returns to sign-in', async () => {
    const { client, rpc } = fakeClient();
    renderForm(locale, client);

    signIn(locale, '07701234567');
    fireEvent.click(await screen.findByRole('button', { name: t(locale, 'legal.deleteAccount.form.cancel') }));

    await screen.findByRole('button', { name: t(locale, 'legal.deleteAccount.form.signIn') });
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
