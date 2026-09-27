/**
 * Goods in opened on one scanned receipt (/stock/receive?receipt=<id>; Phase 2
 * Milestone 4b, 0237). The photo on one side, the lines on the other: each read
 * line shows what the receipt printed (wording, quantity and unit, total), how
 * sure the match is and any check that failed, above Goods in's own line
 * editor, prefilled in the ingredient's base unit with the cost per that unit
 * (receiptLogic.draftFromLine). The manager fixes, removes (a delivery fee is
 * not stock) or adds lines, then "Put into stock" books ONE delivery through
 * app.confirm_receipt, which also teaches the wording to the matcher. "Set
 * aside" rejects it; "Read again" asks receipt-scan once more.
 *
 * With no model connected, or when the reading failed, the editor starts with
 * one blank line and the manager types from the photo; the reason is said
 * above it. While a reading runs the screen polls and holds the editor, up to
 * the server's own three minutes (lib/scanReading.ts, on the server's clock);
 * past that the reading is stuck, and Read again and Set aside are open.
 * Set aside is never held by a reading. A reading that lands while the
 * manager is editing waits for them to choose it.
 *
 * Online-only like the rest of Goods in, with one idempotency key per confirm
 * (a new one after a failure: the receipt itself refuses a second booking).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatNumber, formatIQD, isolate } from '@touch/i18n';
import { appRpc, AppRpcError } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { readingState, requestReading, scanErrorKey, serverOffset } from '../../../lib/scanReading';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Skeleton } from '../../../components/ui';
import { EmptyState, MessagePresenter, Money, Panel, StatusBadge, type Tone } from '../../../components/kit';
import { StaffPhoto } from '../../checklists/StaffPhoto';
import { todayIso } from '../../admin/menu/availability';
import { LineEditor } from '../ReceiveDelivery';
import { StoreCountedNotice, StorePicker, useStockFormat } from '../stockUi';
import { isBlankLine, lineProblem, unitCostFromPack } from '../stockLogic';
import { SK, fetchIngredients, fetchSuppliers, fetchUnfinishedCounts, type IngredientRow } from '../stockKeys';
import { SupplierField } from '../SupplierField';
import { bakeryRefused, beingCounted, type StockLocation } from '../storeLogic';
import {
  confirmLines,
  conversion,
  draftFromLine,
  draftsTotal,
  matchTone,
  readReceiptDetail,
  totalOff,
  type ReceiptLine,
  type ReviewDraft,
} from './receiptLogic';

const MATCH_TONE: Record<'sure' | 'check' | 'none', Tone> = { sure: 'success', check: 'warn', none: 'neutral' };

const blank = (): ReviewDraft => ({
  key: crypto.randomUUID(),
  lineId: null,
  ingredientId: '',
  qtyExpected: '',
  qtyReceived: '',
  unitCostIqd: '',
  expiryDate: '',
});

/** The reading's state on the server's clock, from a detail query's data. */
function stateOf(data: unknown, receivedAt: number, now: number) {
  const d = readReceiptDetail(data);
  return readingState(d, now + serverOffset(d?.server_now ?? null, receivedAt));
}

