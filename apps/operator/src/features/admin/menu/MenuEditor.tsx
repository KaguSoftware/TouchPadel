/**
 * Menu editor (spec 06.23) — categories → items → item form. Reads from the
 * shared `['adminMenu']` query plus the server's `menu_item_availability` for
 * the read-only "blocked by stock" state; every write is an audited `app.*`
 * RPC. Marking an item off for today is temporary (restores next day) and is
 * rendered as such; sold-out stays until switched back.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../../lib/auth';
import { Button, ErrorText } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  Panel,
  PermissionRefusedNotice,
  SearchField,
  StatusBadge,
  asyncStatus,
  type Column,
} from '../../../components/kit';
import { SortButtons } from '../../../components/inputs';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Icon } from '../../../components/icons';
import { HighlightDot, MarginChip, Thumb } from './chips';
import { countWithoutCost, defaultPrice, matchesSearch, reorderedIds, sortRows } from './menuLogic';
import { CategoryForm } from './CategoryEditor';
import { ItemForm } from './ItemForm';
import { MENU_AVAILABILITY_KEY, fetchStockBlockData, stockBlockFor, todayIso } from './availability';
import { patchCachedItems, useAdminMenu, type CategoryRow, type ItemRow } from './useAdminMenu';

export function MenuEditor() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const can = usePermissions();
  const menu = useAdminMenu();

  const availabilityQ = useQuery({
    queryKey: MENU_AVAILABILITY_KEY,
    queryFn: fetchStockBlockData,
    refetchInterval: 60_000,
  });
  const today = todayIso();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | 'new' | null>(null);
  const [editCategory, setEditCategory] = useState<CategoryRow | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  /** Switching item/category inside the page bypasses the router, so guard here too. */
  async function guardedSelect(action: () => void) {
    if (dirtyRef.current) {
      const leave = await confirm({ title: tr('op.common.unsavedPrompt'), kind: 'danger' });
      if (!leave) return;
      dirtyRef.current = false;
    }
    action();
  }

  const reorder = useMutation({
    mutationFn: async ({ rows, index, direction }: { rows: ItemRow[]; index: number; direction: 'up' | 'down' }) => {
      const ids = reorderedIds(rows, index, direction);
      if (ids.length === 0) return;
      const position = new Map(ids.map((id, i) => [id, i]));
      patchCachedItems(queryClient, (items) =>
        items.map((i) => {
          const pos = position.get(i.id);
          return pos === undefined ? i : { ...i, sort_order: pos };
        }),
      );
      // ONE statement that touches only sort_order (see the H3 note in menuLogic).
      await appRpc('reorder_menu_items', { p_ids: ids });
    },
    onSuccess: () => toast.ok(tr('op.toast.saved')),
    onError: (e) => toast.err(e),
    onSettled: () => menu.refresh(),
  });

  async function setSoldOut(itemId: string, next: boolean) {
    await appRpc('set_item_sold_out', { p_item_id: itemId, p_sold_out: next });
    await menu.refresh();
  }

  const data = menu.data;
  const categories = useMemo(() => (data ? sortRows(data.categories) : []), [data]);
  const activeCat = selectedCategory ?? categories[0]?.id ?? null;
  const categoryItems = useMemo(() => (data ? sortRows(data.items.filter((i) => i.category_id === activeCat)) : []), [data, activeCat]);
  const visibleItems = categoryItems.filter((i) => matchesSearch(i, search));
  const searching = search.trim() !== '';
  const item = data && selectedItem && selectedItem !== 'new' ? (data.items.find((i) => i.id === selectedItem) ?? null) : null;
  const noCost = data ? countWithoutCost(data.items, data.costs) : 0;
  const menuStatus = asyncStatus(menu, (d) => d.categories.length === 0);

  const columns: Column<ItemRow>[] = [
    {
      key: 'item',
      header: tr('ws.manager.menu.item'),
      render: (i) => {
        const block = stockBlockFor(i, availabilityQ.data, today);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minInlineSize: 0, opacity: i.is_active ? 1 : 0.55 }}>
            <Thumb path={i.photo_path} size="2rem" />
            <span style={{ minInlineSize: 0, display: 'grid', gap: '0.15rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: i.id === selectedItem ? 700 : 500 }}>
                <HighlightDot highlight={i.highlight} />
                <bdi>{pickName(locale, i)}</bdi>
              </span>
              <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                {!i.is_active && <StatusBadge size="sm" tone="neutral" label={tr('ws.manager.menu.inactive')} />}
                {i.sold_out && <StatusBadge size="sm" tone="danger" label={tr('ws.manager.menu.soldOut')} />}
                {i.unavailable_on === today && <StatusBadge size="sm" tone="warn" label={tr('ws.manager.menu.offToday')} />}
                {block.blocked && <StatusBadge size="sm" tone="warn" icon="box" label={tr('ws.manager.menu.blocked')} />}
              </span>
            </span>
          </span>
        );
      },
    },
    {
      key: 'price',
      header: tr('ws.manager.menu.price'),
      numeric: true,
      render: (i) => {
        const price = defaultPrice(i.menu_item_variants);
        return (
          <span style={{ display: 'inline-grid', justifyItems: 'end', gap: '0.15rem' }}>
            <Money amount={price} />
            <MarginChip price={price} cost={data?.costs.get(i.id) ?? null} />
          </span>
        );
      },
    },
    {
      key: 'soldOut',
      header: tr('ws.manager.menu.soldOut'),
      align: 'center',
      width: '5rem',
      render: (i) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Switch
            checked={i.sold_out}
            disabled={!can.editMenu}
            onChange={(next) => setSoldOut(i.id, next)}
            label={`${tr('op.menu.soldOutShort')} — ${pickName(locale, i)}`}
            hideLabel
            tone="danger"
          />
        </span>
      ),
    },
    {
      key: 'order',
      header: '',
      align: 'end',
      width: '5rem',
      render: (i) => {
        const index = categoryItems.findIndex((r) => r.id === i.id);
        return (
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <SortButtons
              onUp={() => reorder.mutate({ rows: categoryItems, index, direction: 'up' })}
              onDown={() => reorder.mutate({ rows: categoryItems, index, direction: 'down' })}
              disabledUp={!can.editMenu || searching || index <= 0 || reorder.isPending}
              disabledDown={!can.editMenu || searching || index === categoryItems.length - 1 || reorder.isPending}
            />
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.menu.title')}
        subtitle={tr('ws.manager.menu.lead')}
        eyebrow={noCost > 0 ? tr('op.menu.noCostCount', { count: noCost }) : undefined}
        actions={
          <>
            <Button icon="plus" disabled={!can.editMenu} onClick={() => setEditCategory('new')}>
              {tr('ws.manager.menu.newCategory')}
            </Button>
            <Button kind="primary" icon="plus" disabled={!can.editMenu || !activeCat} onClick={() => void guardedSelect(() => setSelectedItem('new'))}>
              {tr('ws.manager.menu.newItem')}
            </Button>
          </>
        }
      >
        {!can.editMenu && <PermissionRefusedNotice action={tr('ws.manager.menu.newItem')} requiredRole={requiredRoleFor('editMenu')} />}
      </PageHeader>

      <AsyncStateWrapper
        status={menuStatus}
        error={menu.error}
        onRetry={() => void menu.refetch()}
        emptyContent={
          <>
            <EmptyState
              icon="layers"
              title={tr('ws.manager.menu.noCategories')}
              body={tr('ws.manager.menu.noCategoriesBody')}
              action={
                <Button kind="primary" icon="plus" disabled={!can.editMenu} onClick={() => setEditCategory('new')}>
                  {tr('ws.manager.menu.newCategory')}
                </Button>
              }
            />
            {editCategory && data && (
              <CategoryForm
                key="new"
                category={null}
                taxGroups={data.taxGroups}
                onDone={(id) => {
                  setEditCategory(null);
                  setSelectedCategory(id);
                }}
                onCancel={() => setEditCategory(null)}
              />
            )}
          </>
        }
      >
        {data && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(11rem, 13rem) minmax(20rem, 26rem) minmax(0, 1fr)',
              gap: '1rem',
              alignItems: 'start',
            }}
          >
            {/* categories */}
            <Panel title={tr('ws.manager.menu.categories')} padded={false}>
              <ul style={{ listStyle: 'none', margin: 0, padding: '0.35rem' }}>
                {categories.map((c) => {
                  const active = c.id === activeCat;
                  return (
                    <li key={c.id} className="tp-row" data-clickable="true" data-selected={active ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', borderRadius: 'var(--tp-radius-ctl)' }}>
                      <button
                        type="button"
                        aria-current={active || undefined}
                        onClick={() =>
                          void guardedSelect(() => {
                            setSelectedCategory(c.id);
                            setSelectedItem(null);
                            setSearch('');
                          })
                        }
                        style={{
                          flex: 1,
                          minInlineSize: 0,
                          textAlign: 'start',
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          font: 'inherit',
                          fontWeight: active ? 700 : 500,
                          opacity: c.is_active ? 1 : 0.5,
                          paddingBlock: '0.5rem',
                          paddingInline: '0.6rem',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <bdi>{pickName(locale, c)}</bdi>
                      </button>
                      <Button kind="ghost" size="sm" icon="note" onClick={() => setEditCategory(c)} aria-label={`${tr('ws.manager.menu.editCategory')} — ${pickName(locale, c)}`} />
                    </li>
                  );
                })}
              </ul>
              {editCategory && (
                <div style={{ paddingInline: '0.5rem', paddingBlockEnd: '0.5rem' }}>
                  <CategoryForm
                    key={editCategory === 'new' ? 'new' : editCategory.id}
                    category={editCategory === 'new' ? null : editCategory}
                    taxGroups={data.taxGroups}
                    onDone={(id) => {
                      setEditCategory(null);
                      setSelectedCategory(id);
                    }}
                    onCancel={() => setEditCategory(null)}
                  />
                </div>
              )}
            </Panel>

            {/* items */}
            <div style={{ minInlineSize: 0, display: 'grid', gap: '0.5rem' }}>
              <SearchField value={search} onChange={setSearch} placeholder={tr('ws.manager.menu.search')} aria-label={tr('op.common.search')} />
              <ErrorText error={availabilityQ.error} />
              {categoryItems.length === 0 ? (
                <EmptyState
                  compact
                  icon="receipt"
                  title={tr('ws.manager.menu.emptyCategory')}
                  body={tr('ws.manager.menu.emptyCategoryBody')}
                  action={
                    <Button kind="primary" size="sm" icon="plus" disabled={!can.editMenu || !activeCat} onClick={() => void guardedSelect(() => setSelectedItem('new'))}>
                      {tr('ws.manager.menu.newItem')}
                    </Button>
                  }
                />
              ) : (
                <DataTable
                  dense
                  columns={columns}
                  rows={visibleItems}
                  rowKey={(i) => i.id}
                  selectedKey={item?.id ?? null}
                  onRowClick={(i) => void guardedSelect(() => setSelectedItem(i.id))}
                  emptyContent={tr('ws.manager.menu.noMatch')}
                  aria-label={tr('ws.manager.menu.items')}
                />
              )}
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <Icon name="info" size={12} /> {tr('ws.manager.menu.reorderHint')}
              </p>
            </div>

            {/* item form */}
            <div style={{ minInlineSize: 0 }}>
              {(item || selectedItem === 'new') && activeCat ? (
                <ItemForm
                  key={item?.id ?? 'new'}
                  item={item}
                  categoryId={activeCat}
                  groups={data.groups}
                  modifiers={data.modifiers}
                  cost={item ? (data.costs.get(item.id) ?? null) : null}
                  stockBlock={item ? stockBlockFor(item, availabilityQ.data, today) : { blocked: false, ingredients: [] }}
                  onSaved={(id) => setSelectedItem(id)}
                  onDirtyChange={onDirtyChange}
                />
              ) : (
                <EmptyState icon="note" title={tr('ws.manager.menu.pickItem')} />
              )}
            </div>
          </div>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

/** Route alias for the spec name. */
export const MenuEditorScreen = MenuEditor;
