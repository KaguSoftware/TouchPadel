'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { formatIraqiNational, toE164Iraq } from '@touch/core';
import { isolateLtr, makeT, type Locale, type MessageKey } from '@touch/i18n';
import { appRpc } from '@/lib/appRpc';
import { createEphemeralBrowserSupabase } from '@/lib/supabase/client';

/**
 * The web half of account deletion — the Google Play "delete account" URL,
 * reachable without installing the app.
 *
 * Sign in with the account's phone or email and password, type the
 * confirmation word, and app.delete_my_account (0077) runs exactly as it does
 * from the app: same RPC, same p_confirm token, same guards (an anonymous
 * session is ACCOUNT_REQUIRED, staff are FORBIDDEN). The session lives in an
 * in-memory client (createEphemeralBrowserSupabase), never the café's shared
 * sb-* cookie, and is signed out on every exit path.
 *
 * Apple and Google accounts have no password; the page sends them to the app
 * or the emailed request instead (Sign in with Apple revocation needs a fresh
 * Apple authorization that only the iPhone flow obtains).
 */

type Method = 'phone' | 'email';
type Step = 'signin' | 'confirm' | 'done';
type Client = SupabaseClient<Database>;

const RPC_KEYS: Record<string, MessageKey> = {
  FORBIDDEN: 'legal.deleteAccount.form.errors.staff',
  ALREADY_DELETED: 'legal.deleteAccount.form.errors.already',
  ACCOUNT_REQUIRED: 'legal.deleteAccount.form.errors.noAccount',
  AUTH_REQUIRED: 'legal.deleteAccount.form.errors.credentials',
};

/** Same rule as the app (apps/mobile/src/features/profile/deletion.ts): trimmed, case-insensitive. */
export function confirmationMatches(typed: string, expected: string): boolean {
  const norm = (s: string) => s.trim().toLocaleLowerCase();
  const want = norm(expected);
  return want.length > 0 && norm(typed) === want;
}

