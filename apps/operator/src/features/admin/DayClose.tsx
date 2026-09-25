/**
 * Day close (spec 06.22) — open-day form, then the close: counted cash and
 * the card terminal batch against server figures, blocked states with the
 * rows that cause them (DAY_OPEN_TABS → the tabs, linked into the till;
 * DAY_UNSYNCED → the queued writes), the discounts / voids / refunds / waste
 * summary with authoriser names, and a client-side CSV of the summary.
 *
 * RPCs: app.open_day (0015), app.close_day (0020). Reads: day session (shared
 * QK.day), tabs, v_day_close_summary, v_day_close_adjustments.
 *
 * WHY THIS LAYOUT
 *
 * Closing the day is a short job done in a fixed order, so the left column IS
 * that order: settle the tabs, let the station sync, count the drawer, read
 * the card terminal, close. Each step says whether it is done, the way the
 * Today screen's closing card does, and the close button says which step is
 * still holding it. The previous screen scattered the same job over five
 * panels, printed the open-tabs sentence three times (badge, panel lead,
 * button), started the counted cash at 0 — so a forgotten count closed the
 * day "short by the whole drawer" — and closed without asking.
 *
 * The right column is the day's record: discounts, voids, refunds and waste,
 * each opening those entries in the audit log, then every PIN-authorised
 * adjustment in words ("10% off · whole bill") instead of `discount_percent`.
 *
 * Since the court desk takes payment (0106): the cash and card steps say how
 * much of the day's takings the desk recorded (already inside those figures —
 * the desk keeps its own cash box), an open tab that belongs to a booking also
 * opens that booking, and bookings that were played but never paid are listed
 * above the record as a WARNING. They never hold the close: nothing about them
 * reaches deriveDayCloseState or closeBlock.
 *
 * The daily checklists (0165) follow the same rule: a list with a line nobody
 * ticked on this business day is listed under "Checklists not finished"
 * (app.checklist_day_state), and the close stays open.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatIQD, formatNumber, formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { QK, fetchOpenDay } from '../../lib/queries';
import { sendHeartbeat } from '../../lib/heartbeat';
import { errorCodeToMessageKey } from '../../lib/errors';
import { pickName, useLocale } from '../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../lib/auth';
import { touch, type QueueRowInfo } from '../../ipc/bridge';
import { AmountPad, Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import {
  DataTable,
  EmptyState,
  ExportButton,
  Money,
  PageHeader,
  Panel,
  PermissionRefusedNotice,
  StatusBadge,
  TabStatusIndicator,
  type Column,
} from '../../components/kit';
import { MoneyInput } from '../../components/inputs';
import { useConfirm } from '../../components/ConfirmDialog';
import { downloadCsv, toCsv } from '../analytics/csv';
import type { DayStateList } from '../checklists/checklistLogic';
import { auditDrillHref, tillTabHref, type ExceptionKey } from '../ops/opsLogic';
import { CardTitle, FigureRow, MARK_FG, RowList, Step } from '../ops/OpsVisuals';
import {
  closeBlock,
  dayCloseCsv,
  deriveDayCloseState,
  describeAdjustmentKind,
  knownReason,
  queueErrorCode,
  queueWriteKey,
  unfinishedChecklists,
  unpaidPlayedRows,
  varianceMagnitude,
  varianceSign,
  type CloseResult,
  type DayAdjustmentRow,
  type DayCloseState,
  type DaySummaryRow,
  type UnpaidPlayedBooking,
} from './dayCloseLogic';

interface OpenTabRow {
  id: string;
  status: string;
  label: string | null;
  /** Set when the tab is a booking's bill — the court desk can take it from the booking. */
  reservation_id: string | null;
  table: { table_number: string } | null;
  reservation: { guest_name: string | null } | null;
}

interface LastCloseRow {
  business_date: string;
  cash_variance_iqd: number | null;
}

type Tr = ReturnType<typeof useLocale>['tr'];
type Locale = ReturnType<typeof useLocale>['locale'];

const SUMMARY_COLUMNS =
  'day_session_id, business_date, status, opening_float_iqd, cash_payments_iqd, card_payments_iqd, ' +
  'cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_expected_iqd, card_terminal_batch_iqd, ' +
  'discounts_iqd, adjustment_count, authorizer_names, voided_lines_iqd, voided_line_count, refunds_iqd, refund_count, waste_cost_iqd, ' +
  'desk_cash_iqd, desk_card_iqd';

/** Counted cash ceiling: 999,999,999,999 IQD — twelve digits, past any real drawer. */
const MAX_COUNTED_IQD = 999_999_999_999;

const STATE_TONE: Partial<Record<DayCloseState, 'success' | 'danger' | 'warn' | 'neutral'>> = {
  ready: 'success',
  busy: 'success',
  blockedByOpenTabs: 'danger',
  blockedByUnsyncedQueue: 'warn',
  closed: 'neutral',
};

const showDate = (iso: string, locale: Locale) => formatDate(new Date(`${iso}T00:00:00`), locale);

