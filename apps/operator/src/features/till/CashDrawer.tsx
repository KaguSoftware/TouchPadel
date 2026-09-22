/**
 * CashDrawerScreen (spec 06.19) at /till/drawer — the opening float and what
 * the drawer did this shift.
 *
 *   float   day_sessions.opening_float_iqd (QK.day). It is set when the manager
 *           OPENS the day (manager workspace, /admin/day-close); this screen
 *           says so and links there.
 *   events  two server sources merged by time: audit_log rows with action
 *           'drawer.open' (what app.record_drawer_open writes — entity
 *           day_sessions, after.tab_id, reason_code, device_id) and cash
 *           `payments` for the open day with their change_iqd.
 *   open    "Open drawer" → ReasonCodePrompt → app.record_drawer_open. Hardware
 *           is out of scope; the RECORD is what day close reconciles against.
 *   close   route to /admin/day-close for a role that can close the day. A
 *           cashier gets one sentence instead: a greyed button plus a
 *           four-line "not allowed for your role" box offered them nothing
 *           they could do, on a screen they open every shift.
 *
 * The subtitle is the day this drawer belongs to ("Day opened 5:09 PM"), not
 * a description of the screen. A cash payment names the tab it was for, so
 * "18,000 IQD" can be matched to a table when the drawer is counted; the
 * columns say which way the money went ("Paid in", "Change given").
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatNumber, formatTime, type MessageKey } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { QK, fetchOpenDay } from '../../lib/queries';
import { usePermissions } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { tabAnchorLabel } from './tillData';
import { Button, ErrorText } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  HeadlineFigure,
  MessagePresenter,
  Money,
  PageHeader,
  Panel,
  ReasonCodePrompt,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { muted } from './tillStyles';
import { DRAWER_REASONS } from './drawerReasons';

interface DrawerEvent {
  id: string;
  at: string;
  kind: 'open' | 'cash';
  amount: number | null;
  change: number | null;
  reason: string | null;
  /** The tab a cash payment was taken on, as the floor names it. */
  tab: string | null;
  by: string | null;
}

interface DrawerOpenRow {
  id: number;
  at: string;
  actor_role: string | null;
  reason_code: string | null;
  after: { tab_id?: string | null } | null;
}
interface CashPaymentRow {
  id: string;
  created_at: string;
  amount_iqd: number;
  change_iqd: number | null;
  recorder: { display_name: string } | null;
  tab: {
    label: string | null;
    table: { table_number: string } | null;
    reservation: { guest_name: string | null } | null;
  } | null;
}

