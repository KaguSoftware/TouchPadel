/**
 * Recipes (spec 06.31 / 06.32) — the bill of materials per SIZE,
 * modifier-aware lines and sub-recipes. One app.set_recipe call per
 * attachment point — atomic replace, cycle-guarded. Auto-deduction is wired
 * server-side (0018); attaching lines here is what makes a sale take stock.
 *
 * WHY THIS LAYOUT
 *
 * The old screen opened on a "Kind" switch and one empty select holding every
 * size of every item — two hundred options and nothing else on the page — so
 * the one thing worth knowing, which items have no recipe at all, was only
 * visible one item at a time. A size with no recipe deducts nothing when it
 * sells and is the single largest cause of count differences.
 *
 * Now the screen is the list: each tab (menu items · add-ons · prepared
 * items) shows every entry with its recipe status, leads with how many have
 * none and a button to show exactly those, and opens a recipe in a dialog.
 * The dialog keeps the old "sizes of this item" matrix as a row of switches to
 * the item's other sizes, each marked when it has no recipe.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle, Select } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, PageHeader, Panel, ResultCount, SearchField, SegmentedControl, StatusBadge, TableSkeleton, Toolbar, type Column } from '../../components/kit';
import { AttentionList, useStockFormat } from './stockUi';
import { SK, fetchIngredients, type IngredientRow } from './stockKeys';

type TargetKind = 'variant' | 'modifier' | 'output';
type Show = 'all' | 'missing' | 'set';

interface Target {
  kind: TargetKind;
  id: string;
  name: string;
  /** Variants: the size's name, and the item it belongs to. */
  size?: string;
  itemId?: string;
  /** Outputs: the prepared ingredient's unit, so "per 1 ml made" can be said. */
  unit?: string;
}

interface RecipeLineRow {
  variant_id: string | null;
  modifier_id: string | null;
  output_ingredient_id: string | null;
  ingredient_id: string;
  qty: number;
}

const TARGET_COLUMN: Record<TargetKind, 'variant_id' | 'modifier_id' | 'output_ingredient_id'> = {
  variant: 'variant_id',
  modifier: 'modifier_id',
  output: 'output_ingredient_id',
};

