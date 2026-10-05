'use client';

import { useEffect, useState } from 'react';
import { formatIraqiNational } from '@touch/core';
import { memberToken, type MemberCard } from '@touch/core/loyalty';
import { formatNumber, makeT, type Locale } from '@touch/i18n';
import { MemberQr } from './MemberQr';

/**
 * The member card on the web (plan §5.2, the phone's `member-card.tsx` twin): the rotating QR
 * the till scans, a countdown to the next code, the member code printed under it, and the
 * phone the guest can say instead (loyalty decision L-4). The token is computed here, offline,
 * from the card's secret (`memberToken`, RFC 6238); the clock ticks once a second and the QR
 * redraws only when the token changes.
 */
export function MemberCardView({
  locale,
  card,
  phone,
  now = Date.now,
}: {
  locale: Locale;
  card: MemberCard;
  /** E.164, or null when the account has none. */
  phone: string | null;
  /** Test seam. */
  now?: () => number;
}) {
  const tr = makeT(locale);
  const [tick, setTick] = useState(() => memberToken(card, now()));

  useEffect(() => {
    setTick(memberToken(card, now()));
    const id = setInterval(() => setTick(memberToken(card, now())), 1000);
    return () => clearInterval(id);
  }, [card, now]);

  const step = card.step > 0 ? card.step : 30;
  return (
    <section className="tp-acct__card" aria-labelledby="acct-card-title">
      <h2 id="acct-card-title" className="tp-acct__h2">
        {tr('loyalty.web.account.card.title')}
      </h2>
      <p className="tp-acct__muted">{tr('loyalty.web.account.card.hint')}</p>
      <div className="tp-acct__qr-frame">
        <MemberQr
          className="tp-acct__qr"
          value={tick.token}
          label={tr('loyalty.web.account.card.qrLabel')}
        />
      </div>
      <div
        className="tp-acct__countdown"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={step}
        aria-valuenow={tick.secondsLeft}
        aria-label={tr('loyalty.web.account.card.refresh', {
          seconds: formatNumber(tick.secondsLeft, locale),
        })}
      >
        <span
          className="tp-acct__countdown-bar"
          style={{ inlineSize: `${(tick.secondsLeft / step) * 100}%` }}
        />
      </div>
      <p className="tp-acct__muted tp-num" aria-hidden="true">
        {tr('loyalty.web.account.card.refresh', {
          seconds: formatNumber(tick.secondsLeft, locale),
        })}
      </p>
      <p className="tp-acct__code">
        <span className="tp-acct__label">{tr('loyalty.web.account.card.code')}</span>
        <span className="tp-acct__code-value" dir="ltr">
          {card.member_code}
        </span>
      </p>
      {phone ? (
        <p className="tp-acct__say">
          <span className="tp-acct__label">{tr('loyalty.web.account.card.sayNumber')}</span>
          <span className="tp-acct__phone tp-num" dir="ltr">
            {formatIraqiNational(phone)}
          </span>
        </p>
      ) : null}
    </section>
  );
}
