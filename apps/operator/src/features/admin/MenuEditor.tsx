/**
 * Admin menu editor — categories/items tree, side-by-side EN/AR fields (dir per
 * field), variants + prices, modifier groups, availability toggle. All writes
 * via the 0013 upsert RPCs (menu management is RPC-only).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, card, inputStyle } from '../../components/ui';

interface CategoryRow {
  id: string;
  name_en: string;
  name_ar: string;
  tax_group_id: string;
  sort_order: number;
  is_active: boolean;
}
interface ItemRow {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  sort_order: number;
  is_active: boolean;
  unavailable_on: string | null;
  menu_item_variants: VariantRow[];
  menu_item_modifier_groups: { group_id: string }[];
}
interface VariantRow {
  id: string;
  item_id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
}
interface GroupRow {
  id: string;
  name_en: string;
  name_ar: string;
  min_select: number;
  max_select: number;
}
interface ModifierRow {
  id: string;
  group_id: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  sort_order: number;
  is_active: boolean;
}

/** Paired EN (ltr) / AR (rtl) inputs — dir is per FIELD, not per document. */
function BilingualFields({
  labelEn,
  labelAr,
  en,
  ar,
  onEn,
  onAr,
}: {
  labelEn: string;
  labelAr: string;
  en: string;
  ar: string;
  onEn: (v: string) => void;
  onAr: (v: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
      <Field label={labelEn}>
        <input style={inputStyle} dir="ltr" value={en} onChange={(e) => onEn(e.target.value)} />
      </Field>
      <Field label={labelAr}>
        <input style={inputStyle} dir="rtl" lang="ar" value={ar} onChange={(e) => onAr(e.target.value)} />
      </Field>
    </div>
  );
}

export function MenuEditor() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | 'new' | null>(null);
  const [editCategory, setEditCategory] = useState<CategoryRow | 'new' | null>(null);

  const menuQ = useQuery({
    queryKey: ['adminMenu'],
    queryFn: async () => {
      const [cats, items, groups, mods, taxes] = await Promise.all([
        supabase.from('menu_categories').select('*').order('sort_order'),
        supabase
          .from('menu_items')
          .select('*, menu_item_variants(*), menu_item_modifier_groups(group_id)')
          .order('sort_order'),
        supabase.from('modifier_groups').select('*'),
        supabase.from('modifiers').select('*').order('sort_order'),
        supabase.from('tax_groups').select('id, name_en, name_ar, rate_bp'),
      ]);
      for (const r of [cats, items, groups, mods, taxes]) if (r.error) throw r.error;
      return {
        categories: (cats.data ?? []) as unknown as CategoryRow[],
        items: (items.data ?? []) as unknown as ItemRow[],
        groups: (groups.data ?? []) as unknown as GroupRow[],
        modifiers: (mods.data ?? []) as unknown as ModifierRow[],
        taxGroups: (taxes.data ?? []) as unknown as { id: string; name_en: string; name_ar: string }[],
      };
    },
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['adminMenu'] });

  const categories = menuQ.data?.categories ?? [];
  const activeCat = selectedCategory ?? categories[0]?.id ?? null;
  const items = (menuQ.data?.items ?? []).filter((i) => i.category_id === activeCat);
  const item =
    selectedItem && selectedItem !== 'new'
      ? (menuQ.data?.items ?? []).find((i) => i.id === selectedItem) ?? null
      : null;

  return (
    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* categories */}
      <div style={{ inlineSize: '13rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{tr('op.menu.categories')}</h3>
          <Button onClick={() => setEditCategory('new')}>+</Button>
        </div>
        {categories.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: '0.2rem', marginBlockStart: '0.3rem' }}>
            <Button
              kind={c.id === activeCat ? 'primary' : 'default'}
              style={{ flex: 1, textAlign: 'start', opacity: c.is_active ? 1 : 0.5 }}
              onClick={() => {
                setSelectedCategory(c.id);
                setSelectedItem(null);
              }}
            >
              {pickName(locale, c)}
            </Button>
            <Button kind="ghost" onClick={() => setEditCategory(c)}>
              ✎
            </Button>
          </div>
        ))}
        {editCategory && (
          <CategoryForm
            category={editCategory === 'new' ? null : editCategory}
            taxGroups={menuQ.data?.taxGroups ?? []}
            onDone={() => {
              setEditCategory(null);
              refresh();
            }}
            onCancel={() => setEditCategory(null)}
          />
        )}
      </div>

      {/* items */}
      <div style={{ inlineSize: '15rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>{tr('op.menu.items')}</h3>
          <Button onClick={() => setSelectedItem('new')} disabled={!activeCat}>
            +
          </Button>
        </div>
        {items.map((i) => (
          <Button
            key={i.id}
            kind={i.id === selectedItem ? 'primary' : 'default'}
            style={{
              display: 'block',
              inlineSize: '100%',
              textAlign: 'start',
              marginBlockStart: '0.3rem',
              opacity: i.is_active ? 1 : 0.5,
            }}
            onClick={() => setSelectedItem(i.id)}
          >
            {pickName(locale, i)}
            {i.unavailable_on && ` · ${tr('op.menu.unavailableToday')}`}
          </Button>
        ))}
      </div>

      {/* item editor */}
      {(item || selectedItem === 'new') && activeCat && (
        <ItemEditor
          key={item?.id ?? 'new'}
          item={item}
          categoryId={activeCat}
          groups={menuQ.data?.groups ?? []}
          modifiers={menuQ.data?.modifiers ?? []}
          onSaved={(id) => {
            setSelectedItem(id);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CategoryForm({
  category,
  taxGroups,
  onDone,
  onCancel,
}: {
  category: CategoryRow | null;
  taxGroups: { id: string; name_en: string; name_ar: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { tr, locale } = useLocale();
  const [nameEn, setNameEn] = useState(category?.name_en ?? '');
  const [nameAr, setNameAr] = useState(category?.name_ar ?? '');
  const [taxGroupId, setTaxGroupId] = useState(category?.tax_group_id ?? taxGroups[0]?.id ?? '');
  const [sortOrder, setSortOrder] = useState(category?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(category?.is_active ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('upsert_menu_category', {
        p_id: category?.id ?? null,
        p_name_en: nameEn,
        p_name_ar: nameAr,
        p_tax_group_id: taxGroupId,
        p_sort_order: sortOrder,
        p_is_active: isActive,
      });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...card, marginBlockStart: '0.5rem' }}>
      <h4 style={{ marginBlockStart: 0 }}>
        {category ? tr('op.common.edit') : tr('op.menu.newCategory')}
      </h4>
      <BilingualFields
        labelEn={tr('op.menu.nameEn')}
        labelAr={tr('op.menu.nameAr')}
        en={nameEn}
        ar={nameAr}
        onEn={setNameEn}
        onAr={setNameAr}
      />
      <Field label={tr('op.menu.taxGroup')}>
        <select style={inputStyle} value={taxGroupId} onChange={(e) => setTaxGroupId(e.target.value)}>
          {taxGroups.map((tg) => (
            <option key={tg.id} value={tg.id}>
              {pickName(locale, tg)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.menu.sortOrder')}>
        <input
          style={inputStyle}
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
        />
      </Field>
      <label style={{ display: 'flex', gap: '0.4rem', marginBlockEnd: '0.5rem' }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {tr('op.menu.isActive')}
      </label>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>{tr('common.cancel')}</Button>
        <Button kind="primary" disabled={busy || !nameEn || !nameAr || !taxGroupId} onClick={() => void save()}>
          {tr('common.save')}
        </Button>
      </div>
    </div>
  );
}

function ItemEditor({
  item,
  categoryId,
  groups,
  modifiers,
  onSaved,
}: {
  item: ItemRow | null;
  categoryId: string;
  groups: GroupRow[];
  modifiers: ModifierRow[];
  onSaved: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const [nameEn, setNameEn] = useState(item?.name_en ?? '');
  const [nameAr, setNameAr] = useState(item?.name_ar ?? '');
  const [descEn, setDescEn] = useState(item?.description_en ?? '');
  const [descAr, setDescAr] = useState(item?.description_ar ?? '');
  const [sortOrder, setSortOrder] = useState(item?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setSaved(false), [nameEn, nameAr, descEn, descAr, sortOrder, isActive]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSaved(true);
      if (item) onSaved(item.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveItem() {
    setBusy(true);
    setError(null);
    try {
      const id = await appRpc<string>('upsert_menu_item', {
        p_id: item?.id ?? null,
        p_category_id: categoryId,
        p_name_en: nameEn,
        p_name_ar: nameAr,
        p_description_en: descEn || null,
        p_description_ar: descAr || null,
        p_sort_order: sortOrder,
        p_is_active: isActive,
      });
      setSaved(true);
      onSaved(id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const linkedGroupIds = new Set((item?.menu_item_modifier_groups ?? []).map((l) => l.group_id));
  const unavailableToday = Boolean(item?.unavailable_on);

  return (
    <div style={{ flex: 1, minInlineSize: '24rem' }}>
      <div style={card}>
        <h3 style={{ marginBlockStart: 0 }}>{item ? pickName(locale, item) : tr('op.menu.newItem')}</h3>
        <BilingualFields
          labelEn={tr('op.menu.nameEn')}
          labelAr={tr('op.menu.nameAr')}
          en={nameEn}
          ar={nameAr}
          onEn={setNameEn}
          onAr={setNameAr}
        />
        <BilingualFields
          labelEn={tr('op.menu.descriptionEn')}
          labelAr={tr('op.menu.descriptionAr')}
          en={descEn}
          ar={descAr}
          onEn={setDescEn}
          onAr={setDescAr}
        />
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
          <Field label={tr('op.menu.sortOrder')} style={{ marginBlockEnd: 0 }}>
            <input
              style={{ ...inputStyle, inlineSize: '5rem' }}
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
            />
          </Field>
          <label style={{ display: 'flex', gap: '0.4rem' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {tr('op.menu.isActive')}
          </label>
          {item && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  appRpc('set_item_availability', {
                    p_item_id: item.id,
                    p_available: unavailableToday,
                  }),
                )
              }
            >
              {unavailableToday ? tr('op.menu.markAvailable') : tr('op.menu.markUnavailable')}
            </Button>
          )}
        </div>
        <ErrorText error={error} />
        {saved && <p style={{ color: 'var(--tp-accent)', marginBlock: '0.3rem' }}>{tr('op.menu.saved')}</p>}
        <Button kind="primary" disabled={busy || !nameEn || !nameAr} onClick={() => void saveItem()}>
          {tr('common.save')}
        </Button>
      </div>

      {item && (
        <>
          <VariantsEditor item={item} onChanged={() => onSaved(item.id)} />
          <GroupsEditor
            item={item}
            groups={groups}
            modifiers={modifiers}
            linkedGroupIds={linkedGroupIds}
            onChanged={() => onSaved(item.id)}
          />
        </>
      )}
    </div>
  );
}

function VariantsEditor({ item, onChanged }: { item: ItemRow; onChanged: () => void }) {
  const { tr, locale } = useLocale();
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<{ nameEn: string; nameAr: string; price: number } | null>(null);

  async function save(v: Partial<VariantRow> & { name_en: string; name_ar: string; price_iqd: number }) {
    setError(null);
    try {
      await appRpc('upsert_variant', {
        p_id: v.id ?? null,
        p_item_id: item.id,
        p_name_en: v.name_en,
        p_name_ar: v.name_ar,
        p_price_iqd: v.price_iqd,
        p_is_default: v.is_default ?? false,
        p_sort_order: v.sort_order ?? 0,
      });
      setDraft(null);
      onChanged();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div style={{ ...card, marginBlockStart: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>{tr('op.menu.variants')}</h4>
        <Button onClick={() => setDraft({ nameEn: '', nameAr: '', price: 0 })}>
          {tr('op.menu.newVariant')}
        </Button>
      </div>
      {[...item.menu_item_variants]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((v) => (
          <VariantRowEditor key={v.id} variant={v} onSave={save} />
        ))}
      {draft && (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', marginBlockStart: '0.4rem', flexWrap: 'wrap' }}>
          <Field label={tr('op.menu.nameEn')} style={{ marginBlockEnd: 0 }}>
            <input style={inputStyle} dir="ltr" value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} />
          </Field>
          <Field label={tr('op.menu.nameAr')} style={{ marginBlockEnd: 0 }}>
            <input style={inputStyle} dir="rtl" lang="ar" value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} />
          </Field>
          <Field label={tr('op.menu.priceIqd')} style={{ marginBlockEnd: 0 }}>
            <input
              style={{ ...inputStyle, inlineSize: '7rem' }}
              dir="ltr"
              type="number"
              min={0}
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
          <Button
            kind="primary"
            disabled={!draft.nameEn || !draft.nameAr}
            onClick={() => void save({ name_en: draft.nameEn, name_ar: draft.nameAr, price_iqd: draft.price })}
          >
            {tr('common.save')}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function VariantRowEditor({
  variant,
  onSave,
}: {
  variant: VariantRow;
  onSave: (v: VariantRow) => Promise<void>;
}) {
  const { tr, locale } = useLocale();
  const [price, setPrice] = useState(variant.price_iqd);
  const [isDefault, setIsDefault] = useState(variant.is_default);
  const dirty = price !== variant.price_iqd || isDefault !== variant.is_default;

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBlockStart: '0.3rem' }}>
      <span style={{ flex: 1 }}>{pickName(locale, variant)}</span>
      <input
        style={{ ...inputStyle, inlineSize: '7rem' }}
        dir="ltr"
        type="number"
        min={0}
        value={price}
        onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
      />
      <span style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>
        {formatIQD(variant.price_iqd, locale)}
      </span>
      <label style={{ display: 'flex', gap: '0.25rem', fontSize: '0.85rem' }}>
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        {tr('op.menu.isDefault')}
      </label>
      <Button
        disabled={!dirty}
        onClick={() => void onSave({ ...variant, price_iqd: price, is_default: isDefault })}
      >
        {tr('common.save')}
      </Button>
    </div>
  );
}

function GroupsEditor({
  item,
  groups,
  modifiers,
  linkedGroupIds,
  onChanged,
}: {
  item: ItemRow;
  groups: GroupRow[];
  modifiers: ModifierRow[];
  linkedGroupIds: Set<string>;
  onChanged: () => void;
}) {
  const { tr, locale } = useLocale();
  const [error, setError] = useState<unknown>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<{ nameEn: string; nameAr: string; min: number; max: number } | null>(null);
  const [modDraft, setModDraft] = useState<{ nameEn: string; nameAr: string; delta: number } | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div style={{ ...card, marginBlockStart: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>{tr('op.menu.modifierGroups')}</h4>
        <Button onClick={() => setGroupDraft({ nameEn: '', nameAr: '', min: 0, max: 1 })}>
          {tr('op.menu.newGroup')}
        </Button>
      </div>
      {groups.map((g) => {
        const linked = linkedGroupIds.has(g.id);
        return (
          <div key={g.id} style={{ marginBlockStart: '0.35rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <Button kind="ghost" onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}>
                {openGroup === g.id ? '▾' : '▸'}
              </Button>
              <span style={{ flex: 1 }}>
                {pickName(locale, g)}{' '}
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>
                  ({g.min_select}–{g.max_select})
                </span>
              </span>
              <Button
                kind={linked ? 'danger' : 'primary'}
                onClick={() =>
                  void run(() =>
                    appRpc('link_item_modifier_group', {
                      p_item_id: item.id,
                      p_group_id: g.id,
                      p_linked: !linked,
                    }),
                  )
                }
              >
                {linked ? tr('op.menu.unlink') : tr('op.menu.link')}
              </Button>
            </div>
            {openGroup === g.id && (
              <div style={{ marginInlineStart: '1.5rem' }}>
                {modifiers
                  .filter((m) => m.group_id === g.id)
                  .map((m) => (
                    <div key={m.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBlockStart: '0.2rem' }}>
                      <span style={{ flex: 1, opacity: m.is_active ? 1 : 0.5 }}>
                        {pickName(locale, m)} · {formatIQD(m.price_delta_iqd, locale)}
                      </span>
                      <Button
                        onClick={() =>
                          void run(() =>
                            appRpc('upsert_modifier', {
                              p_id: m.id,
                              p_group_id: m.group_id,
                              p_name_en: m.name_en,
                              p_name_ar: m.name_ar,
                              p_price_delta_iqd: m.price_delta_iqd,
                              p_sort_order: m.sort_order,
                              p_is_active: !m.is_active,
                            }),
                          )
                        }
                      >
                        {m.is_active ? tr('op.menu.markUnavailable') : tr('op.menu.markAvailable')}
                      </Button>
                    </div>
                  ))}
                {modDraft ? (
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBlockStart: '0.3rem' }}>
                    <input style={{ ...inputStyle, inlineSize: '9rem' }} dir="ltr" placeholder={tr('op.menu.nameEn')} value={modDraft.nameEn} onChange={(e) => setModDraft({ ...modDraft, nameEn: e.target.value })} />
                    <input style={{ ...inputStyle, inlineSize: '9rem' }} dir="rtl" lang="ar" placeholder={tr('op.menu.nameAr')} value={modDraft.nameAr} onChange={(e) => setModDraft({ ...modDraft, nameAr: e.target.value })} />
                    <input style={{ ...inputStyle, inlineSize: '7rem' }} dir="ltr" type="number" min={0} placeholder={tr('op.menu.priceDelta')} value={modDraft.delta} onChange={(e) => setModDraft({ ...modDraft, delta: Math.max(0, Number(e.target.value) || 0) })} />
                    <Button
                      kind="primary"
                      disabled={!modDraft.nameEn || !modDraft.nameAr}
                      onClick={() =>
                        void run(async () => {
                          await appRpc('upsert_modifier', {
                            p_group_id: g.id,
                            p_name_en: modDraft.nameEn,
                            p_name_ar: modDraft.nameAr,
                            p_price_delta_iqd: modDraft.delta,
                          });
                          setModDraft(null);
                        })
                      }
                    >
                      {tr('common.save')}
                    </Button>
                  </div>
                ) : (
                  <Button kind="ghost" onClick={() => setModDraft({ nameEn: '', nameAr: '', delta: 0 })}>
                    + {tr('op.menu.newModifier')}
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {groupDraft && (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBlockStart: '0.4rem' }}>
          <input style={{ ...inputStyle, inlineSize: '9rem' }} dir="ltr" placeholder={tr('op.menu.nameEn')} value={groupDraft.nameEn} onChange={(e) => setGroupDraft({ ...groupDraft, nameEn: e.target.value })} />
          <input style={{ ...inputStyle, inlineSize: '9rem' }} dir="rtl" lang="ar" placeholder={tr('op.menu.nameAr')} value={groupDraft.nameAr} onChange={(e) => setGroupDraft({ ...groupDraft, nameAr: e.target.value })} />
          <Field label={tr('op.menu.minSelect')} style={{ marginBlockEnd: 0 }}>
            <input style={{ ...inputStyle, inlineSize: '4rem' }} dir="ltr" type="number" min={0} value={groupDraft.min} onChange={(e) => setGroupDraft({ ...groupDraft, min: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label={tr('op.menu.maxSelect')} style={{ marginBlockEnd: 0 }}>
            <input style={{ ...inputStyle, inlineSize: '4rem' }} dir="ltr" type="number" min={1} value={groupDraft.max} onChange={(e) => setGroupDraft({ ...groupDraft, max: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
          <Button
            kind="primary"
            disabled={!groupDraft.nameEn || !groupDraft.nameAr}
            onClick={() =>
              void run(async () => {
                await appRpc('upsert_modifier_group', {
                  p_name_en: groupDraft.nameEn,
                  p_name_ar: groupDraft.nameAr,
                  p_min_select: groupDraft.min,
                  p_max_select: groupDraft.max,
                });
                setGroupDraft(null);
              })
            }
          >
            {tr('common.save')}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}
