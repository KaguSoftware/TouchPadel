'use client';

import { useMemo, useState } from 'react';
import { makeT, formatIQD, type Locale } from '@touch/i18n';
import type { MenuItem, MenuModifierGroup } from '@/lib/menu';
import { buildLine, violatedGroup, type BasketLine } from '@/lib/cafe/basket';

/**
 * Item bottom sheet: size (variant) picker, modifier groups with min/max
 * enforcement (distinct choices — mirrors app.add_order_items), quantity,
 * kitchen notes, live price preview.
 */
export function ItemSheet({
  item,
  locale,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  locale: Locale;
  onAdd: (line: BasketLine) => void;
  onClose: () => void;
}) {
  const tr = useMemo(() => makeT(locale), [locale]);
  const ar = locale === 'ar';
  const defaultVariant = item.variants.find((v) => v.is_default) ?? item.variants[0];
  const [variantId, setVariantId] = useState<string>(defaultVariant?.id ?? '');
  const [chosen, setChosen] = useState<Map<string, number>>(new Map()); // modifierId -> qty
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  const chosenArr = useMemo(
    () => [...chosen.entries()].map(([modifierId, mqty]) => ({ modifierId, qty: mqty })),
    [chosen],
  );
  const violated = violatedGroup(item.modifierGroups, chosenArr);

  const variant = item.variants.find((v) => v.id === variantId);
  const preview = useMemo(() => {
    if (!variant) return 0;
    let mods = 0;
    for (const [id, mqty] of chosen) {
      for (const g of item.modifierGroups) {
        const m = g.modifiers.find((mm) => mm.id === id);
        if (m) mods += m.price_delta_iqd * mqty;
      }
    }
    return (variant.price_iqd + mods) * qty;
  }, [variant, chosen, qty, item.modifierGroups]);

  const toggleModifier = (group: MenuModifierGroup, modifierId: string) => {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(modifierId)) {
        next.delete(modifierId);
        return next;
      }
      const groupIds = new Set(group.modifiers.map((m) => m.id));
      const inGroup = [...next.keys()].filter((id) => groupIds.has(id));
      if (group.max_select === 1) {
        // radio behaviour: replace the current choice
        for (const id of inGroup) next.delete(id);
      } else if (inGroup.length >= group.max_select) {
        return prev; // at the cap — ignore
      }
      next.set(modifierId, 1);
      return next;
    });
  };

  const add = () => {
    if (!variant || violated) return;
    onAdd(buildLine(item, variant.id, qty, chosenArr, notes));
  };

  const groupHint = (g: MenuModifierGroup): string => {
    if (g.min_select === g.max_select && g.min_select > 0)
      return tr('cafe.chooseExactly', { count: g.min_select });
    if (g.min_select > 0) return tr('cafe.chooseRange', { min: g.min_select, max: g.max_select });
    return tr('cafe.chooseUpTo', { max: g.max_select });
  };

  return (
    <>
      <div className="tp-sheet-backdrop" onClick={onClose} />
      <div className="tp-sheet" role="dialog" aria-modal="true" aria-label={ar ? item.name_ar : item.name_en}>
        <div className="tp-sheet__row">
          <h2>{ar ? item.name_ar : item.name_en}</h2>
          <button className="tp-btn tp-btn--ghost" onClick={onClose}>
            {tr('common.close')}
          </button>
        </div>
        {(ar ? item.description_ar : item.description_en) && (
          <p className="tp-menu-item__desc">{ar ? item.description_ar : item.description_en}</p>
        )}
        {item.allergens.length > 0 && (
          <div className="tp-chips" aria-label={tr('cafe.allergensLabel')}>
            {item.allergens.map((a) => (
              <span key={a.code} className="tp-chip">
                {ar ? a.label_ar : a.label_en}
              </span>
            ))}
          </div>
        )}

        {item.variants.length > 1 && (
          <div className="tp-sheet__group">
            <h3>{tr('cafe.size')}</h3>
            {item.variants.map((v) => (
              <label key={v.id} className="tp-opt">
                <input
                  type="radio"
                  name="tp-size"
                  checked={variantId === v.id}
                  onChange={() => setVariantId(v.id)}
                />
                <span>{ar ? v.name_ar : v.name_en}</span>
                <span className="tp-opt__price">{formatIQD(v.price_iqd, locale)}</span>
              </label>
            ))}
          </div>
        )}

        {item.modifierGroups.map((g) => (
          <div className="tp-sheet__group" key={g.id}>
            <h3>
              {ar ? g.name_ar : g.name_en}
              <span className="tp-sheet__hint">
                {groupHint(g)}
                {g.min_select > 0 ? ` · ${tr('cafe.required')}` : ''}
              </span>
            </h3>
            {g.modifiers.map((m) => (
              <label key={m.id} className="tp-opt">
                <input
                  type={g.max_select === 1 ? 'radio' : 'checkbox'}
                  name={`tp-group-${g.id}`}
                  checked={chosen.has(m.id)}
                  onChange={() => toggleModifier(g, m.id)}
                  onClick={() => {
                    // allow deselecting a radio choice in an optional group
                    if (g.max_select === 1 && chosen.has(m.id)) toggleModifier(g, m.id);
                  }}
                />
                <span>{ar ? m.name_ar : m.name_en}</span>
                {m.price_delta_iqd > 0 && (
                  <span className="tp-opt__price">+{formatIQD(m.price_delta_iqd, locale)}</span>
                )}
              </label>
            ))}
          </div>
        ))}

        <div className="tp-sheet__group">
          <h3>{tr('cafe.notesLabel')}</h3>
          <textarea
            className="tp-textarea"
            placeholder={tr('cafe.notesPlaceholder')}
            value={notes}
            maxLength={280}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="tp-sheet__row" style={{ marginBlockStart: '0.75rem' }}>
          <div className="tp-qty" aria-label={tr('cafe.quantity')}>
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="−">
              −
            </button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="+">
              +
            </button>
          </div>
          <button className="tp-btn tp-btn--primary" disabled={!variant || violated !== null} onClick={add}>
            {tr('cafe.addToOrder')} · {formatIQD(preview, locale)}
          </button>
        </div>
        {violated && (
          <p className="tp-banner tp-banner--info" role="alert">
            {tr('cafe.chooseRange', { min: violated.min_select, max: violated.max_select })} —{' '}
            {ar ? violated.name_ar : violated.name_en}
          </p>
        )}
      </div>
    </>
  );
}
