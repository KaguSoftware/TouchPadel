/**
 * Physical counts — THE Module-5 acceptance flow (SOW L509-514, L541-542).
 * app.start_count snapshots the ledger's theoretical per active ingredient;
 * entry is BLIND by default (honest counts — the expected number is behind a
 * toggle); drafts autosave to localStorage per count id so a station crash
 * doesn't lose an hour of counting; app.finalize_count writes the
 * count_adjustment movements and stamps the period.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, card, inputStyle } from '../../components/ui';
import { SK, fetchIngredients } from './stockKeys';

interface OpenCount {
  id: string;
  started_at: string;
}

interface CountLine {
  ingredient_id: string;
  theoretical_qty: number;
}

const draftKey = (countId: string) => `touch-operator-count-${countId}`;

function loadDraft(countId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(draftKey(countId)) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function CountScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [showTheoretical, setShowTheoretical] = useState(false);
  const [counted, setCounted] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const openQ = useQuery({
    queryKey: SK.openCount,
    queryFn: async (): Promise<OpenCount | null> => {
      const { data, error: err } = await supabase
        .from('stock_counts')
        .select('id, started_at')
        .is('finalized_at', null)
        .maybeSingle();
      if (err) throw err;
      return data as OpenCount | null;
    },
  });
  const open = openQ.data ?? null;

  const linesQ = useQuery({
    queryKey: ['stock', 'countLines', open?.id],
    enabled: !!open,
    queryFn: async (): Promise<CountLine[]> => {
      const { data, error: err } = await supabase
        .from('stock_count_lines')
        .select('ingredient_id, theoretical_qty')
        .eq('count_id', open!.id);
      if (err) throw err;
      return data as CountLine[];
    },
  });

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const nameOf = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i]));

  // Hydrate draft once per open count.
  if (open && counted === null) setCounted(loadDraft(open.id));

  function setLine(ingredientId: string, value: string) {
    setCounted((prev) => {
      const next = { ...(prev ?? {}), [ingredientId]: value };
      if (open) {
        try {
          localStorage.setItem(draftKey(open.id), JSON.stringify(next));
        } catch {
          /* draft is a convenience; the count itself is server state */
        }
      }
      return next;
    });
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('start_count', {});
      setCounted(null);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!open || !counted) return;
    const entered = Object.entries(counted).filter(([, v]) => v.trim() !== '');
    const ok = await confirm({
      title: tr('op.stock.finalizeTitle'),
      body: tr('op.stock.finalizeBody', { count: entered.length }),
      kind: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('finalize_count', {
        p_count_id: open.id,
        p_lines: entered.map(([ingredient_id, v]) => ({
          ingredient_id,
          counted_qty: Number(v),
        })),
      });
      try {
        localStorage.removeItem(draftKey(open.id));
      } catch {
        /* stale draft is harmless once the count is finalized */
      }
      toast.ok(tr('op.stock.finalized'));
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void navigate({ to: '/stock/variance' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (openQ.isSuccess && !open) {
    return (
      <div style={{ maxInlineSize: '30rem' }}>
        <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.countsTitle')}</h2>
        <div style={card}>
          <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)' }}>{tr('op.stock.noOpenCount')}</p>
          <ErrorText error={error} />
          <Button kind="primary" disabled={busy} onClick={() => void start()}>
            {tr('op.stock.startCount')}
          </Button>
        </div>
      </div>
    );
  }

  if (!open) return <p>{tr('common.loading')}</p>;

  return (
    <div style={{ maxInlineSize: '38rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginBlock: '0.4rem' }}>
          {tr('op.stock.countOpenSince', { time: formatTime(new Date(open.started_at), locale) })}
        </h2>
        <Button
          kind={showTheoretical ? 'primary' : 'default'}
          aria-pressed={showTheoretical}
          onClick={() => setShowTheoretical((v) => !v)}
        >
          {tr('op.stock.showExpected')}
        </Button>
      </div>
      <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>
        {tr('op.stock.blindHint')}
      </p>

      <div style={card}>
        {(linesQ.data ?? []).map((l) => {
          const ing = nameOf.get(l.ingredient_id);
          return (
            <div
              key={l.ingredient_id}
              style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBlockEnd: '0.3rem' }}
            >
              <span style={{ flex: 1 }}>
                {ing ? pickName(locale, ing) : l.ingredient_id.slice(0, 8)}{' '}
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>({ing?.unit})</span>
              </span>
              {showTheoretical && (
                <span style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
                  {l.theoretical_qty}
                </span>
              )}
              <input
                style={{ ...inputStyle, inlineSize: '7rem', textAlign: 'end' }}
                dir="ltr"
                inputMode="decimal"
                aria-label={ing ? pickName(locale, ing) : l.ingredient_id}
                value={counted?.[l.ingredient_id] ?? ''}
                onChange={(e) => setLine(l.ingredient_id, e.target.value)}
              />
            </div>
          );
        })}
        <ErrorText error={error} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlockStart: '0.5rem' }}>
          <Button kind="danger" disabled={busy} onClick={() => void finalize()}>
            {tr('op.stock.finalizeBtn')}
          </Button>
        </div>
      </div>
    </div>
  );
}
