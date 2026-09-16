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
 */
import { useEffect, useId, useState, type CSSProperties } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, pickName } from '../../../lib/i18n';
import { appRpc } from '../../../lib/appRpc';
import { usePermissions } from '../../../lib/auth';
import { Button, Field, inputStyle } from '../../../components/ui';
import { Panel } from '../../../components/kit';
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

const ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(6rem, 1fr) minmax(9rem, 12rem) 5rem 5.5rem',
  gap: 'var(--tp-sp-2)',
  alignItems: 'center',
};

const HEAD: CSSProperties = {
  fontSize: 'var(--tp-fs-xs)',
  fontWeight: 600,
  color: 'var(--tp-muted-fg)',
};

export function VariantsEditor({ item }: { item: ItemRow }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const can = usePermissions();
  const { refresh } = useAdminMenu();
  const [draft, setDraft] = useState<{ nameEn: string; nameAr: string; price: number } | null>(null);
  const variants = [...item.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);
  const savedDefault = variants.find((v) => v.is_default)?.id ?? null;
  const [defaultId, setDefaultId] = useState<string | null>(savedDefault);

  // Follow the server after a save or a colleague's change.
  useEffect(() => setDefaultId(savedDefault), [savedDefault]);

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

  const readOnly = !can.editMenu;

  return (
    <Panel
      title={tr('ws.manager.menu.form.sizes.title')}
      actions={
        <Button size="sm" icon="plus" onClick={() => setDraft({ nameEn: '', nameAr: '', price: 0 })} disabled={readOnly || !!draft}>
          {tr('ws.manager.menu.form.sizes.newSize')}
        </Button>
      }
    >
      {variants.length === 0 && !draft ? (
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.menu.form.sizes.empty')}</p>
      ) : (
        <div role="radiogroup" aria-label={tr('ws.manager.menu.form.sizes.default')} style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          {variants.length > 0 && (
            <div style={ROW} aria-hidden="true">
              <span style={HEAD}>{tr('ws.manager.menu.form.sizes.size')}</span>
              <span style={HEAD}>{tr('ws.manager.menu.form.sizes.price')}</span>
              <span style={{ ...HEAD, textAlign: 'center' }}>{tr('ws.manager.menu.form.sizes.default')}</span>
              <span />
            </div>
          )}
          {variants.map((v) => (
            <VariantRowEditor
              key={v.id}
              variant={v}
              name={pickName(locale, v)}
              isDefault={defaultId === v.id}
              onPickDefault={() => setDefaultId(v.id)}
              busy={save.isPending}
              readOnly={readOnly}
              onSave={(next) => save.mutate(next)}
            />
          ))}
          {variants.length > 1 && (
            <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.menu.form.sizes.defaultHint')}</p>
          )}
        </div>
      )}
      {draft && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'flex-end', marginBlockStart: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <Field label={tr('op.menu.nameEn')} style={{ marginBlockEnd: 0, flex: '1 1 8rem' }}>
            <input style={inputStyle} dir="ltr" value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} />
          </Field>
          <Field label={tr('op.menu.nameAr')} style={{ marginBlockEnd: 0, flex: '1 1 8rem' }}>
            <input style={inputStyle} dir="rtl" lang="ar" value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />
          </Field>
          <Field label={tr('op.menu.priceIqd')} style={{ marginBlockEnd: 0 }}>
            <MoneyInput value={draft.price} onChange={(n) => setDraft({ ...draft, price: n ?? 0 })} style={{ inlineSize: '10rem' }} />
          </Field>
          <Button kind="ghost" onClick={() => setDraft(null)}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={save.isPending}
            disabled={!draft.nameEn.trim() || !draft.nameAr.trim()}
            disabledReason={draft.nameEn.trim() || draft.nameAr.trim() ? tr('ws.manager.disabled.namesRequired') : undefined}
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
    </Panel>
  );
}

function VariantRowEditor({
  variant,
  name,
  isDefault,
  onPickDefault,
  busy,
  readOnly,
  onSave,
}: {
  variant: VariantRow;
  name: string;
  isDefault: boolean;
  onPickDefault: () => void;
  busy: boolean;
  readOnly: boolean;
  onSave: (v: VariantPayload) => void;
}) {
  const { tr } = useLocale();
  const priceId = useId();
  const [price, setPrice] = useState<number>(variant.price_iqd);
  useEffect(() => setPrice(variant.price_iqd), [variant.price_iqd]);
  // Only the row that BECOMES the default has something to save: the server
  // clears the old default itself, so losing it is not a change on that row.
  const becomesDefault = isDefault && !variant.is_default;
  const dirty = price !== variant.price_iqd || becomesDefault;

  return (
    <div style={ROW}>
      <bdi style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</bdi>
      <span style={{ minInlineSize: 0 }}>
        <label htmlFor={priceId} className="tp-sr-only">{`${tr('ws.manager.menu.form.sizes.price')} — ${name}`}</label>
        <MoneyInput id={priceId} value={price} onChange={(n) => setPrice(n ?? 0)} disabled={readOnly} />
      </span>
      <span style={{ display: 'flex', justifyContent: 'center' }}>
        <input
          type="radio"
          name={`default-size-${variant.item_id}`}
          checked={isDefault}
          disabled={readOnly}
          onChange={onPickDefault}
          aria-label={`${tr('ws.manager.menu.form.sizes.default')} — ${name}`}
          style={{ inlineSize: '1rem', blockSize: '1rem' }}
        />
      </span>
      <span>
        {dirty && (
          <Button size="sm" kind="primary" busy={busy} onClick={() => onSave({ ...variant, price_iqd: price, is_default: isDefault || variant.is_default })}>
            {tr('common.save')}
          </Button>
        )}
      </span>
    </div>
  );
}
