/**
 * Day close (spec 06.22) — open-day form, then the close: counted cash and
 * the card terminal batch against server figures, blocked states with the
 * rows that cause them (DAY_OPEN_TABS → the tabs, linked into the till;
 * DAY_UNSYNCED → the queued writes), the discounts / voids / refunds / waste
 * summary with authoriser names, and a client-side CSV of the summary.
 *
 * RPCs: app.open_day (0015), app.close_day (0020). Reads: day session (shared
 * QK.day), tabs, v_day_close_summary, v_day_close_adjustments.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatIQD, formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { QK, fetchOpenDay } from '../../lib/queries';
import { useLocale } from '../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../lib/auth';
import { touch, type QueueRowInfo } from '../../ipc/bridge';
import { AmountPad, Button, ErrorText, Field, inputStyle } from '../../components/ui';
import {
  DataTable,
  DescriptionList,
  EmptyState,
  ExportButton,
  MessagePresenter,
  Money,
  PageHeader,
  Panel,
  PermissionRefusedNotice,
  StatusBadge,
  TabStatusIndicator,
  type Column,
} from '../../components/kit';
import { MoneyInput } from '../../components/inputs';
import { Icon } from '../../components/icons';
import { downloadCsv, toCsv } from '../analytics/csv';
import { tillTabHref } from '../ops/opsLogic';
import {
  dayCloseCsv,
  deriveDayCloseState,
  varianceMagnitude,
  varianceSign,
  type CloseResult,
  type DayAdjustmentRow,
  type DaySummaryRow,
} from './dayCloseLogic';

interface OpenTabRow {
  id: string;
  status: string;
  label: string | null;
  table: { table_number: string } | null;
  reservation: { guest_name: string | null } | null;
}

const SUMMARY_COLUMNS =
  'day_session_id, business_date, status, opening_float_iqd, cash_payments_iqd, card_payments_iqd, ' +
  'cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_expected_iqd, card_terminal_batch_iqd, ' +
  'discounts_iqd, adjustment_count, authorizer_names, voided_lines_iqd, voided_line_count, refunds_iqd, refund_count, waste_cost_iqd';

export function DayClose() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const can = usePermissions();
  const [openingFloat, setOpeningFloat] = useState(0);
  const [countedCash, setCountedCash] = useState(0);
  const [cardBatch, setCardBatch] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);

  // Identical query to the till's — same key, same shape, deliberately shared.
  const dayQ = useQuery({ queryKey: QK.day, queryFn: fetchOpenDay });
  const day = dayQ.data ?? null;
  const daySessionId = closeResult?.day_session_id ?? day?.id ?? null;

  const openTabsQ = useQuery({
    queryKey: ['dayOpenTabs', day?.id],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('tabs')
        .select('id, status, label, table:cafe_tables(table_number), reservation:reservations(guest_name)')
        .eq('day_session_id', day?.id ?? '')
        .in('status', ['open', 'awaiting_payment']);
      if (err) throw err;
      return data as unknown as OpenTabRow[];
    },
    enabled: Boolean(day),
    refetchInterval: 30_000,
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
        .select('adjustment_id, tab_id, kind, value, amount_iqd, reason_code, created_at, applied_by_name, authorized_by_name')
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

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: QK.day });
    void queryClient.invalidateQueries({ queryKey: ['dayOpenTabs'] });
    void queryClient.invalidateQueries({ queryKey: ['dayCloseSummary'] });
    void queryClient.invalidateQueries({ queryKey: ['dayCloseAdjustments'] });
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
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<CloseResult>('close_day', {
        p_cash_counted_iqd: countedCash,
        p_card_batch_iqd: cardBatch !== null && cardBatch > 0 ? cardBatch : null,
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
        cashExpected: tr('op.dayClose.cashExpected'),
        cashCounted: tr('op.dayClose.cashCounted'),
        variance: tr('op.dayClose.variance'),
        cardExpected: tr('op.dayClose.cardExpected'),
        cardBatch: tr('op.dayClose.cardBatch'),
        discounts: tr('ws.manager.ops.exceptions.discounts'),
        voids: tr('ws.manager.ops.exceptions.voids'),
        refunds: tr('ws.manager.ops.exceptions.refunds'),
        waste: tr('ws.manager.ops.exceptions.waste'),
        openingFloat: tr('ws.manager.dayClose.openingFloat'),
        cashPayments: tr('ws.manager.dayClose.cashPayments'),
        cardPayments: tr('ws.manager.dayClose.cardPayments'),
      },
      closeResult,
      summary,
      adjustments,
      joinNames,
    );
    const date = closeResult?.business_date ?? day?.business_date ?? 'day';
    downloadCsv(`day-close-${date}.csv`, toCsv(headers, rows));
  }

  const stateBadge = (() => {
    switch (state) {
      case 'ready':
      case 'busy':
        return <StatusBadge tone="success" label={tr('ws.manager.dayClose.state.ready')} />;
      case 'blockedByOpenTabs':
        return <StatusBadge tone="danger" label={tr('ws.manager.dayClose.state.blockedByOpenTabs')} />;
      case 'blockedByUnsyncedQueue':
        return <StatusBadge tone="warn" label={tr('ws.manager.dayClose.state.blockedByUnsyncedQueue')} />;
      case 'closed':
        return <StatusBadge tone="neutral" icon="check" label={tr('ws.manager.dayClose.state.closed')} />;
      default:
        return null;
    }
  })();

  // ---------------------------------------------------------------- loading
  if (state === 'loading') {
    return (
      <div>
        <PageHeader title={tr('ws.manager.dayClose.title')} subtitle={tr('ws.manager.dayClose.lead')} />
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
        <Panel style={{ maxInlineSize: '28rem' }}>
          <Field label={tr('op.dayClose.openingFloat')}>
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
          {!can.closeDay && <PermissionRefusedNotice action={tr('op.dayClose.openDayBtn')} requiredRole={requiredRoleFor('closeDay')} style={{ marginBlockEnd: 'var(--tp-sp-2)' }} />}
          <Button kind="primary" busy={busy} disabled={!can.closeDay} onClick={() => void openDay()}>
            {tr('op.dayClose.openDayBtn')}
          </Button>
        </Panel>
      </div>
    );
  }

  const businessDate = closeResult?.business_date ?? day?.business_date ?? null;

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.dayClose.title')}
        subtitle={
          state === 'closed' && businessDate
            ? tr('ws.manager.dayClose.closedLead', { date: formatDate(new Date(`${businessDate}T00:00:00`), locale) })
            : tr('ws.manager.dayClose.lead')
        }
        eyebrow={
          day ? (
            <bdi>
              {tr('op.dayClose.openBanner', {
                time: formatTime(new Date(day.opened_at), locale),
                float: formatIQD(day.opening_float_iqd, locale),
              })}
            </bdi>
          ) : undefined
        }
        actions={
          <>
            {stateBadge}
            <ExportButton onExport={exportCsv} disabled={!summary && !closeResult} scope={tr('ws.manager.dayClose.export')} />
          </>
        }
      />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'minmax(20rem, 1fr) minmax(20rem, 1fr)', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          {/* Blocked: open tabs */}
          {state === 'blockedByOpenTabs' && (
            <Panel title={tr('op.dayClose.blockedTabs')} padded={false}>
              <p style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-danger-fg)' }}>
                {tr('ws.manager.dayClose.openTabsLead')}
              </p>
              <DataTable<OpenTabRow>
                dense
                rows={openTabs}
                rowKey={(t) => t.id}
                columns={[
                  {
                    key: 'label',
                    header: tr('op.till.table'),
                    render: (t) => (
                      <bdi>
                        {t.table
                          ? tr('ws.manager.dayClose.tabTable', { number: t.table.table_number })
                          : (t.reservation?.guest_name ?? t.label ?? t.id.slice(0, 8))}
                      </bdi>
                    ),
                  },
                  { key: 'status', header: tr('ws.manager.promotions.status'), render: (t) => <TabStatusIndicator status={t.status} size="sm" /> },
                  {
                    key: 'open',
                    header: '',
                    align: 'end',
                    render: (t) => (
                      <Link to="/till" href={tillTabHref(t.id)} className="tp-btn" data-kind="soft" data-size="sm">
                        <Icon name="receipt" size={14} /> {tr('ws.manager.dayClose.openTab')}
                      </Link>
                    ),
                  },
                ]}
              />
            </Panel>
          )}

          {/* Blocked: unsynced queue */}
          {state === 'blockedByUnsyncedQueue' && (
            <Panel title={tr('op.dayClose.unsyncedTitle')} data-testid="day-close-queue">
              <div data-queue-rows>
                <MessagePresenter tone="refused" message={tr('ws.manager.dayClose.unsyncedLead', { count: queueRows.length })} style={{ marginBlockEnd: 'var(--tp-sp-2-5)' }} />
                <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('op.dayClose.unsyncedHint')}</p>
                <ul style={{ marginBlock: 0, paddingInlineStart: 'var(--tp-sp-4)' }}>
                  {queueRows.map((row) => (
                    <li key={row.seq} style={{ fontSize: 'var(--tp-fs-sm)' }}>
                      <code>{row.mutationType}</code> · {tr(`op.queue.state.${row.state}`)}
                      {row.lastError ? ` — ${row.lastError}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}

          {/* Cash */}
          <Panel title={tr('ws.manager.dayClose.cashTitle')}>
            {closeResult ? (
              <>
                <DescriptionList
                  columns={3}
                  items={[
                    { label: tr('op.dayClose.cashExpected'), value: <Money amount={closeResult.cash_expected_iqd} strong />, numeric: true },
                    { label: tr('op.dayClose.cashCounted'), value: <Money amount={closeResult.cash_counted_iqd} strong />, numeric: true },
                    { label: tr('op.dayClose.variance'), value: <VarianceText variance={closeResult.cash_variance_iqd} />, numeric: true },
                  ]}
                />
              </>
            ) : (
              <>
                <DescriptionList
                  columns={2}
                  style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
                  items={[
                    { label: tr('ws.manager.dayClose.openingFloat'), value: <Money amount={day?.opening_float_iqd ?? summary?.opening_float_iqd} />, numeric: true },
                    { label: tr('ws.manager.dayClose.cashPayments'), value: <Money amount={summary?.cash_payments_iqd} />, numeric: true },
                  ]}
                />
                <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2-5)' }}>{tr('ws.manager.dayClose.expectedAtClose')}</p>
                <Field label={tr('ws.manager.dayClose.countedCash')}>
                  <input
                    style={{ ...inputStyle, textAlign: 'end', fontSize: 'var(--tp-fs-xl)' }}
                    dir="ltr"
                    inputMode="numeric"
                    value={countedCash}
                    disabled={busy}
                    onChange={(e) => setCountedCash(Number(e.target.value.replace(/\D/g, '')) || 0)}
                  />
                </Field>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <AmountPad value={countedCash} onChange={setCountedCash} disabled={busy} />
                </div>
              </>
            )}
          </Panel>

          {/* Card */}
          <Panel title={tr('ws.manager.dayClose.cardTitle')}>
            {closeResult ? (
              <DescriptionList
                columns={2}
                items={[
                  { label: tr('op.dayClose.cardExpected'), value: <Money amount={closeResult.card_expected_iqd} strong />, numeric: true },
                  { label: tr('op.dayClose.cardBatch'), value: <Money amount={closeResult.card_terminal_batch_iqd} strong />, numeric: true },
                ]}
              />
            ) : (
              <>
                <DescriptionList
                  columns={1}
                  style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
                  items={[{ label: tr('ws.manager.dayClose.cardPayments'), value: <Money amount={summary?.card_payments_iqd} />, numeric: true }]}
                />
                <Field label={tr('ws.manager.dayClose.cardBatch')} hint={tr('ws.manager.dayClose.cardBatchHint')}>
                  <MoneyInput value={cardBatch} onChange={setCardBatch} allowEmpty disabled={busy} />
                </Field>
              </>
            )}
          </Panel>

          {/* Close action */}
          {!closeResult && (
            <Panel muted>
              <Field label={tr('ws.manager.dayClose.notes')}>
                <input style={inputStyle} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <ErrorText error={error} />
              {!can.closeDay && <PermissionRefusedNotice action={tr('op.dayClose.closeBtn')} requiredRole={requiredRoleFor('closeDay')} style={{ marginBlockEnd: 'var(--tp-sp-2)' }} />}
              <Button
                kind="danger"
                size="lg"
                icon="lock"
                busy={busy}
                disabled={!can.closeDay || state === 'blockedByOpenTabs' || state === 'blockedByUnsyncedQueue'}
                // The blocking reason was stated at the top of the screen, which
                // is the one place a manager scrolled past on the way down to
                // this button (rulebook 4.3).
                disabledReason={
                  state === 'blockedByOpenTabs'
                    ? tr('ws.manager.dayClose.openTabsLead')
                    : state === 'blockedByUnsyncedQueue'
                      ? tr('ws.manager.dayClose.unsyncedLead', { count: queueRows.length })
                      : undefined
                }
                onClick={() => void closeDay()}
              >
                {tr('ws.manager.dayClose.closeBtn')}
              </Button>
            </Panel>
          )}
        </div>

        {/* Summary with authorisers */}
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <Panel title={tr('ws.manager.dayClose.summaryTitle')}>
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.manager.dayClose.summaryLead')}</p>
            <ErrorText error={summaryQ.error} />
            {summary ? (
              <DescriptionList
                columns={2}
                items={[
                  { label: tr('op.dayClose.discounts', { count: summary.adjustment_count }), value: <Money amount={summary.discounts_iqd} />, numeric: true },
                  { label: tr('op.dayClose.voids', { count: summary.voided_line_count }), value: <Money amount={summary.voided_lines_iqd} />, numeric: true },
                  { label: tr('op.dayClose.refunds', { count: summary.refund_count }), value: <Money amount={summary.refunds_iqd} />, numeric: true },
                  { label: tr('op.dayClose.waste'), value: <Money amount={summary.waste_cost_iqd} />, numeric: true },
                  {
                    label: tr('ws.manager.dayClose.authorisedBy'),
                    value: (summary.authorizer_names ?? []).length > 0 ? <bdi>{joinNames(summary.authorizer_names ?? [])}</bdi> : tr('ws.manager.dayClose.noAuthoriser'),
                  },
                ]}
              />
            ) : (
              <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('common.loading')}</p>
            )}
          </Panel>

          <Panel title={tr('ws.manager.dayClose.adjustmentsTitle')} padded={false}>
            <ErrorText error={adjustmentsQ.error} />
            {adjustments.length === 0 ? (
              <div style={{ padding: 'var(--tp-sp-3)' }}>
                <EmptyState compact icon="shield" title={tr('ws.manager.dayClose.noAdjustments')} />
              </div>
            ) : (
              <DataTable<DayAdjustmentRow>
                dense
                rows={adjustments}
                rowKey={(a) => a.adjustment_id}
                columns={adjustmentColumns(tr, locale)}
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Route alias for the spec name. */
export const DayCloseScreen = DayClose;

function adjustmentColumns(tr: ReturnType<typeof useLocale>['tr'], locale: ReturnType<typeof useLocale>['locale']): Column<DayAdjustmentRow>[] {
  return [
    { key: 'when', header: tr('op.audit.when'), render: (a) => <bdi>{formatDateTime(new Date(a.created_at), locale)}</bdi> },
    { key: 'kind', header: tr('ws.manager.dayClose.kind'), render: (a) => a.kind },
    { key: 'amount', header: tr('ws.manager.dayClose.amount'), numeric: true, render: (a) => <Money amount={a.amount_iqd} /> },
    { key: 'reason', header: tr('ws.manager.dayClose.reason'), render: (a) => a.reason_code ?? '—' },
    { key: 'applied', header: tr('ws.manager.dayClose.appliedBy'), render: (a) => <bdi>{a.applied_by_name ?? '—'}</bdi> },
    {
      key: 'authorised',
      header: tr('ws.manager.dayClose.authorisedBy'),
      render: (a) =>
        a.authorized_by_name ? (
          <bdi>{a.authorized_by_name}</bdi>
        ) : (
          <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.dayClose.noAuthoriser')}</span>
        ),
    },
  ];
}

function VarianceText({ variance }: { variance: number }) {
  const { tr, locale } = useLocale();
  const sign = varianceSign(variance);
  const amount = formatIQD(varianceMagnitude(variance), locale);
  if (sign === 'exact') return <span style={{ color: 'var(--tp-success-fg)', fontWeight: 700 }}>{tr('ws.manager.dayClose.varianceExact')}</span>;
  return (
    <span style={{ color: sign === 'short' ? 'var(--tp-danger-fg)' : 'var(--tp-warn-fg)', fontWeight: 700 }}>
      <bdi>{sign === 'short' ? tr('ws.manager.dayClose.varianceShort', { amount }) : tr('ws.manager.dayClose.varianceOver', { amount })}</bdi>
    </span>
  );
}
