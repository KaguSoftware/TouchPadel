/**
 * Category form (name EN/AR, tax group, photo, shown or hidden) + the
 * standalone /admin/categories page (ordered list with ▲▼ + the form in the
 * right-hand pane). Photo goes through `set_category_photo` immediately for
 * saved categories; for a new category the upload is held until the first
 * save.
 *
 * The form opens in the right-hand pane on both screens. On the menu editor it
 * used to open at the bottom of the category column, below ~50 rows, so the
 * pencil appeared to do nothing; here it used to be a card list where only the
 * name was (invisibly) clickable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { removeMedia } from '../../../lib/storage';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/auth';
import { Button, ErrorText, Field, Select } from '../../../components/ui';
import {
  AsyncStateWrapper,
  BilingualFieldPair,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { DragHandle } from '../../../components/DragReorder';
import { ImageField } from '../../../components/ImageField';
import { Switch } from '../../../components/Switch';
import { ChevronForward } from '../../../components/icons';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Thumb } from './chips';
import { SectionDialog, type DialogSection } from '../../../components/SectionDialog';
import { NAME_MAX, movedIds, reorderedIds, sortRows } from './menuLogic';
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
  itemCount,
  onDone,
  onDirtyChange,
  onClose,
  canClose,
}: {
  category: CategoryRow | null;
  taxGroups: TaxGroupRow[];
  /** Items in this category, for the line under the title. */
  itemCount?: number;
  onDone: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onClose: () => void;
  canClose?: () => boolean | Promise<boolean>;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const can = usePermissions();
  const readOnly = !can.editMenu;
  const { refresh } = useAdminMenu();
  const [name, setName] = useState({ en: category?.name_en ?? '', ar: category?.name_ar ?? '' });
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

  // The photo saves on its own for a saved category, so it is not part of "unsaved".
  const dirty =
    name.en !== (category?.name_en ?? '') ||
    name.ar !== (category?.name_ar ?? '') ||
    taxGroupId !== (category?.tax_group_id ?? taxGroups[0]?.id ?? '') ||
    isActive !== (category?.is_active ?? true) ||
    (!category && pendingPhoto.current !== null);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useBlocker({
    shouldBlockFn: async () => {
      if (!dirty) return false;
      const leave = await confirm({ title: tr('op.common.unsavedPrompt'), kind: 'danger' });
      return !leave;
    },
    enableBeforeUnload: dirty,
  });

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
        p_name_en: name.en.trim(),
        p_name_ar: name.ar.trim(),
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
      setError(null);
      toast.ok(tr('op.toast.saved'));
      await refresh();
      onDirtyChange?.(false);
      onDone(id);
    },
    onError: (e) => {
      setError(e);
      toast.err(e);
    },
  });

  /** Closing the dialog drops a photo uploaded for a category that was never saved. */
  function close() {
    if (!category && pendingPhoto.current) void removeMedia(pendingPhoto.current);
    onDirtyChange?.(false);
    onClose();
  }

  const namesMissing = name.en.trim() === '' || name.ar.trim() === '';
  const valid = !namesMissing && taxGroupId !== '';

  const sections: DialogSection[] = [
    {
      key: 'details',
      label: tr('ws.manager.menu.form.details'),
      icon: 'note',
      flagged: namesMissing,
      content: (
        <Panel title={tr('ws.manager.menu.form.details')}>
        <BilingualFieldPair label={tr('ws.manager.menu.form.name')} value={name} onChange={setName} required maxLength={NAME_MAX} disabled={readOnly} />
        <Field label={tr('op.menu.taxGroup')} hint={tr('op.categories.taxGroupHint')}>
          <Select
            value={taxGroupId}
            onChange={setTaxGroupId}
            disabled={readOnly}
            options={taxGroups.map((tg) => ({ value: tg.id, label: pickName(locale, tg) }))}
          />
        </Field>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <Switch checked={isActive} disabled={readOnly} onChange={setIsActive} label={tr('op.categories.active')} />
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('op.categories.activeHint')}</p>
        </div>
      </Panel>
      ),
    },
    {
      key: 'photo',
      label: tr('op.categories.photo'),
      icon: 'image',
      content: (
        <Panel title={tr('op.categories.photo')}>
        <div style={{ maxInlineSize: '22rem' }}>
          <ImageField
            label={tr('op.categories.photo')}
            value={photo}
            onChange={onPhotoChange}
            folder="categories"
            ownerId={category?.id ?? draftId.current}
            aspect="16:9"
            disabled={readOnly || photoMutation.isPending}
          />
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('op.categories.photoHint')}</p>
        </div>
      </Panel>
      ),
    },
  ];

  return (
    <SectionDialog
      title={category ? pickName(locale, category) : tr('ws.manager.menu.categoryForm.newTitle')}
      meta={
        category ? (
          <>
            <span>{tr('ws.manager.menu.categoryForm.editTitle')}</span>
            {itemCount !== undefined && <span>· {tr('ws.manager.menu.categoryForm.itemsCount', { count: formatNumber(itemCount, locale) })}</span>}
          </>
        ) : undefined
      }
      sections={sections}
      notice={<ErrorText error={error} style={{ marginBlock: 0 }} />}
      dirty={dirty}
      busy={save.isPending}
      onClose={close}
      canClose={canClose}
      actions={
        <Button
          size="lg"
          kind="primary"
          icon="check"
          busy={save.isPending}
          disabled={readOnly || !valid || !dirty}
          disabledReason={dirty && namesMissing ? tr('ws.manager.disabled.namesRequired') : undefined}
          onClick={() => save.mutate()}
        >
          {tr('ws.kit.actions.save')}
        </Button>
      }
    />
  );
}