async function fetchDrawerEvents(dayId: string, openedAt: string, tableWord: string, bookingWord: string): Promise<DrawerEvent[]> {
  const [opens, cash] = await Promise.all([
    supabase
      .from('audit_log')
      .select('id, at, actor_role, reason_code, after')
      .eq('action', 'drawer.open')
      .gte('at', openedAt)
      .order('at', { ascending: false })
      .limit(200),
    supabase
      .from('payments')
      .select('id, created_at, amount_iqd, change_iqd, recorder:staff(display_name), tab:tabs(label, table:cafe_tables(table_number), reservation:reservations!tabs_reservation_id_fkey(guest_name))')
      .eq('day_session_id', dayId)
      .eq('method', 'cash')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if (opens.error) throw opens.error;
  if (cash.error) throw cash.error;
  const a = (opens.data as unknown as DrawerOpenRow[]).map<DrawerEvent>((r) => ({
    id: `open-${r.id}`,
    at: r.at,
    kind: 'open',
    amount: null,
    change: null,
    reason: r.reason_code,
    tab: null,
    by: r.actor_role,
  }));
  const b = (cash.data as unknown as CashPaymentRow[]).map<DrawerEvent>((p) => ({
    id: `cash-${p.id}`,
    at: p.created_at,
    kind: 'cash',
    amount: p.amount_iqd,
    change: p.change_iqd,
    reason: null,
    tab: p.tab ? tabAnchorLabel(p.tab, tableWord, bookingWord) : null,
    by: p.recorder?.display_name ?? null,
  }));
  return [...a, ...b].sort((x, y) => y.at.localeCompare(x.at));
}

export function CashDrawerScreen() {
  const { tr, locale } = useLocale();
  const can = usePermissions();
  const queryClient = useQueryClient();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recorded, setRecorded] = useState(false);

  const dayQ = useQuery({ queryKey: QK.day, queryFn: fetchOpenDay });
  const day = dayQ.data ?? null;
  const eventsQ = useQuery({
    queryKey: ['drawerEvents', day?.id ?? null],
    enabled: Boolean(day),
    queryFn: () => fetchDrawerEvents(day!.id, day!.opened_at, tr('op.till.table'), tr('op.till.forReservation')),
    refetchInterval: 30_000,
  });

  async function recordOpen(reasonCode: string) {
    setBusy(true);
    setError(null);
    try {
      await appRpc('record_drawer_open', { p_reason_code: reasonCode, p_device_id: deviceId(), p_tab_id: null });
      setRecorded(true);
      setReasonOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['drawerEvents'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /*
   * Widths up to the reason: the auto table layout hands the slack of a
   * full-width monitor to whichever column will take it, which put a hand's
   * width of nothing between "Cash payment" and the figure it belongs to. The
   * two free-text columns at the end — a reason phrase and a staff name —
   * are the ones that can use the room.
   */
  const columns: Column<DrawerEvent>[] = [
    { key: 'time', header: tr('ws.cashier.drawer.colTime'), width: '6rem', render: (r) => <span dir="ltr" style={{ whiteSpace: 'nowrap' }}>{formatTime(new Date(r.at), locale)}</span> },
    {
      // What happened and what for, in one cell: "Cash payment" over the tab
      // it was taken on, or "Drawer opened" over the reason. Two columns for
      // this pushed Change and Recorded-by off the panel at 1100px.
      key: 'event',
      header: tr('ws.cashier.drawer.colEvent'),
      truncate: true,
      truncateTitle: (r) => (r.kind === 'cash' ? (r.tab ?? '') : r.reason ? tr(`op.reasons.${r.reason}` as MessageKey) : ''),
      render: (r) => {
        const detail = r.kind === 'cash' ? r.tab : r.reason ? tr(`op.reasons.${r.reason}` as MessageKey) : null;
        return (
          <span style={{ display: 'grid', minInlineSize: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', whiteSpace: 'nowrap' }}>
              <Icon name={r.kind === 'open' ? 'drawer' : 'banknote'} size={14} />
              {r.kind === 'open' ? tr('ws.cashier.drawer.eventOpen') : tr('ws.cashier.drawer.eventCash')}
            </span>
            {detail && (
              <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <bdi>{detail}</bdi>
              </span>
            )}
          </span>
        );
      },
    },
    { key: 'amount', header: tr('ws.cashier.drawer.colAmount'), width: '8rem', numeric: true, render: (r) => <Money amount={r.amount} style={{ whiteSpace: 'nowrap' }} /> },
    { key: 'change', header: tr('ws.cashier.drawer.colChange'), width: '8rem', numeric: true, render: (r) => <Money amount={r.change} style={{ whiteSpace: 'nowrap' }} /> },
    {
      key: 'by',
      header: tr('ws.cashier.drawer.colBy'),
      width: '10rem',
      truncate: true,
      truncateTitle: (r) => r.by ?? '',
      render: (r) =>
        r.by ? (
          <bdi>{r.kind === 'open' ? tr(`op.roles.${r.by}` as MessageKey) : r.by}</bdi>
        ) : (
          <span style={muted}>—</span>
        ),
    },
  ];

  return (
    /*
     * This screen used to be a --tp-measure-wide column: a summary strip of two
     * cards over an events table, all of it stopping a third of the way across
     * a till monitor with the lower two thirds bare. Three holes, one cause — a
     * reading measure on a screen whose job is a log.
     *
     * The log takes the page. The float and the route to day close are standing
     * context, so they sit in a rail beside it rather than a strip above it, and
     * the panel holding the log takes the height rather than hugging three rows
     * of it.
     */
    <div style={{ inlineSize: '100%', blockSize: '100%', minBlockSize: 0, display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        style={{ flexShrink: 0 }}
        title={tr('ws.cashier.drawer.title')}
        subtitle={day ? tr('ws.cashier.drawer.dayOpenedAt', { time: formatTime(new Date(day.opened_at), locale) }) : undefined}
        actions={
          <Button
            kind="primary"
            icon="drawer"
            busy={busy}
            disabled={!day}
            disabledReason={dayQ.isSuccess && !day ? tr('ws.cashier.drawer.noDay') : undefined}
            onClick={() => {
              setRecorded(false);
              setReasonOpen(true);
            }}
          >
            {tr('ws.cashier.drawer.openDrawer')}
          </Button>
        }
      />

      {recorded && <MessagePresenter tone="success" icon="drawer" message={tr('ws.cashier.drawer.recorded')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />}
      <ErrorText error={error} />

      <div style={{ flex: 1, minBlockSize: 0, display: 'flex', flexDirection: 'column' }}>
        <AsyncStateWrapper
          status={dayQ.isError && dayQ.data === undefined ? 'error' : dayQ.data === undefined ? 'loading' : 'ready'}
          onRetry={() => void dayQ.refetch()}
          error={dayQ.error}
          compact
        >
          {!day ? (
            <EmptyState
              icon="sun"
              title={tr('ws.cashier.drawer.noDay')}
              body={tr('ws.cashier.drawer.noDayBody')}
              action={can.closeDay ? <DayCloseLink label={tr('ws.cashier.drawer.dayClose')} /> : undefined}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) clamp(15rem, 24vw, 22rem)', gap: 'var(--tp-sp-4)', blockSize: '100%', minBlockSize: 0 }}>
              <Panel
                title={tr('ws.cashier.drawer.events')}
                actions={
                  eventsQ.data && eventsQ.data.length > 0 ? (
                    <span style={muted}>
                      {tr('ws.cashier.drawer.countCash', { count: formatNumber(eventsQ.data.filter((e) => e.kind === 'cash').length, locale) })}
                      {' · '}
                      {tr('ws.cashier.drawer.countOpen', { count: formatNumber(eventsQ.data.filter((e) => e.kind === 'open').length, locale) })}
                    </span>
                  ) : undefined
                }
                padded={false}
                fill
              >
                <AsyncStateWrapper
                  status={asyncStatus(eventsQ, (d) => d.length === 0)}
                  onRetry={() => void eventsQ.refetch()}
                  error={eventsQ.error}
                  compact
                  emptyContent={
                    /* Centred in the panel it now fills, and without the dashed
                       box: the panel already draws that edge. */
                    <EmptyState compact icon="drawer" title={tr('ws.cashier.drawer.empty')} body={tr('ws.cashier.drawer.emptyBody')} style={{ flex: 1, justifyContent: 'center', border: 'none' }} />
                  }
                >
                  <DataTable columns={columns} rows={eventsQ.data ?? []} rowKey={(r) => r.id} dense fill aria-label={tr('ws.cashier.drawer.events')} />
                </AsyncStateWrapper>
              </Panel>

              <aside style={{ display: 'grid', gap: 'var(--tp-sp-3)', alignContent: 'start', minBlockSize: 0, overflowY: 'auto' }}>
                <HeadlineFigure label={tr('ws.cashier.drawer.float')} value={<Money amount={day.opening_float_iqd} />} hint={tr('ws.cashier.drawer.floatHint')} />
                <Panel muted>
                  <p style={{ ...muted, marginBlockEnd: can.closeDay ? 'var(--tp-sp-2)' : 0 }}>
                    {can.closeDay ? tr('ws.cashier.drawer.dayCloseHint') : tr('ws.cashier.drawer.dayCloseByManager')}
                  </p>
                  {can.closeDay && <DayCloseLink label={tr('ws.cashier.drawer.goDayClose')} />}
                </Panel>
              </aside>
            </div>
          )}
        </AsyncStateWrapper>
      </div>

      {reasonOpen && (
        <ReasonCodePrompt action={tr('ws.cashier.drawer.openDrawerAction')} reasonCodes={DRAWER_REASONS} busy={busy} error={error} withNote={false} onSubmit={(code) => void recordOpen(code)} onCancel={() => setReasonOpen(false)}>
          <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.cashier.drawer.openHint')}</p>
        </ReasonCodePrompt>
      )}
    </div>
  );
}

/** The route to day close, for a role that can close the day. */
function DayCloseLink({ label }: { label: string }) {
  return (
    <Link to="/admin/day-close" className="tp-btn" data-kind="default" data-size="md" style={{ textDecoration: 'none' }}>
      <Icon name="lock" size={16} /> {label}
    </Link>
  );
}
