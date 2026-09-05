/**
 * Category form (name EN/AR, tax group, photo, active) + the standalone
 * /admin/categories page (ordered list with ▲▼ + inline form). Photo goes
 * through `set_category_photo` immediately for saved categories; for a new
 * category the upload is held until the first save.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { removeMedia } from '../../../lib/storage';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Field, Select, Skeleton, card } from '../../../components/ui';
import { BilingualFields, SortButtons } from '../../../components/inputs';
import { ImageField } from '../../../components/ImageField';
import { useToast } from '../../../components/toast';
import { Thumb } from './chips';
import { NAME_MAX, reorderedIds, sortRows } from './menuLogic';
import { savePhoto } from './photo';
import {
  patchCachedCategories,
  useAdminMenu,
  type CategoryRow,
  type TaxGroupRow,
} from './useAdminMenu';

export function CategoryForm({
  category,
  taxGroups,
  onDone,
  onCancel,
}: {
  category: CategoryRow | null;
  taxGroups: TaxGroupRow[];
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const { refresh } = useAdminMenu();
  const [nameEn, setNameEn] = useState(category?.name_en ?? '');
  const [nameAr, setNameAr] = useState(category?.name_ar ?? '');
  const [taxGroupId, setTaxGroupId] = useState(category?.tax_group_id ?? taxGroups[0]?.id ?? '');
  const [isActive, setIsActive] = useState(category?.is_active ?? true);
  const [photo, setPhoto] = useState<string | null>(category?.photo_path ?? null);
  const [error, setError] = useState<unknown>(null);
  // New categories get a draft owner id so uploads have a folder before the row exists.
  const draftId = useRef(crypto.randomUUID());
  const pendingPhoto = useRef<string | null>(null);

  useEffect(() => {
    if (category) setPhoto(category.photo_path);
  }, [category]);

  const photoMutation = useMutation({
    mutationFn: ({ next, previous }: { next: string | null; previous: string | null }) =>
      savePhoto('category', category!.id, next, previous),
    onSuccess: async () => {
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
    onError: (e, { previous }) => {
      setPhoto(previous);
      toast.err(e);
    },
  });

  function onPhotoChange(next: string | null) {
    const previous = photo;
    setPhoto(next);
    if (category) {
      photoMutation.mutate({ next, previous });
    } else {
      if (pendingPhoto.current && pendingPhoto.current !== next) void removeMedia(pendingPhoto.current);
      pendingPhoto.current = next;
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const id = await appRpc<string>('upsert_menu_category', {
        p_id: category?.id ?? null,
        p_name_en: nameEn.trim(),
        p_name_ar: nameAr.trim(),
        p_tax_group_id: taxGroupId,
        p_sort_order: category?.sort_order ?? 0,
        p_is_active: isActive,
      });
      if (!category && pendingPhoto.current) {
        await savePhoto('category', id, pendingPhoto.current, null);
        pendingPhoto.current = null;
      }
      return id;
    },
    onSuccess: async (id) => {
      toast.ok(tr('op.toast.saved'));
      await refresh();
      onDone(id);
    },
    onError: (e) => {
      setError(e);
      toast.err(e);
    },
  });

  function cancel() {
    if (!category && pendingPhoto.current) void removeMedia(pendingPhoto.current);
    onCancel();
  }

  const valid = nameEn.trim() !== '' && nameAr.trim() !== '' && taxGroupId !== '';

  return (
    <div style={{ ...card, marginBlockStart: 'var(--tp-sp-2)' }}>
      <h4 style={{ marginBlockStart: 0 }}>
        {category ? pickName(locale, category) : tr('op.menu.newCategory')}
      </h4>
      <BilingualFields
        labelEn={tr('op.menu.nameEn')}
        labelAr={tr('op.menu.nameAr')}
        en={nameEn}
        ar={nameAr}
        onEn={setNameEn}
        onAr={setNameAr}
        maxLength={NAME_MAX}
      />
      <Field label={tr('op.menu.taxGroup')}>
        <Select
          value={taxGroupId}
          onChange={setTaxGroupId}
          options={taxGroups.map((tg) => ({ value: tg.id, label: pickName(locale, tg) }))}
        />
      </Field>
      <ImageField
        label={tr('op.categories.photo')}
        value={photo}
        onChange={onPhotoChange}
        folder="categories"
        ownerId={category?.id ?? draftId.current}
        aspect="16:9"
        disabled={photoMutation.isPending}
      />
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlock: '0 0.6rem' }}>
        {tr('op.categories.photoHint')}
      </p>
      <label style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', marginBlockEnd: 'var(--tp-sp-2-5)', alignItems: 'center' }}>
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        {tr('op.categories.active')}
      </label>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'flex-end' }}>
        <Button onClick={cancel}>{tr('common.cancel')}</Button>
        <Button kind="primary" disabled={save.isPending || !valid} onClick={() => save.mutate()}>
          {tr('common.save')}
        </Button>
      </div>
    </div>
  );
}

/** Reorder categories (optimistic; two `upsert_menu_category` calls, or a renumber on ties). */
export function useCategoryReorder() {
  const { tr } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, refresh } = useAdminMenu();

  const mutation = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: 'up' | 'down' }) => {
      const rows = data?.categories ?? [];
      const ids = reorderedIds(rows, index, direction);
      if (ids.length === 0) return;
      const position = new Map(ids.map((id, i) => [id, i]));
      patchCachedCategories(queryClient, (cats) =>
        cats.map((c) => {
          const pos = position.get(c.id);
          return pos === undefined ? c : { ...c, sort_order: pos };
        }),
      );
      // See MenuEditor: one statement, sort_order only.
      await appRpc('reorder_menu_categories', { p_ids: ids });
    },
    onSuccess: () => toast.ok(tr('op.toast.saved')),
    onError: (e) => toast.err(e),
    onSettled: () => refresh(),
  });
  return mutation;
}

