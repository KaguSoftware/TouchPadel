/**
 * /admin/suggested — left: category → item picker; right: the item's ordered
 * "goes well with" list (search-add, ▲▼, remove, cap 6, no self). Save =
 * `set_addon_suggestions` (whole-list replace).
 *
 * The screen used to be a bare heading, a category dropdown and a column of
 * buttons: nothing said what a suggestion IS (the guest menu's "Goes well
 * with" row), nothing said which items already had some, and nothing appeared
 * on the right until an item was clicked. It now leads with what guests see,
 * the item list says how many suggestions each item carries, and the empty
 * side says what to do.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/auth';
import { Button, Field, Select, inputStyle } from '../../../components/ui';
import { AsyncStateWrapper, EmptyState, MessagePresenter, PageHeader, Panel, StatusBadge, asyncStatus } from '../../../components/kit';
import { ChevronForward } from '../../../components/icons';
import { SortButtons } from '../../../components/inputs';
import { useToast } from '../../../components/toast';
import { moveInList, sameOrder } from '../addons/addonsLogic';
import { sortRows } from '../menu/menuLogic';
import { SUGGESTION_CAP, canAddSuggestion, suggestionCandidates, suggestionCounts } from './suggestedLogic';

const KEY = ['adminSuggested'] as const;

interface CategoryRow {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
}
interface ItemRow {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  sort_order: number;
}
interface SuggestionRow {
  item_id: string;
  suggested_item_id: string;
  sort_order: number;
}

async function fetchSuggested() {
  const [cats, items, sugg] = await Promise.all([
    supabase.from('menu_categories').select('id, name_en, name_ar, sort_order').order('sort_order'),
    supabase.from('menu_items').select('id, category_id, name_en, name_ar, is_active, sort_order').order('sort_order'),
    supabase.from('addon_suggestions').select('item_id, suggested_item_id, sort_order'),
  ]);
  for (const r of [cats, items, sugg]) if (r.error) throw r.error;
  return {
    categories: (cats.data ?? []) as CategoryRow[],
    items: (items.data ?? []) as ItemRow[],
    suggestions: (sugg.data ?? []) as SuggestionRow[],
  };
}

export function SuggestedEditor() {
  const { tr, locale } = useLocale();
  const q = useQuery({ queryKey: KEY, queryFn: fetchSuggested });
  const [categoryId, setCategoryId] = useState<string>('');
  const [itemId, setItemId] = useState<string | null>(null);
  const status = asyncStatus(q, () => false);

  return (
    <div>
      <PageHeader title={tr('op.suggested.title')} subtitle={tr('op.suggested.lead')} />
      <AsyncStateWrapper status={status} error={q.error} onRetry={() => void q.refetch()}>
        {q.data &&
          (() => {
            const { categories, items, suggestions } = q.data;
            const activeCat = categoryId || categories[0]?.id || '';
            const pickable = sortRows(items.filter((i) => i.category_id === activeCat));
            const counts = suggestionCounts(suggestions);
            const item = itemId ? (items.find((i) => i.id === itemId) ?? null) : null;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(16rem, 22rem) minmax(0, 1fr)', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
                <Panel title={tr('op.suggested.pickItem')} padded={false}>
                  <div style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)' }}>
                    <Field label={tr('op.suggested.category')} style={{ marginBlockEnd: 0 }}>
                      <Select
                        value={activeCat}
                        onChange={(v) => {
                          setCategoryId(v);
                          setItemId(null);
                        }}
                        options={categories.map((c) => ({ value: c.id, label: pickName(locale, c) }))}
                      />
                    </Field>
                  </div>
                  {pickable.length === 0 ? (
                    <div style={{ padding: 'var(--tp-sp-2)' }}>
                      <EmptyState compact titleAs="h4" icon="layers" title={tr('op.suggested.noItems')} />
                    </div>
                  ) : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--tp-sp-1-5)', display: 'grid', gap: 'var(--tp-sp-0)', maxBlockSize: 'calc(100vh - 20rem)', overflowY: 'auto' }}>
                      {pickable.map((i) => {
                        const selected = i.id === itemId;
                        const count = counts.get(i.id) ?? 0;
                        return (
                          <li key={i.id} className="tp-row" data-clickable="true" data-selected={selected ? 'true' : undefined} style={{ borderRadius: 'var(--tp-radius-ctl)' }}>
                            <button
                              type="button"
                              aria-current={selected || undefined}
                              onClick={() => setItemId(i.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--tp-sp-2)',
                                inlineSize: '100%',
                                textAlign: 'start',
                                background: 'transparent',
                                border: 'none',
                                color: 'inherit',
                                font: 'inherit',
                                cursor: 'pointer',
                                paddingBlock: 'var(--tp-sp-1-5)',
                                paddingInline: 'var(--tp-sp-2)',
                              }}
                            >
                              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0, flex: 1 }}>
                                <bdi style={{ fontWeight: selected ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: i.is_active ? undefined : 'var(--tp-muted-fg)' }}>
                                  {pickName(locale, i)}
                                </bdi>
                                <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                                  {count > 0 ? tr('op.suggested.countLabel', { count: formatNumber(count, locale) }) : tr('op.suggested.none')}
                                  {!i.is_active && <StatusBadge size="sm" dot={false} tone="neutral" label={tr('op.suggested.hidden')} />}
                                </span>
                              </span>
                              <ChevronForward size={14} style={{ color: 'var(--tp-muted-fg)', flex: '0 0 auto' }} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
                <div style={{ minInlineSize: 0 }}>
                  {item ? (
                    <SuggestionList key={item.id} item={item} items={items} suggestions={suggestions} />
                  ) : (
                    <EmptyState icon="spark" title={tr('op.suggested.pick')} />
                  )}
                </div>
              </div>
            );
          })()}
      </AsyncStateWrapper>
    </div>
  );
}

function SuggestionList({
  item,
  items,
  suggestions,
}: {
  item: ItemRow;
  items: ItemRow[];
  suggestions: SuggestionRow[];
}) {
  const { tr, locale } = useLocale();
  const can = usePermissions();
  const toast = useToast();
  const queryClient = useQueryClient();
  const saved = suggestions
    .filter((s) => s.item_id === item.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => s.suggested_item_id);
  const [list, setList] = useState<string[]>(saved);
  const [query, setQuery] = useState('');
  const byId = new Map(items.map((i) => [i.id, i]));
  const dirty = !sameOrder(saved, list);
  const full = list.length >= SUGGESTION_CAP;
  const candidates = suggestionCandidates(item.id, list, items, query);

  const save = useMutation({
    mutationFn: () => appRpc('set_addon_suggestions', { p_item_id: item.id, p_suggested_item_ids: list }),
    onSuccess: async () => {
      toast.ok(tr('op.toast.saved'));
      await queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.err(e),
  });

  // The search never offers the item itself or one already chosen, and it is
  // disabled when the list is full, so these refusals only guard a race.
  function add(id: string) {
    if (canAddSuggestion(item.id, list, id) !== null) return;
    setList([...list, id]);
    setQuery('');
  }

  return (
    <Panel
      title={
        <span>
          <bdi>{pickName(locale, item)}</bdi> · {tr('op.suggested.suggestions')}
        </span>
      }
      actions={
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
          {tr('op.suggested.count', { count: formatNumber(list.length, locale), max: formatNumber(SUGGESTION_CAP, locale) })}
        </span>
      }
    >
      {list.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)', margin: 0 }}>{tr('op.suggested.none')}</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {list.map((id, index) => (
            <li key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-1)', borderBlockEnd: '1px solid var(--tp-border)' }}>
              <span style={{ inlineSize: '1.5rem', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(index + 1, locale)}</span>
              <bdi style={{ flex: 1, minInlineSize: 0 }}>{pickName(locale, byId.get(id)) || id}</bdi>
              <SortButtons
                onUp={() => setList(moveInList(list, index, 'up'))}
                onDown={() => setList(moveInList(list, index, 'down'))}
                disabledUp={index === 0 || !can.editMenu}
                disabledDown={index === list.length - 1 || !can.editMenu}
              />
              <Button kind="ghost" size="sm" icon="x" disabled={!can.editMenu} onClick={() => setList(list.filter((s) => s !== id))}>
                {tr('op.common.remove')}
              </Button>
            </li>
          ))}
        </ol>
      )}

      {full ? (
        <MessagePresenter tone="info" message={tr('op.suggested.full', { max: formatNumber(SUGGESTION_CAP, locale) })} style={{ marginBlockStart: 'var(--tp-sp-3)' }} />
      ) : (
        <Field label={tr('op.suggested.add')} style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <input
            type="search"
            style={inputStyle}
            placeholder={tr('op.menu.search')}
            value={query}
            disabled={!can.editMenu}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
      )}
      {!full && candidates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1)', marginBlockEnd: 'var(--tp-sp-2-5)' }}>
          {candidates.map((c) => (
            <Button key={c.id} size="sm" icon="plus" onClick={() => add(c.id)}>
              <bdi>{pickName(locale, c)}</bdi>
            </Button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'flex-end', marginBlockStart: 'var(--tp-sp-3)' }}>
        <Button kind="ghost" disabled={!dirty || save.isPending} onClick={() => setList(saved)}>
          {tr('op.suggested.discard')}
        </Button>
        <Button
          kind="primary"
          icon="check"
          disabled={!dirty || save.isPending || !can.editMenu}
          disabledReason={!dirty ? tr('ws.manager.disabled.noChanges') : undefined}
          busy={save.isPending}
          onClick={() => save.mutate()}
        >
          {tr('common.save')}
        </Button>
      </div>
    </Panel>
  );
}
