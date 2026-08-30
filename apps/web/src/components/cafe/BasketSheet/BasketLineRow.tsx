'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatIQD, type Locale } from '@touch/i18n';
import { lineTotal, lineUnitTotal, type BasketLine } from '@/lib/cafe/basket';
import { QTY_MAX, QTY_MIN } from './constants';

/**
 * When the line is handed to the parent for removal, measured from the moment
 * the row starts its exit. Deliberately SHORTER than the row's own animation:
 * by this point the row has faded and collapsed far enough to read as gone, and
 * releasing here lets the sheet's height animation start without a visible
 * pause between the two. `animationend` still finishes it early if it fires
 * first, and this doubles as the reduced-motion / hidden-tab fallback.
 */
const REMOVE_HANDOFF_MS = 190;

/**
 * One basket line: `name · variant`, one sub-line per extra, the italic
 * item note, the −/+ stepper and remove (UpperDeck CartDrawer L170-229).
 *
 * The stepper is the same .tp-qty pill the item sheet uses. Its minus stops at
 * QTY_MIN rather than reaching zero — a line is taken out with Remove, not by
 * counting it down — so at 1 the button is disabled.
 *
 * Remove plays an exit first: the row collapses its own height while it fades,
 * so the lines below slide up into the gap instead of jumping. The parent is
 * only told once that animation has finished, which is what actually drops the
 * line from the basket.
 */
export function BasketLineRow({
  locale,
  line,
  removeLabel,
  qtyLabel,
  eachLabel,
  decreaseLabel,
  increaseLabel,
  onSetQty,
  onRemove,
  onRemovingChange,
}: {
  locale: Locale;
  line: BasketLine;
  removeLabel: string;
  qtyLabel: string;
  /** suffix on the per-item price, e.g. "each" */
  eachLabel: string;
  decreaseLabel: string;
  increaseLabel: string;
  onSetQty(key: string, qty: number): void;
  onRemove(key: string): void;
  /** tells the sheet this row is playing (or has cancelled) its removal */
  onRemovingChange?(key: string, removing: boolean): void;
}) {
  const ar = locale === 'ar';
  const variantName = ar ? line.variant_name_ar : line.variant_name_en;

  const rowRef = useRef<HTMLDivElement | null>(null);
  const [removing, setRemoving] = useState(false);
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;
  const onRemovingChangeRef = useRef(onRemovingChange);
  onRemovingChangeRef.current = onRemovingChange;

  // Report the flag rather than calling during render; the sheet needs it to
  // know when the LAST row is on its way out.
  useEffect(() => {
    onRemovingChangeRef.current?.(line.key, removing);
  }, [removing, line.key]);

  /**
   * Pin the row's measured height before flagging it, so the collapse has a
   * concrete value to animate from — `block-size: auto` cannot be interpolated.
   */
  const remove = useCallback(() => {
    const node = rowRef.current;
    if (node) node.style.blockSize = `${node.getBoundingClientRect().height}px`;
    setRemoving(true);
  }, []);

  /**
   * The line key is item+variant, so re-adding the same drink while its row is
   * animating out would land back on THIS component mid-exit. A changed qty is
   * the signal that happened: cancel the removal and restore the row.
   */
  useEffect(() => {
    setRemoving(false);
    const node = rowRef.current;
    if (node) node.style.blockSize = '';
  }, [line.qty]);

  useEffect(() => {
    if (!removing) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onRemoveRef.current(line.key);
    };
    const node = rowRef.current;
    // animationend bubbles — only the row's own exit counts.
    const onEnd = (e: AnimationEvent) => {
      if (e.target === node) finish();
    };
    node?.addEventListener('animationend', onEnd);
    // Hand over EARLY. The row is visually gone well before its keyframes end,
    // and waiting for animationend left the panel sitting at the old height for
    // ~140ms before the sheet's own collapse could start — read as a stall
    // between the two. Removing the line here lets the height animation pick up
    // while the row is still finishing, so the two read as one movement.
    const timer = window.setTimeout(finish, REMOVE_HANDOFF_MS);
    return () => {
      node?.removeEventListener('animationend', onEnd);
      window.clearTimeout(timer);
    };
  }, [removing, line.key]);

  return (
    <div className="tp-basket-line" ref={rowRef} data-removing={removing ? 'true' : undefined}>
      <div className="tp-basket-line__body">
        <div className="tp-basket-line__name">
          {ar ? line.item_name_ar : line.item_name_en}
          {variantName && <span className="tp-basket-line__sub"> · {variantName}</span>}
          {/* Only worth printing when there is more than one: at qty 1 it just
              repeats the line total sitting beside it. */}
          {line.qty > 1 && (
            <span className="tp-basket-line__sub">
              {' · '}
              {formatIQD(lineUnitTotal(line), locale)} {eachLabel}
            </span>
          )}
        </div>
        {line.modifiers.map((m) => (
          <div key={m.modifierId} className="tp-basket-line__sub">
            + {m.qty > 1 ? `${m.qty} × ` : ''}
            {ar ? m.name_ar : m.name_en}
            {m.price_delta_iqd > 0 ? ` · ${formatIQD(m.price_delta_iqd * m.qty, locale)}` : ''}
          </div>
        ))}
        {line.notes && <div className="tp-basket-line__note">“{line.notes}”</div>}
        <div className="tp-basket-line__controls">
          <div className="tp-qty" aria-label={qtyLabel}>
            <button
              type="button"
              className="tp-qty__step"
              aria-label={decreaseLabel}
              disabled={line.qty <= QTY_MIN}
              onClick={() => onSetQty(line.key, Math.max(QTY_MIN, line.qty - 1))}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </button>
            <span className="tp-qty__value">{line.qty}</span>
            <button
              type="button"
              className="tp-qty__step"
              aria-label={increaseLabel}
              disabled={line.qty >= QTY_MAX}
              onClick={() => onSetQty(line.key, Math.min(QTY_MAX, line.qty + 1))}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M12 6v12M6 12h12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {/* Trailing column: the total, with Remove directly beneath it. Remove
          has to live in THIS column, not on the stepper's row — that row sits
          inside __body, which stops short of the price and can never line up
          under it. The column is bottom-aligned so Remove settles level with
          the stepper. */}
      <div className="tp-basket-line__aside">
        <div className="tp-basket-line__total">{formatIQD(lineTotal(line), locale)}</div>
        <button
          type="button"
          className="tp-basket-line__remove"
          onClick={remove}
          disabled={removing}
          aria-label={removeLabel}
          title={removeLabel}
        >
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" focusable="false"
            fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16" />
            <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1z" />
            <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
