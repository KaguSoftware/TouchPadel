/**
 * /admin/suggested — left: category → item picker; right: the item's ordered
 * "goes well with" list (search-add, ▲▼, remove, cap 6, no self). Save =
 * `set_addon_suggestions` (whole-list replace).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Field, Select, Skeleton, card, inputStyle } from '../../../components/ui';
import { SortButtons } from '../../../components/inputs';
import { useToast } from '../../../components/toast';
import { moveInList, sameOrder } from '../addons/addonsLogic';
import { sortRows } from '../menu/menuLogic';
import { SUGGESTION_CAP, canAddSuggestion, suggestionCandidates } from './suggestedLogic';

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

  if (q.isPending) return <Skeleton lines={6} />;
  if (q.error) return <ErrorText error={q.error} />;
  const { categories, items } = q.data;
  const activeCat = categoryId || categories[0]?.id || '';
  const pickable = sortRows(items.filter((i) => i.category_id === activeCat));
  const item = itemId ? items.find((i) => i.id === itemId) ?? null : null;

  return (
    <div>
      <h2 style={{ marginBlockStart: 0 }}>{tr('op.suggested.title')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(14rem, 18rem) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
        <div>
          <Field label={tr('op.suggested.pickItem')}>
            <Select
              value={activeCat}
              onChange={(v) => {
                setCategoryId(v);
                setItemId(null);
              }}
              options={categories.map((c) => ({ value: c.id, label: pickName(locale, c) }))}
            />
          </Field>
          {pickable.length === 0 && <p style={{ color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>{tr('op.common.none')}</p>}
          {pickable.map((i) => (
            <Button
              key={i.id}
              kind={i.id === itemId ? 'primary' : 'default'}
              style={{ display: 'block', inlineSize: '100%', textAlign: 'start', marginBlockStart: '0.3rem', opacity: i.is_active ? 1 : 0.55 }}
              onClick={() => setItemId(i.id)}
            >
              {pickName(locale, i)}
            </Button>
          ))}
        </div>
        <div style={{ minInlineSize: 0 }}>
          {item && <SuggestionList key={item.id} item={item} items={items} suggestions={q.data.suggestions} />}
        </div>
      </div>
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
  const candidates = suggestionCandidates(item.id, list, items, query);

  const save = useMutation({
    mutationFn: () => appRpc('set_addon_suggestions', { p_item_id: item.id, p_suggested_item_ids: list }),
    onSuccess: async () => {
      toast.ok(tr('op.toast.saved'));
      await queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.err(e),
  });

  function add(id: string) {
    const err = canAddSuggestion(item.id, list, id);
    if (err === 'self') {
      toast.err(tr('op.suggested.selfHint'));
      return;
    }
    if (err === 'cap') {
      toast.err(tr('op.suggested.max', { count: SUGGESTION_CAP }));
      return;
    }
    if (err) return;
    setList([...list, id]);
    setQuery('');
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>
          {pickName(locale, item)} · {tr('op.suggested.suggestions')}
        </h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>
          {tr('op.suggested.max', { count: SUGGESTION_CAP })} ({list.length}/{SUGGESTION_CAP})
        </span>
      </div>
      {list.length === 0 && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.suggested.none')}</p>}
      {list.map((id, index) => (
        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBlockStart: '0.4rem' }}>
          <span style={{ inlineSize: '1.5rem', color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }} dir="ltr">
            {index + 1}.
          </span>
          <span style={{ flex: 1 }}>{pickName(locale, byId.get(id)) || id}</span>
          <SortButtons
            onUp={() => setList(moveInList(list, index, 'up'))}
            onDown={() => setList(moveInList(list, index, 'down'))}
            disabledUp={index === 0}
            disabledDown={index === list.length - 1}
          />
          <Button kind="ghost" onClick={() => setList(list.filter((s) => s !== id))}>
            {tr('op.common.remove')}
          </Button>
        </div>
      ))}

      <Field label={tr('op.suggested.add')} style={{ marginBlockStart: '0.8rem' }}>
        <input
          type="search"
          style={inputStyle}
          placeholder={tr('op.menu.search')}
          value={query}
          disabled={list.length >= SUGGESTION_CAP}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      {candidates.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBlockEnd: '0.6rem' }}>
          {candidates.map((c) => (
            <Button key={c.id} onClick={() => add(c.id)}>
              + {pickName(locale, c)}
            </Button>
          ))}
        </div>
      )}
      <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)', marginBlock: '0 0.6rem' }}>{tr('op.suggested.selfHint')}</p>
      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
        <Button disabled={!dirty} onClick={() => setList(saved)}>
          {tr('common.cancel')}
        </Button>
        <Button kind="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {tr('common.save')}
        </Button>
      </div>
    </div>
  );
}
