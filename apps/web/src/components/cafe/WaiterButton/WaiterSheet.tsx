'use client';

import { useEffect, useRef } from 'react';
import { makeT, type Locale, type MessageKey } from '@touch/i18n';
import { useSheetDrag } from '@/hooks/cafe/useSheetDrag';
import { formatCooldown, type WaiterPhase } from '@/hooks/cafe/waiter';
import type { WaiterReason } from '@/hooks/cafe/useWaiterCall';
import { Loader } from '../brand/Loader';

const REASONS: { reason: WaiterReason; key: MessageKey }[] = [
  { reason: 'order', key: 'cafe.waiterReasonOrder' },
  { reason: 'bill', key: 'cafe.waiterReasonBill' },
  { reason: 'water', key: 'cafe.waiterReasonWater' },
  { reason: 'assistance', key: 'cafe.waiterReasonAssistance' },
];

/** A resolved call closes itself — the guest has their answer. */
const DONE_AUTOCLOSE_MS = 2_500;

/**
 * The reason picker + live call state (`waiter_call_reason`, 0016).
 *
 * idle         → 2×2 reason grid (a cooldown disables it and says when it lifts)
 * sending      → loader
 * raised       → "Calling a waiter…" — staff have it, nobody has claimed it
 * acknowledged → "On the way" (a waiter tapped ✅ in Telegram or on the floor view)
 * done         → "Done", then auto-close
 * failed       → error copy + retry
 *
 * In degraded mode the call is refused server-side, so the sheet says so up
 * front rather than letting the guest tap into a rejection.
 */
export function WaiterSheet({
  locale,
  open,
  phase,
  degraded,
  cooldownLeftMs,
  onPick,
  onClose,
}: {
  locale: Locale;
  open: boolean;
  phase: WaiterPhase;
  degraded: boolean;
  cooldownLeftMs: number;
  onPick(reason: WaiterReason): void;
  onClose(): void;
}) {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const { style } = useSheetDrag(headerRef, onClose);
  const tr = makeT(locale);

  useEffect(() => {
    if (!open || phase !== 'done') return;
    const timer = setTimeout(onClose, DONE_AUTOCLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, phase, onClose]);

  if (!open) return null;
  const cooling = cooldownLeftMs > 0;

  return (
    <>
      <div className="tp-sheet-backdrop" onClick={onClose} />
      <div
        className="tp-sheet"
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={tr('cafe.callWaiter')}
      >
        <div className="tp-sheet__header" ref={headerRef}>
          <div className="tp-sheet__grip" aria-hidden="true" />
          <div className="tp-sheet__row">
            <h2>{tr('cafe.waiterReasonTitle')}</h2>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>
              {tr('common.close')}
            </button>
          </div>
        </div>

        {degraded ? (
          <p className="tp-banner tp-banner--warn" role="status">
            {tr('degraded.waiterCallRefused')}
          </p>
        ) : phase === 'idle' || phase === 'failed' ? (
          <>
            {phase === 'failed' && (
              <p className="tp-banner tp-banner--error" role="status">
                {tr('cafe.waiterFailed')}
              </p>
            )}
            {cooling && (
              <p className="tp-banner tp-banner--info" role="status">
                {tr('cafe.waiterCooldown', { time: formatCooldown(cooldownLeftMs) })}
              </p>
            )}
            <div className="tp-reasons">
              {REASONS.map(({ reason, key }) => (
                <button key={reason} type="button" onClick={() => onPick(reason)}>
                  {tr(key)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="tp-waiter-phase" data-phase={phase} role="status">
            {(phase === 'sending' || phase === 'raised') && <Loader size="md" tone="onLight" />}
            <p>
              {phase === 'sending'
                ? tr('cafe.waiterSending')
                : phase === 'raised'
                  ? tr('cafe.waiterCalled')
                  : phase === 'acknowledged'
                    ? tr('cafe.waiterOnTheWay')
                    : tr('cafe.waiterDone')}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
