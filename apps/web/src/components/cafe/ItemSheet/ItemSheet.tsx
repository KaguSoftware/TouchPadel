'use client';

import { useEffect, useMemo, useRef, useState, type JSX, type UIEvent } from 'react';
import { formatIQD, makeT, type Locale } from '@touch/i18n';
import { buildLine, violatedGroup } from '@/lib/cafe/basket';
import { activeGroups, type MenuItem, type MenuModifierGroup } from '@/lib/menu';
import { ImageLayers } from './ImageLayers';
import { Lightbox } from './Lightbox';
import { ModifierGroup } from './ModifierGroup';
import { SheetShell } from './SheetShell';
import { SuggestionsRail } from './SuggestionsRail';
import { VariantPicker } from './VariantPicker';
import { ITEM_NOTE_MAX, QTY_MAX, QTY_MIN, STAMP_DELAY_MS } from './constants';
import { useSheetDrag } from './drag';
import { chosenModifiers, pricePreview, toggleModifier, type Selection } from './selection';
import type { ItemSheetProps } from './types';

export type { ItemSheetProps } from './types';

/**
 * Item bottom sheet (web-slice §2, UpperDeck ItemModal parity): header-only
 * drag-to-close, three-layer photo + lightbox, sticky name header, variants,
 * modifier groups with nested reveals, suggestions, note, quantity, live price
 * and the add CTA.
 *
 * Renders nothing when no item is open; the inner component is keyed on the
 * item id so every piece of sheet state resets between items.
 */
export function ItemSheet(props: ItemSheetProps): JSX.Element | null {
  const { item } = props;
  if (!item) return null;
  return <ItemSheetInner key={item.id} {...props} item={item} />;
}

