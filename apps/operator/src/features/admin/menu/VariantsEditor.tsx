/** Sizes & prices for one item — `upsert_variant` per row / new draft. */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, Field, card, inputStyle } from '../../../components/ui';
import { MoneyInput } from '../../../components/inputs';
import { useToast } from '../../../components/toast';
import { useAdminMenu, type ItemRow, type VariantRow } from './useAdminMenu';

interface VariantPayload {
  id?: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default?: boolean;
  sort_order?: number;
}

export function VariantsEditor({ item }: { item: ItemRow }) {
  const { tr } = useLocale();
  const toast = useToast();
  const { refresh } = useAdminMenu();
  const [draft, setDraft] = useState<{ nameEn: string; nameAr: string; price: number } | null>(
    null,
  );

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
    onError: (e) => toast.err(e),
  });

  const variants = [...item.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div style={{ ...card, marginBlockStart: 'var(--tp-sp-2-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>{tr('op.menu.variants')}</h4>
        <Button onClick={() => setDraft({ nameEn: '', nameAr: '', price: 0 })} disabled={!!draft}>
          {tr('op.menu.newVariant')}
        </Button>
      </div>
      {variants.map((v) => (
        <VariantRowEditor
          key={v.id}
          variant={v}
          busy={save.isPending}
          onSave={(next) => save.mutate(next)}
        />
      ))}
      {draft && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--tp-sp-1-5)',
            alignItems: 'flex-end',
            marginBlockStart: 'var(--tp-sp-2)',
            flexWrap: 'wrap',
          }}
        >
          <Field label={tr('op.menu.nameEn')} style={{ marginBlockEnd: 0, flex: 1 }}>
            <input
              style={inputStyle}
              dir="ltr"
              value={draft.nameEn}
              onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
            />
          </Field>
          <Field label={tr('op.menu.nameAr')} style={{ marginBlockEnd: 0, flex: 1 }}>
            <input
              style={inputStyle}
              dir="rtl"
              lang="ar"
              value={draft.nameAr}
              onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
            />
          </Field>
          <Field label={tr('op.menu.priceIqd')} style={{ marginBlockEnd: 0 }}>
            <MoneyInput
              value={draft.price}
              onChange={(n) => setDraft({ ...draft, price: n ?? 0 })}
              style={{ inlineSize: '11rem' }}
            />
          </Field>
          <Button onClick={() => setDraft(null)}>{tr('common.cancel')}</Button>
          <Button
            kind="primary"
            disabled={save.isPending || !draft.nameEn.trim() || !draft.nameAr.trim()}
            onClick={() =>
              save.mutate({
                name_en: draft.nameEn.trim(),
                name_ar: draft.nameAr.trim(),
                price_iqd: draft.price,
                is_default: variants.length === 0,
                sort_order: variants.length,
              })
            }
          >
            {tr('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

function VariantRowEditor({
  variant,
  busy,
  onSave,
}: {
  variant: VariantRow;
  busy: boolean;
  onSave: (v: VariantPayload) => void;
}) {
  const { tr, locale } = useLocale();
  const [price, setPrice] = useState<number>(variant.price_iqd);
  const [isDefault, setIsDefault] = useState(variant.is_default);
  const dirty = price !== variant.price_iqd || isDefault !== variant.is_default;

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--tp-sp-2)',
        alignItems: 'center',
        marginBlockStart: 'var(--tp-sp-1-5)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1, minInlineSize: '6rem' }}>{pickName(locale, variant)}</span>
      <MoneyInput value={price} onChange={(n) => setPrice(n ?? 0)} style={{ inlineSize: '12rem' }} />
      <label style={{ display: 'flex', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        {tr('op.menu.isDefault')}
      </label>
      <Button
        disabled={!dirty || busy}
        onClick={() => onSave({ ...variant, price_iqd: price, is_default: isDefault })}
      >
        {tr('common.save')}
      </Button>
    </div>
  );
}
