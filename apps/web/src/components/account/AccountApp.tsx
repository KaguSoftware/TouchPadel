'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { MemberCard, MyLoyalty } from '@touch/core/loyalty';
import { formatDate, formatNumber, makeT, type Locale } from '@touch/i18n';
import {
  accountHref,
  accountName,
  accountPhone,
  historyKindKey,
  localName,
  pointsToNextTier,
  readMemberCard,
  readMyLoyalty,
} from '@/lib/account/account';
import { accountBrowserSupabase } from '@/lib/supabase/client';
import { MemberCardView } from './MemberCardView';
import { SignInForm } from './SignInForm';

type Client = SupabaseClient<Database>;

type Auth =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'signed-out'; client: Client }
  | { state: 'signed-in'; client: Client; user: User };

type Data =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ok'; card: MemberCard | null; loyalty: MyLoyalty | null };

/**
 * /{locale}/account, the client half (plan §5.2): the session lives in the account client's own
 * `sb-tp-account` cookie, never the café's table session, so the page is a client island and
 * reads no cookie on the server (the layout's C11 rule). Signed out, the sign-in; signed in,
 * the member card, the points, the tier, the history and the rewards, and sign out.
 *
 * `returnTo` is the café chip's way back (`?return=`, already checked by `safeReturnPath`): a
 * sign-in made here goes straight back to the table, where the chip links the session.
 */
