/**
 * Recipes / BOM editor (SOW L516-518: bill of materials per product with
 * per-SIZE quantities, modifier-aware consumption, sub-recipes). One
 * app.set_recipe call per attachment point — atomic replace, cycle-guarded.
 * Auto-deduction is already wired server-side (0018); attaching lines here is
 * what makes it actually consume.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, card, inputStyle } from '../../components/ui';
import { SK, fetchIngredients } from './stockKeys';

type TargetKind = 'variant' | 'modifier' | 'output';

interface TargetOption {
  id: string;
  label: string;
}

interface RecipeLineDraft {
  key: string;
  ingredientId: string;
  qty: string;
}

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
    queryKey: ['stock', 'recipeTargets', target],
    queryFn: async (): Promise<TargetOption[]> => {
      if (target === 'variant') {
        const { data, error: err } = await supabase
          .from('menu_item_variants')
          .select('id, name_en, name_ar, item:menu_items(name_en, name_ar)')
          .order('id');
        if (err) throw err;
        return (
          data as unknown as {
            id: string;
            name_en: string;
            name_ar: string;
            item: { name_en: string; name_ar: string } | null;
          }[]
        ).map((v) => ({
          id: v.id,
          label: `${v.item ? pickName(locale, v.item) : '?'} — ${pickName(locale, v)}`,
        }));
      }
      if (target === 'modifier') {
        const { data, error: err } = await supabase
          .from('modifiers')
          .select('id, name_en, name_ar')
          .order('name_en');
        if (err) throw err;
        return (data as { id: string; name_en: string; name_ar: string }[]).map((m) => ({
          id: m.id,
          label: pickName(locale, m),
        }));
      }
      const { data, error: err } = await supabase
        .from('ingredients')
        .select('id, name_en, name_ar')
        .eq('kind', 'prepared')
        .order('name_en');
      if (err) throw err;
      return (data as { id: string; name_en: string; name_ar: string }[]).map((i) => ({
        id: i.id,
        label: pickName(locale, i),
      }));
    },
  });

  const linesQ = useQuery({
    queryKey: SK.recipes(target, targetId),
    enabled: !!targetId,
    queryFn: async () => {
      const col =
        target === 'variant' ? 'variant_id' : target === 'modifier' ? 'modifier_id' : 'output_ingredient_id';
      const { data, error: err } = await supabase
        .from('recipe_lines')
        .select('ingredient_id, qty')
        .eq(col, targetId);
      if (err) throw err;
      return data as { ingredient_id: string; qty: number }[];
    },
  });

  // Hydrate the draft when a target's lines land (once per selection).
  if (targetId && linesQ.isSuccess && loadedFor !== `${target}:${targetId}`) {
    setLoadedFor(`${target}:${targetId}`);
    setLines(
      linesQ.data.map((l) => ({
        key: crypto.randomUUID(),
        ingredientId: l.ingredient_id,
        qty: String(l.qty),
      })),
    );
  }

  const validLines = lines.filter((l) => l.ingredientId && Number(l.qty) > 0);

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

  return (
    <div style={{ maxInlineSize: '40rem' }}>
      <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.recipesTitle')}</h2>
      <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>
        {tr('op.stock.recipesHint')}
      </p>

      <div style={card}>
        <div style={{ display: 'flex', gap: '0.4rem', marginBlockEnd: '0.5rem' }}>
          {(['variant', 'modifier', 'output'] as const).map((t) => (
            <Button
              key={t}
              kind={target === t ? 'primary' : 'default'}
              aria-pressed={target === t}
              onClick={() => {
                setTarget(t);
                setTargetId('');
                setLines([]);
                setLoadedFor(null);
              }}
            >
              {tr(`op.stock.target_${t}`)}
            </Button>
          ))}
        </div>

        <Field label={tr(`op.stock.target_${target}`)}>
          <select
            style={inputStyle}
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value);
              setLines([]);
              setLoadedFor(null);
            }}
          >
            <option value="">—</option>
            {(optionsQ.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {targetId && (
          <>
            {lines.map((l) => (
              <div
                key={l.key}
                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: '0.4rem', alignItems: 'end', marginBlockEnd: '0.3rem' }}
              >
                <Field label={tr('op.stock.ingredient')}>
                  <select
                    style={inputStyle}
                    value={l.ingredientId}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ingredientId: e.target.value } : x)))
                    }
                  >
                    <option value="">—</option>
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {pickName(locale, i)} ({i.unit})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={tr('op.stock.qtyPerUnit')}>
                  <input
                    style={inputStyle}
                    dir="ltr"
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))
                    }
                  />
                </Field>
                <div style={{ paddingBlockEnd: '0.35rem' }}>
                  <Button kind="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    ✕
                  </Button>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBlockStart: '0.5rem' }}>
              <Button
                onClick={() =>
                  setLines((ls) => [...ls, { key: crypto.randomUUID(), ingredientId: '', qty: '' }])
                }
              >
                {tr('op.stock.addLine')}
              </Button>
              <Button kind="primary" disabled={busy} onClick={() => void save()}>
                {tr('op.common.apply')}
              </Button>
            </div>
            <ErrorText error={error} />
          </>
        )}
      </div>
    </div>
  );
}
