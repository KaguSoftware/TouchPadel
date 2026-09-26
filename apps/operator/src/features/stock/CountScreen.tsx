/**
 * Stock count (spec 06.35) — THE Module-5 acceptance flow and the ONLY route
 * by which a stock adjustment is permitted. app.start_count snapshots the
 * ledger's theoretical per active ingredient; entry is BLIND by default (the
 * recorded number is behind a toggle); drafts autosave to localStorage per
 * count id so a station crash doesn't lose an hour of counting;
 * app.finalize_count writes the count_adjustment movements and stamps the
 * period, and the screen then opens Count differences.
 *
 * Before a count starts, the screen explains the three steps a count takes,
 * because this is where "why can't I just type the stock number?" gets its
 * answer — the old lead said only that there is "no editable stock number
 * anywhere in this app". While counting, the table can be searched and
 * narrowed to what is left, and progress is one line in the subtitle rather
 * than two badges and a toggle crowding the title.
 *
 * Finishing is the primary action with a confirmation that says what happens
 * in plain words. It was a red "Finalize count" button; nothing is destroyed —
 * stock is corrected to what was counted.
 *
 * Wave 5 (wave5-addendum-2026-09-25 §2.8.2 D7, §5.2): each store is counted
 * on its own. The store tabs pick the store BEFORE Start, and each tab shows
 * that store's own count (fetchOpenCount filters the operator's count at the
 * store). While a manager's count is open, deliveries and moves into that
 * store are refused (STORE_BEING_COUNTED), so an open count can be discarded
 * too, with a red confirm.
 *
 * The kitchen counts the bakery store blind on the phone
 * (app.submit_stock_count): such a count waits, and "Counts from the phone"
 * above the tabs is where a manager reviews it (the counted lines, what the
 * records said when it was sent and the difference), corrects a line, and
 * applies it (finalize_count) or discards it (discard_count). While one waits
 * for a store, that store cannot start another count (COUNT_IN_PROGRESS), and
 * the sub-nav's Stock count row carries the number waiting. What a
 * difference is worth is not shown: no server read carries it, and money is
 * never worked out here (PRODUCT.md principle 3).
 */
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatDateTime, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { usePermissions } from '../../lib/auth';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, inputStyle, Tabs, Skeleton } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, PageHeader, Panel, ResultCount, SearchField, SegmentedControl, StatusBadge, Toolbar, asyncStatus, type Column } from '../../components/kit';
import { CardTitle, Step } from '../ops/OpsVisuals';
import { Footnote, KindFilter, matchesKind, useStockFormat, useStoreName, type StockKindFilter } from './stockUi';
import { countEntryState, matchesName } from './stockLogic';
import { STOCK_LOCATIONS, countDifference, phoneCountWaitingAt, phoneCountsWaiting, type StockLocation, type UnfinishedCount } from './storeLogic';
import {
  SK,
  fetchCountLines,
  fetchIngredients,
  fetchLastCount,
  fetchOpenCount,
  fetchUnfinishedCounts,
  type CountLineRow,
  type IngredientRow,
} from './stockKeys';

type LineFilter = 'all' | 'left' | 'entered';

const draftKey = (countId: string) => `touch-operator-count-${countId}`;

function loadDraft(countId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(draftKey(countId)) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function CountScreen() {
  const { tr } = useLocale();
  const [store, setStore] = useState<StockLocation>('cafe');
  const countsQ = useQuery({ queryKey: SK.unfinishedCounts, queryFn: fetchUnfinishedCounts, refetchInterval: 60_000 });
  const waiting = phoneCountsWaiting(countsQ.data);
  const openAt = (s: StockLocation) => (countsQ.data ?? []).some((c) => c.source === 'operator' && c.location === s);

  return (
    <div style={{ maxInlineSize: '56rem' }}>
      <PageHeader title={tr('op.stockNav.counts')} subtitle={tr('ws.manager.stock.count.lead')} />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-5)' }}>
        {waiting.length > 0 && <PhoneCounts counts={waiting} />}

        <section aria-label={tr('ws.stores.counts.storeTabs')}>
          <Tabs<StockLocation>
            value={store}
            onChange={setStore}
            items={STOCK_LOCATIONS.map((s) => ({
              id: s,
              label: openAt(s) ? `${tr(`work.store.${s}`)} · ${tr('ws.stores.counts.counting')}` : tr(`work.store.${s}`),
            }))}
          />
          <StoreCount key={store} store={store} phoneWaiting={phoneCountWaitingAt(countsQ.data, store)} />
        </section>
      </div>
    </div>
  );
}

