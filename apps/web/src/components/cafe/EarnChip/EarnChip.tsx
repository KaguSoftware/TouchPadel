'use client';

import { useEffect, useState } from 'react';
import { formatNumber, makeT, type Locale } from '@touch/i18n';
import { accountHref } from '@/lib/account/account';
import { linkGuestSessionOnce, type GuestLink } from '@/lib/account/linkGuest';
import { accountBrowserSupabase, type BrowserSupabase } from '@/lib/supabase/client';

/**
 * "Sign in to earn points" on a bound table (loyalty plan §5.2). Signed out, a chip to
 * /{locale}/account with the way back; signed in, the café session is linked to the member
 * once (`linkGuestSessionOnce`, through the café's own anonymous client) and the chip reads
 * "Earning points as <name>" with the balance.
 *
 * It never gets in the café's way: nothing shows until the account is known, nothing shows
 * when loyalty is switched off or the account client cannot be made, and a failed link is one
 * quiet line with a retry. The order flow does not wait on any of it.
 */
export function EarnChip({
  locale,
  cafe,
  sessionId,
  getAccount = accountBrowserSupabase,
  link = linkGuestSessionOnce,
}: {
  locale: Locale;
  /** The café's anonymous client (useSupabase). */
  cafe: BrowserSupabase | null;
  /** The bound guest session; null while unbound (no chip). */
  sessionId: string | null;
  /** Test seams. */
  getAccount?: () => BrowserSupabase | null;
  link?: typeof linkGuestSessionOnce;
}) {
  const tr = makeT(locale);
  const [state, setState] = useState<GuestLink | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [here, setHere] = useState<string | null>(null);

  useEffect(() => {
    setHere(`${window.location.pathname}${window.location.search}`);
  }, []);

  useEffect(() => {
    setState(null);
    if (!cafe || !sessionId) return;
    const account = getAccount();
    if (!account) return;
    let cancelled = false;
    void link(cafe, account, sessionId).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [cafe, sessionId, getAccount, link, attempt]);

  if (!state || state.status === 'off') return null;

  if (state.status === 'signed-out') {
    return (
      <a className="tp-earn-chip" href={accountHref(locale, here)}>
        <span className="tp-earn-chip__dot" aria-hidden="true" />
        {tr('loyalty.web.cafeChip.signIn')}
      </a>
    );
  }

  if (state.status === 'failed') {
    return (
      <p className="tp-earn-chip tp-earn-chip--quiet">
        {tr('loyalty.web.cafeChip.failed')}
        <button
          type="button"
          className="tp-earn-chip__retry"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {tr('loyalty.web.cafeChip.retry')}
        </button>
      </p>
    );
  }

  return (
    <p className="tp-earn-chip tp-earn-chip--linked" role="status">
      <span className="tp-earn-chip__dot" aria-hidden="true" />
      {state.name
        ? tr('loyalty.web.cafeChip.earning', { name: state.name })
        : tr('loyalty.web.cafeChip.earningNoName')}
      {state.balance !== null ? (
        <span className="tp-earn-chip__balance tp-num">
          {tr('loyalty.web.cafeChip.balance', { points: formatNumber(state.balance, locale) })}
        </span>
      ) : null}
    </p>
  );
}