function ItemSheetInner({
  locale,
  item,
  settings,
  itemsById,
  onClose,
  onAdd,
  onOpenSuggested,
  onViewed,
  onAbandon,
}: ItemSheetProps & { item: MenuItem }) {
  const tr = useMemo(() => makeT(locale), [locale]);
  const ar = locale === 'ar';

  const headerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const openedAt = useRef(Date.now());
  const settled = useRef(false);

  const defaultVariant = item.variants.find((v) => v.is_default) ?? item.variants[0];
  const [variantId, setVariantId] = useState(defaultVariant?.id ?? '');
  const [selection, setSelection] = useState<Selection>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [lightbox, setLightbox] = useState(false);
  const [showStamp, setShowStamp] = useState(false);
  const [atBottom, setAtBottom] = useState(false);

  const soldOut = item.sold_out || !item.orderable;

  useEffect(() => {
    onViewed?.(item);
    // once per opened item — the inner component is keyed on item.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!soldOut) return;
    const id = window.setTimeout(() => setShowStamp(true), STAMP_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [soldOut]);

  /** Close once, reporting the dwell when nothing was added. */
  const finish = (added: boolean) => {
    if (!settled.current) {
      settled.current = true;
      if (!added) onAbandon?.(item, Date.now() - openedAt.current);
    }
    onClose();
  };

  const drag = useSheetDrag(headerRef, () => finish(false));

  const active = useMemo(() => activeGroups(item, selection), [item, selection]);
  const chosen = useMemo(() => chosenModifiers(selection), [selection]);
  const violated = useMemo(() => violatedGroup(active, chosen), [active, chosen]);
  const variant = item.variants.find((v) => v.id === variantId);
  const price = useMemo(
    () => pricePreview(item, variantId, selection, qty),
    [item, variantId, selection, qty],
  );

  const suggestions = useMemo(
    () =>
      item.suggestedItemIds
        .map((id) => itemsById.get(id))
        .filter((s): s is MenuItem => Boolean(s && s.id !== item.id && s.orderable && !s.sold_out)),
    [item, itemsById],
  );

  const onToggle = (group: MenuModifierGroup, modifierId: string) => {
    setSelection((prev) => toggleModifier(item, group, modifierId, prev));
  };

  const add = () => {
    if (!variant || violated || soldOut) return;
    onAdd(buildLine(item, variant.id, qty, chosen, notes));
    finish(true);
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 12);
  };

  const name = ar ? item.name_ar : item.name_en;
  const hook = ar ? item.hook_ar : item.hook_en;
  const description = ar ? item.description_ar : item.description_en;
  // No category name reaches the sheet, so the eyebrow carries the featured
  // badge when this is the promoted item and the generic menu label otherwise.
  const featured = settings.featured_item_id === item.id;
  const eyebrow =
    (featured
      ? ar
        ? settings.featured_badge_ar || settings.featured_label_ar
        : settings.featured_badge_en || settings.featured_label_en
      : '') || tr(featured ? 'cafe.hero.featured' : 'cafe.menu');

  return (
    <>
      <SheetShell
        label={name}
        onClose={() => finish(false)}
        className="tp-sheet tp-sheet--panel"
        style={drag.style}
        backdropStyle={drag.backdropStyle}
        sheetRef={sheetRef}
      >
        <div className="tp-sheet__header tp-sheet__drag" ref={headerRef}>
          <div className="tp-sheet__grip" aria-hidden="true" />
          <ImageLayers
            src={item.photo_url}
            blur={item.photo_blur}
            alt={name}
            expandLabel={tr('cafe.expandPhoto')}
            loadingLabel={tr('common.loading')}
            onExpand={() => setLightbox(true)}
          />
          {soldOut && showStamp && <span className="tp-stamp">{tr('cafe.soldOut')}</span>}
        </div>

        <button
          type="button"
          className="tp-sheet__close"
          onClick={() => finish(false)}
          aria-label={tr('common.close')}
        >
          ×
        </button>

        <div className="tp-sheet__scroll" onScroll={onScroll}>
          <div className="tp-itemsheet__sticky">
            <p className="tp-itemsheet__eyebrow">{eyebrow}</p>
            <h2 className="tp-itemsheet__name">{name}</h2>
          </div>

          {hook && <p className="tp-itemsheet__hook">{hook}</p>}
          {description && <p className="tp-itemsheet__desc">{description}</p>}

          {item.allergens.length > 0 && (
            <div className="tp-chips" aria-label={tr('cafe.allergensLabel')}>
              {item.allergens.map((a) => (
                <span key={a.code} className="tp-chip tp-chip--muted">
                  {ar ? a.label_ar : a.label_en}
                </span>
              ))}
            </div>
          )}

          <VariantPicker
            locale={locale}
            label={tr('cafe.size')}
            variants={item.variants}
            value={variantId}
            onChange={setVariantId}
          />

          {item.modifierGroups.map((g) => (
            <ModifierGroup
              key={g.id}
              locale={locale}
              item={item}
              group={g}
              selection={selection}
              onToggle={onToggle}
            />
          ))}

          <SuggestionsRail
            locale={locale}
            label={tr('cafe.goesWellWith')}
            items={suggestions}
            onOpen={(s) => {
              if (!settled.current) {
                settled.current = true;
                onAbandon?.(item, Date.now() - openedAt.current);
              }
              onOpenSuggested(s);
            }}
          />

          <div className="tp-sheet__group">
            <h3>{tr('cafe.notesLabel')}</h3>
            <textarea
              className="tp-textarea"
              placeholder={tr('cafe.notesPlaceholder')}
              value={notes}
              maxLength={ITEM_NOTE_MAX}
              rows={2}
              onChange={(e) => setNotes(e.target.value.slice(0, ITEM_NOTE_MAX))}
            />
            <p className="tp-counter">
              {tr('cafe.notesCounter', { count: notes.length, max: ITEM_NOTE_MAX })}
            </p>
          </div>
        </div>

        <div className="tp-sheet__scrollhint" data-at-bottom={atBottom ? 'true' : 'false'} aria-hidden="true">
          ⌄
        </div>

        <div className="tp-sheet__foot">
          <div className="tp-sheet__row" style={{ paddingBlock: 0 }}>
            <div className="tp-qty" aria-label={tr('cafe.quantity')}>
              <button type="button" onClick={() => setQty((q) => Math.max(QTY_MIN, q - 1))} aria-label="−">
                −
              </button>
              <span aria-live="polite">{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(QTY_MAX, q + 1))} aria-label="+">
                +
              </button>
            </div>
            <div className="tp-itemsheet__prices">
              {price.discountPct > 0 && (
                <span className="tp-itemsheet__price tp-itemsheet__price--list">
                  {formatIQD(price.list, locale)}
                </span>
              )}
              <span className="tp-itemsheet__price">{formatIQD(price.total, locale)}</span>
            </div>
          </div>

          <button
            type="button"
            className="tp-btn tp-btn--primary tp-btn--block"
            disabled={soldOut || !variant || violated !== null}
            onClick={add}
          >
            {soldOut ? tr('cafe.soldOutCta') : tr('cafe.addToOrder')}
          </button>

          {!soldOut && violated && (
            <p className="tp-sheet__hint" role="status">
              {ar ? violated.name_ar : violated.name_en} —{' '}
              {violated.min_select === violated.max_select
                ? tr('cafe.chooseExactly', { count: violated.min_select })
                : tr('cafe.chooseRange', {
                    min: violated.min_select,
                    max: violated.max_select,
                  })}
            </p>
          )}
        </div>
      </SheetShell>

      {lightbox && item.photo_url && (
        <Lightbox
          src={item.photo_url}
          alt={name}
          closeLabel={tr('cafe.lightbox.close')}
          onClose={() => setLightbox(false)}
        />
      )}
    </>
  );
}
