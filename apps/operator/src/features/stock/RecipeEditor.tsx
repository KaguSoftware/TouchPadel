/**
 * Recipe editor (spec 06.31 / 06.32) — the bill of materials per SIZE,
 * modifier-aware lines and sub-recipes. One app.set_recipe call per
 * attachment point — atomic replace, cycle-guarded. Auto-deduction is wired
 * server-side (0018); attaching lines here is what makes it actually consume.
 *
 * The VariantQuantityMatrix is the point of the screen: for the item of the
 * selected size it lists every size and whether it carries a recipe. A size
 * without one renders `incomplete` — it deducts nothing and is the single
 * largest cause of variance noise.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { DataTable, MessagePresenter, PageHeader, Panel, SegmentedControl, StatusBadge, type Column } from '../../components/kit';
import { SK, fetchIngredients } from './stockKeys';

type TargetKind = 'variant' | 'modifier' | 'output';

interface TargetOption {
  id: string;
  label: string;
  /** For variants: the parent item id, so the matrix can list siblings. */
  itemId?: string;
  variantName?: string;
}

interface RecipeLineDraft {
  key: string;
  ingredientId: string;
  qty: string;
}

interface RecipeLineRow {
  variant_id: string | null;
  ingredient_id: string;
  qty: number;
}

const NO_OPTIONS: TargetOption[] = [];

