/**
 * Menu editor (spec 06.23) — categories → items → item form. Reads from the
 * shared `['adminMenu']` query plus the server's `menu_item_availability` for
 * the read-only "blocked by stock" state; every write is an audited `app.*`
 * RPC. Marking an item off for today is temporary (restores next day) and is
 * rendered as such; sold-out stays until switched back.
 *
 * WHAT CHANGED AND WHY
 *
 *  - The right-hand pane is THE editor: an item, or a category. The category
 *    form used to open under the category column, below ~50 rows, so its
 *    pencil appeared to do nothing.
 *  - Search looks through every category and names each row's category.
 *    Searching "Latte" from the wrong category used to find nothing.
 *  - "188 ITEMS WITHOUT COST" was an uppercase eyebrow nobody could act on.
 *    It is a notice row with a button that lists exactly those items.
 *  - Reorder is a within-one-category move, so the arrows only exist on the
 *    plain category view, and the line where they would be says why not.
 *  - Without launchDirectly (a manager), "New item" in a café category is
 *    "Propose a new item", which starts a product release on /protocols: the
 *    server refuses a manager's new café item (ITEM_VIA_RELEASE, #52). An item
 *    still in its release wears "In release" in the list.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { can as hasCapability, useAuth, usePermissions, requiredRoleFor } from '../../../lib/auth';
import { Button, ErrorText, Select } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  Panel,
  PermissionRefusedNotice,
  ResultCount,
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
import { MARK_FG, MARK_SOFT } from '../../ops/OpsVisuals';
import { HighlightDot, MarginChip, Thumb } from './chips';
import { countWithoutCost, defaultPrice, inRelease, itemListView, newItemMode, nextSortOrder, reorderedIds, sortRows } from './menuLogic';
import { CategoryForm } from './CategoryEditor';
import { ItemForm } from './ItemForm';
import { MENU_AVAILABILITY_KEY, fetchStockBlockData, stockBlockFor } from './availability';
import { useBusinessToday } from '../../../lib/settings';
import { patchCachedItems, useAdminMenu, type CategoryRow, type ItemRow } from './useAdminMenu';
import { useNarrow } from './useNarrow';

/** Below this width the three columns leave the item form too thin to use. */
const THREE_COLUMNS_MIN_PX = 1040;

