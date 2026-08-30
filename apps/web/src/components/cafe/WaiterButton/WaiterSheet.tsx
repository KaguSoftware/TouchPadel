'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { makeT, type Locale, type MessageKey } from '@touch/i18n';
import { SheetShell } from '../ItemSheet/SheetShell';
import { useSheetDrag } from '../ItemSheet/drag';
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
  /** SheetShell's deferred close, so the Close button, the timer and the drag
      all play the exit instead of unmounting the sheet on the spot. */
  const dismiss = useRef<(() => void) | null>(null);
  const close = useCallback(() => {
    if (dismiss.current) dismiss.current();
    else onClose();
  }, [onClose]);
  /**
   * True when this closing came from the swipe, so the sheet fades out from
   * where the finger left it instead of replaying the slide. The sheet stays
   * mounted between openings (it only returns null), so the flag has to be
   * cleared on the way IN or a later tap-close would inherit it.
   */
  const [dragClosed, setDragClosed] = useState(false);
  useEffect(() => {
    if (open) setDragClosed(false);
  }, [open]);
  const drag = useSheetDrag(headerRef, () => {
    setDragClosed(true);
    close();
  });
  const tr = makeT(locale);

  /**
   * The autoclose timer reads the close through a ref rather than depending on
   * it. CafeApp passes `onClose={() => setWaiterOpen(false)}` — a fresh function
   * every render — so an effect keyed on it re-ran, cleared its own timeout and
   * started a new 2.5 s wait on EVERY render. The cooldown ticker and the
   * session channel both re-render this tree well inside 2.5 s, so a resolved
   * call could sit there indefinitely instead of dismissing itself.
   */
  const closeFn = useRef(close);
  closeFn.current = close;

  // A resolved call dismisses itself. This goes through the deferred close too,
  // so the sheet slides away rather than blinking out; SheetShell's requestClose
  // is idempotent, so a guest who taps Close first does not double-fire it.
  useEffect(() => {
    if (!open || phase !== 'done') return;
    const timer = setTimeout(() => closeFn.current(), DONE_AUTOCLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, phase]);

  if (!open) return null;
  const cooling = cooldownLeftMs > 0;

  return (
    <SheetShell
      label={tr('cafe.callWaiter')}
      onClose={onClose}
      closeRef={dismiss}
      className="tp-sheet"
      style={drag.style}
      backdropStyle={drag.backdropStyle}
      dragged={dragClosed}
    >
      <div className="tp-sheet__header" ref={headerRef}>
        <div className="tp-sheet__grip" aria-hidden="true" />
        <div className="tp-sheet__row">
          <h2>{tr('cafe.waiterReasonTitle')}</h2>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={close}>
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
    </SheetShell>
  );
}