/** One store's own count: the steps and Start, or the count in progress. */
function StoreCount({ store, phoneWaiting }: { store: StockLocation; phoneWaiting: UnfinishedCount | null }) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const can = usePermissions();
  const [showRecorded, setShowRecorded] = useState(false);
  const [counted, setCounted] = useState<Record<string, string> | null>(null);
  const [query, setQuery] = useState('');
  const [lineFilter, setLineFilter] = useState<LineFilter>('all');
  const [kind, setKind] = useState<StockKindFilter>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const openQ = useQuery({ queryKey: SK.openCount(store), queryFn: () => fetchOpenCount(store) });
  const lastQ = useQuery({ queryKey: SK.lastCountAt(store), queryFn: () => fetchLastCount(store) });
  const open = openQ.data ?? null;

  const linesQ = useQuery({
    queryKey: SK.countLines(open?.id ?? ''),
    enabled: !!open,
    queryFn: () => fetchCountLines(open!.id),
  });

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const ingredientOf = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i]));
  const storeWord = tr(`ws.stores.inSentence.${store}`);

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

  function forgetDraft(countId: string) {
    try {
      localStorage.removeItem(draftKey(countId));
    } catch {
      /* a stale draft is harmless once the count is closed */
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('start_count', { p_location: store });
      setCounted(null);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const lines = [...(linesQ.data ?? [])].sort((a, b) =>
    pickName(locale, ingredientOf.get(a.ingredient_id) ?? { name_en: '', name_ar: '' }).localeCompare(pickName(locale, ingredientOf.get(b.ingredient_id) ?? { name_en: '', name_ar: '' }), locale),
  );
  const entries = counted ?? {};
  const entered = lines.filter((l) => countEntryState(entries[l.ingredient_id]) === 'ok');
  const invalid = lines.filter((l) => countEntryState(entries[l.ingredient_id]) === 'invalid');

  async function finish() {
    if (!open) return;
    const ok = await confirm({
      title: tr('ws.manager.stock.count.finishTitle'),
      body: entered.length === 0 ? tr('ws.manager.stock.count.finishBodyNone') : tr('ws.manager.stock.count.finishBody', { count: fmt.num(entered.length) }),
      confirmLabel: tr('ws.manager.stock.count.finish'),
      kind: 'primary',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('finalize_count', {
        p_count_id: open.id,
        p_lines: entered.map((l) => ({ ingredient_id: l.ingredient_id, counted_qty: Number(entries[l.ingredient_id]) })),
      });
      forgetDraft(open.id);
      toast.ok(tr('ws.manager.stock.count.finished'));
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void navigate({ to: '/stock/variance' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!open) return;
    const ok = await confirm({
      title: tr('ws.stores.counts.discardTitle'),
      body: tr('ws.stores.counts.discardBody', { store: storeWord }),
      confirmLabel: tr('ws.stores.counts.discardConfirm'),
      kind: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('discard_count', { p_count_id: open.id });
      forgetDraft(open.id);
      setCounted(null);
      toast.ok(tr('ws.stores.counts.discarded'));
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const visible = lines.filter((l) => {
    const ing = ingredientOf.get(l.ingredient_id);
    if (ing && !matchesName(ing, query)) return false;
    if (!matchesKind(ing?.kind, kind)) return false;
    const state = countEntryState(entries[l.ingredient_id]);
    if (lineFilter === 'left') return state !== 'ok';
    if (lineFilter === 'entered') return state === 'ok';
    return true;
  });

  const nameCell = (ing: IngredientRow | undefined) => (ing ? pickName(locale, ing) : tr('ws.manager.stock.alerts.unknownIngredient'));

  const columns: Column<CountLineRow>[] = [
    {
      key: 'ingredient',
      header: tr('op.stock.ingredient'),
      render: (l) => <bdi>{nameCell(ingredientOf.get(l.ingredient_id))}</bdi>,
    },
    ...(showRecorded
      ? [
          {
            key: 'recorded',
            header: tr('ws.manager.stock.count.recorded'),
            numeric: true,
            render: (l: CountLineRow) => {
              const ing = ingredientOf.get(l.ingredient_id);
              return <bdi style={{ color: 'var(--tp-muted-fg)' }}>{ing ? fmt.qty(l.theoretical_qty, ing.unit) : fmt.num(l.theoretical_qty)}</bdi>;
            },
          } satisfies Column<CountLineRow>,
        ]
      : []),
    {
      key: 'counted',
      header: tr('ws.manager.stock.count.counted'),
      align: 'end',
      width: '13rem',
      render: (l) => {
        const ing = ingredientOf.get(l.ingredient_id);
        const bad = countEntryState(entries[l.ingredient_id]) === 'invalid';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
            <input
              style={{ ...inputStyle, inlineSize: '7rem', textAlign: 'end', borderColor: bad ? 'var(--tp-danger)' : undefined }}
              dir="ltr"
              inputMode="decimal"
              aria-label={ing ? pickName(locale, ing) : l.ingredient_id}
              aria-invalid={bad || undefined}
              value={entries[l.ingredient_id] ?? ''}
              disabled={busy || !can.adjustStock}
              onChange={(e) => setLine(l.ingredient_id, e.target.value)}
            />
            <span style={{ minInlineSize: '2.5rem', textAlign: 'start', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{ing ? fmt.unit(ing.unit) : ''}</span>
          </span>
        );
      },
    },
  ];

  const lastFinished = lastQ.data?.finalized_at;
  const startBlocked = phoneWaiting ? tr('ws.stores.counts.startBlocked', { store: storeWord }) : undefined;

  return (
    <AsyncStateWrapper status={asyncStatus(openQ, () => false)} error={openQ.error} onRetry={() => void openQ.refetch()}>
      {!open ? (
        <Panel title={<CardTitle icon="scale">{tr('ws.manager.stock.count.how')}</CardTitle>} data-testid={`count-start-${store}`}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
            <Step index={1} title={tr('ws.manager.stock.count.step1')} done={false} tone="neutral">
              <StepHint>{tr('ws.manager.stock.count.step1Hint')}</StepHint>
            </Step>
            <Step index={2} title={tr('ws.manager.stock.count.step2')} done={false} tone="neutral">
              <StepHint>{tr('ws.manager.stock.count.step2Hint')}</StepHint>
            </Step>
            <Step index={3} title={tr('ws.manager.stock.count.step3')} done={false} tone="neutral">
              <StepHint>{tr('ws.manager.stock.count.step3Hint')}</StepHint>
            </Step>
          </ol>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-4)' }}>
            <Button
              kind="primary"
              icon="scale"
              busy={busy}
              disabled={!can.adjustStock || startBlocked !== undefined}
              disabledReason={!can.adjustStock ? tr('ws.manager.stock.count.notAllowed') : startBlocked}
              onClick={() => void start()}
            >
              {tr('ws.manager.stock.count.start')}
            </Button>
            {lastQ.isSuccess && (
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {lastFinished ? tr('ws.manager.stock.count.lastCount', { date: formatDate(new Date(lastFinished), locale) }) : tr('ws.manager.stock.onHand.neverCounted')}
              </span>
            )}
            {lastFinished && (
              <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/stock/variance' })}>
                {tr('op.stockNav.variance')}
              </Button>
            )}
          </div>
          {startBlocked && <p style={{ margin: 0, marginBlockStart: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-warn-fg)' }}>{startBlocked}</p>}
          <ErrorText error={error} />
        </Panel>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid={`count-open-${store}`}>
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>
            {tr('ws.manager.stock.count.progress', {
              time: formatDateTime(new Date(open.started_at), locale),
              entered: fmt.num(entered.length),
              total: fmt.num(lines.length),
            })}
          </p>
          <Toolbar
            end={
              <>
                <ResultCount shown={visible.length} total={lines.length} />
                <Button size="sm" kind="ghost" icon={showRecorded ? 'eyeOff' : 'eye'} aria-pressed={showRecorded} onClick={() => setShowRecorded((v) => !v)}>
                  {showRecorded ? tr('ws.manager.stock.count.hideRecorded') : tr('ws.manager.stock.count.showRecorded')}
                </Button>
              </>
            }
            style={{ marginBlockEnd: 0 }}
          >
            <SegmentedControl<LineFilter>
              value={lineFilter}
              onChange={setLineFilter}
              aria-label={tr('ws.manager.stock.onHand.table.show')}
              options={[
                { value: 'all', label: tr('ws.kit.common.all') },
                { value: 'left', label: tr('ws.manager.stock.count.notEntered') },
                { value: 'entered', label: tr('ws.manager.stock.count.enteredFilter') },
              ]}
            />
            <span style={{ inlineSize: '14rem', maxInlineSize: '100%' }}>
              <SearchField value={query} onChange={setQuery} placeholder={tr('ws.manager.stock.onHand.table.search')} />
            </span>
            {lines.some((l) => ingredientOf.get(l.ingredient_id)?.kind === 'retail') && <KindFilter value={kind} onChange={setKind} />}
          </Toolbar>
          <ErrorText error={linesQ.error} />
          {visible.length === 0 && lines.length > 0 ? (
            <EmptyState
              kind="filtered"
              onClearFilters={() => {
                setQuery('');
                setLineFilter('all');
              }}
            />
          ) : (
            <DataTable columns={columns} rows={visible} rowKey={(l) => l.ingredient_id} dense aria-label={tr('op.stockNav.counts')} />
          )}
          <Panel>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
              <Footnote>{tr('ws.manager.stock.count.blankKept')}</Footnote>
              <ErrorText error={error} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
                <Button icon="trash" disabled={busy || !can.adjustStock} onClick={() => void discard()} data-testid="count-discard" style={{ color: 'var(--tp-danger-fg)' }}>
                  {tr('ws.stores.counts.discard')}
                </Button>
                <Button
                  kind="primary"
                  icon="check"
                  busy={busy}
                  disabled={!can.adjustStock || invalid.length > 0}
                  disabledReason={!can.adjustStock ? tr('ws.manager.stock.count.notAllowed') : tr('ws.manager.stock.count.fixInvalid', { count: fmt.num(invalid.length) })}
                  onClick={() => void finish()}
                >
                  {tr('ws.manager.stock.count.finish')}
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </AsyncStateWrapper>
  );
}

function StepHint({ children }: { children: string }) {
  return <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>{children}</p>;
}

// ---------------------------------------------------------------------------
// Counts from the phone
// ---------------------------------------------------------------------------

function PhoneCounts({ counts }: { counts: UnfinishedCount[] }) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const storeName = useStoreName();
  const [openId, setOpenId] = useState<string | null>(counts.length === 1 ? counts[0]!.id : null);

  return (
    <Panel
      title={<CardTitle icon="phone">{tr('ws.stores.counts.phone.title')}</CardTitle>}
      actions={<StatusBadge tone="warn" label={tr('ws.stores.counts.phone.waiting', { count: fmt.num(counts.length) })} />}
      data-testid="phone-counts"
    >
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.stores.counts.phone.lead')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {counts.map((c) => {
          const expanded = openId === c.id;
          return (
            <li key={c.id} data-count={c.id} style={{ borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-2-5)' }}>
                <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
                  <strong>{storeName(c.location)}</strong>
                  <bdi style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                    {tr('ws.stores.counts.phone.sentBy', { name: isolate(c.staff?.display_name ?? '—'), when: formatDateTime(new Date(c.started_at), locale) })}
                  </bdi>
                </span>
                <Button size="sm" kind={expanded ? 'ghost' : 'soft'} icon={expanded ? 'chevronUp' : 'chevronDown'} aria-expanded={expanded} onClick={() => setOpenId(expanded ? null : c.id)} data-testid={`phone-count-toggle-${c.id}`}>
                  {expanded ? tr('ws.stores.counts.phone.hide') : tr('ws.stores.counts.phone.review')}
                </Button>
              </div>
              {expanded && <PhoneCountReview count={c} onDone={() => setOpenId(null)} />}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function PhoneCountReview({ count, onDone }: { count: UnfinishedCount; onDone: () => void }) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = usePermissions();
  const linesQ = useQuery({ queryKey: SK.countLines(count.id), queryFn: () => fetchCountLines(count.id) });
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const ingredientOf = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i]));
  /** The manager's corrections; a line not touched keeps what was counted. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const store = (count.location === 'bakery' ? 'bakery' : 'cafe') as StockLocation;
  const storeWord = tr(`ws.stores.inSentence.${store}`);

  const lines = [...(linesQ.data ?? [])].sort((a, b) =>
    pickName(locale, ingredientOf.get(a.ingredient_id) ?? { name_en: '', name_ar: '' }).localeCompare(pickName(locale, ingredientOf.get(b.ingredient_id) ?? { name_en: '', name_ar: '' }), locale),
  );
  const valueOf = (l: CountLineRow) => edits[l.ingredient_id] ?? String(Number(l.counted_qty));
  const invalid = lines.filter((l) => countEntryState(valueOf(l)) !== 'ok');

  async function apply() {
    const ok = await confirm({
      title: tr('ws.stores.counts.phone.applyTitle'),
      body: tr('ws.stores.counts.phone.applyBody', { store: storeWord, count: fmt.num(lines.length) }),
      confirmLabel: tr('ws.stores.counts.phone.apply'),
      kind: 'primary',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('finalize_count', {
        p_count_id: count.id,
        p_lines: lines.map((l) => ({ ingredient_id: l.ingredient_id, counted_qty: Number(valueOf(l)) })),
      });
      toast.ok(tr('ws.stores.counts.phone.applied'));
      onDone();
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void navigate({ to: '/stock/variance' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const ok = await confirm({
      title: tr('ws.stores.counts.phone.discardTitle'),
      body: tr('ws.stores.counts.phone.discardBody', { name: isolate(count.staff?.display_name ?? '—'), store: storeWord }),
      confirmLabel: tr('ws.stores.counts.phone.discardConfirm'),
      kind: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('discard_count', { p_count_id: count.id });
      toast.ok(tr('ws.stores.counts.phone.discarded'));
      onDone();
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<CountLineRow>[] = [
    {
      key: 'ingredient',
      header: tr('op.stock.ingredient'),
      render: (l) => {
        const ing = ingredientOf.get(l.ingredient_id);
        return <bdi style={{ fontWeight: 600 }}>{ing ? pickName(locale, ing) : tr('ws.manager.stock.alerts.unknownIngredient')}</bdi>;
      },
    },
    {
      key: 'recorded',
      header: tr('ws.stores.counts.phone.recordsSaid'),
      numeric: true,
      render: (l) => {
        const ing = ingredientOf.get(l.ingredient_id);
        return <bdi style={{ color: 'var(--tp-muted-fg)' }}>{ing ? fmt.qty(l.theoretical_qty, ing.unit) : fmt.num(l.theoretical_qty)}</bdi>;
      },
    },
    {
      key: 'counted',
      header: tr('ws.stores.counts.phone.counted'),
      align: 'end',
      width: '12rem',
      render: (l) => {
        const ing = ingredientOf.get(l.ingredient_id);
        const bad = countEntryState(valueOf(l)) !== 'ok';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
            <input
              style={{ ...inputStyle, inlineSize: '7rem', textAlign: 'end', borderColor: bad ? 'var(--tp-danger)' : undefined }}
              dir="ltr"
              inputMode="decimal"
              aria-label={ing ? pickName(locale, ing) : l.ingredient_id}
              aria-invalid={bad || undefined}
              value={valueOf(l)}
              disabled={busy || !can.adjustStock}
              onChange={(e) => setEdits((prev) => ({ ...prev, [l.ingredient_id]: e.target.value }))}
            />
            <span style={{ minInlineSize: '2.5rem', textAlign: 'start', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{ing ? fmt.unit(ing.unit) : ''}</span>
          </span>
        );
      },
    },
    {
      key: 'difference',
      header: tr('ws.stores.counts.phone.difference'),
      numeric: true,
      render: (l) => {
        if (countEntryState(valueOf(l)) !== 'ok') return <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>;
        const d = countDifference(Number(valueOf(l)), l.theoretical_qty);
        const ing = ingredientOf.get(l.ingredient_id);
        if (d === 0) return <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.variance.matched')}</span>;
        return (
          <span style={{ display: 'grid', justifyItems: 'end' }}>
            <bdi style={{ fontWeight: 700, color: d < 0 ? 'var(--tp-danger-fg)' : 'var(--tp-fg)' }}>{ing ? fmt.change(d, ing.unit) : fmt.num(d)}</bdi>
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{d < 0 ? tr('ws.manager.stock.variance.missing') : tr('ws.manager.stock.variance.extra')}</span>
          </span>
        );
      },
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-2-5)', paddingBlockEnd: 'var(--tp-sp-2-5)' }} data-testid={`phone-count-${count.id}`}>
      {linesQ.isPending ? (
        <Skeleton lines={3} />
      ) : linesQ.isError ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <ErrorText error={linesQ.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void linesQ.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : (
        <>
          <DataTable columns={columns} rows={lines} rowKey={(l) => l.ingredient_id} dense aria-label={tr('ws.stores.counts.phone.title')} />
          <Footnote>{tr('ws.stores.counts.phone.recordsNote')}</Footnote>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
            <Button icon="trash" disabled={busy || !can.adjustStock} onClick={() => void discard()} data-testid="phone-count-discard" style={{ color: 'var(--tp-danger-fg)' }}>
              {tr('ws.stores.counts.phone.discard')}
            </Button>
            <Button
              kind="primary"
              icon="check"
              busy={busy}
              disabled={!can.adjustStock || invalid.length > 0 || lines.length === 0}
              disabledReason={!can.adjustStock ? tr('ws.manager.stock.count.notAllowed') : tr('ws.manager.stock.count.fixInvalid', { count: fmt.num(invalid.length) })}
              onClick={() => void apply()}
              data-testid="phone-count-apply"
            >
              {tr('ws.stores.counts.phone.apply')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Route alias for the spec name. */
export const PhysicalCountScreen = CountScreen;