export function MenuEditor() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const can = usePermissions();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const menu = useAdminMenu();
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(rootRef, THREE_COLUMNS_MIN_PX);

  const availabilityQ = useQuery({
    queryKey: MENU_AVAILABILITY_KEY,
    queryFn: fetchStockBlockData,
    refetchInterval: 60_000,
  });
  // unavailable_on is stamped with the BUSINESS date (0041); after midnight the
  // station calendar has moved on and "off today" items read as stock-blocked.
  const today = useBusinessToday();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | 'new' | null>(null);
  const [editCategory, setEditCategory] = useState<CategoryRow | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [noCostOnly, setNoCostOnly] = useState(false);
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

  const openItem = (id: string | 'new', categoryId?: string) =>
    void guardedSelect(() => {
      setEditCategory(null);
      setSelectedItem(id);
      if (categoryId) setSelectedCategory(categoryId);
    });
  const openCategoryForm = (c: CategoryRow | 'new') =>
    void guardedSelect(() => {
      setSelectedItem(null);
      setEditCategory(c);
    });
  const chooseCategory = (id: string) =>
    void guardedSelect(() => {
      setSelectedCategory(id);
      setSelectedItem(null);
      setEditCategory(null);
      setSearch('');
      setNoCostOnly(false);
    });

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
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryRank = useMemo(() => new Map(categories.map((c, i) => [c.id, i])), [categories]);
  const activeCat = selectedCategory ?? categories[0]?.id ?? null;
  const view = useMemo(
    () =>
      data
        ? itemListView(data.items, { categoryId: activeCat, search, noCostOnly, costs: data.costs, categoryRank })
        : { rows: [] as ItemRow[], mode: 'category' as const, reorderable: true },
    [data, activeCat, search, noCostOnly, categoryRank],
  );
  const categoryItems = useMemo(() => (data ? sortRows(data.items.filter((i) => i.category_id === activeCat)) : []), [data, activeCat]);
  const item = data && selectedItem && selectedItem !== 'new' ? (data.items.find((i) => i.id === selectedItem) ?? null) : null;
  const noCost = data ? countWithoutCost(data.items, data.costs) : 0;
  const menuStatus = asyncStatus(menu, (d) => d.categories.length === 0);
  const crossCategory = view.mode !== 'category';
  const addMode = newItemMode(activeCat ? categoryById.get(activeCat)?.kind : undefined, hasCapability(staff?.role, 'launchDirectly'));
  const proposeItem = () => void navigate({ to: '/protocols', search: { start: 'product_release' } });

  const columns: Column<ItemRow>[] = [
    {
      key: 'item',
      header: tr('ws.manager.menu.item'),
      render: (i) => {
        const block = stockBlockFor(i, availabilityQ.data, today);
        const category = crossCategory ? categoryById.get(i.category_id) : undefined;
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
            {/* An inactive item fades its photo only: the Inactive badge says it
                in words, and the name keeps its full contrast. */}
            <span style={{ display: 'inline-flex', opacity: i.is_active ? 1 : 0.55 }}>
              <Thumb path={i.photo_path} size="2rem" />
            </span>
            <span style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontWeight: i.id === selectedItem ? 700 : 500 }}>
                <HighlightDot highlight={i.highlight} />
                <bdi>{pickName(locale, i)}</bdi>
              </span>
              {category && (
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                  <bdi>{pickName(locale, category)}</bdi>
                </span>
              )}
              <span style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
                {/* In release says more than Inactive: it is off until the owner launches it. */}
                {inRelease(i) ? (
                  <StatusBadge size="sm" tone="info" icon="split" label={tr('ws.release.menu.inReleaseBadge')} />
                ) : (
                  !i.is_active && <StatusBadge size="sm" tone="neutral" label={tr('ws.manager.menu.inactive')} />
                )}
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
          <span style={{ display: 'inline-grid', justifyItems: 'end', gap: 'var(--tp-sp-0)' }}>
            <Money amount={price} unit={false} />
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
            label={`${tr('op.menu.soldOutShort')}: ${pickName(locale, i)}`}
            hideLabel
            tone="danger"
          />
        </span>
      ),
    },
    ...(view.reorderable
      ? [
          {
            key: 'order',
            header: '',
            align: 'end',
            width: '5rem',
            render: (i: ItemRow) => {
              const index = categoryItems.findIndex((r) => r.id === i.id);
              return (
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <SortButtons
                    onUp={() => reorder.mutate({ rows: categoryItems, index, direction: 'up' })}
                    onDown={() => reorder.mutate({ rows: categoryItems, index, direction: 'down' })}
                    disabledUp={!can.editMenu || index <= 0 || reorder.isPending}
                    disabledDown={!can.editMenu || index === categoryItems.length - 1 || reorder.isPending}
                  />
                </span>
              );
            },
          } satisfies Column<ItemRow>,
        ]
      : []),
  ];

  const orderNote = view.mode === 'search' ? tr('ws.manager.menu.reorderOffSearch') : view.mode === 'noCost' ? tr('ws.manager.menu.reorderOffNoCost') : tr('ws.manager.menu.reorderHint');

  return (
    <div ref={rootRef}>
      <PageHeader
        title={tr('ws.manager.menu.title')}
        subtitle={tr('ws.manager.menu.lead')}
        actions={
          <>
            <Button icon="plus" disabled={!can.editMenu} onClick={() => openCategoryForm('new')}>
              {tr('ws.manager.menu.newCategory')}
            </Button>
            {addMode === 'propose' ? (
              <Button kind="primary" icon="plus" disabled={!hasCapability(staff?.role, 'startProtocolRelease')} onClick={proposeItem}>
                {tr('ws.release.menu.proposeItem')}
              </Button>
            ) : (
              <Button
                kind="primary"
                icon="plus"
                disabled={!can.editMenu || !activeCat}
                // Items live inside categories, so with none there is nowhere to
                // put one — say so rather than leaving the page's one primary
                // action dead (rulebook 4.3).
                disabledReason={!activeCat ? tr('ws.manager.menu.noCategoriesBody') : undefined}
                onClick={() => openItem('new')}
              >
                {tr('ws.manager.menu.newItem')}
              </Button>
            )}
          </>
        }
      >
        {!can.editMenu && <PermissionRefusedNotice action={tr('ws.manager.menu.newItem')} requiredRole={requiredRoleFor('editMenu')} />}
        {/* Said once, where the button changed: a touch till has no tooltip. */}
        {can.editMenu && addMode === 'propose' && (
          <p style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'baseline', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            <Icon name="split" size={13} style={{ alignSelf: 'center', flex: '0 0 auto' }} />
            <span>{tr('ws.release.menu.proposeHint')}</span>
          </p>
        )}
      </PageHeader>

      <AsyncStateWrapper
        status={menuStatus}
        error={menu.error}
        onRetry={() => void menu.refetch()}
        emptyContent={
          editCategory && data ? (
            <CategoryForm
              key="new"
              category={null}
              taxGroups={data.taxGroups}
              onDone={(id) => {
                setEditCategory(null);
                setSelectedCategory(id);
              }}
              onCancel={() => setEditCategory(null)}
              onDirtyChange={onDirtyChange}
            />
          ) : (
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
          )
        }
      >
        {data && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            {(noCost > 0 || noCostOnly) && (
              <NoCostRow
                tr={tr}
                locale={locale}
                count={noCost}
                active={noCostOnly}
                onShow={() =>
                  void guardedSelect(() => {
                    setNoCostOnly(true);
                    setSelectedItem(null);
                    setEditCategory(null);
                  })
                }
                onBack={() => setNoCostOnly(false)}
              />
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: narrow
                  ? 'minmax(17rem, 22rem) minmax(0, 1fr)'
                  : 'minmax(11rem, 13rem) minmax(20rem, 26rem) minmax(0, 1fr)',
                gap: 'var(--tp-sp-4)',
                alignItems: 'start',
              }}
            >
              {/* categories */}
              {!narrow && (
                <Panel title={tr('ws.manager.menu.categories')} padded={false}>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--tp-sp-1-5)', maxBlockSize: 'calc(100vh - 17rem)', overflowY: 'auto' }}>
                    {categories.map((c) => {
                      const active = c.id === activeCat && !crossCategory;
                      const editing = editCategory !== null && editCategory !== 'new' && editCategory.id === c.id;
                      return (
                        <li
                          key={c.id}
                          className="tp-row"
                          data-clickable="true"
                          data-selected={active ? 'true' : undefined}
                          style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', borderRadius: 'var(--tp-radius-ctl)' }}
                        >
                          <button
                            type="button"
                            aria-current={active || undefined}
                            onClick={() => chooseCategory(c.id)}
                            style={{
                              flex: 1,
                              minInlineSize: 0,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'var(--tp-sp-1)',
                              textAlign: 'start',
                              background: 'transparent',
                              border: 'none',
                              color: c.is_active ? 'inherit' : 'var(--tp-muted-fg)',
                              font: 'inherit',
                              fontWeight: active ? 700 : 500,
                              paddingBlock: 'var(--tp-sp-2)',
                              paddingInline: 'var(--tp-sp-2-5)',
                              cursor: 'pointer',
                            }}
                          >
                            <bdi style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pickName(locale, c)}</bdi>
                            {/* Hidden is said with a glyph AND its name, never dimming alone. */}
                            {!c.is_active && (
                              <span title={tr('op.categories.hidden')} style={{ display: 'inline-flex', flex: '0 0 auto' }}>
                                <Icon name="eyeOff" size={13} label={tr('op.categories.hidden')} />
                              </span>
                            )}
                          </button>
                          <Button
                            kind={editing ? 'soft' : 'ghost'}
                            size="sm"
                            icon="note"
                            disabled={!can.editMenu}
                            onClick={() => openCategoryForm(c)}
                            aria-label={`${tr('ws.manager.menu.editCategory')}: ${pickName(locale, c)}`}
                            title={tr('ws.manager.menu.editCategory')}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              )}

              {/* items */}
              <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
                {narrow && (
                  <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center' }}>
                    <Select
                      aria-label={tr('ws.manager.menu.category')}
                      value={activeCat ?? ''}
                      onChange={(id) => chooseCategory(id)}
                      options={categories.map((c) => ({
                        value: c.id,
                        label: c.is_active ? pickName(locale, c) : `${pickName(locale, c)} (${tr('op.categories.hidden')})`,
                      }))}
                      style={{ flex: 1, minInlineSize: 0 }}
                    />
                    {activeCat && categoryById.get(activeCat) && (
                      <Button
                        icon="note"
                        disabled={!can.editMenu}
                        onClick={() => openCategoryForm(categoryById.get(activeCat)!)}
                        aria-label={tr('ws.manager.menu.editCategory')}
                        title={tr('ws.manager.menu.editCategory')}
                      />
                    )}
                  </div>
                )}
                <SearchField value={search} onChange={setSearch} placeholder={tr('ws.manager.menu.search')} aria-label={tr('op.common.search')} />
                <ErrorText error={availabilityQ.error} />
                <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', display: 'flex', gap: 'var(--tp-sp-1)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Icon name="info" size={12} style={{ alignSelf: 'center' }} />
                  <span style={{ flex: '1 1 12rem' }}>{orderNote}</span>
                  {crossCategory && <ResultCount shown={view.rows.length} total={data.items.length} style={{ fontSize: 'var(--tp-fs-xs)' }} />}
                </p>
                {view.mode === 'category' && categoryItems.length === 0 ? (
                  <EmptyState
                    compact
                    icon="receipt"
                    title={tr('ws.manager.menu.emptyCategory')}
                    // "It appears as soon as it is saved" is not true of a
                    // proposal, and the header already says what one is.
                    body={addMode === 'propose' ? undefined : tr('ws.manager.menu.emptyCategoryBody')}
                    action={
                      addMode === 'propose' ? (
                        <Button kind="primary" size="sm" icon="plus" disabled={!hasCapability(staff?.role, 'startProtocolRelease')} onClick={proposeItem}>
                          {tr('ws.release.menu.proposeItem')}
                        </Button>
                      ) : (
                        <Button kind="primary" size="sm" icon="plus" disabled={!can.editMenu || !activeCat} onClick={() => openItem('new')}>
                          {tr('ws.manager.menu.newItem')}
                        </Button>
                      )
                    }
                  />
                ) : (
                  <DataTable
                    columns={columns}
                    rows={view.rows}
                    rowKey={(i) => i.id}
                    selectedKey={item?.id ?? null}
                    onRowClick={(i) => openItem(i.id, i.category_id)}
                    // Scrolls inside itself, so the editor beside it stays in
                    // view whichever row was clicked.
                    maxBlockSize="calc(100vh - 19rem)"
                    // A bare sentence in a table body told a manager whose search
                    // matched nothing that the category was empty, and offered no
                    // way back (rulebook 9.2).
                    emptyContent={
                      view.mode === 'noCost' && search.trim() === '' ? (
                        <EmptyState compact kind="nothingToDo" title={tr('ws.manager.menu.noCost.none')} />
                      ) : (
                        <EmptyState compact kind="filtered" title={tr('ws.manager.menu.noMatch')} onClearFilters={() => setSearch('')} />
                      )
                    }
                    aria-label={tr('ws.manager.menu.items')}
                  />
                )}
              </div>

              {/* the editor: a category or an item */}
              <div style={{ minInlineSize: 0 }}>
                {editCategory ? (
                  <CategoryForm
                    key={editCategory === 'new' ? 'new' : editCategory.id}
                    category={editCategory === 'new' ? null : editCategory}
                    taxGroups={data.taxGroups}
                    itemCount={editCategory === 'new' ? undefined : data.items.filter((i) => i.category_id === editCategory.id).length}
                    onDone={(id) => {
                      setEditCategory(null);
                      setSelectedCategory(id);
                      setSearch('');
                      setNoCostOnly(false);
                    }}
                    onCancel={() => setEditCategory(null)}
                    onDirtyChange={onDirtyChange}
                  />
                ) : (item || selectedItem === 'new') && activeCat ? (
                  <ItemForm
                    key={item?.id ?? 'new'}
                    item={item}
                    categoryId={activeCat}
                    categoryName={pickName(locale, categoryById.get(item?.category_id ?? activeCat))}
                    categoryKind={categoryById.get(item?.category_id ?? activeCat)?.kind ?? 'cafe'}
                    newSortOrder={nextSortOrder(categoryItems)}
                    groups={data.groups}
                    modifiers={data.modifiers}
                    cost={item ? (data.costs.get(item.id) ?? null) : null}
                    stockBlock={item ? stockBlockFor(item, availabilityQ.data, today) : { blocked: false, ingredients: [] }}
                    today={today}
                    onSaved={(id) => setSelectedItem(id)}
                    onDirtyChange={onDirtyChange}
                  />
                ) : (
                  <EmptyState icon="note" title={tr('ws.manager.menu.pickItem')} />
                )}
              </div>
            </div>
          </div>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

/**
 * The "items without a cost" notice: the count, what it costs the manager, and
 * the one button that lists those items. Neutral until there is something to
 * say; the count wears warn only while it is above zero.
 */
function NoCostRow({
  count,
  active,
  onShow,
  onBack,
  tr,
  locale,
}: {
  count: number;
  active: boolean;
  onShow: () => void;
  onBack: () => void;
  tr: ReturnType<typeof useLocale>['tr'];
  locale: ReturnType<typeof useLocale>['locale'];
}) {
  const tone = count > 0 ? 'warn' : 'success';
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-3)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2)',
        borderRadius: 'var(--tp-radius-panel)',
        border: '1px solid var(--tp-border)',
        background: 'var(--tp-surface)',
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          minInlineSize: '3rem',
          blockSize: '2.25rem',
          paddingInline: 'var(--tp-sp-2)',
          borderRadius: 'var(--tp-radius-ctl)',
          background: MARK_SOFT[tone],
          color: MARK_FG[tone],
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatNumber(count, locale)}
      </span>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
        <strong>{tr('ws.manager.menu.noCost.title')}</strong>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {count > 0 ? tr('ws.manager.menu.noCost.hint') : tr('ws.manager.menu.noCost.none')}
        </span>
      </span>
      {active ? (
        <Button size="sm" icon="x" onClick={onBack}>
          {tr('ws.manager.menu.noCost.back')}
        </Button>
      ) : (
        <Button size="sm" icon="search" onClick={onShow}>
          {tr('ws.manager.menu.noCost.show')}
        </Button>
      )}
    </div>
  );
}

/** Route alias for the spec name. */
export const MenuEditorScreen = MenuEditor;