export function DeleteAccountForm({
  locale,
  createClient = createEphemeralBrowserSupabase,
}: {
  locale: Locale;
  /** Injected by tests; production uses the in-memory browser client. */
  createClient?: () => Client;
}) {
  const tr = makeT(locale);
  const id = useId();
  const clientRef = useRef<Client | null>(null);
  const [method, setMethod] = useState<Method>('phone');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [who, setWho] = useState('');
  const [step, setStep] = useState<Step>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const word = tr('profile.deleteConfirmWord');
  const armed = confirmationMatches(typed, word);

  // Created on first use, not on render: a misconfigured deployment (no
  // Supabase env) must still render the page and its request fallback.
  const client = (): Client => {
    if (!clientRef.current) clientRef.current = createClient();
    return clientRef.current;
  };

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

    let credentials: { phone: string; password: string } | { email: string; password: string };
    let display: string;
    if (method === 'phone') {
      const e164 = toE164Iraq(identifier);
      if (!e164) return setError('legal.deleteAccount.form.errors.phone');
      credentials = { phone: e164, password };
      display = formatIraqiNational(e164);
    } else {
      const email = identifier.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('legal.deleteAccount.form.errors.email');
      credentials = { email, password };
      display = email;
    }

    setBusy(true);
    try {
      const { error: authError } = await client().auth.signInWithPassword(credentials);
      if (authError) {
        setError('legal.deleteAccount.form.errors.credentials');
        return;
      }
      setWho(display);
      setPassword('');
      setStep('confirm');
    } catch {
      setError('legal.deleteAccount.form.errors.unavailable');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await clientRef.current?.auth.signOut();
    } catch {
      // The session is in memory only; dropping the client forgets it anyway.
    }
    clientRef.current = null;
  };

  const onDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (!armed || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: rpcError } = await appRpc(client(), 'delete_my_account', { p_confirm: 'DELETE' });
      if (rpcError) {
        const code = rpcError.message?.trim() ?? '';
        setError(RPC_KEYS[code] ?? 'legal.deleteAccount.form.errors.generic');
        // Nothing to retry for these: end the session rather than leave it open.
        if (code in RPC_KEYS) {
          await signOut();
          setStep('signin');
          setTyped('');
        }
        return;
      }
      // The auth user is gone server-side; this only clears the local copy.
      await signOut();
      setStep('done');
    } catch {
      setError('legal.deleteAccount.form.errors.generic');
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    await signOut();
    setStep('signin');
    setTyped('');
    setWho('');
    setError(null);
  };

  if (step === 'done') {
    return (
      <div className="tp-legal__form" role="status">
        <h3 className="tp-legal__subtitle">{tr('legal.deleteAccount.form.doneTitle')}</h3>
        <p>{tr('legal.deleteAccount.form.doneBody')}</p>
      </div>
    );
  }

  const errorLine = error ? (
    <p className="tp-legal__error" role="alert">
      {tr(error)}
    </p>
  ) : null;

  if (step === 'confirm') {
    return (
      <form className="tp-legal__form" onSubmit={onDelete} aria-label={tr('legal.deleteAccount.form.label')}>
        <p>{tr('legal.deleteAccount.form.signedIn', { who: isolateLtr(who) })}</p>
        <label className="tp-legal__field" htmlFor={`${id}-word`}>
          <span>{tr('legal.deleteAccount.form.confirmPrompt', { word })}</span>
          <input
            id={`${id}-word`}
            className="tp-legal__input"
            value={typed}
            onChange={(ev) => setTyped(ev.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </label>
        {errorLine}
        <div className="tp-legal__actions">
          <button type="submit" className="tp-btn tp-legal__danger" disabled={!armed || busy}>
            {busy ? tr('legal.deleteAccount.form.deleting') : tr('legal.deleteAccount.form.delete')}
          </button>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onCancel} disabled={busy}>
            {tr('legal.deleteAccount.form.cancel')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="tp-legal__form" onSubmit={onSignIn} aria-label={tr('legal.deleteAccount.form.label')}>
      <fieldset className="tp-legal__methods">
        <legend>{tr('legal.deleteAccount.form.method')}</legend>
        {(['phone', 'email'] as const).map((m) => (
          <label key={m} className="tp-legal__method">
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
            {tr(m === 'phone' ? 'legal.deleteAccount.form.phone' : 'legal.deleteAccount.form.email')}
          </label>
        ))}
      </fieldset>
      <label className="tp-legal__field" htmlFor={`${id}-identifier`}>
        <span>
          {tr(method === 'phone' ? 'legal.deleteAccount.form.phoneLabel' : 'legal.deleteAccount.form.emailLabel')}
        </span>
        <input
          id={`${id}-identifier`}
          className="tp-legal__input"
          type={method === 'phone' ? 'tel' : 'email'}
          inputMode={method === 'phone' ? 'tel' : 'email'}
          autoComplete={method === 'phone' ? 'tel' : 'email'}
          placeholder={method === 'phone' ? tr('legal.deleteAccount.form.phonePlaceholder') : undefined}
          dir="ltr"
          value={identifier}
          onChange={(ev) => setIdentifier(ev.target.value)}
          required
        />
      </label>
      <label className="tp-legal__field" htmlFor={`${id}-password`}>
        <span>{tr('legal.deleteAccount.form.passwordLabel')}</span>
        <input
          id={`${id}-password`}
          className="tp-legal__input"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(ev) => setPassword(ev.target.value)}
          required
        />
      </label>
      {errorLine}
      <div className="tp-legal__actions">
        <button type="submit" className="tp-btn tp-btn--primary" disabled={busy}>
          {busy ? tr('legal.deleteAccount.form.signingIn') : tr('legal.deleteAccount.form.signIn')}
        </button>
      </div>
    </form>
  );
}
