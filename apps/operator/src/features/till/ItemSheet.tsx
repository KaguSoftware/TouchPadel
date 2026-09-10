/**
 * Item sheet (spec ModifierPicker + NumericKeypad-lite): size, modifier
 * groups with each delta shown, quantity and a note. Opens for items that need
 * a choice, and on right-click / long-press for quick-add items that want a
 * note. Esc and click-outside close it (Modal).
 */
import { useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Field, Modal, inputStyle } from '../../components/ui';
import type { BasketLine, ItemRow, ModifierGroupRow, ModifierRow } from './tillData';
import { muted, reasonedFooter, touchTarget } from './tillStyles';

export function ItemSheet({
  item,
  groups,
  modifiers,
  onClose,
  onAdd,
}: {
  item: ItemRow;
  groups: ModifierGroupRow[];
  modifiers: ModifierRow[];
  onClose: () => void;
  onAdd: (line: BasketLine) => void;
}) {
  const { tr, locale } = useLocale();
  const variants = [...item.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);
  const [variantId, setVariantId] = useState<string>(
    (variants.find((v) => v.is_default) ?? variants[0])?.id ?? '',
  );
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [chosen, setChosen] = useState<Map<string, number>>(new Map()); // modifier id -> qty

  const linkedGroups = item.menu_item_modifier_groups
    .map((l) => groups.find((g) => g.id === l.group_id))
    .filter((g): g is ModifierGroupRow => Boolean(g));

  const variant = variants.find((v) => v.id === variantId);

  // The first group whose min/max is not satisfied — Add is disabled because
  // of THAT group, so name it rather than leaving a grey button (rulebook 4.3).
  const unsatisfied = linkedGroups.find((g) => {
    const count = modifiers.filter((m) => m.group_id === g.id && chosen.has(m.id)).length;
    return count < g.min_select || count > g.max_select;
  });
  const selectionValid = unsatisfied === undefined;

  function toggle(m: ModifierRow, group: ModifierGroupRow) {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(m.id)) next.delete(m.id);
      else {
        const inGroup = modifiers.filter((x) => x.group_id === group.id && next.has(x.id));
        if (inGroup.length >= group.max_select && group.max_select === 1) {
          for (const x of inGroup) next.delete(x.id);
        }
        if (modifiers.filter((x) => x.group_id === group.id && next.has(x.id)).length < group.max_select)
          next.set(m.id, 1);
      }
      return next;
    });
  }

  function add() {
    if (!variant) return;
    onAdd({
      key: crypto.randomUUID(),
      variantId: variant.id,
      itemName: pickName(locale, item),
      variantName: pickName(locale, variant),
      qty,
      notes,
      unitPriceIqd: variant.price_iqd,
      modifiers: [...chosen.entries()].map(([id, mQty]) => {
        const m = modifiers.find((x) => x.id === id);
        return {
          modifierId: id,
          qty: mQty,
          name: m ? pickName(locale, m) : '',
          priceDeltaIqd: m?.price_delta_iqd ?? 0,
        };
      }),
    });
  }

  return (
    <Modal
      title={pickName(locale, item)}
      onClose={onClose}
      footer={
        <div style={reasonedFooter}>
          <Button onClick={onClose}>{tr('common.cancel')}</Button>
          <Button
            kind="primary"
            size="lg"
            disabled={!variant || !selectionValid}
            disabledReason={
              unsatisfied
                ? tr('ws.cashier.till.sheet.needChoice', {
                    group: pickName(locale, unsatisfied),
                    min: unsatisfied.min_select,
                    max: unsatisfied.max_select,
                  })
                : undefined
            }
            onClick={add}
          >
            {tr('op.till.addToBasket')}
          </Button>
        </div>
      }
    >
      {variants.length > 1 ? (
        <Field label={tr('op.till.size')}>
          <div role="radiogroup" aria-label={tr('op.till.size')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
            {variants.map((v) => (
              <Button
                key={v.id}
                size="lg"
                aria-pressed={v.id === variantId}
                onClick={() => setVariantId(v.id)}
                style={touchTarget}
              >
                {pickName(locale, v)} · <bdi>{formatIQD(v.price_iqd, locale)}</bdi>
              </Button>
            ))}
          </div>
        </Field>
      ) : (
        variant && (
          <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-3)' }}>
            {pickName(locale, variant)} · <bdi>{formatIQD(variant.price_iqd, locale)}</bdi>
          </p>
        )
      )}

      {linkedGroups.map((g) => (
        <div key={g.id} style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
          <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-1)', fontWeight: 600 }}>
            {pickName(locale, g)} <span style={{ fontWeight: 400 }}>({g.min_select}–{g.max_select})</span>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
            {modifiers
              .filter((m) => m.group_id === g.id && m.is_active)
              .map((m) => (
                <Button
                  key={m.id}
                  size="lg"
                  aria-pressed={chosen.has(m.id)}
                  onClick={() => toggle(m, g)}
                  style={touchTarget}
                >
                  {pickName(locale, m)}
                  {m.price_delta_iqd !== 0 && (
                    <span style={{ color: 'var(--tp-muted-fg)', fontWeight: 400 }}>
                      {' '}
                      <bdi>{`${m.price_delta_iqd > 0 ? '+' : '−'}${formatIQD(Math.abs(m.price_delta_iqd), locale)}`}</bdi>
                    </span>
                  )}
                </Button>
              ))}
          </div>
        </div>
      ))}

      <Field label={tr('op.till.qty')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
          <Button size="lg" icon="minus" aria-label="−1" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} style={touchTarget} />
          <input
            style={{ ...inputStyle, inlineSize: '4.5rem', textAlign: 'center', fontSize: 'var(--tp-fs-lg)' }}
            type="number"
            dir="ltr"
            min={1}
            max={99}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
          />
          <Button size="lg" icon="plus" aria-label="+1" disabled={qty >= 99} onClick={() => setQty((q) => Math.min(99, q + 1))} style={touchTarget} />
        </div>
      </Field>
      <Field label={tr('op.till.itemNotes')}>
        <input style={inputStyle} value={notes} maxLength={120} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