export function DayClose() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const can = usePermissions();
  const [openingFloat, setOpeningFloat] = useState(0);
  // Null until the manager enters a count: 0 is a real count, "not counted" is not.
  const [countedCash, setCountedCash] = useState<number | null>(null);
  const [cardBatch, setCardBatch] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  // Last night's count, batch and notes must not carry into the next day: a
  // till left on this screen showed step 3 done before anything was counted.
  function startNextDay() {
    setCloseResult(null);
    setCountedCash(null);
    setCardBatch(null);
    setNotes('');
  }

  // Identical query to the till's — same key, same shape, deliberately shared.
  const dayQ = useQuery({ queryKey: QK.day, queryFn: fetchOpenDay });
  const day = dayQ.data ?? null;
  const daySessionId = closeResult?.day_session_id ?? day?.id ?? null;

  const openTabsQ = useQuery({
    queryKey: ['dayOpenTabs', day?.id],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('tabs')
        .select('id, status, label, reservation_id, table:cafe_tables(table_number), reservation:reservations!tabs_reservation_id_fkey(guest_name)')
        .eq('day_session_id', day?.id ?? '')
        .in('status', ['open', 'awaiting_payment']);
      if (err) throw err;
      return data as unknown as OpenTabRow[];
    },
    enabled: Boolean(day),
    refetchInterval: 30_000,
  });

  // Played, not paid (0106): a warning list for the open day. Never a block.
  const unpaidQ = useQuery({
    queryKey: ['unpaidPlayedBookings', day?.id],
    enabled: Boolean(day),
    refetchInterval: 60_000,
    queryFn: async () => unpaidPlayedRows(await appRpc<unknown>('unpaid_played_bookings', { p_day_session_id: day?.id ?? null })),
  });

  // Daily checklists still open on this business day (0165): a warning list.
  // The cache holds the RPC's payload as returned, so the checklists card on
  // /protocols can share the key.
  const checklistsQ = useQuery({
    queryKey: QK.checklistDayState.date(day?.business_date ?? ''),
    enabled: Boolean(day),
    refetchInterval: 60_000,
    queryFn: () => appRpc<unknown>('checklist_day_state', { p_business_date: day?.business_date ?? null }),
  });

  // Day summary (v_day_close_summary, 0020): cash / card payments so far while
  // the day is open; the reconciliation columns once it is closed.
  const summaryQ = useQuery({
    queryKey: ['dayCloseSummary', daySessionId],
    enabled: Boolean(daySessionId),
    queryFn: async (): Promise<DaySummaryRow | null> => {
      const { data, error: err } = await supabase
        .from('v_day_close_summary')
        .select(SUMMARY_COLUMNS)
        .eq('day_session_id', daySessionId ?? '')
        .maybeSingle();
      if (err) throw err;
      return data as unknown as DaySummaryRow | null;
    },
  });

  const adjustmentsQ = useQuery({
    queryKey: ['dayCloseAdjustments', daySessionId],
    enabled: Boolean(daySessionId),
    queryFn: async (): Promise<DayAdjustmentRow[]> => {
      const { data, error: err } = await supabase
        .from('v_day_close_adjustments')
        .select('adjustment_id, tab_id, order_item_id, kind, value, amount_iqd, reason_code, created_at, applied_by_name, authorized_by_name')
        .eq('day_session_id', daySessionId ?? '')
        .order('created_at', { ascending: false });
      if (err) throw err;
      return (data ?? []) as unknown as DayAdjustmentRow[];
    },
  });

  // Client-side pre-check of the durable queue: the server refuses close_day
  // while the heartbeat reports unsynced writes (DAY_UNSYNCED, 0020) — this
  // shows WHICH rows are blocking instead of a bare error code. Browser mode
  // has no queue and returns [].
  const [queueRows, setQueueRows] = useState<QueueRowInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      touch
        .getQueueRows()
        .then((rows) => {
          if (!cancelled) setQueueRows(rows);
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = touch.onQueueUpdate(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // A conflict (409) or failed (deterministic 4xx) row is terminal: the worker
  // will never retry it, so left alone it holds day close shut forever — which
  // is exactly what happened on 2026-09-07 (ITEM_UNAVAILABLE + ALREADY_PAID on
  // an offline till). A manager checks the tab at the till, then dismisses the
  // row behind the same PIN gate as Quit: verify_manager_pin server-side when
  // online, the offline cache in main otherwise (touch:resolve-queue-row
  // re-checks). The row is kept as 'resolved' with who and when.
  const [dismissing, setDismissing] = useState<QueueRowInfo | null>(null);
  const [dismissPin, setDismissPin] = useState('');
  const [dismissError, setDismissError] = useState<unknown>(null);
  const [dismissBusy, setDismissBusy] = useState(false);

  function closeDismiss() {
    setDismissing(null);
    setDismissPin('');
    setDismissError(null);
  }

  async function dismissRow() {
    if (!dismissing) return;
    setDismissBusy(true);
    setDismissError(null);
    try {
      try {
        // verify_manager_pin RETURNS null for a wrong PIN (it raises only for a
        // lockout or a non-staff caller). Treating that null as success cached the
        // wrong PIN as observed and the shell's cache check then passed it: any
        // PIN opened this gate while online. Refuse here, before the cache learns it.
        const authorizer = await appRpc<string | null>('verify_manager_pin', {
          p_pin: dismissPin,
          p_device_id: touch.getStation().stationId,
        });
        if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
        touch.pinObserved(dismissPin, authorizer);
      } catch (e) {
        // Offline: fall through to the cache check in main. A server REFUSAL
        // (PIN_INVALID / PIN_LOCKED) still surfaces.
        if (e instanceof AppRpcError && e.code !== 'UNKNOWN') throw e;
      }
      const res = await touch.resolveQueueRow({ idempotencyKey: dismissing.idempotencyKey, pin: dismissPin });
      if (!('ok' in res)) throw new Error(res.error);
      if (!res.ok) {
        if (res.error === 'pin not recognised') throw new AppRpcError('PIN_INVALID', res.error);
        throw new AppRpcError('QUEUE_ROW_NOT_RESOLVABLE', res.error);
      }
      setQueueRows(await touch.getQueueRows());
      closeDismiss();
    } catch (e) {
      setDismissError(e);
    } finally {
      setDismissBusy(false);
    }
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: QK.day });
    void queryClient.invalidateQueries({ queryKey: ['dayOpenTabs'] });
    void queryClient.invalidateQueries({ queryKey: ['dayCloseSummary'] });
    void queryClient.invalidateQueries({ queryKey: ['dayCloseAdjustments'] });
    void queryClient.invalidateQueries({ queryKey: ['unpaidPlayedBookings'] });
    void queryClient.invalidateQueries({ queryKey: QK.checklistDayState.all });
    void queryClient.invalidateQueries({ queryKey: ['dayLastClose'] });
    void queryClient.invalidateQueries({ queryKey: ['tabs'] });
  }

  async function openDay() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('open_day', { p_opening_float_iqd: openingFloat, p_device_id: deviceId() });
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function closeDay() {
    if (countedCash === null || !day) return;
    // Closing cannot be undone and stops the till, so it is confirmed with the
    // two figures the manager typed, where a slipped digit is still visible.
    const ok = await confirm({
      title: tr('ws.manager.dayClose.confirmTitle', { date: showDate(day.business_date, locale) }),
      body: tr('ws.manager.dayClose.confirmBody', {
        cash: formatIQD(countedCash, locale),
        card: cardBatch !== null ? formatIQD(cardBatch, locale) : tr('ws.manager.dayClose.notEntered'),
      }),
      confirmLabel: tr('ws.manager.dayClose.closeBtn'),
      kind: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      // close_day reads this station's LAST heartbeat (0020: DAY_UNSYNCED when
      // queue_depth > 0). The beat runs every 10s, so a row dismissed seconds
      // ago is still on the server as blocking — send a fresh beat with the
      // depth as it is now. Best effort: if it fails, close_day is the judge.
      try {
        const station = touch.getStation();
        await sendHeartbeat(station.stationId, station.mode === 'till', queueRows.length, station.appVersion);
      } catch {
        // The close below reports its own refusal.
      }
      const res = await appRpc<CloseResult>('close_day', {
        p_cash_counted_iqd: countedCash,
        // A batch of 0 is a reading (a cash-only night), not "not entered".
        p_card_batch_iqd: cardBatch,
        p_notes: notes || null,
        p_device_id: deviceId(),
      });
      setCloseResult(res);
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const openTabs = openTabsQ.data ?? [];
  const summary = summaryQ.data ?? null;
  const adjustments = adjustmentsQ.data ?? [];
  const state = deriveDayCloseState({
    dayLoaded: dayQ.isSuccess || dayQ.isError,
    dayOpen: Boolean(day),
    openTabCount: openTabs.length,
    queuedCount: queueRows.length,
    busy,
    closed: closeResult !== null,
    error,
  });

  const joinNames = (names: readonly string[]) => names.join(locale === 'ar' ? '، ' : ', ');

  function exportCsv() {
    const { headers, rows } = dayCloseCsv(
      {
        figure: tr('ws.manager.dayClose.csv.figure'),
        value: tr('ws.manager.dayClose.csv.value'),
        count: tr('ws.manager.dayClose.csv.count'),
        authorisers: tr('ws.manager.dayClose.csv.authorisers'),
        cashExpected: tr('ws.manager.dayClose.cashExpected'),
        cashCounted: tr('ws.manager.dayClose.cashCounted'),
        variance: tr('ws.manager.dayClose.difference'),
        cardExpected: tr('ws.manager.dayClose.cardExpected'),
        cardBatch: tr('ws.manager.dayClose.cardBatchShort'),
        discounts: tr('ws.manager.dayClose.discounts'),
        voids: tr('ws.manager.dayClose.voids'),
        refunds: tr('ws.manager.dayClose.refunds'),
        waste: tr('ws.manager.dayClose.waste'),
        openingFloat: tr('ws.manager.dayClose.openingFloat'),
        cashPayments: tr('ws.manager.dayClose.cashPayments'),
        cardPayments: tr('ws.manager.dayClose.cardPayments'),
        deskCash: tr('ws.manager.dayClose.deskCash'),
        deskCard: tr('ws.manager.dayClose.deskCard'),
      },
      closeResult,
      summary,
      adjustments,
      joinNames,
      (a) => adjustmentWords(a, tr).join(' · '),
    );
    const date = closeResult?.business_date ?? day?.business_date ?? 'day';
    downloadCsv(`day-close-${date}.csv`, toCsv(headers, rows));
  }

  // ---------------------------------------------------------------- loading
  if (state === 'loading') {
    return (
      <div>
        <PageHeader title={tr('ws.manager.dayClose.title')} />
        <Panel>
          <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('common.loading')}</p>
        </Panel>
      </div>
    );
  }

  // ------------------------------------------------------------- no open day
  if (state === 'noOpenDay') {
    return (
      <div>
        <PageHeader title={tr('ws.manager.dayClose.openDayTitle')} subtitle={tr('ws.manager.dayClose.openDayLead')} />
        <ErrorText error={dayQ.error} />
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap', alignItems: 'start' }}>
          <Panel style={{ flex: '0 1 28rem', minInlineSize: 0 }}>
            <Field label={tr('ws.manager.dayClose.openingFloatInput')}>
              <input
                style={{ ...inputStyle, textAlign: 'end', fontSize: 'var(--tp-fs-xl)' }}
                dir="ltr"
                inputMode="numeric"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(Number(e.target.value.replace(/\D/g, '')) || 0)}
              />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'center', marginBlockEnd: 'var(--tp-sp-2-5)' }}>
              <AmountPad value={openingFloat} onChange={setOpeningFloat} onConfirm={() => void openDay()} disabled={busy} />
            </div>
            <ErrorText error={error} />
            {!can.closeDay && <PermissionRefusedNotice action={tr('ws.manager.dayClose.openDayBtn')} requiredRole={requiredRoleFor('closeDay')} style={{ marginBlockEnd: 'var(--tp-sp-2)' }} />}
            <Button kind="primary" size="lg" icon="sun" busy={busy} disabled={!can.closeDay} onClick={() => void openDay()}>
              {tr('ws.manager.dayClose.openDayBtn')}
            </Button>
          </Panel>
          <LastClose />
        </div>
      </div>
    );
  }

  const businessDate = closeResult?.business_date ?? day?.business_date ?? null;
  const block = closeBlock(state, countedCash);
  const stateTone = STATE_TONE[state];

  // The subtitle is the business day itself — which day, since when, with what
  // float — rather than a description of the screen.
  const subtitle = day
    ? tr('ws.manager.dayClose.subtitle', {
        date: showDate(day.business_date, locale),
        time: formatTime(new Date(day.opened_at), locale),
        float: formatIQD(day.opening_float_iqd, locale),
      })
    : undefined;

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.dayClose.title')}
        subtitle={subtitle && <bdi>{subtitle}</bdi>}
        actions={<ExportButton onExport={exportCsv} disabled={!summary && !closeResult} scope={tr('ws.manager.dayClose.export')} />}
      />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(24rem, 1fr))', alignItems: 'start' }}>
        {/* ------------------------------------------------ the close itself */}
        {closeResult && businessDate ? (
          <ClosedResult result={closeResult} businessDate={businessDate} onNextDay={startNextDay} />
        ) : (
          <Panel
            title={<CardTitle icon="sun">{tr('ws.manager.dayClose.stepsTitle')}</CardTitle>}
            actions={stateTone && state !== 'closed' ? <StatusBadge tone={stateTone} label={tr(`ws.manager.dayClose.state.${state === 'busy' ? 'ready' : (state as 'ready' | 'blockedByOpenTabs' | 'blockedByUnsyncedQueue')}`)} /> : undefined}
          >
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-4)' }}>
              <Step
                index={1}
                title={tr('ws.manager.dayClose.steps.tabs')}
                done={openTabs.length === 0}
                tone="danger"
                status={
                  openTabs.length === 0
                    ? tr('ws.manager.dayClose.steps.tabsDone')
                    : tr('ws.manager.dayClose.steps.tabsLeft', { count: formatNumber(openTabs.length, locale) })
                }
              >
                {openTabs.length > 0 && (
                  <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                    <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.steps.tabsHint')}</p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
                      {openTabs.map((t) => (
                        <li
                          key={t.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--tp-sp-2)',
                            flexWrap: 'wrap',
                            paddingBlock: 'var(--tp-sp-1)',
                            paddingInline: 'var(--tp-sp-2)',
                            borderRadius: 'var(--tp-radius-ctl)',
                            background: 'var(--tp-surface-2)',
                          }}
                        >
                          <bdi style={{ fontWeight: 600, minInlineSize: 0, overflowWrap: 'anywhere', flex: '1 1 10rem' }}>{tabName(t, tr)}</bdi>
                          <TabStatusIndicator status={t.status} size="sm" />
                          <Button size="sm" kind="soft" icon="receipt" iconEnd="arrowUpRight" onClick={() => void navigate({ href: tillTabHref(t.id) })}>
                            {tr('ws.manager.dayClose.openTab')}
                          </Button>
                          {t.reservation_id && (
                            <Button
                              size="sm"
                              kind="soft"
                              icon="calendar"
                              iconEnd="arrowUpRight"
                              onClick={() => void navigate({ to: '/desk/bookings/$id', params: { id: t.reservation_id as string } })}
                            >
                              {tr('ws.manager.dayClose.openBooking')}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Step>

              <Step
                index={2}
                title={tr('ws.manager.dayClose.steps.sync')}
                done={queueRows.length === 0}
                tone="warn"
                status={
                  queueRows.length === 0
                    ? tr('ws.manager.dayClose.steps.syncDone')
                    : tr('ws.manager.dayClose.steps.syncLeft', { count: formatNumber(queueRows.length, locale) })
                }
              >
                {queueRows.length > 0 && (
                  <div data-testid="day-close-queue" data-queue-rows style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                    <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.dayClose.unsyncedHint')}</p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
                      {queueRows.map((row) => (
                        <QueueRow
                          key={row.seq}
                          row={row}
                          canDismiss={can.closeDay}
                          onDismiss={() => {
                            setDismissError(null);
                            setDismissPin('');
                            setDismissing(row);
                          }}
                        />
                      ))}
                    </ul>
                  </div>
                )}
              </Step>

              <Step
                index={3}
                title={tr('ws.manager.dayClose.steps.count')}
                done={countedCash !== null}
                tone="neutral"
                status={countedCash !== null ? tr('ws.manager.dayClose.steps.countDone') : undefined}
              >
                <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                  <RowList chevrons={false}>
                    <FigureRow label={tr('ws.manager.dayClose.openingFloat')} value={<Money amount={day?.opening_float_iqd ?? summary?.opening_float_iqd} />} />
                    <FigureRow label={tr('ws.manager.dayClose.cashPayments')} value={<Money amount={summary?.cash_payments_iqd} />} />
                    {summary?.desk_cash_iqd != null && (
                      <FigureRow label={tr('ws.manager.dayClose.deskCash')} hint={tr('ws.manager.dayClose.deskCashHint')} value={<Money amount={summary.desk_cash_iqd} />} />
                    )}
                  </RowList>
                  <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap', alignItems: 'start' }}>
                    <Field label={tr('ws.manager.dayClose.countedCash')} hint={tr('ws.manager.dayClose.countedHint')} style={{ flex: '1 1 13rem', minInlineSize: 0, marginBlockEnd: 0 }}>
                      <MoneyInput
                        value={countedCash}
                        onChange={setCountedCash}
                        allowEmpty
                        max={MAX_COUNTED_IQD}
                        disabled={busy}
                        style={{ fontSize: 'var(--tp-fs-xl)' }}
                      />
                    </Field>
                    <AmountPad nullable value={countedCash} onChange={setCountedCash} max={MAX_COUNTED_IQD} disabled={busy} />
                  </div>
                </div>
              </Step>

              <Step
                index={4}
                title={tr('ws.manager.dayClose.steps.card')}
                done={cardBatch !== null}
                tone="neutral"
                status={cardBatch === null ? tr('ws.manager.dayClose.steps.cardOptional') : undefined}
              >
                <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                  <RowList chevrons={false}>
                    <FigureRow label={tr('ws.manager.dayClose.cardPayments')} value={<Money amount={summary?.card_payments_iqd} />} />
                    {summary?.desk_card_iqd != null && (
                      <FigureRow label={tr('ws.manager.dayClose.deskCard')} hint={tr('ws.manager.dayClose.deskCardHint')} value={<Money amount={summary.desk_card_iqd} />} />
                    )}
                  </RowList>
                  <Field label={tr('ws.manager.dayClose.cardBatch')} hint={tr('ws.manager.dayClose.cardBatchHint')} style={{ marginBlockEnd: 0 }}>
                    <MoneyInput value={cardBatch} onChange={setCardBatch} allowEmpty disabled={busy} />
                  </Field>
                </div>
              </Step>

              <Step index={5} title={tr('ws.manager.dayClose.steps.close')} done={false} tone={block === null ? 'success' : 'neutral'}>
                <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
                  <Field label={tr('ws.manager.dayClose.notes')} hint={tr('ws.manager.dayClose.notesHint')} style={{ marginBlockEnd: 0 }}>
                    <input style={inputStyle} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                  <ErrorText error={error} style={{ marginBlock: 0 }} />
                  {!can.closeDay && <PermissionRefusedNotice action={tr('ws.manager.dayClose.closeBtn')} requiredRole={requiredRoleFor('closeDay')} />}
                  <div>
                    <Button
                      kind={block === null ? 'danger' : 'default'}
                      size="lg"
                      icon="lock"
                      busy={busy}
                      disabled={!can.closeDay || block !== null}
                      // One reason, naming the step that holds the close — the
                      // manager scrolled past that step to get here (rulebook 4.3).
                      disabledReason={block ? tr(`ws.manager.dayClose.block.${block}`) : undefined}
                      onClick={() => void closeDay()}
                    >
                      {tr('ws.manager.dayClose.closeBtn')}
                    </Button>
                  </div>
                </div>
              </Step>
            </ol>
          </Panel>
        )}

        {/* ------------------------------------------------ the day's record */}
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', minInlineSize: 0 }}>
          {!closeResult && (
            <UnpaidPlayed
              rows={unpaidQ.data ?? []}
              error={unpaidQ.error}
              onRetry={() => void unpaidQ.refetch()}
              onOpenBooking={(id) => void navigate({ to: '/desk/bookings/$id', params: { id } })}
            />
          )}
          {!closeResult && (
            <ChecklistsOpen lists={unfinishedChecklists(checklistsQ.data)} error={checklistsQ.error} onRetry={() => void checklistsQ.refetch()} />
          )}
          <DaySummary summary={summary} error={summaryQ.error} joinNames={joinNames} />
          <Panel title={<CardTitle icon="shield">{tr('ws.manager.dayClose.adjustmentsTitle')}</CardTitle>}>
            <ErrorText error={adjustmentsQ.error} />
            {adjustments.length === 0 ? (
              <EmptyState compact kind="nothingToDo" icon="shield" title={tr('ws.manager.dayClose.noAdjustments')} />
            ) : (
              <>
                <p style={{ marginBlockEnd: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  {tr('ws.manager.dayClose.adjustmentsLead')}
                </p>
                <DataTable<DayAdjustmentRow> dense rows={adjustments} rowKey={(a) => a.adjustment_id} columns={adjustmentColumns(tr, locale)} aria-label={tr('ws.manager.dayClose.adjustmentsTitle')} />
              </>
            )}
          </Panel>
        </div>
      </div>

      {dismissing && (
        <Modal
          title={tr('op.dayClose.dismissTitle')}
          size="sm"
          onClose={closeDismiss}
          footer={
            <>
              <Button onClick={closeDismiss} disabled={dismissBusy}>{tr('common.cancel')}</Button>
              <Button kind="danger" busy={dismissBusy} disabled={dismissPin.length < 4} onClick={() => void dismissRow()}>
                {tr('op.dayClose.dismissRow')}
              </Button>
            </>
          }
        >
          <p style={{ fontSize: 'var(--tp-fs-sm)', marginBlockStart: 0 }}>{tr('op.dayClose.dismissLead')}</p>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr(`ws.manager.dayClose.writes.${queueWriteKey(dismissing.mutationType)}`)} · {tr(`op.queue.state.${dismissing.state}`)}
          </p>
          <Field label={tr('op.common.pin')}>
            <input
              style={inputStyle}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              autoFocus
              value={dismissPin}
              onChange={(e) => setDismissPin(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <ErrorText error={dismissError} />
        </Modal>
      )}
    </div>
  );
}

/** Route alias for the spec name. */
export const DayCloseScreen = DayClose;

function tabName(t: OpenTabRow, tr: Tr): string {
  if (t.table) return tr('ws.manager.dayClose.tabTable', { number: t.table.table_number });
  return t.reservation?.guest_name ?? t.label ?? tr('ws.manager.dayClose.tabUnnamed');
}

/** One write this station has not synced: what it was, where it is, and — if it never will — the way out. */
function QueueRow({ row, canDismiss, onDismiss }: { row: QueueRowInfo; canDismiss: boolean; onDismiss: () => void }) {
  const { tr } = useLocale();
  const code = queueErrorCode(row.lastError);
  const refused = row.state === 'conflict' || row.state === 'failed';
  const errorKey = code ? errorCodeToMessageKey(code) : null;
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-2)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--tp-sp-1)',
        paddingInline: 'var(--tp-sp-2)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
        fontSize: 'var(--tp-fs-sm)',
      }}
    >
      <span style={{ display: 'grid', flex: '1 1 12rem', minInlineSize: 0 }}>
        <strong>{tr(`ws.manager.dayClose.writes.${queueWriteKey(row.mutationType)}`)}</strong>
        <span style={{ color: refused ? MARK_FG.danger : 'var(--tp-muted-fg)' }}>
          {tr(`op.queue.state.${row.state}`)}
          {refused && errorKey && errorKey !== 'errors.generic' ? ` — ${tr(errorKey)}` : ''}
        </span>
      </span>
      {refused && (
        <Button size="sm" kind="soft" icon="x" disabled={!canDismiss} onClick={onDismiss}>
          {tr('op.dayClose.dismissRow')}
        </Button>
      )}
    </li>
  );
}