/** Reorder categories (optimistic; one `reorder_menu_categories` call, sort_order only). */
export function useCategoryReorder() {
  const { tr } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refresh } = useAdminMenu();

  const mutation = useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
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
  const confirm = useConfirm();
  const can = usePermissions();
  const menu = useAdminMenu();
  const reorder = useCategoryReorder();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  async function guarded(next: string | 'new' | null) {
    if (dirtyRef.current && next !== editing) {
      const leave = await confirm({ title: tr('op.common.unsavedPrompt'), kind: 'danger' });
      if (!leave) return;
      dirtyRef.current = false;
    }
    setEditing(next);
  }

  const data = menu.data;
  const categories = useMemo(() => (data ? sortRows(data.categories) : []), [data]);
  const itemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of data?.items ?? []) counts.set(i.category_id, (counts.get(i.category_id) ?? 0) + 1);
    return counts;
  }, [data]);
  const editingRow = editing && editing !== 'new' ? (categories.find((c) => c.id === editing) ?? null) : null;
  const status = asyncStatus(menu, () => false);

  const columns: Column<CategoryRow>[] = [
    {
      key: 'order',
      header: tr('op.categories.order'),
      align: 'center',
      width: '4.5rem',
      render: (c) => {
        const index = categories.findIndex((r) => r.id === c.id);
        return (
          <DragHandle
            label={`${tr('op.common.moveUp')} / ${tr('op.common.moveDown')}`}
            disabled={!can.editMenu || reorder.isPending}
            onMove={(direction) => reorder.mutate({ ids: reorderedIds(categories, index, direction) })}
          />
        );
      },
    },
    {
      key: 'name',
      header: tr('op.categories.category'),
      truncate: true,
      truncateTitle: (c) => pickName(locale, c),
      render: (c) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
          <Thumb path={c.photo_path} size="2rem" />
          <bdi style={{ fontWeight: c.id === editing ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickName(locale, c)}</bdi>
        </span>
      ),
    },
    {
      key: 'items',
      header: tr('op.categories.items'),
      numeric: true,
      width: '5rem',
      render: (c) => formatNumber(itemCounts.get(c.id) ?? 0, locale),
    },
    {
      key: 'status',
      header: tr('op.categories.status'),
      width: '6.5rem',
      render: (c) =>
        c.is_active ? (
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('op.categories.shown')}</span>
        ) : (
          <StatusBadge size="sm" tone="neutral" label={tr('op.categories.hidden')} />
        ),
    },
    {
      key: 'open',
      header: '',
      width: '2rem',
      align: 'end',
      render: () => <ChevronForward size={14} style={{ color: 'var(--tp-muted-fg)' }} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('op.categories.title')}
        subtitle={tr('op.categories.lead')}
        actions={
          <Button kind="primary" icon="plus" disabled={!can.editMenu} onClick={() => void guarded('new')}>
            {tr('op.menu.newCategory')}
          </Button>
        }
      />
      <AsyncStateWrapper status={status} error={menu.error} onRetry={() => void menu.refetch()}>
        {data && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
            {categories.length === 0 ? (
              <EmptyState icon="grid" title={tr('op.categories.empty')} body={tr('op.categories.emptyBody')} />
            ) : (
              <DataTable
                columns={columns}
                rows={categories}
                rowKey={(c) => c.id}
                selectedKey={editing && editing !== 'new' ? editing : null}
                onRowClick={(c) => void guarded(c.id)}
                onRowDrop={can.editMenu && !reorder.isPending ? (from, to) => reorder.mutate({ ids: movedIds(categories, from, to) }) : undefined}
                // The list scrolls inside itself, so the page keeps its place.
                maxBlockSize="calc(100vh - 13rem)"
                aria-label={tr('op.categories.title')}
              />
            )}
            {editing && (
              <CategoryForm
                key={editing}
                category={editingRow}
                taxGroups={data.taxGroups}
                itemCount={editingRow ? (itemCounts.get(editingRow.id) ?? 0) : undefined}
                onDone={(id) => setEditing(id)}
                onDirtyChange={onDirtyChange}
                onClose={() => {
                  dirtyRef.current = false;
                  setEditing(null);
                }}
                canClose={async () => !dirtyRef.current || confirm({ title: tr('op.common.unsavedPrompt'), kind: 'danger' })}
              />
            )}
          </div>
        )}
      </AsyncStateWrapper>
    </div>
  );
}
