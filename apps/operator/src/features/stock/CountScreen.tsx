/**
 * Physical count (spec 06.35) — THE Module-5 acceptance flow and the ONLY
 * route by which a stock adjustment is permitted. app.start_count snapshots
 * the ledger's theoretical per active ingredient; entry is BLIND by default
 * (the expected number is behind a toggle); drafts autosave to localStorage
 * per count id so a station crash doesn't lose an hour of counting;
 * app.finalize_count writes the count_adjustment movements and stamps the
 * period. States: ready (no count) · inProgress · busy · error · submitted.
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../lib/auth';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, MessagePresenter, PageHeader, Panel, PermissionRefusedNotice, StatusBadge, asyncStatus, type Column } from '../../components/kit';
import { SK, fetchIngredients, type IngredientRow } from './stockKeys';

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
  const can = usePermissions();
  const [showTheoretical, setShowTheoretical] = useState(false);
  const [counted, setCounted] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);

  const openQ = useQuery({
    queryKey: SK.openCount,
    queryFn: async (): Promise<OpenCount | null> => {
      const { data, error: err } = await supabase.from('stock_counts').select('id, started_at').is('finalized_at', null).maybeSingle();
      if (err) throw err;
      return data as OpenCount | null;
    },
  });
  const open = openQ.data ?? null;

  const linesQ = useQuery({
    queryKey: ['stock', 'countLines', open?.id],
    enabled: !!open,
    queryFn: async (): Promise<CountLine[]> => {
      const { data, error: err } = await supabase.from('stock_count_lines').select('ingredient_id, theoretical_qty').eq('count_id', open!.id);
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
      setSubmitted(false);
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
        p_lines: entered.map(([ingredient_id, v]) => ({ ingredient_id, counted_qty: Number(v) })),
      });
      try {
        localStorage.removeItem(draftKey(open.id));
      } catch {
        /* stale draft is harmless once the count is finalized */
      }
      toast.ok(tr('op.stock.finalized'));
      setSubmitted(true);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void navigate({ to: '/stock/variance' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const status = asyncStatus(openQ, () => false);
  const lines = linesQ.data ?? [];
  const enteredCount = Object.values(counted ?? {}).filter((v) => v.trim() !== '').length;

  const columns: Column<CountLine>[] = [
    {
      key: 'ingredient',
      header: tr('op.stock.ingredient'),
      render: (l) => {
        const ing = nameOf.get(l.ingredient_id);
        return (
          <span>
            <bdi>{ing ? pickName(locale, ing) : l.ingredient_id.slice(0, 8)}</bdi>{' '}
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>({ing?.unit})</span>
          </span>
        );
      },
    },
    ...(showTheoretical
      ? [{ key: 'theoretical', header: tr('op.stock.theoretical'), numeric: true, render: (l: CountLine) => <span style={{ color: 'var(--tp-muted-fg)' }}>{l.theoretical_qty}</span> } satisfies Column<CountLine>]
      : []),
    {
      key: 'counted',
      header: tr('op.stock.counted'),
      align: 'end',
      width: '9rem',
      render: (l) => {
        const ing: IngredientRow | undefined = nameOf.get(l.ingredient_id);
        return (
          <input
            style={{ ...inputStyle, inlineSize: '7rem', textAlign: 'end' }}
            dir="ltr"
            inputMode="decimal"
            aria-label={ing ? pickName(locale, ing) : l.ingredient_id}
            value={counted?.[l.ingredient_id] ?? ''}
            disabled={busy}
            onChange={(e) => setLine(l.ingredient_id, e.target.value)}
          />
        );
      },
    },
  ];

  return (
    <div style={{ maxInlineSize: '48rem' }}>
      <PageHeader
        title={open ? tr('op.stock.countOpenSince', { time: formatTime(new Date(open.started_at), locale) }) : tr('op.stock.countsTitle')}
        subtitle={tr('ws.manager.stock.count.lead')}
        actions={
          open ? (
            <>
              <StatusBadge tone="accent" label={tr('ws.manager.stock.count.inProgress')} />
              <StatusBadge tone="neutral" label={tr('ws.manager.stock.count.entered', { entered: formatNumber(enteredCount, locale), total: formatNumber(lines.length, locale) })} />
              <Button kind={showTheoretical ? 'primary' : 'default'} size="sm" icon={showTheoretical ? 'eyeOff' : 'eye'} aria-pressed={showTheoretical} onClick={() => setShowTheoretical((v) => !v)}>
                {tr('op.stock.showExpected')}
              </Button>
            </>
          ) : undefined
        }
      />

      <AsyncStateWrapper status={status} error={openQ.error} onRetry={() => void openQ.refetch()}>
        {submitted && !open && (
          <MessagePresenter
            tone="success"
            message={
              <>
                <strong>{tr('ws.manager.stock.count.submitted')}</strong> {tr('ws.manager.stock.count.submittedLead')}{' '}
                <Button size="sm" kind="soft" onClick={() => void navigate({ to: '/stock/variance' })}>
                  {tr('ws.manager.stock.count.openVariance')}
                </Button>
              </>
            }
            style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
          />
        )}
        {!open ? (
          <Panel>
            <EmptyState
              icon="scale"
              title={tr('op.stock.countsTitle')}
              body={tr('op.stock.noOpenCount')}
              action={
                <>
                  {!can.adjustStock && <PermissionRefusedNotice action={tr('op.stock.startCount')} requiredRole={requiredRoleFor('adjustStock')} style={{ marginBlockEnd: 'var(--tp-sp-2)' }} />}
                  <Button kind="primary" icon="scale" busy={busy} disabled={!can.adjustStock} onClick={() => void start()}>
                    {tr('op.stock.startCount')}
                  </Button>
                </>
              }
            />
            <ErrorText error={error} />
          </Panel>
        ) : (
          <Panel padded={false}>
            <p style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              {tr('op.stock.blindHint')} {tr('ws.manager.stock.count.draftSaved')}
            </p>
            <ErrorText error={linesQ.error} />
            <DataTable columns={columns} rows={lines} rowKey={(l) => l.ingredient_id} aria-label={tr('op.stock.countsTitle')} />
            <div style={{ paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-3)', borderBlockStart: '1px solid var(--tp-border)' }}>
              <ErrorText error={error} />
              {!can.adjustStock && <PermissionRefusedNotice action={tr('op.stock.finalizeBtn')} requiredRole={requiredRoleFor('adjustStock')} style={{ marginBlockEnd: 'var(--tp-sp-2)' }} />}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginInlineEnd: 'auto' }}>{tr('ws.manager.stock.count.untouched')}</span>
                <Button kind="danger" icon="check" busy={busy} disabled={!can.adjustStock} onClick={() => void finalize()}>
                  {tr('op.stock.finalizeBtn')}
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

/** Route alias for the spec name. */
export const PhysicalCountScreen = CountScreen;