export function RecipeEditor() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<TargetKind>('variant');
  const [targetId, setTargetId] = useState('');
  const [lines, setLines] = useState<RecipeLineDraft[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const ingredients = (ingredientsQ.data ?? []).filter((i) => i.is_active);

  const optionsQ = useQuery({
    queryKey: ['stock', 'recipeTargets', target, locale],
    queryFn: async (): Promise<TargetOption[]> => {
      if (target === 'variant') {
        const { data, error: err } = await supabase
          .from('menu_item_variants')
          .select('id, item_id, name_en, name_ar, sort_order, item:menu_items(name_en, name_ar)')
          .order('item_id')
          .order('sort_order');
        if (err) throw err;
        return (
          data as unknown as {
            id: string;
            item_id: string;
            name_en: string;
            name_ar: string;
            item: { name_en: string; name_ar: string } | null;
          }[]
        ).map((v) => ({
          id: v.id,
          itemId: v.item_id,
          variantName: pickName(locale, v),
          label: `${v.item ? pickName(locale, v.item) : '?'} — ${pickName(locale, v)}`,
        }));
      }
      if (target === 'modifier') {
        const { data, error: err } = await supabase.from('modifiers').select('id, name_en, name_ar').order('name_en');
        if (err) throw err;
        return (data as { id: string; name_en: string; name_ar: string }[]).map((m) => ({ id: m.id, label: pickName(locale, m) }));
      }
      const { data, error: err } = await supabase.from('ingredients').select('id, name_en, name_ar').eq('kind', 'prepared').order('name_en');
      if (err) throw err;
      return (data as { id: string; name_en: string; name_ar: string }[]).map((i) => ({ id: i.id, label: pickName(locale, i) }));
    },
  });

  // Every variant recipe line — feeds the matrix (which sizes carry a recipe).
  const variantLinesQ = useQuery({
    queryKey: ['stock', 'recipes', 'variantLines'],
    enabled: target === 'variant',
    queryFn: async (): Promise<RecipeLineRow[]> => {
      const { data, error: err } = await supabase.from('recipe_lines').select('variant_id, ingredient_id, qty').not('variant_id', 'is', null);
      if (err) throw err;
      return data as RecipeLineRow[];
    },
  });

  const linesQ = useQuery({
    queryKey: SK.recipes(target, targetId),
    enabled: !!targetId,
    queryFn: async () => {
      const col = target === 'variant' ? 'variant_id' : target === 'modifier' ? 'modifier_id' : 'output_ingredient_id';
      const { data, error: err } = await supabase.from('recipe_lines').select('ingredient_id, qty').eq(col, targetId);
      if (err) throw err;
      return data as { ingredient_id: string; qty: number }[];
    },
  });

  // Hydrate the draft when a target's lines land (once per selection).
  if (targetId && linesQ.isSuccess && loadedFor !== `${target}:${targetId}`) {
    setLoadedFor(`${target}:${targetId}`);
    setLines(linesQ.data.map((l) => ({ key: crypto.randomUUID(), ingredientId: l.ingredient_id, qty: String(l.qty) })));
  }

  const validLines = lines.filter((l) => l.ingredientId && Number(l.qty) > 0);
  const savedLines = linesQ.data ?? [];
  const dirty =
    !!targetId &&
    JSON.stringify(validLines.map((l) => [l.ingredientId, Number(l.qty)]).sort()) !== JSON.stringify(savedLines.map((l) => [l.ingredient_id, l.qty]).sort());

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('set_recipe', {
        p_target: target,
        p_target_id: targetId,
        p_lines: validLines.map((l) => ({ ingredient_id: l.ingredientId, qty: Number(l.qty) })),
      });
      toast.ok(tr('op.toast.saved'));
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function select(kind: TargetKind, id: string) {
    setTarget(kind);
    setTargetId(id);
    setLines([]);
    setLoadedFor(null);
    setError(null);
  }

  const options = optionsQ.data ?? NO_OPTIONS;
  const selectedOption = options.find((o) => o.id === targetId);
  const siblings = useMemo(
    () => (target === 'variant' && selectedOption?.itemId ? options.filter((o) => o.itemId === selectedOption.itemId) : []),
    [target, selectedOption, options],
  );
  const lineCountByVariant = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of variantLinesQ.data ?? []) if (l.variant_id) m.set(l.variant_id, (m.get(l.variant_id) ?? 0) + 1);
    return m;
  }, [variantLinesQ.data]);
  const incompleteCount = siblings.filter((s) => !(lineCountByVariant.get(s.id) ?? 0)).length;

  const matrixColumns: Column<TargetOption>[] = [
    { key: 'size', header: tr('op.stock.target_variant'), render: (v) => <bdi style={{ fontWeight: v.id === targetId ? 700 : 500 }}>{v.variantName ?? v.label}</bdi> },
    {
      key: 'lines',
      header: tr('op.stock.qtyPerUnit'),
      numeric: true,
      render: (v) => {
        const n = lineCountByVariant.get(v.id) ?? 0;
        return n === 0 ? <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.recipes.noLines')}</span> : tr('ws.manager.stock.recipes.lines', { count: formatNumber(n, locale) });
      },
    },
    {
      key: 'status',
      header: tr('ws.manager.stock.overview.status'),
      render: (v) =>
        (lineCountByVariant.get(v.id) ?? 0) > 0 ? (
          <StatusBadge size="sm" tone="success" label={tr('ws.manager.stock.recipes.complete')} />
        ) : (
          <StatusBadge size="sm" tone="danger" icon="alert" label={tr('ws.manager.stock.recipes.incomplete')} />
        ),
    },
    {
      key: 'edit',
      header: '',
      align: 'end',
      render: (v) =>
        v.id === targetId ? (
          <StatusBadge size="sm" tone="accent" label={tr('ws.manager.stock.recipes.editing')} />
        ) : (
          <Button size="sm" kind="ghost" onClick={() => select('variant', v.id)}>
            {tr('ws.manager.stock.recipes.selectSize')}
          </Button>
        ),
    },
  ];

  return (
    <div style={{ maxInlineSize: '64rem' }}>
      <PageHeader
        title={tr('op.stock.recipesTitle')}
        subtitle={tr('op.stock.recipesHint')}
        actions={dirty ? <StatusBadge tone="warn" label={tr('ws.kit.actions.unsaved')} /> : undefined}
      />

      <Panel>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label={tr('op.stock.kind')} style={{ marginBlockEnd: 0 }}>
            <SegmentedControl<TargetKind>
              value={target}
              onChange={(t) => select(t, '')}
              options={[
                { value: 'variant', label: tr('op.stock.target_variant') },
                { value: 'modifier', label: tr('op.stock.target_modifier') },
                { value: 'output', label: tr('op.stock.target_output') },
              ]}
            />
          </Field>
          <Field label={tr(`op.stock.target_${target}`)} style={{ marginBlockEnd: 0, flex: 1, minInlineSize: '16rem' }}>
            <select style={inputStyle} value={targetId} onChange={(e) => select(target, e.target.value)}>
              <option value="">—</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {target === 'modifier' && <MessagePresenter tone="info" message={tr('ws.manager.stock.recipes.modifierHint')} style={{ marginBlockStart: '0.75rem' }} />}
      </Panel>

      {target === 'variant' && siblings.length > 0 && (
        <Panel
          title={tr('ws.manager.stock.recipes.matrixTitle')}
          padded={false}
          style={{ marginBlockStart: '0.75rem' }}
          actions={incompleteCount > 0 ? <StatusBadge size="sm" tone="danger" icon="alert" label={`${tr('ws.manager.stock.recipes.incomplete')} · ${formatNumber(incompleteCount, locale)}`} /> : undefined}
        >
          <p style={{ paddingBlock: '0.5rem', paddingInline: '0.85rem', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.recipes.matrixLead')}</p>
          <DataTable dense columns={matrixColumns} rows={siblings} rowKey={(v) => v.id} selectedKey={targetId} aria-label={tr('ws.manager.stock.recipes.matrixTitle')} />
        </Panel>
      )}

      {targetId && (
        <Panel title={selectedOption?.label ?? ''} style={{ marginBlockStart: '0.75rem' }}>
          {lines.map((l) => (
            <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '0.4rem', alignItems: 'end', marginBlockEnd: '0.3rem' }}>
              <Field label={tr('op.stock.ingredient')} style={{ marginBlockEnd: 0 }}>
                <select
                  style={inputStyle}
                  value={l.ingredientId}
                  disabled={busy}
                  onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ingredientId: e.target.value } : x)))}
                >
                  <option value="">—</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {pickName(locale, i)} ({i.unit})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('op.stock.qtyPerUnit')} style={{ marginBlockEnd: 0 }}>
                <input
                  style={inputStyle}
                  dir="ltr"
                  inputMode="decimal"
                  value={l.qty}
                  disabled={busy}
                  onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))}
                />
              </Field>
              <div style={{ paddingBlockEnd: '0.15rem' }}>
                <Button kind="ghost" size="sm" icon="x" disabled={busy} aria-label={tr('ws.kit.actions.remove')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <MessagePresenter tone="refused" icon="alert" message={tr('ws.manager.stock.recipes.incomplete')} style={{ marginBlockEnd: '0.6rem' }} />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBlockStart: '0.5rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button icon="plus" disabled={busy} onClick={() => setLines((ls) => [...ls, { key: crypto.randomUUID(), ingredientId: '', qty: '' }])}>
              {tr('op.stock.addLine')}
            </Button>
            <Button kind="primary" icon="check" busy={busy} disabled={!dirty} onClick={() => void save()}>
              {tr('op.common.apply')}
            </Button>
          </div>
          <ErrorText error={error} />
        </Panel>
      )}
    </div>
  );
}

/** Route aliases for the spec names (06.31 recipe, 06.32 sub-recipe share one editor). */
export const RecipeEditorScreen = RecipeEditor;
export const SubRecipeEditorScreen = RecipeEditor;