/**
 * Bookings played on this business day whose court fee was never taken. A
 * warning in the warn tone, not a block: the close stays open (decided
 * 2026-09-17 — refusing it would hold the whole venue's day for one guest who
 * left). Nothing to list, nothing rendered.
 */
function UnpaidPlayed({
  rows,
  error,
  onRetry,
  onOpenBooking,
}: {
  rows: readonly UnpaidPlayedBooking[];
  error: unknown;
  onRetry: () => void;
  onOpenBooking: (reservationId: string) => void;
}) {
  const { tr, locale } = useLocale();
  if (rows.length === 0 && error == null) return null;
  return (
    <Panel
      title={<CardTitle icon="court">{tr('ws.manager.dayClose.unpaid.title')}</CardTitle>}
      actions={rows.length > 0 ? <StatusBadge tone="warn" label={tr('ws.manager.dayClose.unpaid.badge', { count: formatNumber(rows.length, locale) })} /> : undefined}
    >
      {rows.length === 0 ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={onRetry}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.unpaid.lead')}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {rows.map((r) => {
              const court =
                r.court_name_en && r.court_name_ar ? pickName(locale, { name_en: r.court_name_en, name_ar: r.court_name_ar }) : (r.court_name_en ?? r.court_name_ar ?? '');
              return (
                <li
                  key={r.reservation_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--tp-sp-2)',
                    flexWrap: 'wrap',
                    paddingBlock: 'var(--tp-sp-1)',
                    paddingInline: 'var(--tp-sp-2)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    background: 'var(--tp-surface-2)',
                    fontSize: 'var(--tp-fs-sm)',
                  }}
                >
                  <span style={{ display: 'grid', flex: '1 1 12rem', minInlineSize: 0 }}>
                    <bdi style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.guest_name ?? tr('ws.manager.dayClose.unpaid.noName')}</bdi>
                    <bdi style={{ color: 'var(--tp-muted-fg)' }}>
                      {formatTime(new Date(r.start_at), locale)}
                      {court ? ` · ${court}` : ''}
                    </bdi>
                  </span>
                  <span style={{ display: 'grid', justifyItems: 'end' }}>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.unpaid.owed')}</span>
                    <Money amount={r.remaining_iqd} strong style={{ color: MARK_FG.warn }} />
                  </span>
                  <Button size="sm" kind="soft" icon="calendar" iconEnd="arrowUpRight" onClick={() => onOpenBooking(r.reservation_id)}>
                    {tr('ws.manager.dayClose.openBooking')}
                  </Button>
                </li>
              );
            })}
          </ul>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
        </div>
      )}
    </Panel>
  );
}

