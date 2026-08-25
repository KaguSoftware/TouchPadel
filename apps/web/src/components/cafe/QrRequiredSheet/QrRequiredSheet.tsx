'use client';

import { useMemo, useRef, type JSX } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { SheetShell } from '../ItemSheet/SheetShell';
import { useSheetDrag } from '../ItemSheet/drag';
import { QrIllustration } from './QrIllustration';

export type QrRequiredSheetProps = {
  locale: Locale;
  /** which gated action asked for a table; null → nothing to show */
  reason: 'order' | 'waiter' | null;
  onClose(): void;
};

/**
 * "Scan the QR on your table" sheet (web-slice §2): the guest is browsing
 * without a table session and tried to order or call a waiter. The basket is
 * kept — the walk-in draft merges into the table draft on bind.
 */
export function QrRequiredSheet({
  locale,
  reason,
  onClose,
}: QrRequiredSheetProps): JSX.Element | null {
  const tr = useMemo(() => makeT(locale), [locale]);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const drag = useSheetDrag(headerRef, onClose);

  if (!reason) return null;

  return (
    <SheetShell
      label={tr('cafe.qrRequired.title')}
      onClose={onClose}
      className="tp-sheet tp-qr-required"
      style={drag.style}
      backdropStyle={drag.backdropStyle}
    >
      <div className="tp-sheet__header" ref={headerRef}>
        <div className="tp-sheet__grip" aria-hidden="true" />
      </div>
      <QrIllustration />
      <h2>{tr('cafe.qrRequired.title')}</h2>
      <p>{tr(reason === 'order' ? 'cafe.qrRequired.bodyOrder' : 'cafe.qrRequired.bodyWaiter')}</p>
      <p>{tr('cafe.qrRequired.keepBasket')}</p>
      <button type="button" className="tp-btn tp-btn--primary tp-btn--block" onClick={onClose}>
        {tr('common.ok')}
      </button>
    </SheetShell>
  );
}
