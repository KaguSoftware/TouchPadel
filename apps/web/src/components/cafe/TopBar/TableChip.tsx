'use client';

import { makeT, isolate, type Locale } from '@touch/i18n';
import { Loader } from '../brand/Loader';
import type { TableSession, TableSessionState } from '@/hooks/cafe/useTableSession';

/**
 * The table badge in the top bar — the guest's proof that "send to waiter"
 * knows where they are sitting.
 *
 * none    → nothing (walk-in browsing is a first-class flow)
 * binding → spinner + "Linking table…" (the menu is already readable behind it)
 * bound   → "Table T3" (the number is Latin inside an Arabic sentence → isolate)
 * invalid / expired → a tappable chip that opens the re-scan notice
 */
export function TableChip({
  locale,
  state,
  session,
  onNeedsRescan,
}: {
  locale: Locale;
  state: TableSessionState;
  session: TableSession | null;
  onNeedsRescan(): void;
}) {
  const tr = makeT(locale);

  if (state === 'none') return null;

  if (state === 'binding') {
    return (
      <span className="tp-cafe__table" data-state="binding">
        <Loader size="xs" tone="onDark" /> {tr('cafe.tableChipBinding')}
      </span>
    );
  }

  if (state === 'bound' && session) {
    return (
      <span className="tp-cafe__table" data-state="bound">
        {tr('cafe.tableLabel', { table: isolate(session.tableNumber) })}
      </span>
    );
  }

  // invalid | expired | error — tapping explains what to do next.
  return (
    <button
      type="button"
      className="tp-cafe__table"
      data-state={state}
      onClick={onNeedsRescan}
      aria-label={tr('cafe.scanAgain')}
    >
      {tr('cafe.scanAgain')}
    </button>
  );
}
