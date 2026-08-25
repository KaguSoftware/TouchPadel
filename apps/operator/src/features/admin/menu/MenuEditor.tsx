/**
 * /admin/menu — three panes: categories → items (search, thumbnails, chips,
 * sold-out switch, ▲▼ reorder) → item form. Reads from the shared
 * `['adminMenu']` query; every write is an audited `app.*` RPC.
 */
import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Skeleton, card, inputStyle } from '../../../components/ui';
import { SortButtons } from '../../../components/inputs';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Chip, HighlightDot, MarginChip, Thumb } from './chips';
import { countWithoutCost, defaultPrice, matchesSearch, reorderPlan, sortRows } from './menuLogic';
import { itemUpsertArgs } from './photo';
import { CategoryForm } from './CategoryEditor';
import { ItemForm } from './ItemForm';
import { patchCachedItems, useAdminMenu, type CategoryRow, type ItemRow } from './useAdminMenu';

export function MenuEditor() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const menu = useAdminMenu();

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
      const plan = reorderPlan(rows, index, direction);
      if (plan.length === 0) return;
      const byId = new Map(rows.map((r) => [r.id, r]));
      patchCachedItems(queryClient, (items) =>
        items.map((i) => {
          const u = plan.find((p) => p.id === i.id);
          return u ? { ...i, sort_order: u.sort_order } : i;
        }),
      );
      for (const u of plan) {
        await appRpc('upsert_menu_item', itemUpsertArgs(byId.get(u.id)!, { sort_order: u.sort_order }));
      }
    },
    onSuccess: () => toast.ok(tr('op.toast.saved')),
    onError: (e) => toast.err(e),
    onSettled: () => menu.refresh(),
  });

  async function setSoldOut(itemId: string, next: boolean) {
    await appRpc('set_item_sold_out', { p_item_id: itemId, p_sold_out: next });
    await menu.refresh();
  }

  if (menu.isPending) return <Skeleton lines={6} />;
  if (menu.error) return <ErrorText error={menu.error} />;
  const data = menu.data;

  const categories = sortRows(data.categories);
  const activeCat = selectedCategory ?? categories[0]?.id ?? null;
  const categoryItems = sortRows(data.items.filter((i) => i.category_id === activeCat));
  const visibleItems = categoryItems.filter((i) => matchesSearch(i, search));
  const searching = search.trim() !== '';
  const item =
    selectedItem && selectedItem !== 'new' ? data.items.find((i) => i.id === selectedItem) ?? null : null;
  const noCost = countWithoutCost(data.items, data.costs);

  return (
    <div>
      <div style={{ marginBlockEnd: '0.8rem' }}>
        <h2 style={{ margin: 0 }}>{tr('op.adminNav.menu')}</h2>
        {noCost > 0 && (
          <p style={{ margin: 0, marginBlockStart: '0.2rem', fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>
            {tr('op.menu.noCostCount', { count: noCost })}
          </p>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(11rem, 13rem) minmax(18rem, 22rem) minmax(0, 1fr)',
          gap: '0.8rem',
          alignItems: 'start',
        }}
      >
        {/* categories */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{tr('op.menu.categories')}</h3>
            <Button onClick={() => setEditCategory('new')} aria-label={tr('op.menu.newCategory')}>
              +
            </Button>
          </div>
          {categories.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: '0.2rem', marginBlockStart: '0.3rem' }}>
              <Button
                kind={c.id === activeCat ? 'primary' : 'default'}
                style={{ flex: 1, textAlign: 'start', opacity: c.is_active ? 1 : 0.5, minInlineSize: 0 }}
                onClick={() =>
                  void guardedSelect(() => {
                    setSelectedCategory(c.id);
                    setSelectedItem(null);
                    setSearch('');
                  })
                }
              >
                {pickName(locale, c)}
              </Button>
              <Button kind="ghost" onClick={() => setEditCategory(c)} aria-label={tr('op.common.edit')}>
                ✎
              </Button>
            </div>
          ))}
          {editCategory && (
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
          )}
        </div>

        {/* items */}
        <div style={{ minInlineSize: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>{tr('op.menu.items')}</h3>
            <Button
              onClick={() => void guardedSelect(() => setSelectedItem('new'))}
              disabled={!activeCat}
              aria-label={tr('op.menu.newItem')}
            >
              +
            </Button>
          </div>
          <input
            type="search"
            style={{ ...inputStyle, marginBlockStart: '0.4rem' }}
            placeholder={tr('op.menu.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={tr('op.common.search')}
          />
          {visibleItems.length === 0 && (
            <p style={{ color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>{tr('op.common.none')}</p>
          )}
          {visibleItems.map((i) => {
            const index = categoryItems.findIndex((r) => r.id === i.id);
            const price = defaultPrice(i.menu_item_variants);
            const selected = i.id === selectedItem;
            return (
              <div
                key={i.id}
                style={{
                  ...card,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBlockStart: '0.35rem',
                  paddingBlock: '0.4rem',
                  paddingInline: '0.5rem',
                  borderColor: selected ? 'var(--tp-accent)' : 'var(--tp-border)',
                  opacity: i.is_active ? 1 : 0.55,
                }}
              >
                <button
                  type="button"
                  onClick={() => void guardedSelect(() => setSelectedItem(i.id))}
                  aria-current={selected || undefined}
                  style={{
                    flex: 1,
                    minInlineSize: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: 'inherit',
                    font: 'inherit',
                    textAlign: 'start',
                    cursor: 'pointer',
                  }}
                >
                  <Thumb path={i.photo_path} />
                  <span style={{ minInlineSize: 0, display: 'grid', gap: '0.15rem' }}>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontWeight: selected ? 700 : 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <HighlightDot highlight={i.highlight} />
                      {pickName(locale, i)}
                    </span>
                    <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      {price !== null && (
                        <span dir="ltr" style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>
                          {formatIQD(price, locale)}
                        </span>
                      )}
                      <MarginChip price={price} cost={data.costs.get(i.id) ?? null} />
                      {i.sold_out && <Chip tone="danger">{tr('op.menu.soldOutShort')}</Chip>}
                      {i.unavailable_on && <Chip tone="ok">{tr('op.menu.unavailableToday')}</Chip>}
                    </span>
                  </span>
                </button>
                <Switch
                  checked={i.sold_out}
                  onChange={(next) => setSoldOut(i.id, next)}
                  label={tr('op.menu.soldOutShort')}
                  hideLabel
                  tone="danger"
                />
                <SortButtons
                  onUp={() => reorder.mutate({ rows: categoryItems, index, direction: 'up' })}
                  onDown={() => reorder.mutate({ rows: categoryItems, index, direction: 'down' })}
                  disabledUp={searching || index <= 0 || reorder.isPending}
                  disabledDown={searching || index === categoryItems.length - 1 || reorder.isPending}
                />
              </div>
            );
          })}
        </div>

        {/* item form */}
        <div style={{ minInlineSize: 0 }}>
          {(item || selectedItem === 'new') && activeCat && (
            <ItemForm
              key={item?.id ?? 'new'}
              item={item}
              categoryId={activeCat}
              groups={data.groups}
              modifiers={data.modifiers}
              cost={item ? data.costs.get(item.id) ?? null : null}
              onSaved={(id) => setSelectedItem(id)}
              onDirtyChange={onDirtyChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
