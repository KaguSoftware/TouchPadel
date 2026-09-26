/**
 * Move stock (/stock/moves; docs/design/protocols/wave5-addendum-2026-09-25
 * §2.8.2 D6, §5.2, §7.4): stock carried from one store to the other. The
 * waiter records moves on the phone as he carries them; a manager records one
 * here, above all the first day's "opening move" of what already sits on the
 * bakery shelf, since every batch on record starts in the cafe store.
 *
 * One call, app.transfer_stock, books the whole move: the source store's
 * batches are split FEFO into the destination with the same expiry and cost,
 * so the venue's on-hand and its stock value never change. It refuses the
 * whole move when the source shows less than a line (TRANSFER_SHORT, whose
 * detail is what it shows), a shop product, and any move while a manager's
 * count is open at either store (STORE_BEING_COUNTED). The form says the
 * last two before the manager types anything, and the first under the line.
 *
 * The direction is ONE control, "Cafe store to bakery store" or the other
 * way, so the two stores can never be the same one. No cost anywhere: a move
 * carries quantities only. Online-only, with an idempotency key minted when
 * the form opens, kept across retries and renewed after a move (§5.2).
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime } from '@touch/i18n';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { pickName, useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle, Select } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, MessagePresenter, PageHeader, Panel, SegmentedControl, TableSkeleton, asyncStatus, type Column } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { decimalKeystroke } from './decimalInput';
import { useStockFormat } from './stockUi';
import {
  DIRECTIONS,
  beingCounted,
  directionStores,
  heldAt,
  isBlankMoveLine,
  isFirstMoveDay,
  moveLineProblem,
  movePayload,
  repeatedIngredients,
  shortShows,
  splitByStore,
  type Direction,
  type MoveLineDraft,
} from './storeLogic';
import {
  RECENT_MOVE_DAYS,
  SK,
  fetchByStore,
  fetchIngredients,
  fetchTransferCount,
  fetchTransfers,
  fetchUnfinishedCounts,
  type IngredientRow,
  type TransferRow,
} from './stockKeys';

const emptyLine = (): MoveLineDraft => ({ key: crypto.randomUUID(), ingredientId: '', qty: '', unit: 'base' });

export function MoveStock() {
  const { tr } = useLocale();
  const transferCountQ = useQuery({ queryKey: SK.transferCount, queryFn: fetchTransferCount });
  return (
    <div style={{ maxInlineSize: '60rem' }}>
      <PageHeader title={tr('op.stockNav.moves')} subtitle={tr('ws.stores.moves.lead')} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        {isFirstMoveDay(transferCountQ.data) && (
          <div data-testid="move-first-day">
            <MessagePresenter
              tone="info"
              icon="info"
              message={
                <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                  <strong>{tr('ws.stores.moves.firstDay.title')}</strong>
                  <span>{tr('ws.stores.moves.firstDay.body')}</span>
                </span>
              }
            />
          </div>
        )}
        <MoveForm />
        <RecentMoves />
      </div>
    </div>
  );
}

function MoveForm() {
  const { tr } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<Direction>('cafe_to_bakery');
  const [lines, setLines] = useState<MoveLineDraft[]>([emptyLine()]);
  /**
   * One key per move as sent: a retry of the same lines reuses it; an edited
   * line or direction, or a recorded move, gets a new one. app.claim_replay
   * compares no payload, so a key kept across an edit after a lost answer
   * would replay the first move and record nothing for the second.
   */
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const byStoreQ = useQuery({ queryKey: SK.byStore, queryFn: fetchByStore, refetchInterval: 60_000 });
  const countsQ = useQuery({ queryKey: SK.unfinishedCounts, queryFn: fetchUnfinishedCounts, refetchInterval: 60_000 });

  const { from, to } = directionStores(direction);
  const splits = useMemo(() => splitByStore(byStoreQ.data ?? []), [byStoreQ.data]);
  // Shop stock lives in the cafe store only and never moves (V14).
  const movable = (ingredientsQ.data ?? []).filter((i) => i.is_active && i.kind !== 'retail');
  const byId = new Map(movable.map((i) => [i.id, i]));
  const atSource = movable.filter((i) => heldAt(splits.get(i.id), from) > 0);
  const repeated = repeatedIngredients(lines);
  const started = lines.filter((l) => !isBlankMoveLine(l));
  const problemOf = (l: MoveLineDraft) =>
    moveLineProblem(l, byId.get(l.ingredientId), { onHandAtSource: heldAt(splits.get(l.ingredientId), from), repeated: repeated.has(l.ingredientId) });
  const problems = started.filter((l) => problemOf(l) !== null);
  const countedStore = beingCounted(countsQ.data, from) ? from : beingCounted(countsQ.data, to) ? to : null;
  const ready = started.length > 0 && problems.length === 0 && countedStore === null && byStoreQ.isSuccess;

  const refusal = error instanceof AppRpcError ? error : null;
  const shortLine = refusal?.code === 'TRANSFER_SHORT' ? refusal.hint : undefined;

  function patch(key: string, part: Partial<MoveLineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...part } : l)));
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const args = { p_from: from, p_to: to, p_lines: movePayload(lines) };
      const sig = JSON.stringify(args);
      if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: `stock.move:${crypto.randomUUID()}` };
      await appRpc('transfer_stock', { ...args, p_idempotency_key: keyRef.current.key });
      toast.ok(tr(`ws.stores.moves.moved.${to}`));
      setLines([emptyLine()]);
      keyRef.current = null;
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
      // What the store shows, or the count that holds it, changed under the
      // form: read both again so the lines and the button say so.
      if (e instanceof AppRpcError && (e.code === 'TRANSFER_SHORT' || e.code === 'STORE_BEING_COUNTED')) {
        void byStoreQ.refetch();
        void countsQ.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  const readFailed = [ingredientsQ, byStoreQ].find((q) => q.isError);

  return (
    <Panel title={<CardTitle icon="repeat">{tr('ws.stores.moves.formTitle')}</CardTitle>} data-testid="move-form">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <Field label={tr('ws.stores.moves.direction')} group style={{ marginBlockEnd: 0 }}>
          <SegmentedControl<Direction>
            value={direction}
            onChange={(d) => {
              setDirection(d);
              setError(null);
            }}
            options={DIRECTIONS.map((d) => ({ value: d, label: tr(`ws.stores.moves.${d}`) }))}
          />
        </Field>

        {countedStore && (
          <MessagePresenter
            tone="refused"
            message={
              <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{tr('ws.stores.moves.countBlocked', { store: tr(`ws.stores.inSentence.${countedStore}`) })}</span>
                <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/stock/counts' })}>
                  {tr('ws.stores.picker.openCounts')}
                </Button>
              </span>
            }
          />
        )}

        {readFailed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <ErrorText error={readFailed.error} style={{ marginBlock: 0 }} />
            <Button size="sm" icon="refresh" busy={readFailed.isFetching} onClick={() => void readFailed.refetch()}>
              {tr('ws.kit.async.retry')}
            </Button>
          </div>
        )}

        {ingredientsQ.isSuccess && byStoreQ.isSuccess && atSource.length === 0 ? (
          <EmptyState
            compact
            icon="package"
            title={tr(`ws.stores.moves.nothingAt.${from}`)}
            body={tr('ws.stores.moves.nothingAtBody')}
            action={
              <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/stock/receive' })}>
                {tr('ws.stores.moves.openGoodsIn')}
              </Button>
            }
          />
        ) : (
          <>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
              {lines.map((l, i) => (
                <MoveLine
                  key={l.key}
                  index={i}
                  line={l}
                  options={atSource}
                  ingredient={byId.get(l.ingredientId)}
                  onHandAtSource={heldAt(splits.get(l.ingredientId), from)}
                  from={from}
                  problem={problemOf(l)}
                  refusedShows={shortLine && shortLine === l.ingredientId ? shortShows(refusal?.details) : null}
                  busy={busy}
                  removable={lines.length > 1}
                  onPatch={(part) => patch(l.key, part)}
                  onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                />
              ))}
            </ol>
            <div>
              <Button icon="plus" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                {tr('ws.stores.moves.addLine')}
              </Button>
            </div>
            <ErrorText error={error} style={{ marginBlock: 0 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {started.length > 0 && tr(`ws.stores.moves.${direction}`)}
              </span>
              <Button
                kind="primary"
                icon="repeat"
                busy={busy}
                disabled={!ready}
                disabledReason={countedStore ? tr('ws.stores.picker.held') : tr('ws.stores.moves.moveDisabled')}
                onClick={() => void submit()}
                data-testid="move-submit"
              >
                {tr('ws.stores.moves.move')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

function MoveLine({
  index,
  line,
  options,
  ingredient,
  onHandAtSource,
  from,
  problem,
  refusedShows,
  busy,
  removable,
  onPatch,
  onRemove,
}: {
  index: number;
  line: MoveLineDraft;
  options: IngredientRow[];
  ingredient: IngredientRow | undefined;
  onHandAtSource: number;
  from: 'cafe' | 'bakery';
  problem: ReturnType<typeof moveLineProblem>;
  /** What the store showed when the server refused this line (TRANSFER_SHORT). */
  refusedShows: number | null;
  busy: boolean;
  removable: boolean;
  onPatch: (part: Partial<MoveLineDraft>) => void;
  onRemove: () => void;
}) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const packs = ingredient && ingredient.pack_size !== null && ingredient.pack_size > 0 ? ingredient.pack_size : null;
  const storeWord = tr(`ws.stores.inSentence.${from}`);
  // What the source shows: the server's figure when it refused this line.
  const shows = refusedShows ?? onHandAtSource;
  const showsText = ingredient ? fmt.qty(shows, ingredient.unit) : fmt.num(shows);
  const problemText =
    problem === 'short' || refusedShows !== null
      ? tr('ws.stores.moves.problem.short', { store: storeWord, qty: showsText })
      : problem === 'ingredient' || problem === 'qty' || problem === 'repeat'
        ? tr(`ws.stores.moves.problem.${problem}`)
        : undefined;

  return (
    <li
      data-line={line.ingredientId || `new-${index}`}
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-1-5)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2-5)',
        borderRadius: 'var(--tp-radius-ctl)',
        border: '1px solid var(--tp-border)',
        background: 'var(--tp-surface-2)',
      }}
    >
      {/* The same two rows as a Goods in line: what, then how much. The
          quantity row aligns to its top, so a line's hint or refusal under
          the box never pushes the other controls out of line. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-2)' }}>
        <Field
          label={tr('ws.stores.moves.ingredient')}
          style={{ marginBlockEnd: 0, flex: 1, minInlineSize: 0 }}
          error={problem === 'ingredient' || problem === 'repeat' ? problemText : undefined}
        >
          <Select
            value={line.ingredientId}
            disabled={busy}
            onChange={(id) => onPatch({ ingredientId: id, unit: 'base' })}
            options={[
              { value: '', label: tr('ws.manager.stock.goodsIn.choose') },
              ...options.map((i) => ({ value: i.id, label: pickName(locale, i) })),
              // A line whose ingredient left the source (the direction was
              // turned) keeps its name rather than going blank.
              ...(ingredient && !options.some((o) => o.id === ingredient.id) ? [{ value: ingredient.id, label: pickName(locale, ingredient) }] : []),
            ]}
          />
        </Field>
        <Button
          kind="ghost"
          size="sm"
          icon="x"
          disabled={busy || !removable}
          aria-label={tr('ws.stores.moves.removeLine', { n: fmt.num(index + 1) })}
          title={tr('ws.stores.moves.removeLine', { n: fmt.num(index + 1) })}
          onClick={onRemove}
          style={{ marginBlockEnd: 'var(--tp-sp-1)' }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--tp-sp-2)', alignItems: 'start' }}>
        <Field
          label={ingredient && line.unit === 'base' ? tr('ws.manager.stock.waste.quantityIn', { unit: fmt.unit(ingredient.unit) }) : tr('ws.stores.moves.quantity')}
          required
          style={{ marginBlockEnd: 0 }}
          error={problem === 'qty' || problem === 'short' || refusedShows !== null ? problemText : undefined}
          hint={ingredient ? <bdi>{tr('ws.stores.moves.shows', { qty: showsText })}</bdi> : undefined}
        >
          <input
            style={inputStyle}
            dir="ltr"
            inputMode="decimal"
            value={line.qty}
            disabled={busy}
            aria-invalid={problem === 'qty' || problem === 'short' || undefined}
            onChange={(e) => onPatch({ qty: decimalKeystroke(e.target.value) })}
          />
        </Field>
        {packs !== null && ingredient && (
          <Field label={tr('ws.stores.moves.unit')} group style={{ marginBlockEnd: 0 }}>
            <SegmentedControl<'base' | 'pack'>
              value={line.unit}
              onChange={(u) => onPatch({ unit: u })}
              options={[
                { value: 'base', label: fmt.unit(ingredient.unit), disabled: busy },
                { value: 'pack', label: tr('ws.stores.moves.unitPacks', { size: fmt.qty(packs, ingredient.unit) }), disabled: busy },
              ]}
            />
          </Field>
        )}
      </div>
    </li>
  );
}

function RecentMoves() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const transfersQ = useQuery({ queryKey: SK.transfers, queryFn: fetchTransfers, refetchInterval: 60_000 });
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const ingredientOf = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i]));

  const what = (t: TransferRow) =>
    t.stock_transfer_lines
      .map((l) => {
        const ing = ingredientOf.get(l.ingredient_id);
        return ing ? `${pickName(locale, ing)} ${fmt.qty(l.qty, ing.unit)}` : fmt.num(l.qty);
      })
      .join(' · ');

  const columns: Column<TransferRow>[] = [
    { key: 'when', header: tr('ws.stores.moves.recent.when'), render: (t) => <bdi>{formatDateTime(new Date(t.moved_at), locale)}</bdi> },
    {
      key: 'direction',
      header: tr('ws.stores.moves.recent.direction'),
      render: (t) => (t.from_location === 'cafe' ? tr('ws.stores.moves.cafe_to_bakery') : tr('ws.stores.moves.bakery_to_cafe')),
    },
    { key: 'what', header: tr('ws.stores.moves.recent.what'), render: (t) => <bdi style={{ overflowWrap: 'anywhere' }}>{what(t)}</bdi> },
    { key: 'who', header: tr('ws.stores.moves.recent.who'), render: (t) => (t.staff ? <bdi>{t.staff.display_name}</bdi> : <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>) },
  ];

  return (
    <Panel title={<CardTitle icon="fileText">{tr('ws.stores.moves.recent.title')}</CardTitle>} data-testid="recent-moves">
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-2)' }}>
        {tr('ws.stores.moves.recent.lead', { days: fmt.num(RECENT_MOVE_DAYS) })}
      </p>
      <AsyncStateWrapper
        compact
        status={asyncStatus(transfersQ, (d) => d.length === 0)}
        error={transfersQ.error}
        onRetry={() => void transfersQ.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={3} dense />}
        emptyContent={<EmptyState compact kind="nothingToDo" icon="repeat" titleAs="h3" title={tr('ws.stores.moves.recent.empty', { days: fmt.num(RECENT_MOVE_DAYS) })} body={tr('ws.stores.moves.recent.emptyBody')} />}
      >
        {/* A month of moves can run long: it scrolls inside the panel, so the form stays close. */}
        <DataTable columns={columns} rows={transfersQ.data ?? []} rowKey={(t) => t.id} dense maxBlockSize="28rem" aria-label={tr('ws.stores.moves.recent.title')} />
      </AsyncStateWrapper>
    </Panel>
  );
}

/** Route alias for the spec name. */
export const MoveStockScreen = MoveStock;