export function ReceiptReview({ receiptId, onBack }: { receiptId: string; onBack: () => void }) {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const q = useQuery({
    queryKey: SK.receipt(receiptId),
    queryFn: () => appRpc<unknown>('receipt_detail', { p_id: receiptId }),
    refetchInterval: (query) => {
      const st = stateOf(query.state.data, query.state.dataUpdatedAt, Date.now());
      // Stuck: the sweeper ends it within a minute; look now and then.
      return st === 'reading' || st === 'waiting' ? 3_000 : st === 'stale' ? 15_000 : false;
    },
  });
  const detail = useMemo(() => readReceiptDetail(q.data), [q.data]);
  // The clock the reading state is judged by, moved on while a reading runs.
  const [tick, setTick] = useState(() => Date.now());
  const state = readingState(detail, tick + serverOffset(detail?.server_now ?? null, q.dataUpdatedAt));
  const live = state === 'reading' || state === 'waiting';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [live]);
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const suppliersQ = useQuery({ queryKey: SK.suppliers, queryFn: fetchSuppliers });
  const countsQ = useQuery({ queryKey: SK.unfinishedCounts, queryFn: fetchUnfinishedCounts, refetchInterval: 60_000 });
  const suppliers = (suppliersQ.data ?? []).filter((s) => s.is_active);
  const deliverable = (ingredientsQ.data ?? []).filter((i) => i.is_active && (i.kind === 'purchased' || i.kind === 'retail'));
  const byId = useMemo(() => new Map(deliverable.map((i) => [i.id, i])), [deliverable]);

  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  /** The reading the drafts were seeded from ('none' before any): a new reading re-seeds them. */
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [supplier, setSupplier] = useState('');
  const [location, setLocation] = useState<StockLocation>('cafe');
  const [idemKey, setIdemKey] = useState(() => `receipt.confirm:${crypto.randomUUID()}`);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** The manager changed the lines since they were seeded: a new reading asks first. */
  const [dirty, setDirty] = useState(false);

  // Seed the editor once per reading, when the ingredients are known
  // (the documented "adjust state while rendering" pattern, no effect).
  const seedKey =
    detail && !live && ingredientsQ.isSuccess && suppliersQ.isSuccess ? (detail.read_at ?? 'none') : null;
  const newReading = seedKey !== null && seededFrom !== null && seedKey !== seededFrom && dirty;
  if (seedKey !== null && seedKey !== seededFrom && detail && !newReading) {
    setSeededFrom(seedKey);
    setDirty(false);
    setDrafts(
      detail.lines.length === 0
        ? [blank()]
        : detail.lines.map((l) => ({
            key: l.id,
            lineId: l.id,
            qtyExpected: '',
            ...draftFromLine(l, l.ingredient_id ? (byId.get(l.ingredient_id) ?? null) : null),
          })),
    );
    if (detail.supplier_id && suppliers.some((s) => s.id === detail.supplier_id)) {
      setSupplierId(detail.supplier_id);
      setSupplier('');
    } else if (detail.supplier_name_read) {
      setSupplierId('');
      setSupplier(detail.supplier_name_read.slice(0, 80));
    }
  }

  if (q.isPending) {
    return (
      <Panel>
        <Skeleton lines={4} />
      </Panel>
    );
  }
  if (!detail || detail.status === 'confirmed' || detail.status === 'rejected') {
    const notFound = q.error instanceof AppRpcError && q.error.code === 'RECEIPT_NOT_FOUND';
    if (!detail && q.isError && !notFound) {
      return (
        <Panel>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
            <ErrorText error={q.error} style={{ marginBlock: 0 }} />
            <Button size="sm" icon="refresh" busy={q.isFetching} onClick={() => void q.refetch()}>
              {tr('ws.kit.async.retry')}
            </Button>
          </div>
        </Panel>
      );
    }
    return (
      <Panel>
        <EmptyState
          icon="receipt"
          title={tr('ws.receipts.review.gone')}
          body={tr('ws.receipts.review.goneBody')}
          action={
            <Button icon="chevronStart" onClick={onBack}>
              {tr('ws.receipts.review.back')}
            </Button>
          }
        />
      </Panel>
    );
  }

  const today = todayIso();
  const lineById = new Map(detail.lines.map((l) => [l.id, l]));
  const ingredients = location === 'bakery' ? deliverable.filter((i) => i.kind !== 'retail') : deliverable;
  const started = drafts.filter((d) => !isBlankLine(d));
  const problems = started.filter((d) => lineProblem(d, today) !== null);
  const shopOnForm = bakeryRefused(started.map((d) => byId.get(d.ingredientId)?.kind));
  const counted = beingCounted(countsQ.data, location);
  const reading = scanning || live;
  const blockReason =
    started.length === 0
      ? tr('ws.receipts.review.noLines')
      : counted
        ? tr('ws.stores.picker.held')
        : location === 'bakery' && shopOnForm
          ? tr('ws.stores.picker.shopCafeOnly')
          : undefined;
  const canConfirm = !reading && problems.length === 0 && blockReason === undefined;
  const drafted = draftsTotal(started);

  function edit(next: (ds: ReviewDraft[]) => ReviewDraft[]) {
    setDirty(true);
    setDrafts(next);
  }

  function patch(key: string, part: Partial<ReviewDraft>) {
    edit((ds) => ds.map((d) => (d.key === key ? { ...d, ...part } : d)));
  }

  function choose(d: ReviewDraft, id: string) {
    const ing = byId.get(id) ?? null;
    const read = d.lineId ? lineById.get(d.lineId) : undefined;
    if (read && ing) {
      // The receipt's own numbers, in this ingredient's unit.
      const next = draftFromLine(read, ing);
      patch(d.key, { ...next, expiryDate: d.expiryDate || next.expiryDate });
      return;
    }
    const packUnitCost = ing ? unitCostFromPack(ing.pack_size, ing.pack_cost_iqd) : null;
    patch(d.key, {
      ingredientId: id,
      unitCostIqd: d.unitCostIqd.trim() === '' && packUnitCost !== null ? String(packUnitCost) : d.unitCostIqd,
    });
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: SK.receipts });
  }

  /** One write at a time: a double click never sends twice. */
  async function once(run: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await run();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** Done elsewhere (another station, or a reply that was lost): show what the receipt is now. */
  function refusedAsDone(e: unknown) {
    if (e instanceof AppRpcError && e.code === 'RECEIPT_ALREADY_DONE') {
      void q.refetch();
      refresh();
    }
  }

  async function putIntoStock() {
    if (!canConfirm) return;
    await once(async () => {
      try {
      await appRpc('confirm_receipt', {
        p_id: receiptId,
        p_lines: confirmLines(started),
        p_supplier_id: supplierId || null,
        p_supplier_name: supplierId ? null : supplier.trim() || null,
        p_location: location,
        p_idempotency_key: idemKey,
      });
      setIdemKey(`receipt.confirm:${crypto.randomUUID()}`);
      toast.ok(tr('ws.receipts.review.confirmed'));
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onBack();
      } catch (e) {
        setError(e);
        // A fresh key for the next try: if this one was booked after all, the
        // receipt refuses a second booking (RECEIPT_ALREADY_DONE), and edits
        // made since are never answered with the first try's replay.
        setIdemKey(`receipt.confirm:${crypto.randomUUID()}`);
        if (e instanceof AppRpcError && e.code === 'STORE_BEING_COUNTED') void countsQ.refetch();
        refusedAsDone(e);
      }
    });
  }

  async function setAside() {
    const ok = await confirm({
      title: tr('ws.receipts.review.rejectTitle'),
      body: tr('ws.receipts.review.rejectBody'),
      confirmLabel: tr('ws.receipts.review.reject'),
      kind: 'danger',
    });
    if (!ok) return;
    await once(async () => {
      try {
        await appRpc('reject_receipt', { p_id: receiptId, p_reason: null });
        toast.ok(tr('ws.receipts.review.rejected'));
        refresh();
        onBack();
      } catch (e) {
        setError(e);
        refusedAsDone(e);
      }
    });
  }

  async function readAgain() {
    if (inFlight.current) return;
    setScanning(true);
    setError(null);
    try {
      const refused = await requestReading({ receipt_id: receiptId });
      if (refused) setError(refused);
      // The manager asked for this reading: it replaces the lines.
      setDirty(false);
      await q.refetch();
      refresh();
    } finally {
      setScanning(false);
    }
  }

  const errorKey = scanErrorKey(detail.error_code);

  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-4)',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
        alignItems: 'start',
      }}
    >
      <Panel title={tr('ws.receipts.review.photo')} style={{ position: 'sticky', insetBlockStart: 0 }}>
        <StaffPhoto path={detail.storage_path} alt={tr('ws.receipts.review.photo')} />
        {(detail.supplier_name_read || detail.receipt_date) && (
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockStart: 'var(--tp-sp-2)' }}>
            {detail.supplier_name_read && <bdi>{tr('ws.receipts.review.supplierRead', { name: isolate(detail.supplier_name_read) })}</bdi>}
            {detail.supplier_name_read && detail.receipt_date && ' · '}
            {detail.receipt_date && tr('ws.receipts.review.dated', { date: formatDate(new Date(`${detail.receipt_date}T12:00:00Z`), locale) })}
          </p>
        )}
      </Panel>

      <Panel
        title={tr('ws.manager.stock.goodsIn.linesTitle')}
        actions={
          <Button size="sm" kind="ghost" icon="refresh" busy={scanning} disabled={busy || reading} onClick={() => void readAgain()} data-testid="receipt.read-again">
            {tr('ws.receipts.review.readAgain')}
          </Button>
        }
        data-testid="receipt-review"
      >
        {reading ? (
          <MessagePresenter tone="info" icon="hourglass" message={tr('ws.receipts.review.reading')} />
        ) : !ingredientsQ.isSuccess || !suppliersQ.isSuccess ? (
          ingredientsQ.isError || suppliersQ.isError ? (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
              <ErrorText error={ingredientsQ.error ?? suppliersQ.error} style={{ marginBlock: 0 }} />
              <Button
                size="sm"
                icon="refresh"
                busy={ingredientsQ.isFetching || suppliersQ.isFetching}
                onClick={() => {
                  void ingredientsQ.refetch();
                  void suppliersQ.refetch();
                }}
              >
                {tr('ws.kit.async.retry')}
              </Button>
            </div>
          ) : (
            <Skeleton lines={3} />
          )
        ) : (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            {state === 'stale' && (
              <MessagePresenter tone="refused" icon="hourglass" message={tr('ws.receipts.review.stale')} />
            )}
            {newReading && (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }} data-testid="receipt.new-reading">
                <MessagePresenter tone="info" message={tr('ws.receipts.review.newReading')} />
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                  <Button size="sm" kind="soft" onClick={() => setDirty(false)}>
                    {tr('ws.receipts.review.useNewReading')}
                  </Button>
                  <Button size="sm" kind="ghost" onClick={() => setSeededFrom(seedKey)}>
                    {tr('ws.receipts.review.keepMine')}
                  </Button>
                </div>
              </div>
            )}
            {errorKey && <MessagePresenter tone="refused" message={tr(errorKey)} />}
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>
              {tr(detail.lines.length > 0 ? 'ws.receipts.review.lead' : 'ws.receipts.review.manualLead')}
            </p>
            <StorePicker
              label={tr('ws.stores.picker.putIn')}
              value={location}
              onChange={setLocation}
              disabled={busy}
              bakeryOff={shopOnForm ? tr('ws.stores.picker.shopCafeOnly') : undefined}
              data-testid="receipt-store"
            />
            {counted && <StoreCountedNotice store={location} />}

            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
              {drafts.map((d, i) => {
                const read = d.lineId ? lineById.get(d.lineId) : undefined;
                return (
                  <LineEditor
                    key={d.key}
                    index={i}
                    line={d}
                    today={today}
                    ingredients={ingredients}
                    ingredient={byId.get(d.ingredientId) ?? null}
                    busy={busy}
                    removable
                    onChoose={(id) => choose(d, id)}
                    onPatch={(part) => patch(d.key, part)}
                    onRemove={() => edit((ds) => ds.filter((x) => x.key !== d.key))}
                    header={read ? <ReadStrip line={read} chosen={d.ingredientId} ingredient={byId.get(d.ingredientId) ?? null} /> : undefined}
                  />
                );
              })}
            </ol>

            <div>
              <Button icon="plus" disabled={busy} onClick={() => edit((ds) => [...ds, blank()])}>
                {tr('ws.receipts.review.addLine')}
              </Button>
            </div>

            {started.length > 0 && (
              <MessagePresenter
                tone={totalOff(drafted, detail.total_iqd_read, started.length) ? 'refused' : 'info'}
                icon="scale"
                message={
                  totalOff(drafted, detail.total_iqd_read, started.length)
                    ? tr('ws.receipts.review.totalOff', {
                        drafted: formatIQD(drafted, locale),
                        printed: formatIQD(detail.total_iqd_read ?? 0, locale),
                      })
                    : tr('ws.receipts.review.total', { drafted: formatIQD(drafted, locale) })
                }
              />
            )}

            <Field label={tr('ws.manager.stock.goodsIn.supplier')} optional>
              <SupplierField
                suppliers={suppliers}
                supplierId={supplierId}
                name={supplier}
                disabled={busy}
                onChange={(id, name) => {
                  setSupplierId(id);
                  setSupplier(name);
                }}
              />
            </Field>
          </div>
        )}

        <ErrorText error={error} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-3)' }}>
          <Button kind="ghost" icon="ban" disabled={busy} onClick={() => void setAside()} data-testid="receipt.reject">
            {tr('ws.receipts.review.reject')}
          </Button>
          <Button
            kind="primary"
            icon="box"
            busy={busy}
            disabled={!canConfirm}
            disabledReason={reading ? undefined : blockReason}
            onClick={() => void putIntoStock()}
            data-testid="receipt.confirm"
          >
            {tr('ws.receipts.review.confirm')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/** What the receipt printed for one line, how sure the match is, and any check that failed. */
function ReadStrip({ line, chosen, ingredient }: { line: ReceiptLine; chosen: string; ingredient: IngredientRow | null }) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  // The manager's own pick counts as sure; the matcher's keeps its tone until changed.
  const picked = chosen !== '' && chosen !== line.ingredient_id;
  const tone = picked ? 'sure' : matchTone({ ...line, ingredient_id: chosen || null });
  const label = picked
    ? tr('ws.receipts.review.match.manual')
    : tone === 'sure' && line.match_source === 'alias'
      ? tr('ws.receipts.review.match.alias')
      : tr(`ws.receipts.review.match.${tone}`);
  const qty = line.qty_read === null ? null : formatNumber(line.qty_read, locale);
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' }} data-testid="receipt.read-line">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.receipts.review.onReceipt')}</span>
        <bdi style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{line.text_read}</bdi>
        {qty !== null && (
          <span dir="auto">
            {line.unit_read
              ? tr('ws.receipts.review.qtyUnit', { qty, unit: isolate(line.unit_read) })
              : tr('ws.receipts.review.qty', { qty })}
          </span>
        )}
        {line.line_total_iqd_read !== null && (
          <span>
            <Money amount={line.line_total_iqd_read} />
          </span>
        )}
        <StatusBadge tone={MATCH_TONE[tone]} label={label} />
        {ingredient && tone !== 'none' && !picked && (
          <span style={{ color: 'var(--tp-muted-fg)' }}>
            {locale === 'ar' ? '←' : '→'} <bdi>{locale === 'ar' ? ingredient.name_ar : ingredient.name_en}</bdi> ({fmt.unit(ingredient.unit)})
          </span>
        )}
      </div>
      {ingredient && line.qty_read !== null && conversion(line.unit_read, ingredient) === 'packs' && (
        <span style={{ color: 'var(--tp-warn-fg)' }} data-testid="receipt.pack-assumed">
          {tr('ws.receipts.review.packAssumed', {
            size: formatNumber(ingredient.pack_size ?? 0, locale),
            unit: fmt.unit(ingredient.unit),
          })}
        </span>
      )}
      {line.flags.length > 0 && (
        <ul style={{ margin: 0, paddingInlineStart: 'var(--tp-sp-4)', color: 'var(--tp-warn-fg)' }}>
          {line.flags.map((f) => (
            <li key={f}>{tr(`ws.receipts.review.flag.${f}`)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
