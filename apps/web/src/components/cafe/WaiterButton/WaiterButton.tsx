'use client';

import { makeT, type Locale } from '@touch/i18n';
import { formatCooldown, type WaiterPhase } from '@/hooks/cafe/waiter';

/**
 * The bell FAB on the LEADING edge, above the safe-area inset.
 *
 * Hidden (animated out, kept mounted) when the table's bell is switched off
 * (0031 `bell_enabled`), while a sheet owns the screen, and once the footer is
 * visible. During a cooldown it shows the remaining `m:ss` and stays tappable
 * — tapping explains the wait instead of silently doing nothing.
 *
 * With no table the FAB is still offered: tapping opens the QR-required sheet
 * (owner decision 7 — browsing without a QR is a real flow, and the guest must
 * learn WHY calling needs a table).
 */
export function WaiterButton({
  ref,
  locale,
  visible,
  phase,
  cooldownLeftMs,
  onClick,
}: {
  /** the coach mark measures this element's rect for its spotlight */
  ref?: React.Ref<HTMLButtonElement>;
  locale: Locale;
  visible: boolean;
  phase: WaiterPhase;
  cooldownLeftMs: number;
  onClick(): void;
}) {
  const tr = makeT(locale);
  const cooling = cooldownLeftMs > 0;
  const label = cooling
    ? tr('cafe.waiterCooldown', { time: formatCooldown(cooldownLeftMs) })
    : tr('cafe.callWaiter');

  return (
    <button
      ref={ref}
      type="button"
      className="tp-fab tp-fab--bell"
      data-hidden={visible ? undefined : 'true'}
      data-cooldown={cooling ? 'true' : undefined}
      data-phase={phase}
      aria-hidden={visible ? undefined : true}
      tabIndex={visible ? undefined : -1}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path
          d="M12 3.5a1.4 1.4 0 0 1 1.4 1.4v.6a5.6 5.6 0 0 1 4.2 5.4v3.3l1.3 2.2H5.1l1.3-2.2v-3.3a5.6 5.6 0 0 1 4.2-5.4v-.6A1.4 1.4 0 0 1 12 3.5Z"
          fill="currentColor"
        />
        <path d="M10 18.5h4a2 2 0 0 1-4 0Z" fill="currentColor" />
      </svg>
      {cooling && (
        <span className="tp-fab__badge" aria-hidden="true">
          {formatCooldown(cooldownLeftMs)}
        </span>
      )}
    </button>
  );
}
