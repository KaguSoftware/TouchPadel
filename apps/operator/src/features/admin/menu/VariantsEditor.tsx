/**
 * Sizes & prices for one item — `upsert_variant` per row / new draft.
 *
 * Laid out as a small table (Size · Price · Default) inside a Panel like the
 * rest of the item form, with a Save on a row only once that row has changed:
 * every row used to carry its own greyed Save, which read as "something needs
 * saving" on an item nobody had touched.
 *
 * "Default" is one choice per item — `app.upsert_variant` clears the others —
 * so it is a radio group whose value lives here, not a checkbox per row.
 *
 * Locked prices (build-contracts-2026-09-23 §5.5) are shown as figures, not as
 * greyed inputs, and New size gives way: an item in release takes its prices
 * from the release's price step (ITEM_IN_RELEASE, everyone), and an item on
 * sale changes them through "Change the price" unless the role may edit them
 * directly (PRICE_VIA_PROTOCOL). The default size is never locked, and a row
 * saved under a lock re-sends its stored price, which the server lets through.
 *
 * A size's names are shown as text here and never edited, and every save
 * re-sends the stored names: since wave 5 a launched size is renamed through
 * "Change the price" too (§2.2, #9, the `onSale` lock's note says so), and a
 * refusal with hint `name` says that rather than the price sentence.
 */
import { useId, useState, type CSSProperties } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, pickName } from '../../../lib/i18n';
import { appRpc } from '../../../lib/appRpc';
import { usePermissions } from '../../../lib/auth';
import { Button, inputStyle } from '../../../components/ui';
import { Money } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { MoneyInput } from '../../../components/inputs';
import { useToast } from '../../../components/toast';
import { PriceChangeButton, PriceLockNote } from '../promotions/PriceChangeStart';
import { isRenameRefusal } from '../addons/addonsLogic';
import type { PricesLock } from './menuLogic';
import { useAdminMenu, type ItemRow, type VariantRow } from './useAdminMenu';

interface VariantPayload {
  id?: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default?: boolean;
  sort_order?: number;
}

/** One size, as a card: its name, its price and whether it is the default. The form's Save sends them. */
const ROW: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--tp-sp-3)',
  padding: 'var(--tp-sp-3) var(--tp-sp-4)',
  borderRadius: 'var(--tp-radius-panel)',
};

/** The price box and the default button share one size, so choosing a default moves nothing. */
const CONTROL: CSSProperties = { blockSize: '2.5rem', inlineSize: '9rem', boxSizing: 'border-box' };