/** Standalone /admin/categories page. */
export function CategoryEditor() {
  const { tr, locale } = useLocale();
  const { data, isPending, error } = useAdminMenu();
  const reorder = useCategoryReorder();
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  if (isPending) return <Skeleton lines={5} />;
  if (error) return <ErrorText error={error} />;
  const categories = sortRows(data.categories);
  const editingRow = editing && editing !== 'new' ? categories.find((c) => c.id === editing) ?? null : null;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBlockEnd: 'var(--tp-sp-2-5)',
        }}
      >
        <h2 style={{ margin: 0 }}>{tr('op.categories.title')}</h2>
        <Button kind="primary" onClick={() => setEditing('new')}>
          {tr('op.menu.newCategory')}
        </Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(16rem, 24rem) 1fr', gap: 'var(--tp-sp-4)' }}>
        <div>
          {categories.map((c, index) => (
            <div
              key={c.id}
              style={{
                ...card,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-2)',
                marginBlockEnd: 'var(--tp-sp-1-5)',
                opacity: c.is_active ? 1 : 0.55,
                borderColor: editing === c.id ? 'var(--tp-accent)' : 'var(--tp-border)',
              }}
            >
              <Thumb path={c.photo_path} />
              <button
                type="button"
                onClick={() => setEditing(c.id)}
                style={{
                  flex: 1,
                  textAlign: 'start',
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  font: 'inherit',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {pickName(locale, c)}
              </button>
              <SortButtons
                onUp={() => reorder.mutate({ index, direction: 'up' })}
                onDown={() => reorder.mutate({ index, direction: 'down' })}
                disabledUp={index === 0 || reorder.isPending}
                disabledDown={index === categories.length - 1 || reorder.isPending}
              />
            </div>
          ))}
          {categories.length === 0 && (
            <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.common.none')}</p>
          )}
        </div>
        <div>
          {editing && (
            <CategoryForm
              key={editing}
              category={editingRow}
              taxGroups={data.taxGroups}
              onDone={(id) => setEditing(id)}
              onCancel={() => setEditing(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
