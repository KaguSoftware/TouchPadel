'use client';

import { useMemo } from 'react';
import { makeT, type Locale, type MessageKey } from '@touch/i18n';

export type WaiterCallState = {
  callId: string;
  status: 'raised' | 'acknowledged' | 'resolved';
} | null;

type Reason = 'order' | 'bill' | 'water' | 'assistance';

const REASONS: { reason: Reason; key: MessageKey }[] = [
  { reason: 'order', key: 'cafe.waiterReasonOrder' },
  { reason: 'bill', key: 'cafe.waiterReasonBill' },
  { reason: 'water', key: 'cafe.waiterReasonWater' },
  { reason: 'assistance', key: 'cafe.waiterReasonAssistance' },
];

/** Reason picker for the call-waiter button (waiter_call_reason enum, 0016). */
export function WaiterSheet({
  locale,
  degraded,
  onPick,
  onClose,
}: {
  locale: Locale;
  degraded: boolean;
  onPick: (reason: Reason) => void;
  onClose: () => void;
}) {
  const tr = useMemo(() => makeT(locale), [locale]);
  return (
    <>
      <div className="tp-sheet-backdrop" onClick={onClose} />
      <div className="tp-sheet" role="dialog" aria-modal="true" aria-label={tr('cafe.callWaiter')}>
        <div className="tp-sheet__row">
          <h2>{tr('cafe.waiterReasonTitle')}</h2>
          <button className="tp-btn tp-btn--ghost" onClick={onClose}>
            {tr('common.close')}
          </button>
        </div>
        {degraded ? (
          <p className="tp-banner tp-banner--warn" role="status">
            {tr('degraded.waiterCallRefused')}
          </p>
        ) : (
          <div className="tp-reasons">
            {REASONS.map(({ reason, key }) => (
              <button key={reason} onClick={() => onPick(reason)}>
                {tr(key)}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