export function VariantsEditor({
  item,
  pricesLock = null,
  prices,
  onPrice,
  defaultId,
  onDefault,
}: {
  item: ItemRow;
  pricesLock?: PricesLock | null;
  /** Edited prices by size id; the form saves them with its own Save. */
  prices: Record<string, number>;
  onPrice: (id: string, price: number) => void;
  /** The size that is (or is about to become) the default. */
  defaultId: string | null;
  onDefault: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const can = usePermissions();
  const { refresh } = useAdminMenu();
  const [draft, setDraft] = useState<{ nameEn: string; nameAr: string; price: number } | null>(null);
  const variants = [...item.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);

  const save = useMutation({
    mutationFn: (v: VariantPayload) =>
      appRpc('upsert_variant', {
        p_id: v.id ?? null,
        p_item_id: item.id,
        p_name_en: v.name_en,
        p_name_ar: v.name_ar,
        p_price_iqd: v.price_iqd,
        p_is_default: v.is_default ?? false,
        p_sort_order: v.sort_order ?? 0,
      }),
    onSuccess: async () => {
      setDraft(null);
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
    onError: (e) => toast.err(isRenameRefusal(e) ? tr('ws.pricing.renameViaProtocol') : e),
  });

  const readOnly = !can.editMenu;
  const newPriceId = useId();
  const canAdd = draft !== null && draft.nameEn.trim() !== '' && draft.nameAr.trim() !== '';

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      {pricesLock === 'onSale' && (
        // The shared start: it leaves for Protocols, so it wears the same ↗ as
        // every other price or promo start (it carried a tag icon here alone).
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <PriceChangeButton size="sm" target={{ change: 'price', item: item.id }} label={tr('ws.release.menu.sizes.changePrice')} />
        </div>
      )}
      {variants.length === 0 && !draft ? (
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.menu.form.sizes.empty')}</p>
      ) : (
        <div role="radiogroup" aria-label={tr('ws.manager.menu.form.sizes.default')} style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
          {variants.map((v) => (
            <VariantRowEditor
              key={v.id}
              variant={v}
              name={pickName(locale, v)}
              isDefault={defaultId === v.id}
              onPickDefault={() => onDefault(v.id)}
              price={prices[v.id] ?? v.price_iqd}
              onPrice={(n) => onPrice(v.id, n)}
              readOnly={readOnly}
              priceLocked={pricesLock !== null}
            />
          ))}
        </div>
      )}
      {pricesLock === null && !draft && (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setDraft({ nameEn: '', nameAr: '', price: 0 })}
          style={{
            inlineSize: '100%',
            minBlockSize: '4rem',
            marginBlockStart: variants.length > 0 ? 'var(--tp-sp-3)' : 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--tp-sp-2-5)',
            border: '2px dashed var(--tp-border-strong)',
            borderRadius: 'var(--tp-radius-panel)',
            background: 'transparent',
            color: 'var(--tp-accent)',
            font: 'inherit',
            fontWeight: 700,
            cursor: readOnly ? 'not-allowed' : 'pointer',
            opacity: readOnly ? 'var(--tp-opacity-disabled)' : 1,
          }}
        >
          <Icon name="plus" size={18} strokeWidth={2.4} />
          {tr('ws.manager.menu.form.sizes.newSize')}
        </button>
      )}
      {/* The lock said the way Add-ons and Shop products say it. */}
      {pricesLock && <PriceLockNote message={tr(`ws.release.menu.sizes.${pricesLock}`)} style={{ marginBlockStart: 'var(--tp-sp-2)' }} />}
      {draft && !pricesLock && (
        <form
          aria-label={tr('ws.manager.menu.form.sizes.newSize')}
          onSubmit={(e) => {
            e.preventDefault();
            if (!canAdd || save.isPending) return;
            save.mutate({
              name_en: draft.nameEn.trim(),
              name_ar: draft.nameAr.trim(),
              price_iqd: draft.price,
              is_default: variants.length === 0,
              sort_order: variants.length,
            });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(null);
            }
          }}
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-4)',
            marginBlockStart: variants.length > 0 ? 'var(--tp-sp-3)' : 0,
            padding: 'var(--tp-sp-4)',
            border: '2px solid var(--tp-accent)',
            borderRadius: 'var(--tp-radius-panel)',
            background: 'var(--tp-accent-soft)',
          }}
        >
          <strong style={{ fontSize: 'var(--tp-fs-md)' }}>{tr('ws.manager.menu.form.sizes.newSize')}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
            <label style={{ display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>
              {tr('op.menu.nameEn')}
              <input
                style={{ ...inputStyle, minBlockSize: '3rem', borderRadius: '0.75rem', fontWeight: 400 }}
                dir="ltr"
                autoFocus
                value={draft.nameEn}
                onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>
              {tr('op.menu.nameAr')}
              <input
                style={{ ...inputStyle, minBlockSize: '3rem', borderRadius: '0.75rem', fontWeight: 400 }}
                dir="rtl"
                lang="ar"
                value={draft.nameAr}
                onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>
              <label htmlFor={newPriceId}>{tr('op.menu.priceIqd')}</label>
              <span style={{ display: 'flex', alignItems: 'stretch', inlineSize: '12rem', blockSize: '3rem', border: '1px solid var(--tp-border-strong)', borderRadius: '0.75rem', overflow: 'hidden', background: 'var(--tp-surface)' }}>
                <MoneyInput
                  id={newPriceId}
                  value={draft.price}
                  onChange={(n) => setDraft({ ...draft, price: n ?? 0 })}
                  bare
                  style={{ flex: 1, minInlineSize: 0 }}
                  inputStyle={{ border: 'none', borderRadius: 0, background: 'transparent', minBlockSize: 0, blockSize: '100%', fontWeight: 700 }}
                />
                <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-xs)', fontWeight: 700, color: 'var(--tp-muted-fg)', background: 'var(--tp-surface-2)' }}>
                  {tr('ws.manager.menu.form.iqd')}
                </span>
              </span>
            </div>
            <span style={{ flex: 1 }} />
            <Button size="lg" onClick={() => setDraft(null)}>
              {tr('common.cancel')}
            </Button>
            <Button
              size="lg"
              kind="primary"
              type="submit"
              icon="check"
              busy={save.isPending}
              disabled={!canAdd}
              disabledReason={!canAdd ? tr('ws.manager.disabled.namesRequired') : undefined}
            >
              {tr('ws.manager.menu.form.sizes.add')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function VariantRowEditor({
  variant,
  name,
  isDefault,
  onPickDefault,
  price,
  onPrice,
  readOnly,
  priceLocked,
}: {
  variant: VariantRow;
  name: string;
  isDefault: boolean;
  onPickDefault: () => void;
  price: number;
  onPrice: (price: number) => void;
  readOnly: boolean;
  /** Show the stored price as a figure; only the default can change. */
  priceLocked: boolean;
}) {
  const { tr } = useLocale();
  const priceId = useId();

  return (
    <div style={{ ...ROW, border: `2px solid ${isDefault ? 'var(--tp-accent)' : 'var(--tp-border)'}`, background: isDefault ? 'var(--tp-accent-soft)' : 'var(--tp-surface)' }}>
      <bdi style={{ flex: '1 1 8rem', minInlineSize: 0, fontWeight: 700, fontSize: 'var(--tp-fs-md)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</bdi>
      {priceLocked ? (
        <span style={{ flex: '0 0 auto', paddingInline: 'var(--tp-sp-2)' }}>
          <Money amount={variant.price_iqd} unit={false} />
        </span>
      ) : (
        <span style={{ flex: '0 0 auto' }}>
          <label htmlFor={priceId} className="tp-sr-only">{`${tr('ws.manager.menu.form.sizes.price')}: ${name}`}</label>
          <span style={{ ...CONTROL, display: 'flex', alignItems: 'stretch', border: '1px solid var(--tp-border-strong)', borderRadius: 'var(--tp-radius-ctl)', overflow: 'hidden', background: 'var(--tp-surface)' }}>
            <MoneyInput
              id={priceId}
              value={price}
              onChange={(n) => onPrice(n ?? 0)}
              disabled={readOnly}
              bare
              style={{ flex: 1, minInlineSize: 0 }}
              inputStyle={{ border: 'none', borderRadius: 0, background: 'transparent', minBlockSize: 0, blockSize: '100%', fontWeight: 700 }}
            />
            <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', paddingInline: 'var(--tp-sp-2-5)', fontSize: 'var(--tp-fs-xs)', fontWeight: 700, color: 'var(--tp-muted-fg)', background: 'var(--tp-surface-2)' }}>
              {tr('ws.manager.menu.form.iqd')}
            </span>
          </span>
        </span>
      )}
      <label
        style={{
          ...CONTROL,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--tp-sp-1-5)',
          flex: '0 0 auto',
          borderRadius: 'var(--tp-radius-ctl)',
          border: `1px solid ${isDefault ? 'var(--tp-accent)' : 'var(--tp-border-strong)'}`,
          background: isDefault ? 'var(--tp-accent)' : 'var(--tp-surface)',
          color: isDefault ? 'var(--tp-accent-contrast)' : 'var(--tp-fg)',
          fontSize: 'var(--tp-fs-sm)',
          fontWeight: 600,
          cursor: readOnly ? 'not-allowed' : 'pointer',
        }}
      >
        <input
          type="radio"
          name={`default-size-${variant.item_id}`}
          checked={isDefault}
          disabled={readOnly}
          onChange={onPickDefault}
          aria-label={`${tr('ws.manager.menu.form.sizes.default')}: ${name}`}
          style={{ position: 'absolute', opacity: 0, inlineSize: 0, blockSize: 0 }}
        />
        {isDefault && <Icon name="check" size={14} strokeWidth={3} />}
        {isDefault ? tr('ws.manager.menu.form.sizes.default') : tr('ws.manager.menu.form.sizes.makeDefault')}
      </label>
    </div>
  );
}
