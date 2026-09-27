/**
 * One scanned order slip on the till (Phase 2 Milestone 4b; 0239): the photo
 * beside the lines the model read, each already on the menu when it matched
 * (the size it named or the item's default, the quantity written or 1, the
 * waiter's note). The cashier fixes an item, a size or a quantity, sets the
 * options through the till's own item sheet (a required group holds the send
 * and says which), removes what was crossed out, picks the table (read off the
 * slip when it could be) and, when the table has several open tabs, the tab.
 * "Send to kitchen" is app.send_order_slip: ONE order through the till's own
 * app.till_add_items, with the kitchen ticket, and the wording is learned for
 * the next slip. "Set aside" rejects it (the waiter sees that on the phone);
 * "Read again" asks receipt-scan once more.
 *
 * With no model connected, or a reading that failed, the list starts with one
 * empty line and the cashier types from the photo. A reading runs for the
 * server's three minutes at most (lib/scanReading.ts); past that Read again
 * and Set aside are open, and Set aside never waits for a reading. A reading
 * that lands while the cashier is editing waits for them to choose it.
 * Online-only, like Goods in: one idempotency key per send, so a double tap or
 * a retry sends once (a new key after a failure: the slip refuses a second send).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import { appRpc, AppRpcError } from '../../../lib/appRpc';
import { deviceId } from '../../../lib/idem';
import { readingState, requestReading, scanErrorKey, serverOffset } from '../../../lib/scanReading';
import { decimalKeystroke } from '../../stock/decimalInput';
import { QK, fetchActiveCafeTables } from '../../../lib/queries';
import { pickName, useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Modal, Select, Skeleton, inputStyle } from '../../../components/ui';
import { MessagePresenter, StatusBadge, type Tone } from '../../../components/kit';
import { StaffPhoto } from '../../checklists/StaffPhoto';
import { ItemSheet } from '../ItemSheet';
import { OPEN_TABS_QUERY, TILL_MENU_QUERY, type ItemRow, type TillMenu } from '../tillData';
import {
  draftFromLine,
  draftProblem,
  itemOfVariant,
  missingGroup,
  readSlipDetail,
  sendItems,
  sendTarget,
  slipItems,
  tableTabs,
  withItem,
  withSheetLine,
  type SlipDraft,
  type SlipLine,
} from './slipLogic';

export const SLIPS_KEY = ['tillSlips'] as const;
export const slipKey = (id: string) => ['tillSlips', id] as const;

const TONE: Record<'sure' | 'check' | 'none', Tone> = { sure: 'success', check: 'warn', none: 'neutral' };

/** The reading's state on the server's clock, from a detail query's data. */
function stateOf(data: unknown, receivedAt: number, now: number) {
  const d = readSlipDetail(data);
  return readingState(d, now + serverOffset(d?.server_now ?? null, receivedAt));
}

const blank = (): SlipDraft => ({ key: crypto.randomUUID(), lineId: null, itemId: '', variantId: '', qty: 1, notes: '', modifiers: [] });

