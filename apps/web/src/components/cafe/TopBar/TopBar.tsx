'use client';

import Image from 'next/image';
import { t, type Locale } from '@touch/i18n';
import { TableChip } from './TableChip';
import { LocaleSwitcher } from './LocaleSwitcher';
import { BasketButton } from './BasketButton';
import type { TableSession, TableSessionState } from '@/hooks/cafe/useTableSession';

/**
 * The design's header: the Touch Cafe lockup centred on white, 175 px wide.
 *
 * The ordering controls the design does not draw — the table chip, the locale
 * switch and the basket — keep their place either side of it. They are sized by
 * their content and the LOCKUP is what flexes (topbar.css.ts), so the wordmark
 * takes its full 175 px when they leave room and narrows instead of being
 * printed over when they do not.
 *
 * Sticky, not fixed: it belongs to the app shell, above the single scroller.
 */
export function TopBar({
  locale,
  token,
  sessionState,
  session,
  basketCount,
  basketTotal,
  onOpenBasket,
  onNeedsRescan,
}: {
  locale: Locale;
  token: string | null;
  sessionState: TableSessionState;
  session: TableSession | null;
  basketCount: number;
  basketTotal: number;
  onOpenBasket(): void;
  onNeedsRescan(): void;
}) {
  return (
    <header className="tp-cafe__topbar">
      <div className="tp-cafe__topbar-inner">
        <div className="tp-cafe__topbar-side">
          <TableChip
            locale={locale}
            state={sessionState}
            session={session}
            onNeedsRescan={onNeedsRescan}
          />
        </div>
        <Image
          className="tp-cafe__lockup"
          src="/brand/cafe/wordmark.png"
          alt={t(locale, 'common.cafeName')}
          width={1080}
          height={222}
          priority
        />
        <div className="tp-cafe__topbar-side tp-cafe__topbar-side--end">
          <LocaleSwitcher locale={locale} token={token} />
          <BasketButton
            locale={locale}
            count={basketCount}
            total={basketTotal}
            onOpen={onOpenBasket}
          />
        </div>
      </div>
    </header>
  );
}
