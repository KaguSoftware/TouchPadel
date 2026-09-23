/**
 * Item sheet (spec ModifierPicker + NumericKeypad-lite): size, modifier
 * groups with each delta shown, quantity and a note. Opens for items that need
 * a choice, and on right-click / long-press for quick-add items that want a
 * note. Esc and click-outside close it (Modal).
 */
import { useState, type CSSProperties } from 'react';
import { formatIQD } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Field, Modal, inputStyle } from '../../components/ui';
import type { BasketLine, ItemRow, ModifierGroupRow, ModifierRow } from './tillData';
import { muted, reasonedFooter, touchTarget } from './tillStyles';

/**
 * A − or + end of the quantity stepper: square, borderless, the stepper's full
 * height. The dividers live on these buttons, not the input: the global input
 * focus rule recolours an input's border with !important, which drew a blue
 * ring around the number.
 */
const stepperEnd: CSSProperties = { ...touchTarget, minInlineSize: '3.25rem', border: 'none', borderRadius: 0 };

/**
 * The quantity's number, centred. Digits have no descender, so it sits a hair
 * low (padding-block) to look centred.
 *
 * The caret is drawn (the overlay below), never native: the native caret
 * spans the font's whole line, descent included, so it never lined up with a
 * digit. The drawn one is figure-height, baseline to top, and attached to the
 * number — touching the 30% "0" shown while the box is cleared, a little
 * gap after typed digits (-after; margins still sum to zero so the number
 * never shifts). The input stays the real control; the overlay only paints.
 */
const QTY_CSS = `
.tp-qty-input { inline-size: 4rem; box-sizing: border-box; padding-inline: 0; padding-block: 0.12em 0; line-height: 1; text-align: center; }
.tp-qty-caret { display: inline-block; inline-size: 2px; block-size: 0.72em; margin-inline: -1px -1px; vertical-align: baseline; background: var(--tp-fg); animation: tp-qty-blink 1s step-end infinite; }
.tp-qty-caret-after { margin-inline: 1px -3px; }
@keyframes tp-qty-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .tp-qty-caret { animation: none; } }
`;
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
  // The field's text, so the cashier can clear it completely; empty reads as 0
  // (the faded 0 says so) and Add waits for a quantity.
  const [qtyText, setQtyText] = useState('1');
  const [qtyFocused, setQtyFocused] = useState(false);
  // The drawn caret steps aside while the digits are selected (focus selects them).
  const [qtySelected, setQtySelected] = useState(false);
  const showQtyCaret = qtyFocused && !qtySelected;
  const qty = qtyText === '' ? 0 : Math.max(1, Math.min(99, Number(qtyText) || 1));
  const setQty = (next: (q: number) => number) => setQtyText(String(next(qty)));
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
      footer={(close) => (
        <div style={reasonedFooter}>
          <Button size="lg" onClick={close}>{tr('common.cancel')}</Button>
          <Button
            kind="primary"
            size="lg"
            disabled={!variant || !selectionValid || qty < 1}
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
      )}
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
            {pickName(locale, g)}{' '}
            {/* "(1–1)" was the database's min/max; say it the way a person does. */}
            <span style={{ fontWeight: 400 }}>
              {g.min_select > 0 ? tr('ws.cashier.till.sheet.required') : tr('ws.cashier.till.sheet.optional')}
              {g.max_select > 1 && ` · ${tr('ws.cashier.till.sheet.upTo', { max: g.max_select })}`}
            </span>
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

      <style>{QTY_CSS}</style>
      {/* One joined −/number/+ stepper: the three parts share a border and a
          height, and the number is plain text (no native spinner arrows). */}
      <Field label={tr('op.till.qty')} group>
        <div
          role="group"
          aria-label={tr('op.till.qty')}
          style={{
            display: 'inline-flex',
            alignItems: 'stretch',
            border: '1px solid var(--tp-border-strong)',
            borderRadius: 'var(--tp-radius-ctl)',
            background: 'var(--tp-surface)',
            overflow: 'hidden',
          }}
        >
          <Button kind="ghost" size="lg" icon="minus" aria-label="−1" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ ...stepperEnd, borderInlineEnd: '1px solid var(--tp-border)' }} />
          <span style={{ position: 'relative', display: 'flex' }}>
            <input
              aria-label={tr('op.till.qty')}
              className="tp-qty-input"
              type="text"
              inputMode="numeric"
              dir="ltr"
              value={qtyText}
              onFocus={(e) => {
                setQtyFocused(true);
                e.target.select();
              }}
              onBlur={() => setQtyFocused(false)}
              onSelect={(e) => setQtySelected(e.currentTarget.selectionStart !== e.currentTarget.selectionEnd)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 2);
                setQtyText(digits);
              }}
              style={{
                border: 'none',
                outline: 'none',
                boxShadow: 'none',
                background: 'transparent',
                color: 'transparent',
                caretColor: 'transparent',
                font: 'inherit',
                fontSize: 'var(--tp-fs-xl)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            />
            <span
              aria-hidden="true"
              dir="ltr"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                paddingBlockStart: '0.12em',
                lineHeight: 1,
                fontSize: 'var(--tp-fs-xl)',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--tp-fg)',
                pointerEvents: 'none',
              }}
            >
              {qtyText === '' ? (
                <span>
                  {showQtyCaret && <span className="tp-qty-caret" />}
                  <span style={{ opacity: 0.3 }}>0</span>
                </span>
              ) : (
                <span>
                  {qtyText}
                  {showQtyCaret && <span className="tp-qty-caret tp-qty-caret-after" />}
                </span>
              )}
            </span>
          </span>
          <Button kind="ghost" size="lg" icon="plus" aria-label="+1" disabled={qty >= 99} onClick={() => setQty((q) => Math.min(99, q + 1))} style={{ ...stepperEnd, borderInlineStart: '1px solid var(--tp-border)' }} />
        </div>
      </Field>
      <Field label={tr('op.till.itemNotes')}>
        <input style={inputStyle} value={notes} maxLength={120} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}