export function SlipReview({ slipId, uploadedBy, onClose }: { slipId: string; uploadedBy: string | null; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const q = useQuery({
    queryKey: slipKey(slipId),
    queryFn: () => appRpc<unknown>('slip_detail', { p_id: slipId }),
    refetchInterval: (query) => {
      const st = stateOf(query.state.data, query.state.dataUpdatedAt, Date.now());
      // Stuck: the sweeper ends it within a minute; look now and then.
      return st === 'reading' || st === 'waiting' ? 3_000 : st === 'stale' ? 15_000 : false;
    },
  });
  const detail = useMemo(() => readSlipDetail(q.data), [q.data]);
  // The clock the reading state is judged by, moved on while a reading runs.
  const [tick, setTick] = useState(() => Date.now());
  const state = readingState(detail, tick + serverOffset(detail?.server_now ?? null, q.dataUpdatedAt));
  const live = state === 'reading' || state === 'waiting';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [live]);
  const menuQ = useQuery({ ...TILL_MENU_QUERY });
  const tabsQ = useQuery({ ...OPEN_TABS_QUERY });
  const tablesQ = useQuery({ queryKey: QK.activeCafeTables, queryFn: fetchActiveCafeTables });
  const menu = menuQ.data;
  const items = useMemo(() => slipItems(menu), [menu]);

  const [drafts, setDrafts] = useState<SlipDraft[]>([]);
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => `slip.send:${crypto.randomUUID()}`);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** The cashier changed the lines since they were seeded: a new reading asks first. */
  const [dirty, setDirty] = useState(false);

  // Seed once per reading, when the menu is known ("adjust state while rendering").
  const seedKey = detail && !live && menu ? (detail.read_at ?? 'none') : null;
  const newReading = seedKey !== null && seededFrom !== null && seedKey !== seededFrom && dirty;
  if (seedKey !== null && seedKey !== seededFrom && detail && !newReading) {
    setSeededFrom(seedKey);
    setDirty(false);
    setDrafts(detail.lines.length === 0 ? [blank()] : detail.lines.map((l) => draftFromLine(l, menu)));
    if (tableId === null) setTableId(detail.table_id);
  }

  const tables = tablesQ.data ?? [];
  const tableNumber = tables.find((t) => t.id === tableId)?.table_number ?? null;
  const onTable = tableTabs(tabsQ.data, tableNumber);
  const target = sendTarget(tableId, onTable, tabId);
  const reading = scanning || live;
  const lineById = new Map((detail?.lines ?? []).map((l) => [l.id, l]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const firstBad = drafts.find((d) => draftProblem(d, itemById.get(d.itemId) ?? null, menu) !== null);
  const firstProblem = firstBad ? draftProblem(firstBad, itemById.get(firstBad.itemId) ?? null, menu) : null;
  const firstMissing = firstBad && menu ? missingGroup(firstBad, itemById.get(firstBad.itemId) ?? null, menu.groups, menu.modifiers) : null;
  const blockReason =
    drafts.length === 0
      ? tr('ws.slips.review.noLines')
      : firstProblem !== null
        ? tr(`ws.slips.review.problem.${firstProblem}` as MessageKey, { group: firstMissing ? pickName(locale, firstMissing) : '' })
        : target === 'choose_table'
          ? tr('ws.slips.review.problem.table')
          : target === 'choose_tab'
            ? tr('ws.slips.review.problem.tab')
            : undefined;

  function edit(next: (ds: SlipDraft[]) => SlipDraft[]) {
    setDirty(true);
    setDrafts(next);
  }
  function patch(key: string, next: (d: SlipDraft) => SlipDraft) {
    edit((ds) => ds.map((d) => (d.key === key ? next(d) : d)));
  }
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: SLIPS_KEY });
  }

  /** One write at a time: a double tap never sends twice. */
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

  /** Done elsewhere (another till, or a reply that was lost): show what the slip is now. */
  function refusedAsDone(e: unknown) {
    if (e instanceof AppRpcError && e.code === 'SLIP_ALREADY_DONE') {
      void q.refetch();
      refresh();
    }
  }

  async function send() {
    if (reading || blockReason !== undefined || typeof target === 'string') return;
    await once(async () => {
      try {
      await appRpc('send_order_slip', {
        p_id: slipId,
        p_items: sendItems(drafts),
        p_tab_id: target.p_tab_id,
        p_table_id: target.p_table_id,
        p_idempotency_key: idemKey,
        p_device_id: deviceId(),
      });
      setIdemKey(`slip.send:${crypto.randomUUID()}`);
      toast.ok(tr('ws.slips.review.sent'));
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['tabs'] });
      onClose();
      } catch (e) {
        setError(e);
        // A fresh key for the next try: if this one went through after all, the
        // slip refuses a second send (SLIP_ALREADY_DONE), and edits made since
        // are never answered with the first try's replay.
        setIdemKey(`slip.send:${crypto.randomUUID()}`);
        refusedAsDone(e);
        if (e instanceof AppRpcError && e.code === 'TAB_AMBIGUOUS') void queryClient.invalidateQueries({ queryKey: ['tabs'] });
      }
    });
  }

  async function setAside() {
    const ok = await confirm({
      title: tr('ws.slips.review.rejectTitle'),
      body: tr('ws.slips.review.rejectBody'),
      confirmLabel: tr('ws.slips.review.reject'),
      kind: 'danger',
    });
    if (!ok) return;
    await once(async () => {
      try {
        await appRpc('reject_order_slip', { p_id: slipId, p_reason: null });
        toast.ok(tr('ws.slips.review.rejected'));
        refresh();
        onClose();
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
      const refused = await requestReading({ slip_id: slipId });
      if (refused) setError(refused);
      // The cashier asked for this reading: it replaces the lines.
      setDirty(false);
      await q.refetch();
      refresh();
    } finally {
      setScanning(false);
    }
  }

  const done = detail && (detail.status === 'sent' || detail.status === 'rejected');
  const sheetDraft = drafts.find((d) => d.key === sheetFor) ?? null;
  const sheetItem = sheetDraft ? (itemById.get(sheetDraft.itemId) ?? null) : null;

  return (
    <Modal
      title={tr('ws.slips.review.title')}
      subtitle={
        detail
          ? tr('ws.slips.review.subtitle', {
              name: isolate(uploadedBy ?? '—'),
              time: detail.created_at ? formatDateTime(new Date(detail.created_at), locale) : '—',
            })
          : undefined
      }
      size="xl"
      onClose={onClose}
      dismissible={!busy}
      footer={
        done || !detail
          ? undefined
          : () => (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', inlineSize: '100%' }}>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
                  <Button kind="ghost" icon="ban" disabled={busy} onClick={() => void setAside()} data-testid="slip.reject">
                    {tr('ws.slips.review.reject')}
                  </Button>
                  <Button kind="ghost" icon="refresh" busy={scanning} disabled={busy || reading} onClick={() => void readAgain()} data-testid="slip.read-again">
                    {tr('ws.slips.review.readAgain')}
                  </Button>
                </div>
                <Button
                  kind="primary"
                  size="lg"
                  icon="flame"
                  busy={busy}
                  disabled={reading || blockReason !== undefined}
                  disabledReason={reading ? undefined : blockReason}
                  onClick={() => void send()}
                  data-testid="slip.send"
                >
                  {tr('ws.slips.review.send')}
                </Button>
              </div>
            )
      }
    >
      {!menu && menuQ.isError ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={menuQ.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" busy={menuQ.isFetching} onClick={() => void menuQ.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : q.isPending || !menu ? (
        <Skeleton lines={5} />
      ) : !detail || done ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {!detail && q.isError && !(q.error instanceof AppRpcError && q.error.code === 'SLIP_NOT_FOUND') ? (
            <ErrorText error={q.error} />
          ) : (
            <MessagePresenter tone="info" message={`${tr('ws.slips.review.gone')}. ${tr('ws.slips.review.goneBody')}`} />
          )}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))',
            alignItems: 'start',
          }}
        >
          <div style={{ position: 'sticky', insetBlockStart: 0 }}>
            <StaffPhoto path={detail.storage_path} alt={tr('ws.slips.review.photo')} />
          </div>

          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="slip-review">
            {reading ? (
              <MessagePresenter tone="info" icon="hourglass" message={tr('ws.slips.review.reading')} />
            ) : (
              <>
                {state === 'stale' && (
                  <MessagePresenter tone="refused" icon="hourglass" message={tr('ws.slips.review.stale')} />
                )}
                {newReading && (
                  <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }} data-testid="slip.new-reading">
                    <MessagePresenter tone="info" message={tr('ws.slips.review.newReading')} />
                    <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                      <Button size="sm" kind="soft" onClick={() => setDirty(false)}>
                        {tr('ws.slips.review.useNewReading')}
                      </Button>
                      <Button size="sm" kind="ghost" onClick={() => setSeededFrom(seedKey)}>
                        {tr('ws.slips.review.keepMine')}
                      </Button>
                    </div>
                  </div>
                )}
                {detail.error_code && <MessagePresenter tone="refused" message={tr(scanErrorKey(detail.error_code)!)} />}
                <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>
                  {tr(detail.lines.length > 0 ? 'ws.slips.review.lead' : 'ws.slips.review.manualLead')}
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--tp-sp-2)' }}>
                  <Field label={tr('ws.slips.review.table')} style={{ marginBlockEnd: 0 }}>
                    <Select
                      value={tableId ?? ''}
                      disabled={busy}
                      onChange={(v) => {
                        setTableId(v || null);
                        setTabId(null);
                      }}
                      options={[
                        { value: '', label: tr('ws.slips.review.chooseTable') },
                        ...tables.map((t) => ({ value: t.id, label: tr('ws.slips.panel.table', { number: t.table_number }) })),
                      ]}
                    />
                  </Field>
                  {onTable.length > 1 && (
                    <Field label={tr('ws.slips.review.tab')} style={{ marginBlockEnd: 0 }}>
                      <Select
                        value={tabId ?? ''}
                        disabled={busy}
                        onChange={(v) => setTabId(v || null)}
                        options={[
                          { value: '', label: tr('ws.slips.review.chooseTab', { count: formatNumber(onTable.length, locale) }) },
                          ...onTable.map((t) => ({
                            value: t.id,
                            label: t.label ?? tr('ws.slips.review.tabLabel', { time: formatDateTime(new Date(t.opened_at), locale) }),
                          })),
                        ]}
                      />
                    </Field>
                  )}
                </div>
                {tableId && onTable.length <= 1 && (
                  <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>
                    {tr(onTable.length === 1 ? 'ws.slips.review.onTab' : 'ws.slips.review.newTab')}
                  </p>
                )}

                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
                  {drafts.map((d, i) => (
                    <SlipLineEditor
                      key={d.key}
                      index={i}
                      draft={d}
                      read={d.lineId ? lineById.get(d.lineId) : undefined}
                      items={items}
                      menu={menu}
                      busy={busy}
                      onItem={(item) => patch(d.key, (x) => withItem(x, item))}
                      onPatch={(part) => patch(d.key, (x) => ({ ...x, ...part }))}
                      onOptions={() => setSheetFor(d.key)}
                      onRemove={() => edit((ds) => ds.filter((x) => x.key !== d.key))}
                    />
                  ))}
                </ol>
                <div>
                  <Button icon="plus" disabled={busy} onClick={() => edit((ds) => [...ds, blank()])}>
                    {tr('ws.slips.review.addLine')}
                  </Button>
                </div>
              </>
            )}
            <ErrorText error={error} />
          </div>
        </div>
      )}

      {sheetDraft && sheetItem && menu && (
        <ItemSheet
          item={sheetItem}
          groups={menu.groups}
          modifiers={menu.modifiers}
          initial={sheetDraft}
          addLabel={tr('common.done')}
          onClose={() => setSheetFor(null)}
          onAdd={(line) => {
            patch(sheetDraft.key, (x) => withSheetLine(x, line));
            setSheetFor(null);
          }}
        />
      )}
    </Modal>
  );
}