export function RecipeEditor() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const [kind, setKind] = useState<TargetKind>('variant');
  const [show, setShow] = useState<Show>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Target | null>(null);

  const targetsQ = useQuery({
    queryKey: ['stock', 'recipeTargets', kind],
    queryFn: async (): Promise<(Omit<Target, 'name' | 'size'> & { names: { name_en: string; name_ar: string }; sizeNames?: { name_en: string; name_ar: string } })[]> => {
      if (kind === 'variant') {
        const { data, error } = await supabase
          .from('menu_item_variants')
          .select('id, item_id, name_en, name_ar, sort_order, item:menu_items(name_en, name_ar, is_active, sort_order)')
          .order('item_id')
          .order('sort_order');
        if (error) throw error;
        return (
          data as unknown as { id: string; item_id: string; name_en: string; name_ar: string; item: { name_en: string; name_ar: string; is_active: boolean } | null }[]
        )
          .filter((v) => v.item?.is_active !== false)
          .map((v) => ({ kind: 'variant' as const, id: v.id, itemId: v.item_id, names: v.item ?? { name_en: '', name_ar: '' }, sizeNames: { name_en: v.name_en, name_ar: v.name_ar } }));
      }
      if (kind === 'modifier') {
        const { data, error } = await supabase.from('modifiers').select('id, name_en, name_ar, is_active').order('name_en');
        if (error) throw error;
        return (data as { id: string; name_en: string; name_ar: string; is_active: boolean }[])
          .filter((m) => m.is_active)
          .map((m) => ({ kind: 'modifier' as const, id: m.id, names: m }));
      }
      const { data, error } = await supabase.from('ingredients').select('id, name_en, name_ar, unit, is_active').eq('kind', 'prepared').order('name_en');
      if (error) throw error;
      return (data as { id: string; name_en: string; name_ar: string; unit: string; is_active: boolean }[])
        .filter((i) => i.is_active)
        .map((i) => ({ kind: 'output' as const, id: i.id, unit: i.unit, names: i }));
    },
  });

  const linesQ = useQuery({
    queryKey: ['stock', 'recipes', 'allLines'],
    queryFn: async (): Promise<RecipeLineRow[]> => {
      const { data, error } = await supabase.from('recipe_lines').select('variant_id, modifier_id, output_ingredient_id, ingredient_id, qty');
      if (error) throw error;
      return data as RecipeLineRow[];
    },
  });

  const lineCount = new Map<string, number>();
  for (const l of linesQ.data ?? []) {
    const id = l[TARGET_COLUMN[kind]];
    if (id) lineCount.set(id, (lineCount.get(id) ?? 0) + 1);
  }

  const targets: Target[] = (targetsQ.data ?? [])
    .map((t) => ({ kind: t.kind, id: t.id, itemId: t.itemId, unit: t.unit, name: pickName(locale, t.names), size: t.sizeNames ? pickName(locale, t.sizeNames) : undefined }))
    .sort((a, b) => a.name.localeCompare(b.name, locale) || (a.size ?? '').localeCompare(b.size ?? '', locale));
  const q = query.trim().toLowerCase();
  const missing = targets.filter((t) => !lineCount.get(t.id));
  const rows = targets
    .filter((t) => (show === 'missing' ? !lineCount.get(t.id) : show === 'set' ? !!lineCount.get(t.id) : true))
    .filter((t) => q === '' || `${t.name} ${t.size ?? ''}`.toLowerCase().includes(q));

  const columns: Column<Target>[] = [
    {
      key: 'name',
      header: tr(`ws.manager.stock.recipes.nameHeader.${kind}`),
      render: (t) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <bdi style={{ fontWeight: 600 }}>{t.name}</bdi>
          {t.size && <bdi style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{t.size}</bdi>}
        </span>
      ),
    },
    {
      key: 'status',
      header: tr('ws.manager.stock.recipes.status'),
      render: (t) => {
        const n = lineCount.get(t.id) ?? 0;
        return n === 0 ? (
          <StatusBadge size="sm" tone="warn" label={tr('ws.manager.stock.recipes.noRecipe')} />
        ) : (
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.stock.recipes.ingredientCount', { count: fmt.num(n) })}</span>
        );
      },
    },
    {
      key: 'edit',
      header: '',
      align: 'end',
      render: (t) => (
        <Button size="sm" kind="ghost" icon={lineCount.get(t.id) ? 'note' : 'plus'} onClick={() => setEditing(t)}>
          {lineCount.get(t.id) ? tr('op.common.edit') : tr('ws.manager.stock.recipes.add')}
        </Button>
      ),
    },
  ];

  const status = targetsQ.isError || linesQ.isError ? 'error' : targetsQ.isPending || linesQ.isPending ? 'loading' : targets.length === 0 ? 'empty' : 'ready';

  return (
    <div style={{ maxInlineSize: '64rem' }}>
      <PageHeader title={tr('op.stockNav.recipes')} subtitle={tr('ws.manager.stock.recipes.lead')} />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <SegmentedControl<TargetKind>
          value={kind}
          onChange={(k) => {
            setKind(k);
            setShow('all');
            setQuery('');
          }}
          aria-label={tr('op.stockNav.recipes')}
          options={[
            { value: 'variant', label: tr('ws.manager.stock.recipes.kind.variant') },
            { value: 'modifier', label: tr('ws.manager.stock.recipes.kind.modifier') },
            { value: 'output', label: tr('ws.manager.stock.recipes.kind.output') },
          ]}
        />
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{tr(`ws.manager.stock.recipes.kindHint.${kind}`)}</p>

        <AsyncStateWrapper
          status={status}
          error={targetsQ.error ?? linesQ.error}
          onRetry={() => void (targetsQ.refetch(), linesQ.refetch())}
          skeleton={<TableSkeleton columns={columns} />}
          emptyContent={<EmptyState icon="fileText" title={tr(`ws.manager.stock.recipes.empty.${kind}`)} />}
        >
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            <Panel>
              <AttentionList
                clear={tr('ws.manager.stock.recipes.allSet')}
                items={[
                  {
                    key: 'missing',
                    count: missing.length,
                    tone: 'warn',
                    title: tr('ws.manager.stock.recipes.missing'),
                    hint: tr(`ws.manager.stock.recipes.missingHint.${kind}`),
                    action: { label: tr('ws.manager.stock.onHand.now.showWhich'), onClick: () => setShow('missing') },
                  },
                ]}
              />
            </Panel>
            <div>
              <Toolbar end={<ResultCount shown={rows.length} total={targets.length} />}>
                <SegmentedControl<Show>
                  value={show}
                  onChange={setShow}
                  aria-label={tr('ws.manager.stock.onHand.table.show')}
                  options={[
                    { value: 'all', label: tr('ws.kit.common.all') },
                    { value: 'missing', label: tr('ws.manager.stock.recipes.noRecipe') },
                    { value: 'set', label: tr('ws.manager.stock.recipes.hasRecipe') },
                  ]}
                />
                <span style={{ inlineSize: '16rem', maxInlineSize: '100%' }}>
                  <SearchField value={query} onChange={setQuery} placeholder={tr('ws.manager.stock.recipes.search')} />
                </span>
              </Toolbar>
              {rows.length === 0 ? (
                <EmptyState
                  kind="filtered"
                  onClearFilters={() => {
                    setShow('all');
                    setQuery('');
                  }}
                />
              ) : (
                <DataTable columns={columns} rows={rows} rowKey={(t) => t.id} onRowClick={(t) => setEditing(t)} dense aria-label={tr(`ws.manager.stock.recipes.kind.${kind}`)} />
              )}
            </div>
          </div>
        </AsyncStateWrapper>
      </div>

      {editing && (
        <RecipeDialog
          key={editing.id}
          target={editing}
          siblings={editing.kind === 'variant' ? targets.filter((t) => t.itemId === editing.itemId) : []}
          hasRecipe={(id) => (lineCount.get(id) ?? 0) > 0}
          onSwitch={setEditing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface LineDraft {
  key: string;
  ingredientId: string;
  qty: string;
}

function RecipeDialog({
  target,
  siblings,
  hasRecipe,
  onSwitch,
  onClose,
}: {
  target: Target;
  siblings: Target[];
  hasRecipe: (id: string) => boolean;
  onSwitch: (t: Target) => void;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  // A prepared item cannot be made from itself; the server's cycle guard would refuse it anyway.
  const ingredients = (ingredientsQ.data ?? []).filter((i) => i.is_active && !(target.kind === 'output' && i.id === target.id));
  const ingredientOf = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i]));

  const savedQ = useQuery({
    queryKey: SK.recipes(target.kind, target.id),
    queryFn: async () => {
      const { data, error: err } = await supabase.from('recipe_lines').select('ingredient_id, qty').eq(TARGET_COLUMN[target.kind], target.id);
      if (err) throw err;
      return data as { ingredient_id: string; qty: number }[];
    },
  });

  // Hydrate the draft once, when the saved lines land.
  if (lines === null && savedQ.isSuccess) {
    setLines(savedQ.data.map((l) => ({ key: crypto.randomUUID(), ingredientId: l.ingredient_id, qty: String(l.qty) })));
  }

  const draft = lines ?? [];
  const started = draft.filter((l) => l.ingredientId || l.qty.trim() !== '');
  const incomplete = started.filter((l) => !l.ingredientId || !(Number(l.qty) > 0));
  const saved = savedQ.data ?? [];
  const dirty =
    lines !== null &&
    JSON.stringify(started.map((l) => [l.ingredientId, Number(l.qty)]).sort()) !== JSON.stringify(saved.map((l) => [l.ingredient_id, Number(l.qty)]).sort());

  const patch = (key: string, part: Partial<LineDraft>) => setLines((ls) => (ls ?? []).map((x) => (x.key === key ? { ...x, ...part } : x)));

  async function leave(next: () => void) {
    if (dirty && !(await confirm({
      title: tr('ws.kit.actions.dirtyLeave'),
      body: tr('ws.kit.actions.dirtyLeaveBody'),
      confirmLabel: tr('ws.kit.actions.dirtyLeaveConfirm'),
      cancelLabel: tr('ws.kit.actions.dirtyLeaveCancel'),
      kind: 'danger',
      // Beside "Keep editing", not pushed to the far edge (owner call,
      // 2026-09-23). Rulebook 7.8 spreads a destructive confirm; this one
      // loses only an unsaved draft, never stored data, and Cancel still
      // autofocuses so Enter and Esc both keep the edits.
      pairActions: true,
    }))) return;
    next();
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('set_recipe', {
        p_target: target.kind,
        p_target_id: target.id,
        p_lines: started.map((l) => ({ ingredient_id: l.ingredientId, qty: Number(l.qty) })),
      });
      toast.ok(tr('ws.manager.stock.recipes.saved'));
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const title = target.size ? `${target.name} · ${target.size}` : target.name;
  const perOne =
    target.kind === 'output'
      ? tr('ws.manager.stock.recipes.perOne.output', { unit: fmt.unit(target.unit ?? '') })
      : tr(`ws.manager.stock.recipes.perOne.${target.kind}`);

  return (
    <Modal
      title={tr('ws.manager.stock.recipes.dialogTitle', { name: title })}
      subtitle={perOne}
      size="lg"
      onClose={() => void leave(onClose)}
      footer={
        <>
          <Button onClick={() => void leave(onClose)} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="check"
            busy={busy}
            disabled={!dirty || incomplete.length > 0}
            disabledReason={incomplete.length > 0 ? tr('ws.manager.stock.recipes.incompleteLine') : tr('ws.manager.stock.ingredients.form.nothingChanged')}
            onClick={() => void save()}
          >
            {tr('ws.manager.stock.recipes.save')}
          </Button>
        </>
      }
    >
      {siblings.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-3)' }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.recipes.sizes')}</span>
          {siblings.map((s) =>
            s.id === target.id ? (
              <StatusBadge key={s.id} tone="accent" label={s.size ?? s.name} />
            ) : (
              <Button key={s.id} size="sm" kind="soft" onClick={() => void leave(() => onSwitch(s))}>
                <bdi>{s.size ?? s.name}</bdi>
                {!hasRecipe(s.id) && <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 600 }}> · {tr('ws.manager.stock.recipes.noRecipe')}</span>}
              </Button>
            ),
          )}
        </div>
      )}

      {savedQ.isError ? (
        <ErrorText error={savedQ.error} />
      ) : lines === null ? null : (
        <>
          {draft.length === 0 ? (
            <EmptyState compact icon="fileText" title={tr('ws.manager.stock.recipes.noLines')} body={tr(`ws.manager.stock.recipes.missingHint.${target.kind}`)} />
          ) : (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
              {draft.map((l, i) => {
                const ing: IngredientRow | undefined = ingredientOf.get(l.ingredientId);
                const bad = (l.ingredientId || l.qty.trim() !== '') && (!l.ingredientId || !(Number(l.qty) > 0));
                return (
                  <li key={l.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(8rem, 1fr) auto', gap: 'var(--tp-sp-1-5)', alignItems: 'end' }}>
                    <Field label={tr('op.stock.ingredient')} style={{ marginBlockEnd: 0 }}>
                      <Select
                        value={l.ingredientId}
                        disabled={busy}
                        onChange={(ingredientId) => patch(l.key, { ingredientId })}
                        options={[
                          { value: '', label: tr('ws.manager.stock.goodsIn.choose') },
                          ...ingredients.map((opt) => ({ value: opt.id, label: pickName(locale, opt) })),
                        ]}
                      />
                    </Field>
                    <Field label={ing ? tr('ws.manager.stock.recipes.amountIn', { unit: fmt.unit(ing.unit) }) : tr('ws.manager.stock.recipes.amount')} style={{ marginBlockEnd: 0 }}>
                      <input
                        style={{ ...inputStyle, borderColor: bad && l.qty.trim() !== '' && !(Number(l.qty) > 0) ? 'var(--tp-danger)' : undefined }}
                        dir="ltr"
                        inputMode="decimal"
                        value={l.qty}
                        disabled={busy}
                        onChange={(e) => patch(l.key, { qty: e.target.value })}
                      />
                    </Field>
                    <Button
                      kind="ghost"
                      size="sm"
                      icon="x"
                      disabled={busy}
                      aria-label={tr('ws.manager.stock.goodsIn.removeLine', { n: fmt.num(i + 1) })}
                      title={tr('ws.manager.stock.goodsIn.removeLine', { n: fmt.num(i + 1) })}
                      onClick={() => setLines((ls) => (ls ?? []).filter((x) => x.key !== l.key))}
                      style={{ marginBlockEnd: '0.3rem' }}
                    />
                  </li>
                );
              })}
            </ol>
          )}
          <Button icon="plus" size="sm" disabled={busy} style={{ marginBlockStart: 'var(--tp-sp-2-5)' }} onClick={() => setLines((ls) => [...(ls ?? []), { key: crypto.randomUUID(), ingredientId: '', qty: '' }])}>
            {tr('ws.manager.stock.recipes.addIngredient')}
          </Button>
          {incomplete.length > 0 && (
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-danger-fg)', marginBlockStart: 'var(--tp-sp-2)' }}>{tr('ws.manager.stock.recipes.incompleteLine')}</p>
          )}
          <ErrorText error={error} />
        </>
      )}
    </Modal>
  );
}

/** Route aliases for the spec names (06.31 recipe, 06.32 sub-recipe share one editor). */
export const RecipeEditorScreen = RecipeEditor;
export const SubRecipeEditorScreen = RecipeEditor;
