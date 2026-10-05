'use client';

import { useId, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { makeT, type Locale, type MessageKey } from '@touch/i18n';
import { credentialsOf, webOAuthEnabled, type SignInMethod } from '@/lib/account/account';

type Client = SupabaseClient<Database>;

/**
 * Signed out on /{locale}/account: phone or email with the password, the app's own sign-in
 * (apps/mobile/src/features/auth/api.ts `signInWithPhone` / `signIn`). Sign-up stays in the
 * app, where the phone code is spent; the page links to it. Google and Apple only behind
 * `NEXT_PUBLIC_WEB_OAUTH` (PKCE: the provider sends the browser back to this page, and the
 * account client exchanges the `?code=` on load).
 */
export function SignInForm({
  locale,
  client,
  oauthRedirect,
  onSignedIn,
}: {
  locale: Locale;
  client: Client;
  /** Where Google or Apple send the browser back to (this page, with its `?return=`). */
  oauthRedirect: () => string;
  onSignedIn(): void;
}) {
  const tr = makeT(locale);
  const id = useId();
  const [method, setMethod] = useState<SignInMethod>('phone');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const credentials = credentialsOf(method, identifier, password);
    if ('error' in credentials) return setError(credentials.error);
    setBusy(true);
    try {
      const { error: authError } = await client.auth.signInWithPassword(credentials);
      if (authError) {
        setError('loyalty.web.signIn.errors.credentials');
        return;
      }
      setPassword('');
      onSignedIn();
    } catch {
      setError('loyalty.web.signIn.errors.unavailable');
    } finally {
      setBusy(false);
    }
  };

  const onOAuth = async (provider: 'google' | 'apple') => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: oauthRedirect() },
      });
      // On success the browser is already on its way to the provider.
      if (oauthError) setError('loyalty.web.signIn.errors.unavailable');
    } catch {
      setError('loyalty.web.signIn.errors.unavailable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tp-acct__panel" aria-labelledby="acct-signin-title">
      <h2 id="acct-signin-title" className="tp-acct__h2">
        {tr('loyalty.web.signIn.title')}
      </h2>
      <p className="tp-acct__muted">{tr('loyalty.web.signIn.lead')}</p>
      <form
        className="tp-acct__form"
        onSubmit={onSubmit}
        aria-label={tr('loyalty.web.signIn.title')}
      >
        <fieldset className="tp-acct__methods">
          <legend>{tr('loyalty.web.signIn.method')}</legend>
          {(['phone', 'email'] as const).map((m) => (
            <label key={m} className="tp-acct__method">
              <input
                type="radio"
                name={`${id}-method`}
                value={m}
                checked={method === m}
                onChange={() => {
                  setMethod(m);
                  setIdentifier('');
                  setError(null);
                }}
              />
              {tr(m === 'phone' ? 'loyalty.web.signIn.phone' : 'loyalty.web.signIn.email')}
            </label>
          ))}
        </fieldset>
        <label className="tp-acct__field" htmlFor={`${id}-identifier`}>
          <span>
            {tr(
              method === 'phone'
                ? 'loyalty.web.signIn.phoneLabel'
                : 'loyalty.web.signIn.emailLabel',
            )}
          </span>
          <input
            id={`${id}-identifier`}
            className="tp-acct__input"
            type={method === 'phone' ? 'tel' : 'email'}
            inputMode={method === 'phone' ? 'tel' : 'email'}
            autoComplete={method === 'phone' ? 'tel' : 'email'}
            placeholder={method === 'phone' ? tr('loyalty.web.signIn.phonePlaceholder') : undefined}
            dir="ltr"
            value={identifier}
            onChange={(ev) => setIdentifier(ev.target.value)}
            required
          />
        </label>
        <label className="tp-acct__field" htmlFor={`${id}-password`}>
          <span>{tr('loyalty.web.signIn.passwordLabel')}</span>
          <input
            id={`${id}-password`}
            className="tp-acct__input"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            required
          />
        </label>
        {error ? (
          <p className="tp-acct__error" role="alert">
            {tr(error)}
          </p>
        ) : null}
        <button type="submit" className="tp-acct__btn tp-acct__btn--primary" disabled={busy}>
          {busy ? tr('loyalty.web.signIn.submitting') : tr('loyalty.web.signIn.submit')}
        </button>
      </form>
      {webOAuthEnabled() ? (
        <div className="tp-acct__oauth">
          <p className="tp-acct__or">{tr('loyalty.web.signIn.or')}</p>
          <button
            type="button"
            className="tp-acct__btn"
            onClick={() => void onOAuth('google')}
            disabled={busy}
          >
            {tr('loyalty.web.signIn.google')}
          </button>
          <button
            type="button"
            className="tp-acct__btn"
            onClick={() => void onOAuth('apple')}
            disabled={busy}
          >
            {tr('loyalty.web.signIn.apple')}
          </button>
        </div>
      ) : null}
      <p className="tp-acct__muted">
        {tr('loyalty.web.signIn.noAccount')}{' '}
        <a className="tp-acct__link" href={`/${locale}#app`}>
          {tr('loyalty.web.signIn.getApp')}
        </a>
      </p>
    </section>
  );
}
