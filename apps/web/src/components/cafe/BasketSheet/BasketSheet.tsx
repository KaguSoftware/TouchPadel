'use client';

import { useMemo, useRef, type JSX } from 'react';
import { formatIQD, makeT } from '@touch/i18n';
import { Loader } from '../brand';
import { SheetShell } from '../ItemSheet/SheetShell';
import { useSheetDrag } from '../ItemSheet/drag';
import { BasketLineRow } from './BasketLineRow';
import { ORDER_NOTE_MAX } from './constants';
import type { BasketSheetProps } from './types';

export type { BasketSheetProps } from './types';

/**
 * Basket review sheet (web-slice §2): lines with per-extra sub-lines, order
 * note with counter, subtotal / featured-discount / total, the pay-at-desk
 * notice, the degraded warning and the "Send to waiter" CTA. The CTA stays
 * enabled without a table — the shell answers with the QR sheet.
 */
export function BasketSheet(props: BasketSheetProps): JSX.Element | null {
  const {
    locale,
    open,
    lines,
    note,
    subtotal,
    discountTotal,
    total,
    degraded,
    sending,
    tableBound,
    onClose,
    onSetQty,
    onRemove,
    onSetNote,
    onSubmit,
    onBrowse,
  } = props;

  const tr = useMemo(() => makeT(locale), [locale]);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const drag = useSheetDrag(headerRef, onClose);
  const discountPct = useMemo(
    () => lines.reduce((max, l) => Math.max(max, l.discount_pct), 0),
    [lines],
  );

  if (!open) return null;
  const empty = lines.length === 0;

  return (
    <SheetShell
      label={tr('cafe.basket')}
      onClose={onClose}
      className="tp-sheet tp-sheet--panel"
      style={drag.style}
      backdropStyle={drag.backdropStyle}
    >
      <div className="tp-sheet__header tp-sheet__drag" ref={headerRef}>
        <div className="tp-sheet__grip" aria-hidden="true" />
        <div className="tp-sheet__row" style={{ paddingInline: 'var(--tp-space-5)' }}>
          <h2>{tr('cafe.basket')}</h2>
        </div>
      </div>

      <button
        type="button"
        className="tp-sheet__close"
        onClick={onClose}
        aria-label={tr('common.close')}
      >
        ×
      </button>

      <div className="tp-sheet__scroll">
        {empty ? (
          <div className="tp-basket-empty">
            <h3>{tr('cafe.basketEmptyTitle')}</h3>
            <p>{tr('cafe.basketEmpty')}</p>
            <button type="button" className="tp-btn tp-btn--primary" onClick={onBrowse}>
              {tr('cafe.browseMenu')}
            </button>
          </div>
        ) : (
          <>
            {lines.map((line) => (
              <BasketLineRow
                key={line.key}
                locale={locale}
                line={line}
                removeLabel={tr('cafe.remove')}
                qtyLabel={tr('cafe.quantity')}
                onSetQty={onSetQty}
                onRemove={onRemove}
              />
            ))}

            <div className="tp-sheet__group">
              <h3>{tr('cafe.orderNote')}</h3>
              <textarea
                className="tp-textarea"
                placeholder={tr('cafe.orderNotePlaceholder')}
                value={note}
                maxLength={ORDER_NOTE_MAX}
                rows={2}
                onChange={(e) => onSetNote(e.target.value.slice(0, ORDER_NOTE_MAX))}
              />
              <p className="tp-counter">
                {tr('cafe.notesCounter', { count: note.length, max: ORDER_NOTE_MAX })}
              </p>
            </div>

            <div className="tp-basket-totals">
              <div className="tp-basket-totals__row">
                <span>{tr('common.subtotal')}</span>
                <span>{formatIQD(subtotal, locale)}</span>
              </div>
              {discountTotal > 0 && (
                <div className="tp-basket-totals__row tp-basket-totals__row--promo">
                  <span>{tr('cafe.featuredDiscount', { pct: discountPct })}</span>
                  <span>−{formatIQD(discountTotal, locale)}</span>
                </div>
              )}
              <div className="tp-basket-totals__row tp-basket-totals__row--total">
                <span>{tr('common.total')}</span>
                <span>{formatIQD(total, locale)}</span>
              </div>
            </div>

            {degraded && (
              <p className="tp-banner tp-banner--warn" role="status">
                {tr('degraded.orderingRefused')}
              </p>
            )}
            {/* SOW module 3/6: ordering is NOT paying. */}
            <p className="tp-banner tp-banner--info">{tr('cafe.payAtDesk')}</p>
          </>
        )}
      </div>

      {!empty && (
        <div className="tp-sheet__foot">
          <button
            type="button"
            className="tp-btn tp-btn--primary tp-btn--block"
            disabled={sending}
            onClick={onSubmit}
          >
            {sending ? tr('cafe.sendingToWaiter') : tr('cafe.sendToWaiter')}
          </button>
          {!tableBound && <p className="tp-counter">{tr('cafe.qrRequired.keepBasket')}</p>}
        </div>
      )}

      {sending && (
        <div className="tp-sending" role="status">
          <Loader size="md" tone="onLight" label={tr('cafe.sendingToWaiter')} />
        </div>
      )}
    </SheetShell>
  );
}