/** How many of a list's open lines are named before "+N more": the list is a reminder, not the checklist. */
const OPEN_LINES_SHOWN = 3;

/**
 * The daily lists that still have a line nobody ticked. A warning in the warn
 * tone, never a block (plan §7.3): the staff tick them on their phones, and a
 * forgotten tick must not hold the venue's day. Nothing to list, nothing
 * rendered.
 */
function ChecklistsOpen({ lists, error, onRetry }: { lists: readonly DayStateList[]; error: unknown; onRetry: () => void }) {
  const { tr, locale } = useLocale();
  if (lists.length === 0 && error == null) return null;
  return (
    <Panel
      // An hourglass, not a tick: the panel lists what is NOT done.
      title={<CardTitle icon="hourglass">{tr('ws.supplies.dayClose.title')}</CardTitle>}
      actions={lists.length > 0 ? <StatusBadge tone="warn" label={tr('ws.supplies.dayClose.badge', { count: formatNumber(lists.length, locale) })} /> : undefined}
      data-testid="day-close-checklists"
    >
      {lists.length === 0 ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={onRetry}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.supplies.dayClose.lead')}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {lists.map((l) => {
              const shown = l.open_items.slice(0, OPEN_LINES_SHOWN);
              const more = l.open_items.length - shown.length;
              return (
                <li
                  key={`${l.role}:${l.slot}`}
                  style={{
                    display: 'grid',
                    gap: 'var(--tp-sp-0)',
                    paddingBlock: 'var(--tp-sp-1)',
                    paddingInline: 'var(--tp-sp-2)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    background: 'var(--tp-surface-2)',
                    fontSize: 'var(--tp-fs-sm)',
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                    <strong>{tr('ws.supplies.dayClose.list', { role: tr(`op.roles.${l.role}`), slot: tr(`work.checklist.slot.${l.slot}`) })}</strong>
                    <span style={{ color: MARK_FG.warn, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {tr('ws.supplies.dayClose.progress', { done: formatNumber(l.done, locale), total: formatNumber(l.total, locale) })}
                    </span>
                  </span>
                  <span style={{ color: 'var(--tp-muted-fg)', overflowWrap: 'anywhere' }}>
                    <bdi>{shown.map((i) => (locale === 'ar' ? i.text_ar : i.text_en)).join(locale === 'ar' ? '، ' : ', ')}</bdi>
                    {more > 0 ? ` ${tr('ws.supplies.dayClose.more', { count: formatNumber(more, locale) })}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
        </div>
      )}
    </Panel>
  );
}

const SUMMARY_KEYS = ['discounts', 'voids', 'refunds', 'waste'] as const satisfies readonly ExceptionKey[];

function DaySummary({ summary, error, joinNames }: { summary: DaySummaryRow | null; error: unknown; joinNames: (n: readonly string[]) => string }) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const figures: Record<(typeof SUMMARY_KEYS)[number], { amount: number; count: number | null }> | null = summary
    ? {
        discounts: { amount: summary.discounts_iqd, count: summary.adjustment_count },
        voids: { amount: summary.voided_lines_iqd, count: summary.voided_line_count },
        refunds: { amount: summary.refunds_iqd, count: summary.refund_count },
        waste: { amount: summary.waste_cost_iqd, count: null },
      }
    : null;
  const names = summary?.authorizer_names ?? [];
  return (
    <Panel title={<CardTitle icon="fileText">{tr('ws.manager.dayClose.summaryTitle')}</CardTitle>}>
      <ErrorText error={error} />
      {!figures ? (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('common.loading')}</p>
      ) : (
        <>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.manager.dayClose.summaryLead')}</p>
          <RowList chevrons>
            {SUMMARY_KEYS.map((k) => (
              <FigureRow
                key={k}
                label={tr(`ws.manager.dayClose.${k}`)}
                hint={figures[k].count === null ? undefined : tr('ws.manager.dayClose.recorded', { count: formatNumber(figures[k].count ?? 0, locale) })}
                value={<Money amount={figures[k].amount} />}
                onOpen={() => void navigate({ href: auditDrillHref(k) })}
              />
            ))}
            <FigureRow
              label={tr('ws.manager.dayClose.authorisers')}
              value={
                names.length > 0 ? (
                  <bdi>{joinNames(names)}</bdi>
                ) : (
                  <span style={{ fontWeight: 400, color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.noAuthoriser')}</span>
                )
              }
            />
          </RowList>
        </>
      )}
    </Panel>
  );
}

/** The screen after a successful close: the server's final figures, then the way on. */
function ClosedResult({ result, businessDate, onNextDay }: { result: CloseResult; businessDate: string; onNextDay: () => void }) {
  const { tr, locale } = useLocale();
  return (
    <Panel
      title={<CardTitle icon="checkCircle">{tr('ws.manager.dayClose.closedTitle', { date: showDate(businessDate, locale) })}</CardTitle>}
      actions={<StatusBadge tone="neutral" icon="check" label={tr('ws.manager.dayClose.state.closed')} />}
    >
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.manager.dayClose.closedLead')}</p>
      <RowList chevrons={false}>
        <FigureRow label={tr('ws.manager.dayClose.cashExpected')} value={<Money amount={result.cash_expected_iqd} />} />
        <FigureRow label={tr('ws.manager.dayClose.cashCounted')} value={<Money amount={result.cash_counted_iqd} />} />
        <FigureRow label={tr('ws.manager.dayClose.difference')} value={<VarianceText variance={result.cash_variance_iqd} />} />
        <FigureRow label={tr('ws.manager.dayClose.cardExpected')} value={<Money amount={result.card_expected_iqd} />} />
        <FigureRow label={tr('ws.manager.dayClose.cardBatchShort')} value={<Money amount={result.card_terminal_batch_iqd} />} />
      </RowList>
      <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
        <Button kind="primary" icon="sun" onClick={onNextDay}>
          {tr('ws.manager.dayClose.nextDay')}
        </Button>
      </div>
    </Panel>
  );
}

/**
 * Beside the open-day form: how the last day ended. A manager opening the
 * morning wants to know whether last night's drawer was short before they
 * count a new float into it.
 */
function LastClose() {
  const { tr, locale } = useLocale();
  const lastQ = useQuery({
    queryKey: ['dayLastClose'],
    queryFn: async (): Promise<LastCloseRow | null> => {
      const { data, error } = await supabase
        .from('v_day_close_summary')
        .select('business_date, cash_variance_iqd')
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as LastCloseRow | null;
    },
  });
  if (lastQ.isPending || lastQ.isError) return null;
  const last = lastQ.data;
  return (
    <Panel title={<CardTitle icon="clock">{tr('ws.manager.dayClose.lastClose')}</CardTitle>} style={{ flex: '0 1 22rem', minInlineSize: 0 }}>
      {last ? (
        <RowList chevrons={false}>
          <FigureRow label={tr('ws.manager.dayClose.lastCloseLine', { date: showDate(last.business_date, locale) })} value={last.cash_variance_iqd === null ? null : <VarianceText variance={last.cash_variance_iqd} />} />
        </RowList>
      ) : (
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.lastCloseNone')}</p>
      )}
    </Panel>
  );
}

/** "10% off", "whole bill", "Complimentary" — the three things a row of tab_adjustments says. */
function adjustmentWords(a: DayAdjustmentRow, tr: Tr): string[] {
  const { kind, percent } = describeAdjustmentKind(a);
  const what = kind === 'percent' && percent !== null ? tr('ws.manager.dayClose.kind.percent', { percent }) : tr(`ws.manager.dayClose.kind.${kind === 'percent' ? 'other' : kind}`);
  const scope = a.order_item_id ? tr('ws.manager.dayClose.scopeItem') : tr('ws.manager.dayClose.scopeBill');
  return [what, scope, reasonWords(a.reason_code, tr)].filter((s): s is string => Boolean(s));
}

function reasonWords(code: string | null, tr: Tr): string | null {
  if (!code) return null;
  if (code === 'promotion') return tr('ws.manager.dayClose.reasonPromotion');
  const known = knownReason(code);
  return known ? tr(`op.reasons.${known}`) : code;
}

function adjustmentColumns(tr: Tr, locale: Locale): Column<DayAdjustmentRow>[] {
  return [
    { key: 'time', header: tr('ws.manager.dayClose.time'), render: (a) => <bdi>{formatTime(new Date(a.created_at), locale)}</bdi> },
    {
      key: 'what',
      header: tr('ws.manager.dayClose.what'),
      render: (a) => {
        const [what, scope] = adjustmentWords({ ...a, reason_code: null }, tr);
        return (
          <span style={{ display: 'grid' }}>
            <span>{what}</span>
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{scope}</span>
          </span>
        );
      },
    },
    { key: 'amount', header: tr('ws.manager.dayClose.amount'), numeric: true, render: (a) => <Money amount={a.amount_iqd} /> },
    { key: 'reason', header: tr('ws.manager.dayClose.reason'), render: (a) => reasonWords(a.reason_code, tr) ?? '—' },
    {
      key: 'who',
      header: tr('ws.manager.dayClose.who'),
      render: (a) => (
        <span style={{ display: 'grid' }}>
          <bdi>{a.applied_by_name ?? '—'}</bdi>
          {/* The PIN holder only when it was someone else: the same name twice
              in two columns made every row look like two people. */}
          {a.authorized_by_name && a.authorized_by_name !== a.applied_by_name && (
            <bdi style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.pinBy', { name: a.authorized_by_name })}</bdi>
          )}
        </span>
      ),
    },
  ];
}

function VarianceText({ variance }: { variance: number }) {
  const { tr, locale } = useLocale();
  const sign = varianceSign(variance);
  const amount = formatIQD(varianceMagnitude(variance), locale);
  // Status is the word, never the colour alone.
  if (sign === 'exact') return <span style={{ color: MARK_FG.success, fontWeight: 700 }}>{tr('ws.manager.dayClose.varianceExact')}</span>;
  return (
    <span style={{ color: sign === 'short' ? MARK_FG.danger : MARK_FG.warn, fontWeight: 700 }}>
      <bdi>{sign === 'short' ? tr('ws.manager.dayClose.varianceShort', { amount }) : tr('ws.manager.dayClose.varianceOver', { amount })}</bdi>
    </span>
  );
}
