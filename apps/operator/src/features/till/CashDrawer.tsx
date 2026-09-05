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
 *   close   route to /admin/day-close; PermissionRefusedNotice when
 *           can.closeDay is false (control stays visible).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatTime, type MessageKey } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { QK, fetchOpenDay } from '../../lib/queries';
import { requiredRoleFor, usePermissions } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
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
  PermissionRefusedNotice,
  ReasonCodePrompt,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { muted } from './tillStyles';

interface DrawerEvent {
  id: string;
  at: string;
  kind: 'open' | 'cash';
  amount: number | null;
  change: number | null;
  reason: string | null;
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
}

async function fetchDrawerEvents(dayId: string, openedAt: string): Promise<DrawerEvent[]> {
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
      .select('id, created_at, amount_iqd, change_iqd, recorder:staff(display_name)')
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
    by: r.actor_role,
  }));
  const b = (cash.data as unknown as CashPaymentRow[]).map<DrawerEvent>((p) => ({
    id: `cash-${p.id}`,
    at: p.created_at,
    kind: 'cash',
    amount: p.amount_iqd,
    change: p.change_iqd,
    reason: null,
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
    queryFn: () => fetchDrawerEvents(day!.id, day!.opened_at),
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

  const columns: Column<DrawerEvent>[] = [
    { key: 'time', header: tr('ws.cashier.drawer.colTime'), width: '7rem', render: (r) => <span dir="ltr">{formatTime(new Date(r.at), locale)}</span> },
    {
      key: 'event',
      header: tr('ws.cashier.drawer.colEvent'),
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
          <Icon name={r.kind === 'open' ? 'drawer' : 'banknote'} size={14} />
          {r.kind === 'open' ? tr('ws.cashier.drawer.eventOpen') : tr('ws.cashier.drawer.eventCash')}
        </span>
      ),
    },
    { key: 'amount', header: tr('ws.cashier.drawer.colAmount'), numeric: true, render: (r) => <Money amount={r.amount} /> },
    { key: 'change', header: tr('ws.cashier.drawer.colChange'), numeric: true, render: (r) => <Money amount={r.change} /> },
    {
      key: 'reason',
      header: tr('ws.cashier.drawer.colReason'),
      render: (r) => (r.reason ? <span>{tr(`op.reasons.${r.reason}` as MessageKey)}</span> : <span style={muted}>—</span>),
    },
    {
      key: 'by',
      header: tr('ws.cashier.drawer.colBy'),
      render: (r) =>
        r.by ? (
          <bdi>{r.kind === 'open' ? tr(`op.roles.${r.by}` as MessageKey) : r.by}</bdi>
        ) : (
          <span style={muted}>—</span>
        ),
    },
  ];

  return (
    <div style={{ maxInlineSize: 'var(--tp-measure-wide)' }}>
      <PageHeader
        title={tr('ws.cashier.drawer.title')}
        subtitle={tr('ws.cashier.drawer.lead')}
        actions={
          <Button kind="primary" icon="drawer" busy={busy} disabled={!day} onClick={() => { setRecorded(false); setReasonOpen(true); }}>
            {tr('ws.cashier.drawer.openDrawer')}
          </Button>
        }
      />

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
            action={<DayCloseLink canClose={can.closeDay} label={tr('ws.cashier.drawer.dayClose')} />}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: 'var(--tp-sp-3)', marginBlockEnd: 'var(--tp-sp-4)' }}>
            <HeadlineFigure
              label={tr('ws.cashier.drawer.float')}
              value={<Money amount={day.opening_float_iqd} />}
              hint={tr('ws.cashier.drawer.dayOpenedAt', { time: formatTime(new Date(day.opened_at), locale) })}
            />
            <Panel muted>
              <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.cashier.drawer.floatHint')}</p>
              <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.cashier.drawer.dayCloseHint')}</p>
              <DayCloseLink canClose={can.closeDay} label={tr('ws.cashier.drawer.goDayClose')} />
            </Panel>
          </div>
        )}
      </AsyncStateWrapper>

      {recorded && <MessagePresenter tone="success" icon="drawer" message={tr('ws.cashier.drawer.recorded')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />}
      <ErrorText error={error} />

      {day && (
        <Panel
          title={tr('ws.cashier.drawer.events')}
          actions={eventsQ.data ? <span style={muted}>{tr('ws.cashier.drawer.counts', { count: eventsQ.data.length })}</span> : undefined}
          padded={false}
        >
          <AsyncStateWrapper
            status={asyncStatus(eventsQ, (d) => d.length === 0)}
            onRetry={() => void eventsQ.refetch()}
            error={eventsQ.error}
            compact
            emptyContent={<EmptyState compact icon="drawer" title={tr('ws.cashier.drawer.empty')} body={tr('ws.cashier.drawer.emptyBody')} />}
          >
            <DataTable columns={columns} rows={eventsQ.data ?? []} rowKey={(r) => r.id} dense maxBlockSize="60vh" aria-label={tr('ws.cashier.drawer.events')} />
          </AsyncStateWrapper>
        </Panel>
      )}

      {reasonOpen && (
        <ReasonCodePrompt action={tr('ws.cashier.drawer.openDrawerAction')} busy={busy} error={error} withNote={false} onSubmit={(code) => void recordOpen(code)} onCancel={() => setReasonOpen(false)}>
          <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.cashier.drawer.openHint')}</p>
        </ReasonCodePrompt>
      )}
    </div>
  );
}

/** The route to day close: a link for managers, a visible-but-refused control for cashiers (R9). */
function DayCloseLink({ canClose, label }: { canClose: boolean; label: string }) {
  const { tr } = useLocale();
  if (canClose) {
    return (
      <Link to="/admin/day-close" className="tp-btn" data-kind="default" data-size="md" style={{ textDecoration: 'none' }}>
        <Icon name="lock" size={16} /> {label}
      </Link>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start' }}>
      <Button icon="lock" disabled>
        {label}
      </Button>
      <PermissionRefusedNotice action={tr('ws.cashier.drawer.dayCloseAction')} requiredRole={requiredRoleFor('closeDay')} />
    </div>
  );
}
