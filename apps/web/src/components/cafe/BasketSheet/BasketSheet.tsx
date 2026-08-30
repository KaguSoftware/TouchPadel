'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { formatIQD, makeT } from '@touch/i18n';
import { CloseIcon, Loader } from '../brand';
import { SheetShell } from '../ItemSheet/SheetShell';
import { useSheetDrag } from '../ItemSheet/drag';
import { BasketLineRow } from './BasketLineRow';
import { ORDER_NOTE_MAX } from './constants';
import type { BasketSheetProps } from './types';

/** How long the panel takes to grow or shrink around a basket that emptied. */
const HEIGHT_MS = 260;

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
  /**
   * SheetShell's deferred close. Every affordance in here (the X, "browse the
   * menu", the drag) goes through it so the sheet plays its exit animation;
   * calling the `onClose` prop directly would unmount it on the spot.
   */
  const dismiss = useRef<(() => void) | null>(null);
  const close = useCallback(() => {
    if (dismiss.current) dismiss.current();
    else onClose();
  }, [onClose]);
  /**
   * "Browse the menu" is its own intent, even though CafeApp currently just
   * closes the sheet for it. Play the exit, then let the caller act.
   */
  const browse = useCallback(() => {
    if (dismiss.current) dismiss.current();
    else onBrowse();
  }, [onBrowse]);
  /**
   * True when this closing came from the swipe. Without it the released sheet
   * replays the slide-out from the top (sheet.css [data-closing]) instead of
   * fading away from where the finger left it, which read as the cart bouncing
   * back up — the reason the drag felt broken even though it was wired.
   * The sheet stays mounted between openings, so the flag is cleared on the way
   * IN or a later tap on the X would inherit the dragged exit.
   */
  const [dragClosed, setDragClosed] = useState(false);
  useEffect(() => {
    if (open) setDragClosed(false);
  }, [open]);
  const drag = useSheetDrag(headerRef, () => {
    setDragClosed(true);
    close();
  });
  const discountPct = useMemo(
    () => lines.reduce((max, l) => Math.max(max, l.discount_pct), 0),
    [lines],
  );

  /**
   * The sheet sizes to its content, and an auto height cannot be transitioned —
   * so when the last line goes the panel snaps from a full basket to the short
   * empty layout. Measure it either side of that swap and animate between the
   * two, which is the only way to make the collapse readable.
   */
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const prevEmpty = useRef(lines.length === 0);
  /**
   * The panel's height on the last render that still had content. The row's own
   * collapse has already taken most of it by then, which is what we want: the
   * animation picks up from where the row left the panel and carries it the
   * rest of the way, instead of jumping back up to the full height first.
   */
  const heightBefore = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (lines.length > 0 && sheetRef.current) {
      // Read the ANIMATED height, not the laid-out one: the row is mid-collapse
      // here, and the box the user can see is what the sheet must continue from.
      heightBefore.current = sheetRef.current.getBoundingClientRect().height;
    }
  });

  useLayoutEffect(() => {
    const isEmpty = lines.length === 0;
    const was = prevEmpty.current;
    // Track the empty/non-empty flip even on renders where the sheet is closed
    // (it returns null before `open`, so the node does not exist yet). Updating
    // this only when a node happens to be present left it permanently stale and
    // the collapse never animated.
    prevEmpty.current = isEmpty;

    const node = sheetRef.current;
    if (!node || isEmpty === was) return;

    const to = node.getBoundingClientRect().height;
    const from = heightBefore.current;
    if (from === null || Math.abs(to - from) < 1) return;

    // max-block-size is what actually constrains this panel (it is capped at
    // 92dvh and otherwise sizes to content), so animating `height` alone would
    // be ignored. Driving both, and clearing them afterwards, hands the panel
    // back to its normal auto sizing once the collapse has played.
    const anim = node.animate(
      [
        { height: `${from}px`, maxHeight: `${from}px` },
        { height: `${to}px`, maxHeight: `${to}px` },
      ],
      { duration: HEIGHT_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    return () => anim.cancel();
  }, [lines.length]);

  /**
   * Keys of the rows currently playing their removal animation. When that
   * accounts for every line, the basket is about to be empty: the note, the
   * totals and the footer fade out with the last row instead of all vanishing
   * in the single frame it disappears.
   */
  const [removingKeys, setRemovingKeys] = useState<readonly string[]>([]);
  const onRemovingChange = useCallback((key: string, isRemoving: boolean) => {
    setRemovingKeys((prev) =>
      isRemoving ? (prev.includes(key) ? prev : [...prev, key]) : prev.filter((k) => k !== key),
    );
  }, []);
  const emptying = lines.length > 0 && lines.every((l) => removingKeys.includes(l.key));

  if (!open) return null;
  const empty = lines.length === 0;

  return (
    <SheetShell
      label={tr('cafe.basket')}
      onClose={onClose}
      closeRef={dismiss}
      className="tp-sheet tp-sheet--panel"
      style={drag.style}
      backdropStyle={drag.backdropStyle}
      sheetRef={sheetRef}
      dragged={dragClosed}
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
        onClick={close}
        aria-label={tr('common.close')}
      >
        <CloseIcon />
      </button>

      <div className="tp-sheet__scroll">
        {/* Reassurance that an unscanned basket survives — it belongs with the
            heading, where it is read on opening, rather than under the CTA
            where it only appeared once the guest had scrolled to the end. */}
        {!tableBound && !empty && (
          <p className="tp-counter tp-basket-keep">{tr('cafe.qrRequired.keepBasket')}</p>
        )}
        {empty ? (
          <div className="tp-basket-empty">
            <h3>{tr('cafe.basketEmptyTitle')}</h3>
            <p>{tr('cafe.basketEmpty')}</p>
            <button type="button" className="tp-btn tp-btn--primary" onClick={browse}>
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
                eachLabel={tr('cafe.each')}
                decreaseLabel={tr('cafe.decreaseQty')}
                increaseLabel={tr('cafe.increaseQty')}
                onSetQty={onSetQty}
                onRemove={onRemove}
                onRemovingChange={onRemovingChange}
              />
            ))}

            <div className="tp-basket-tail" data-emptying={emptying ? 'true' : undefined}>
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
            </div>
          </>
        )}
      </div>

      {!empty && (
        <div className="tp-sheet__foot" data-emptying={emptying ? 'true' : undefined}>
          <button
            type="button"
            className="tp-btn tp-btn--primary tp-btn--block"
            disabled={sending}
            onClick={onSubmit}
          >
            {sending ? tr('cafe.sendingToWaiter') : tr('cafe.sendToWaiter')}
          </button>
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