export function AccountApp({
  locale,
  returnTo,
  getClient = accountBrowserSupabase,
}: {
  locale: Locale;
  returnTo: string | null;
  /** Injected by tests; production uses the page's one account client. */
  getClient?: () => Client | null;
}) {
  const tr = makeT(locale);
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });
  const [data, setData] = useState<Data>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const client = getClient();
    if (!client) {
      setAuth({ state: 'unavailable' });
      return;
    }
    let cancelled = false;
    void client.auth
      .getSession()
      .then(({ data: s }) => {
        if (cancelled) return;
        setAuth(
          s.session
            ? { state: 'signed-in', client, user: s.session.user }
            : { state: 'signed-out', client },
        );
      })
      .catch(() => {
        if (!cancelled) setAuth({ state: 'signed-out', client });
      });
    // A Google or Apple return lands its session after the first read, and a sign-out in
    // another tab ends this one.
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      setAuth(
        session
          ? { state: 'signed-in', client, user: session.user }
          : { state: 'signed-out', client },
      );
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [getClient]);

  const client = auth.state === 'signed-in' || auth.state === 'signed-out' ? auth.client : null;
  const userId = auth.state === 'signed-in' ? auth.user.id : null;
  useEffect(() => {
    if (!userId || !client) return;
    let cancelled = false;
    setData({ state: 'loading' });
    void Promise.all([readMemberCard(client), readMyLoyalty(client)])
      .then(([card, loyalty]) => {
        if (cancelled) return;
        setData(card || loyalty ? { state: 'ok', card, loyalty } : { state: 'error' });
      })
      .catch(() => {
        if (!cancelled) setData({ state: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [client, userId, attempt]);

  const onSignedIn = useCallback(() => {
    if (returnTo) window.location.assign(returnTo);
  }, [returnTo]);

  const oauthRedirect = useCallback(
    () => `${window.location.origin}${accountHref(locale, returnTo)}`,
    [locale, returnTo],
  );

  const onSignOut = async () => {
    try {
      // Local only: signing out of the website must not sign the phone app out too.
      await client?.auth.signOut({ scope: 'local' });
    } catch {
      // The cookie is cleared locally either way.
    }
    if (client) setAuth({ state: 'signed-out', client });
    setData({ state: 'loading' });
  };

  const back = returnTo ? (
    <a className="tp-acct__btn tp-acct__back" href={returnTo}>
      {tr('loyalty.web.account.back')}
    </a>
  ) : null;

  if (auth.state === 'loading') {
    return (
      <p className="tp-acct__muted" role="status">
        {tr('loyalty.web.account.loading')}
      </p>
    );
  }
  if (auth.state === 'unavailable') {
    return (
      <p className="tp-acct__panel" role="alert">
        {tr('loyalty.web.account.unavailable')}
      </p>
    );
  }
  if (auth.state === 'signed-out') {
    return (
      <>
        {back}
        <SignInForm
          locale={locale}
          client={auth.client}
          oauthRedirect={oauthRedirect}
          onSignedIn={onSignedIn}
        />
      </>
    );
  }

  const name = accountName(auth.user);
  return (
    <div className="tp-acct__signed-in">
      <div className="tp-acct__hello">
        <p className="tp-acct__lead">
          {name ? tr('loyalty.web.account.hello', { name }) : tr('loyalty.web.account.helloNoName')}
        </p>
        <button type="button" className="tp-acct__btn" onClick={() => void onSignOut()}>
          {tr('loyalty.web.account.signOut')}
        </button>
      </div>
      {back}
      {data.state === 'loading' ? (
        <p className="tp-acct__muted" role="status">
          {tr('loyalty.web.account.loading')}
        </p>
      ) : data.state === 'error' ? (
        <div className="tp-acct__panel" role="alert">
          <p>{tr('loyalty.web.account.error')}</p>
          <button type="button" className="tp-acct__btn" onClick={() => setAttempt((n) => n + 1)}>
            {tr('loyalty.web.account.retry')}
          </button>
        </div>
      ) : (
        <>
          {data.card ? (
            <MemberCardView locale={locale} card={data.card} phone={accountPhone(auth.user)} />
          ) : null}
          {data.loyalty ? <Points locale={locale} loyalty={data.loyalty} /> : null}
        </>
      )}
    </div>
  );
}

/** Balance, tier and the way to the next one, rewards, and the history. */
function Points({ locale, loyalty }: { locale: Locale; loyalty: MyLoyalty }) {
  const tr = makeT(locale);
  const num = (n: number) => formatNumber(n, locale);
  if (!loyalty.enabled) {
    return (
      <section className="tp-acct__panel">
        <p>{tr('loyalty.web.account.off')}</p>
      </section>
    );
  }
  const toNext = pointsToNextTier(loyalty);
  return (
    <>
      <section className="tp-acct__panel tp-acct__points" aria-labelledby="acct-points-title">
        <h2 id="acct-points-title" className="tp-acct__h2">
          {tr('loyalty.web.account.balanceTitle')}
        </h2>
        <p className="tp-acct__balance tp-num">
          {tr('loyalty.web.account.points', { points: num(loyalty.balance) })}
        </p>
        {loyalty.tier ? (
          <p className="tp-acct__tier">
            {tr('loyalty.web.account.tier', { tier: localName(locale, loyalty.tier) })}
          </p>
        ) : null}
        {loyalty.next_tier && toNext !== null ? (
          <p className="tp-acct__muted">
            {tr('loyalty.web.account.nextTier', {
              points: num(toNext),
              tier: localName(locale, loyalty.next_tier),
            })}
          </p>
        ) : (
          <p className="tp-acct__muted">{tr('loyalty.web.account.topTier')}</p>
        )}
      </section>

      <section className="tp-acct__panel" aria-labelledby="acct-rewards-title">
        <h2 id="acct-rewards-title" className="tp-acct__h2">
          {tr('loyalty.web.account.rewardsTitle')}
        </h2>
        {loyalty.rewards.length === 0 ? (
          <p className="tp-acct__muted">{tr('loyalty.web.account.rewardsEmpty')}</p>
        ) : (
          <>
            <p className="tp-acct__muted">{tr('loyalty.web.account.rewardsHint')}</p>
            <ul className="tp-acct__list">
              {loyalty.rewards.map((r) => (
                <li key={r.id} className="tp-acct__row">
                  <span>{localName(locale, r)}</span>
                  <span className="tp-num">
                    {tr('loyalty.web.account.points', { points: num(r.cost_points) })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="tp-acct__panel" aria-labelledby="acct-history-title">
        <h2 id="acct-history-title" className="tp-acct__h2">
          {tr('loyalty.web.account.history.title')}
        </h2>
        {loyalty.history.length === 0 ? (
          <p className="tp-acct__muted">{tr('loyalty.web.account.history.empty')}</p>
        ) : (
          <ul className="tp-acct__list">
            {loyalty.history.map((row) => (
              <li key={row.id} className="tp-acct__row">
                <span>
                  {tr(historyKindKey(row.kind))}
                  <span className="tp-acct__date">
                    {' '}
                    · {formatDate(new Date(row.created_at), locale)}
                  </span>
                </span>
                <span className="tp-num" data-sign={row.delta < 0 ? 'minus' : 'plus'} dir="ltr">
                  {row.delta > 0 ? '+' : '−'}
                  {num(Math.abs(row.delta))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