function SlipLineEditor({
  index,
  draft,
  read,
  items,
  menu,
  busy,
  onItem,
  onPatch,
  onOptions,
  onRemove,
}: {
  index: number;
  draft: SlipDraft;
  read: SlipLine | undefined;
  items: ItemRow[];
  menu: TillMenu;
  busy: boolean;
  onItem: (item: ItemRow) => void;
  onPatch: (part: Partial<SlipDraft>) => void;
  onOptions: () => void;
  onRemove: () => void;
}) {
  const { tr, locale } = useLocale();
  const item = items.find((i) => i.id === draft.itemId) ?? null;
  const variants = item ? [...item.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order) : [];
  const problem = draftProblem(draft, item, menu);
  const missing = missingGroup(draft, item, menu.groups, menu.modifiers);
  const readItem = read ? itemOfVariant(menu, read.variant_id) : null;
  const picked = read !== undefined && draft.itemId !== '' && draft.variantId !== read.variant_id;
  const tone = !read ? null : picked ? 'sure' : !read.variant_id ? 'none' : read.match_source === 'alias' || (read.confidence ?? 0) >= 0.7 ? 'sure' : 'check';
  const matchLabel = !read || tone === null
    ? null
    : picked
      ? tr('ws.slips.review.match.manual')
      : read.match_source === 'alias'
        ? tr('ws.slips.review.match.alias')
        : tr(`ws.slips.review.match.${tone}`);

  return (
    <li
      data-testid="slip.line"
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
      {read && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
          <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.slips.review.onSlip')}</span>
          <bdi style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{read.text_read}</bdi>
          {read.qty_read !== null && <span>{tr('ws.slips.review.qty', { qty: formatNumber(read.qty_read, locale) })}</span>}
          {read.notes_read && <bdi style={{ color: 'var(--tp-muted-fg)' }}>{locale === 'ar' ? '«' : '“'}{read.notes_read}{locale === 'ar' ? '»' : '”'}</bdi>}
          {matchLabel && tone && <StatusBadge tone={TONE[tone]} label={matchLabel} />}
          {readItem && !picked && tone !== 'none' && (
            <span style={{ color: 'var(--tp-muted-fg)' }}>
              {locale === 'ar' ? '←' : '→'} <bdi>{pickName(locale, readItem)}</bdi>
            </span>
          )}
          {read.flags.map((f) => (
            <span key={f} style={{ color: 'var(--tp-warn-fg)' }}>
              {tr(`ws.slips.review.flag.${f}`)}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(12rem, 2fr) minmax(7rem, 1fr) 5rem auto', gap: 'var(--tp-sp-2)', alignItems: 'end' }}>
        <Field
          label={tr('ws.slips.review.item')}
          style={{ marginBlockEnd: 0 }}
          error={problem === 'item' ? tr('ws.slips.review.problem.item') : undefined}
        >
          <Select
            value={draft.itemId}
            disabled={busy}
            onChange={(id) => {
              const it = items.find((i) => i.id === id);
              if (it) onItem(it);
            }}
            options={[
              { value: '', label: tr('ws.slips.review.choose') },
              ...items.map((i) => ({ value: i.id, label: pickName(locale, i) })),
            ]}
          />
        </Field>
        <Field label={tr('ws.slips.review.size')} style={{ marginBlockEnd: 0 }}>
          <Select
            value={draft.variantId}
            disabled={busy || variants.length <= 1}
            onChange={(v) => onPatch({ variantId: v })}
            options={variants.map((v) => ({ value: v.id, label: pickName(locale, v) }))}
          />
        </Field>
        <Field
          label={tr('ws.slips.review.count')}
          style={{ marginBlockEnd: 0 }}
          error={problem === 'qty' ? tr('ws.slips.review.problem.qty') : undefined}
        >
          {/* Text, not type=number: Arabic-Indic digits are typed on an Arabic
              keyboard, and the box may be emptied while retyping (0 is "no number"). */}
          <input
            style={{ ...inputStyle, textAlign: 'center' }}
            inputMode="numeric"
            dir="ltr"
            value={draft.qty > 0 ? String(draft.qty) : ''}
            disabled={busy}
            onChange={(e) => onPatch({ qty: Number(decimalKeystroke(e.target.value, 2).replace('.', '')) || 0 })}
          />
        </Field>
        <Button
          kind="ghost"
          size="sm"
          icon="x"
          disabled={busy}
          aria-label={tr('ws.slips.review.removeLine', { n: formatNumber(index + 1, locale) })}
          title={tr('ws.slips.review.removeLine', { n: formatNumber(index + 1, locale) })}
          onClick={onRemove}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--tp-sp-2)', alignItems: 'end' }}>
        <Field label={tr('ws.slips.review.notes')} optional style={{ marginBlockEnd: 0 }}>
          <input style={inputStyle} value={draft.notes} maxLength={120} disabled={busy} onChange={(e) => onPatch({ notes: e.target.value })} />
        </Field>
        <Button size="sm" kind={missing ? 'soft' : 'ghost'} icon="sliders" disabled={busy || !item} onClick={onOptions}>
          {tr('ws.slips.review.options')}
        </Button>
      </div>
      {draft.modifiers.length > 0 && (
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.slips.review.optionsSet', { list: draft.modifiers.map((m) => m.name).join(locale === 'ar' ? '، ' : ', ') })}
        </span>
      )}
      {missing && (
        <span role="alert" style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-warn-fg)', fontWeight: 600 }}>
          {tr('ws.slips.review.problem.options', { group: pickName(locale, missing) })}
        </span>
      )}
    </li>
  );
}
