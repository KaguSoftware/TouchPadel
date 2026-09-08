/**
 * Operations overview (spec 06.21) — the manager's landing screen.
 *
 * One read: `app.ops_overview()` (0068), polled every 30 s and invalidated on
 * the 'floor' / 'courts' / 'kds' broadcasts. Every figure on this screen is a
 * server figure; the screen only lays them out and routes onward (bookings →
 * /desk, tills → /till/tabs, stock → /stock, day close, reports, audit log).
 *
 * WHY THIS LAYOUT (rulebook 2.1: an overview has a primary tier)
 *
 * The first version printed nineteen figures at one weight in four equal
 * panels. The second promoted six of them into a headline row, which helped and
 * then created its own problem: four of those six are ALARMS, and an alarm is
 * zero on a good day, so the loudest thing on the manager's landing screen was
 * usually four large noughts. The figure count had not actually come down —
 * every number was still on the page, now in two places at two sizes.
 *
 * So the screen is three tiers, and each figure belongs to exactly one job:
 *
 *  1. **An attention band** — only the alarms that are NON-ZERO, as chips that
 *     each open the list behind them. On a clear floor it collapses to one green
 *     line. This is the tier that answers "do I need to leave the office".
 *  2. **Four clusters**, each a panel with one promoted figure, one visual
 *     matched to what its numbers actually are, its supporting figures, and one
 *     way out. Bookings leads with a real ratio (arrived out of booked); the
 *     kitchen board and stock are sets of OVERLAPPING counts, so they get ranked
 *     ladders rather than stacked bars — see the note on `RatioMeter` for why
 *     stacking either one would have misstated the data; day close is a gate, so
 *     it gets a checklist and no bars at all. This tier answers "what shape is
 *     the day in".
 *  3. **The review tier** — today's exceptions as same-unit bars into the audit
 *     log, and staff activity as the plain table it always was. Nothing here is
 *     urgent; it is what a manager reads on the way to day close.
 *
 * The alarms in tier 1 also appear inside their cluster in tier 2. That
 * repetition is the design, not an oversight: tier 1 is a router and tier 2 is
 * the context, and the reason a cluster no longer has to shout is that the
 * shouting has somewhere else to live.
 *
 * Nothing on this screen is computed from anything else — `alertsFor`,
 * `dayCloseState` and `exceptionBasis` in `opsLogic.ts` only select, order and
 * scale figures the server already sent.
 */
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber, formatTime, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useBroadcast } from '../../lib/realtime';
import { Button } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  Panel,
  StatusBadge,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { Icon, type IconName } from '../../components/icons';
import {
  DrillBarList,
  GateList,
  LeadFigure,
  MARK,
  MARK_FG,
  MARK_SOFT,
  RatioMeter,
  SeverityLadder,
  type DrillBarRow,
  type GateRow,
} from './OpsVisuals';
import {
  DAY_CLOSE_TONE,
  alertsFor,
  auditDrillHref,
  dayCloseState,
  exceptionBasis,
  normalizeOverview,
  tillTabHref,
  worstSeverity,
  type ExceptionKey,
  type OpsAlertKey,
  type OpsOverview,
  type OpsStaffRow,
} from './opsLogic';

export const OPS_OVERVIEW_KEY = ['opsOverview'] as const;
export const OPS_REFETCH_MS = 30_000;

export function OperationsOverviewScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const overviewQ = useQuery({
    queryKey: OPS_OVERVIEW_KEY,
    queryFn: async () => normalizeOverview(await appRpc<unknown>('ops_overview')),
    refetchInterval: OPS_REFETCH_MS,
  });

  // Cache-bust hints; the poll above is the safety net while disconnected.
  useBroadcast({ topic: 'floor', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  useBroadcast({ topic: 'courts', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  useBroadcast({ topic: 'kds', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });

  const go = (href: string) => void navigate({ href });
  const status = asyncStatus(overviewQ, () => false);
  const updatedAt = overviewQ.dataUpdatedAt ? new Date(overviewQ.dataUpdatedAt) : null;

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.ops.title')}
        subtitle={tr('ws.manager.ops.lead')}
        actions={
          <>
            {updatedAt && (
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                {tr('ws.manager.ops.updated', { time: formatTime(updatedAt, locale) })}
              </span>
            )}
            <Button
              icon="refresh"
              size="sm"
              busy={overviewQ.isFetching && overviewQ.data !== undefined}
              onClick={() => void queryClient.invalidateQueries({ queryKey: OPS_OVERVIEW_KEY })}
            >
              {tr('ws.kit.actions.refresh')}
            </Button>
          </>
        }
      />
      <AsyncStateWrapper status={status} error={overviewQ.error} onRetry={() => void overviewQ.refetch()}>
        {overviewQ.data && <Dashboard data={overviewQ.data} go={go} />}
      </AsyncStateWrapper>
    </div>
  );
}

function Dashboard({ data, go }: { data: OpsOverview; go: (href: string) => void }) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <AttentionBand data={data} go={go} />

      {/* 16rem, not 20rem: at 20rem a 1440px station fits three of the four
          clusters and drops day close onto a second row beside a column of empty
          page. Four columns of ~17rem still hold every ladder row (label, bar,
          count) without wrapping. */}
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', alignItems: 'start' }}>
        <BookingsCluster data={data} go={go} />
        <CafeCluster data={data} go={go} />
        <StockCluster data={data} go={go} />
        <DayCloseCluster data={data} go={go} />
      </div>

      <ExceptionsPanel data={data} go={go} />

      <Panel title={tr('ws.manager.ops.staff.title')} padded={false}>
        <StaffPanelBody rows={data.staffActivity} />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier 1 — the attention band
// ---------------------------------------------------------------------------

const ALERT_LABEL: Record<OpsAlertKey, MessageKey> = {
  ticketsLate: 'ws.manager.ops.cafe.late',
  expired: 'ws.manager.ops.stock.expired',
  low: 'ws.manager.ops.stock.low',
  noShows: 'ws.manager.ops.bookings.noShows',
  waiterCalls: 'ws.manager.ops.cafe.waiterCalls',
};

/** The glyph carries the DOMAIN, so "Expired · 1" cannot be read as expired what. */
const ALERT_ICON: Record<OpsAlertKey, IconName> = {
  ticketsLate: 'clock',
  expired: 'package',
  low: 'package',
  noShows: 'calendar',
  waiterCalls: 'bell',
};

/**
 * The band wears the worst severity present as its GROUND, and the chips inside
 * it stay ordinary buttons on the panel surface.
 *
 * Done the other way round — tinted chips on a plain strip — the chips would
 * have to override `.tp-btn`'s background inline, and an inline background beats
 * the `:hover` rule in the stylesheet, so every chip would have been a control
 * with no hover state at all. Here the severity is on the container, the hover
 * belongs to the button, and neither has to fight the other.
 */
function AttentionBand({ data, go }: { data: OpsOverview; go: (href: string) => void }) {
  const { tr, locale } = useLocale();
  const alerts = alertsFor(data);
  const worst = worstSeverity(alerts);

  const shell = {
    border: '1px solid var(--tp-border)',
    borderRadius: 'var(--tp-radius-panel)',
    paddingBlock: 'var(--tp-sp-3)',
    paddingInline: 'var(--tp-sp-3)',
  } as const;

  if (worst === null) {
    return (
      <div style={{ ...shell, background: MARK_SOFT.success, display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
        <Icon name="checkCircle" size={17} style={{ color: MARK.success, flex: '0 0 auto' }} />
        <span style={{ fontWeight: 600, color: MARK_FG.success }}>{tr('ws.kit.empty.nothingToDo')}</span>
      </div>
    );
  }

  return (
    <section style={{ ...shell, background: MARK_SOFT[worst] }}>
      <h2 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, color: MARK_FG[worst], display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
        <Icon name="alert" size={16} style={{ color: MARK[worst] }} />
        {tr('ws.manager.ops.attention.title')}
      </h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-2-5)' }}>
        {alerts.map((a) => (
          <Button key={a.key} size="sm" onClick={() => go(a.href)}>
            <Icon name={ALERT_ICON[a.key]} size={14} style={{ color: MARK[a.severity] }} />
            <strong style={{ color: MARK_FG[a.severity], fontVariantNumeric: 'tabular-nums' }}>{formatNumber(a.count, locale)}</strong>
            {tr(ALERT_LABEL[a.key])}
          </Button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tier 2 — the four clusters
// ---------------------------------------------------------------------------

/** Panel chrome every cluster shares: a glyphed title and exactly one way out. */
function Cluster({
  icon,
  title,
  actionLabel,
  actionKind,
  onAction,
  children,
}: {
  icon: IconName;
  title: string;
  actionLabel: string;
  actionKind?: 'primary';
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          <Icon name={icon} size={15} style={{ color: 'var(--tp-muted-fg)' }} />
          {title}
        </span>
      }
      actions={
        <Button size="sm" kind={actionKind ?? 'ghost'} iconEnd="arrowUpRight" onClick={onAction}>
          {actionLabel}
        </Button>
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>{children}</div>
    </Panel>
  );
}

/** A labelled figure that is not the cluster's lead. Same row shape as a gate. */
function SupportRow({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: 'neutral' | 'warn' | 'danger' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)' }}>
      <span style={{ color: 'var(--tp-muted-fg)', minInlineSize: 0 }}>{label}</span>
      <span style={{ marginInlineStart: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone === 'neutral' ? 'var(--tp-fg)' : MARK_FG[tone] }}>
        {value}
      </span>
    </div>
  );
}

/** A prose support line (a timestamp, a name) rather than a figure. */
function SupportNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
      <strong style={{ color: 'var(--tp-fg)' }}>{label}:</strong> {children}
    </p>
  );
}

/**
 * The day's roll: how much of what is booked has actually walked in.
 *
 * `arrived` is a true subset of `today` (which counts `confirmed | arrived |
 * completed`), so "arrived of booked" is a real ratio and gets the one meter on
 * this screen. `noShows` is NOT inside `today` — the SQL excludes `no_show` from
 * it — so it sits beside the meter as its own figure rather than as a slice of
 * it, which is the whole reason this cluster is not a stacked bar. See the note
 * on `RatioMeter`.
 */
function BookingsCluster({ data, go }: { data: OpsOverview; go: (href: string) => void }) {
  const { tr, locale } = useLocale();
  const b = data.bookings;
  return (
    <Cluster
      icon="calendar"
      title={tr('ws.manager.ops.bookings.title')}
      actionLabel={tr('ws.manager.ops.bookings.open')}
      onAction={() => go('/desk')}
    >
      <LeadFigure label={tr('ws.manager.ops.bookings.today')} value={formatNumber(b.today, locale)} />
      <RatioMeter
        label={tr('ws.manager.ops.bookings.arrived')}
        value={b.arrived}
        limit={b.today}
        limitLabel={tr('ws.manager.ops.bookings.ofBooked', { count: formatNumber(b.today, locale) })}
        tone="success"
      />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <SupportRow label={tr('ws.manager.ops.bookings.upcoming')} value={formatNumber(b.upcoming, locale)} />
        <SupportRow
          label={tr('ws.manager.ops.bookings.noShows')}
          value={formatNumber(b.noShows, locale)}
          tone={b.noShows > 0 ? 'danger' : 'neutral'}
        />
      </div>
      <SupportNote label={tr('ws.manager.ops.bookings.next')}>
        {b.nextArrivalAt ? (
          <bdi>
            {formatTime(new Date(b.nextArrivalAt), locale)}
            {b.nextArrivalLabel ? ` · ${b.nextArrivalLabel}` : ''}
          </bdi>
        ) : (
          tr('ws.manager.ops.bookings.nextNone')
        )}
      </SupportNote>
    </Cluster>
  );
}

/**
 * The kitchen's board as three independent counts, not a pipeline.
 *
 * It reads like a pipeline — waiting, preparing, late — and it is not one:
 * `ticketsLate` counts tickets whose status is already `queued` or `preparing`,
 * so it OVERLAPS both of the other rows rather than following them. Stacking
 * these would double-count every late ticket. Ranked against each other, a long
 * "late" bar beside a long "waiting" bar says the true thing: nearly everything
 * on the board is past its target.
 *
 * `preparing` is `null` until the payload carries it (the hosted project's
 * `ops_overview` omits it where the local fixtures include it), and a null row
 * prints "—" with no bar rather than a zero the server never sent.
 */
function CafeCluster({ data, go }: { data: OpsOverview; go: (href: string) => void }) {
  const { tr, locale } = useLocale();
  const c = data.cafe;
  return (
    <Cluster icon="flame" title={tr('ws.manager.ops.cafe.title')} actionLabel={tr('ws.manager.ops.cafe.open')} onAction={() => go('/till/tabs')}>
      <LeadFigure label={tr('ws.manager.ops.cafe.openTabs')} value={formatNumber(c.openTabs, locale)} />
      <SeverityLadder
        caption={tr('ws.manager.ops.cafe.board')}
        rows={[
          { key: 'queued', label: tr('ws.manager.ops.cafe.queued'), value: c.ticketsQueued, tone: 'neutral' },
          { key: 'preparing', label: tr('ws.manager.ops.cafe.preparing'), value: c.ticketsPreparing, tone: 'accent' },
          { key: 'late', label: tr('ws.manager.ops.cafe.late'), value: c.ticketsLate, tone: 'danger' },
        ]}
      />
      <SupportRow
        label={tr('ws.manager.ops.cafe.waiterCalls')}
        value={formatNumber(c.waiterCallsOpen, locale)}
        tone={c.waiterCallsOpen > 0 ? 'warn' : 'neutral'}
      />
    </Cluster>
  );
}

/**
 * Four flag counts, ranked against the largest. Not a stacked bar: one item can
 * be both low and below par, so these do not add up to anything.
 *
 * The pairs are kept in their original order — quantity (low, below par) then
 * freshness (expiring soon, expired) — rather than sorted by severity or by
 * value, so the row a manager is looking for is always in the same place.
 */
function StockCluster({ data, go }: { data: OpsOverview; go: (href: string) => void }) {
  const { tr, locale } = useLocale();
  const s = data.stock;
  return (
    <Cluster icon="package" title={tr('ws.manager.ops.stock.title')} actionLabel={tr('ws.manager.ops.stock.open')} onAction={() => go('/stock')}>
      <LeadFigure label={tr('ws.manager.ops.stock.low')} value={formatNumber(s.low, locale)} tone={s.low > 0 ? 'danger' : 'neutral'} />
      <SeverityLadder
        rows={[
          { key: 'low', label: tr('ws.manager.ops.stock.low'), value: s.low, tone: 'danger' },
          { key: 'belowPar', label: tr('ws.manager.ops.stock.belowPar'), value: s.belowPar, tone: 'warn' },
          { key: 'expiringSoon', label: tr('ws.manager.ops.stock.expiringSoon'), value: s.expiringSoon, tone: 'warn' },
          { key: 'expired', label: tr('ws.manager.ops.stock.expired'), value: s.expired, tone: 'danger' },
        ]}
      />
      <SupportNote label={tr('ws.manager.ops.stock.lastCount')}>
        {s.lastCountAt ? <bdi>{formatDateTime(new Date(s.lastCountAt), locale)}</bdi> : tr('ws.manager.ops.stock.neverCounted')}
      </SupportNote>
    </Cluster>
  );
}

/**
 * How many blocking tabs get their own shortcut before the rest fold into a
 * link. A busy floor returns every open tab, and eight chips carrying raw table
 * tokens ("Tab T-RP-1788631290913-1") buried the two gate rows that are the
 * actual answer. The count is already stated exactly on the gate row above; the
 * chips are a convenience for the short list, not the list itself.
 */
const BLOCKING_TABS_SHOWN = 4;

/**
 * Day close leads with the STATE rather than a number, because "3 tabs and 0
 * queued writes" is a sum the manager should not have to do — the answer is
 * either "you can close" or "here is what is in the way".
 *
 * The four state words are the day-close screen's own, so the overview and its
 * destination agree.
 */
function DayCloseCluster({ data, go }: { data: OpsOverview; go: (href: string) => void }) {
  const { tr, locale } = useLocale();
  const d = data.dayClose;
  const state = dayCloseState(d);
  const tone = DAY_CLOSE_TONE[state];
  const gates: GateRow[] = [
    { key: 'tabs', label: tr('ws.manager.ops.dayClose.blockingTabs'), count: d.blockingCount, clearLabel: tr('ws.kit.common.none'), tone: 'danger' },
    { key: 'queued', label: tr('ws.manager.ops.dayClose.queued'), count: d.queued, clearLabel: tr('ws.kit.common.none'), tone: 'warn' },
  ];
  return (
    <Cluster
      icon="lock"
      title={tr('ws.manager.ops.dayClose.title')}
      actionLabel={tr('ws.manager.ops.dayClose.go')}
      actionKind="primary"
      onAction={() => go('/admin/day-close')}
    >
      <div>
        <StatusBadge tone={tone} label={tr(`ws.manager.dayClose.state.${state}`)} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {d.open && d.openedAt && <bdi>{tr('ws.manager.ops.dayClose.openSince', { time: formatTime(new Date(d.openedAt), locale) })}</bdi>}
          {d.businessDate && <bdi>{tr('ws.manager.ops.dayClose.businessDate', { date: formatDate(new Date(`${d.businessDate}T00:00:00`), locale) })}</bdi>}
        </div>
      </div>
      <GateList gates={gates} />
      {d.blockingTabs.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
          {d.blockingTabs.slice(0, BLOCKING_TABS_SHOWN).map((t) => (
            <li key={t.id}>
              <Button size="sm" kind="soft" icon="receipt" onClick={() => go(tillTabHref(t.id))}>
                {tr('ws.manager.ops.dayClose.tab', { label: t.label ?? t.id.slice(0, 8) })}
              </Button>
            </li>
          ))}
          {d.blockingTabs.length > BLOCKING_TABS_SHOWN && (
            <li>
              <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/admin/day-close')}>
                {tr('ws.manager.ops.dayClose.moreTabs', { count: formatNumber(d.blockingTabs.length - BLOCKING_TABS_SHOWN, locale) })}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Cluster>
  );
}

// ---------------------------------------------------------------------------
// Tier 3 — the review tier
// ---------------------------------------------------------------------------

const EXCEPTION_KEYS = ['discounts', 'voids', 'refunds', 'waste'] as const;

function ExceptionsPanel({ data, go }: { data: OpsOverview; go: (href: string) => void }) {
  const { tr, locale } = useLocale();
  // `waste` is absent from the 0068 contract; an absent figure is no row rather
  // than a zero the server never sent.
  const present = EXCEPTION_KEYS.filter((k) => data.exceptions[k] !== null);
  const figures = present.map((k) => data.exceptions[k]!);
  const basis = exceptionBasis(figures);

  const rows: DrillBarRow<ExceptionKey>[] = present.map((k, i) => {
    const f = figures[i]!;
    const raw = basis?.by === 'amount' ? (f.amountIqd ?? 0) : f.count;
    return {
      key: k,
      label: tr(`ws.manager.ops.exceptions.${k}`),
      value: f.amountIqd === null ? formatNumber(f.count, locale) : <Money amount={f.amountIqd} />,
      hint: tr('ws.manager.ops.exceptions.count', { count: formatNumber(f.count, locale) }),
      fraction: basis ? raw / basis.max : 0,
      title: tr('ws.kit.drill.title'),
    };
  });

  return (
    <Panel title={tr('ws.manager.ops.exceptions.title')}>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>
        {tr('ws.manager.ops.exceptions.lead')}
      </p>
      <DrillBarList rows={rows} onDrill={(k) => go(auditDrillHref(k))} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <Button size="sm" icon="chart" onClick={() => go('/reports/courts')}>
          {tr('ws.manager.ops.reports')}
        </Button>
        <Button size="sm" icon="fileText" onClick={() => go('/admin/audit')}>
          {tr('ws.manager.ops.audit')}
        </Button>
      </div>
    </Panel>
  );
}

function StaffPanelBody({ rows }: { rows: OpsStaffRow[] }) {
  const { tr } = useLocale();
  return (
    <>
      <p style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.manager.ops.staff.lead')}
      </p>
      <StaffTable rows={rows} />
    </>
  );
}

/**
 * Deliberately NOT given the bars every other list on this screen got. The lead
 * copy says "Activity, not a ranking", and a proportional bar beside each
 * person's order count is exactly how a table becomes a leaderboard.
 */
function StaffTable({ rows }: { rows: OpsStaffRow[] }) {
  const { tr, locale } = useLocale();
  if (rows.length === 0) {
    return (
      <div style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', paddingBlockEnd: 'var(--tp-sp-3)' }}>
        {/* Nobody has clocked anything yet is not a fault and not a filter. */}
        <EmptyState compact kind="nothingToDo" icon="users" title={tr('ws.manager.ops.staff.empty')} />
      </div>
    );
  }
  const columns: Column<OpsStaffRow>[] = [
    { key: 'name', header: tr('ws.manager.ops.staff.name'), truncate: true, truncateTitle: (r) => r.name, render: (r) => <bdi>{r.name}</bdi> },
    {
      key: 'role',
      header: tr('ws.manager.ops.staff.role'),
      render: (r) => (r.role ? <RoleLabel role={r.role} /> : '—'),
    },
    { key: 'orders', header: tr('ws.manager.ops.staff.orders'), numeric: true, render: (r) => formatNumber(r.ordersTaken, locale) },
    { key: 'bookings', header: tr('ws.manager.ops.staff.bookings'), numeric: true, render: (r) => formatNumber(r.bookingsCreated, locale) },
    {
      key: 'payments',
      header: tr('ws.manager.ops.staff.payments'),
      numeric: true,
      render: (r) => (r.paymentsTaken === null ? '—' : formatNumber(r.paymentsTaken, locale)),
    },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r, i) => r.staffId || String(i)} dense aria-label={tr('ws.manager.ops.staff.title')} />;
}

const ROLE_KEYS = ['cashier', 'prep', 'court_desk', 'manager', 'owner'] as const;
function RoleLabel({ role }: { role: string }) {
  const { tr } = useLocale();
  const known = (ROLE_KEYS as readonly string[]).includes(role);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
      <Icon name="user" size={13} />
      {known ? tr(`op.roles.${role as (typeof ROLE_KEYS)[number]}`) : role}
    </span>
  );
}
