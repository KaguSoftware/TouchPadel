/**
 * Today's reading panels (the 2026-10-16 rebuild): everything on the page that
 * is context rather than a to-do. Two rules hold across all of them:
 *
 *  - **Colour means act, and acting lives in "Needs you".** Every figure here
 *    is plain ink, zero recedes to grey, and nothing is red or amber except
 *    the two checks before closing, which are themselves the way to close.
 *    The old cards printed no-shows red and cancellations amber though
 *    nothing on any screen undoes either.
 *  - **Every figure appears once.** Waiter calls, late orders, running low and
 *    expired stock are rows of "Needs you" when there are any, so they are
 *    not printed again here; open tabs are on the floor, not repeated as a
 *    count before closing.
 *
 * A figure that opens something is a whole row with a chevron (FigureRow),
 * and it opens exactly those items. A panel's way to its own screens is a
 * button at its foot (as "Go to Day close"), a group's is a link beside its
 * title; each is named for where it goes, never with a figure's own words.
 */
import type { ReactNode } from 'react';
import { countPhrase, formatDate, formatDateTime, formatNumber, formatTime, formatWeekdayLong } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { STAFF_ROLES, type StaffRole } from '../../lib/roleResolution';
import { Button } from '../../components/ui';
import { DataTable, EmptyState, Money, Panel, StatusBadge, ViewMore, LIST_CAP, useListCap, type Column } from '../../components/kit';
import { Icon } from '../../components/icons';
import { CardTitle, FigureRow, MARK, MARK_FG, MARK_SOFT, RowList, type MarkTone } from './OpsVisuals';
import {
  DAY_CLOSE_TONE,
  STOCK_HREF,
  auditDrillHref,
  dayCloseState,
  tillTabHref,
  type ExceptionKey,
  type OpsBlockingTab,
  type OpsOverview,
  type OpsStaffRow,
} from './opsLogic';

type Go = (href: string) => void;

/** A group's way to the screen it reads from, beside the group's title: "Courts · See bookings ↗". */
function GroupLink({ label, href, go }: { label: string; href: string; go: Go }) {
  return (
    <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go(href)}>
      {label}
    </Button>
  );
}

/**
 * A panel's ways to its own screens, at its foot like "Go to Day close". In
 * the header they squeezed the title onto two lines in the narrow column,
 * Arabic first.
 */
function PanelLinks({ links, go }: { links: readonly { label: string; href: string }[]; go: Go }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-3)' }}>
      {links.map((l) => (
        <Button key={l.href} size="sm" iconEnd="arrowUpRight" onClick={() => go(l.href)}>
          {l.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * A named group inside a panel ("Courts", "Café", "Kitchen") with its rows,
 * as a card of its own built like every other card on the page: the title
 * band, its way to the screen it reads from at the band's end, then the rows.
 */
function Group({ title, link, children }: { title: string; link?: ReactNode; children: ReactNode }) {
  return (
    <Panel level={3} title={title} actions={link} style={{ minInlineSize: 0 }}>
      {children}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// On the floor now
// ---------------------------------------------------------------------------

export function FloorPanel({ data, go }: { data: OpsOverview; go: Go }) {
  const { tr, locale } = useLocale();
  const b = data.bookings;
  const c = data.cafe;
  const court = locale === 'ar' ? (b.nextArrivalCourtAr ?? b.nextArrivalCourtEn) : (b.nextArrivalCourtEn ?? b.nextArrivalCourtAr);
  const next = b.nextArrivalAt ? [formatTime(new Date(b.nextArrivalAt), locale), court, b.nextArrivalLabel].filter(Boolean).join(' · ') : null;
  return (
    <Panel data-testid="floor-now" title={<CardTitle icon="court">{tr('ws.manager.ops.floor.title')}</CardTitle>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--tp-sp-4)' }}>
        <Group title={tr('ws.manager.ops.floor.courts')} link={<GroupLink label={tr('ws.manager.ops.floor.courtsLink')} href="/desk" go={go} />}>
          <RowList chevrons={false}>
            <FigureRow label={tr('ws.manager.ops.floor.booked')} value={b.today} />
            <FigureRow label={tr('ws.manager.ops.floor.arrived')} value={b.arrived} />
            <FigureRow label={tr('ws.manager.ops.floor.upcoming')} value={b.upcoming} />
          </RowList>
          <p style={{ display: 'grid', gap: 'var(--tp-sp-0)', margin: 0, marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' }}>
            <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.floor.next')}</span>
            {next ? (
              <bdi style={{ fontWeight: 600, color: 'var(--tp-fg)' }}>{next}</bdi>
            ) : (
              <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.floor.nextNone')}</span>
            )}
          </p>
        </Group>
        <Group title={tr('ws.manager.ops.floor.cafe')} link={<GroupLink label={tr('ws.manager.ops.floor.cafeLink')} href="/till/tabs" go={go} />}>
          <RowList chevrons={false}>
            <FigureRow label={tr('ws.manager.ops.floor.openTabs')} value={c.openTabs} />
            <FigureRow label={tr('ws.manager.ops.floor.orders')} value={c.ordersToday} />
          </RowList>
        </Group>
        {/* Late orders are a row of "Needs you" when there are any. These two
            overlap with them (a late order is also waiting or being made), so
            the kitchen is never added up. */}
        <Group title={tr('ws.manager.ops.floor.kitchen')}>
          <RowList chevrons={false}>
            <FigureRow label={tr('ws.manager.ops.floor.waiting')} value={c.ticketsQueued} />
            <FigureRow label={tr('ws.manager.ops.floor.preparing')} value={c.ticketsPreparing} />
          </RowList>
        </Group>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Before you close
// ---------------------------------------------------------------------------

function tabName(t: OpsBlockingTab, tr: ReturnType<typeof useLocale>['tr']): string {
  if (t.tableNumber) return tr('ws.manager.ops.close.tab', { label: t.tableNumber });
  // Never an id: a booking made by a signed-in account carries no guest_name,
  // and a tab named `3f2a1b9c` tells a manager nothing about which one it is.
  return t.guestName ?? t.label ?? tr('op.till.forReservation');
}

/** One check before closing: a tick when it is clear, a mark in its tone when it is not. */
function Check({ done, tone, title, hint, children }: { done: boolean; tone: MarkTone; title: string; hint?: string; children?: ReactNode }) {
  const t: MarkTone = done ? 'success' : tone;
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '1.5rem minmax(0, 1fr)', columnGap: 'var(--tp-sp-3)', rowGap: 'var(--tp-sp-2)', alignItems: 'start' }}>
      <span
        aria-hidden="true"
        style={{ display: 'grid', placeItems: 'center', inlineSize: '1.5rem', blockSize: '1.5rem', borderRadius: 'var(--tp-radius-pill)', background: MARK_SOFT[t], color: MARK_FG[t] }}
      >
        <Icon name={done ? 'check' : 'alert'} size={14} />
      </span>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', paddingBlockStart: '0.0625rem' }}>
        <span style={{ fontWeight: 600, color: done ? 'var(--tp-muted-fg)' : 'var(--tp-fg)' }}>{title}</span>
        {hint && <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{hint}</span>}
      </span>
      {children && <div style={{ gridColumn: 2 }}>{children}</div>}
    </li>
  );
}

export function BeforeYouClose({ data, queued, go }: { data: OpsOverview; queued: number; go: Go }) {
  const { tr, locale } = useLocale();
  const d = data.dayClose;
  const state = dayCloseState(d, queued);
  const tabsClear = d.blockingCount === 0;
  return (
    <Panel
      data-testid="before-close"
      title={<CardTitle icon="sun">{tr('ws.manager.ops.close.title')}</CardTitle>}
      actions={<StatusBadge tone={DAY_CLOSE_TONE[state]} label={tr(`ws.manager.dayClose.state.${state}`)} />}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <Check
          done={tabsClear}
          tone="danger"
          title={tabsClear ? tr('ws.manager.ops.close.tabsDone') : countPhrase('ws.manager.ops.close.tabsLeft', d.blockingCount, locale)}
          hint={tabsClear ? undefined : tr('ws.manager.ops.close.tabsHint')}
        >
          {d.blockingTabs.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
              {d.blockingTabs.slice(0, LIST_CAP).map((t) => (
                <li key={t.id} style={{ minInlineSize: 0, maxInlineSize: '100%' }}>
                  <Button size="sm" kind="soft" icon="receipt" onClick={() => go(tillTabHref(t.id))} style={{ maxInlineSize: '100%' }}>
                    <bdi style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tabName(t, tr)}</bdi>
                  </Button>
                </li>
              ))}
              {d.blockingTabs.length > LIST_CAP && (
                <li>
                  <Button size="sm" kind="ghost" onClick={() => go('/till/tabs')}>
                    {tr('ws.manager.ops.close.moreTabs', { count: formatNumber(d.blockingTabs.length - LIST_CAP, locale) })}
                  </Button>
                </li>
              )}
            </ul>
          )}
        </Check>
        {/* What this machine has not sent yet: only it knows (opsLogic). */}
        <Check
          done={queued === 0}
          tone="warn"
          title={queued === 0 ? tr('ws.manager.ops.close.synced') : countPhrase('ws.manager.ops.close.unsent', queued, locale)}
          hint={queued === 0 ? undefined : tr('ws.manager.ops.close.unsentHint')}
        />
      </ul>
      <div style={{ marginBlockStart: 'var(--tp-sp-4)' }}>
        <Button kind={state === 'ready' ? 'primary' : 'default'} size="sm" iconEnd="arrowUpRight" onClick={() => go('/admin/day-close')}>
          {tr('ws.manager.ops.close.go')}
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Stock to watch
// ---------------------------------------------------------------------------

export function StockToWatch({ data, go }: { data: OpsOverview; go: Go }) {
  const { tr, locale } = useLocale();
  const s = data.stock;
  return (
    <Panel data-testid="stock-watch" title={<CardTitle icon="package">{tr('ws.manager.ops.stock.title')}</CardTitle>}>
      <RowList chevrons>
        <FigureRow label={tr('ws.manager.ops.stock.belowPar')} value={s.belowPar} onOpen={() => go(STOCK_HREF.belowPar)} />
        <FigureRow label={tr('ws.manager.ops.stock.expiringSoon')} value={s.expiringSoon} onOpen={() => go(STOCK_HREF.expiringSoon)} />
        {s.openAlerts !== null && <FigureRow label={tr('ws.manager.ops.stock.alerts')} value={s.openAlerts} onOpen={() => go(STOCK_HREF.alerts)} />}
        <FigureRow
          label={tr('ws.manager.ops.stock.lastCount')}
          value={
            s.lastCountAt ? (
              <bdi>{formatDateTime(new Date(s.lastCountAt), locale)}</bdi>
            ) : (
              <span style={{ fontWeight: 400, color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.stock.never')}</span>
            )
          }
          onOpen={() => go(STOCK_HREF.lastCount)}
        />
      </RowList>
      <PanelLinks links={[{ label: tr('ws.manager.ops.stock.link'), href: '/stock' }]} go={go} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// So far today
// ---------------------------------------------------------------------------

const MONEY_KEYS = ['discounts', 'voids', 'refunds', 'waste'] as const satisfies readonly ExceptionKey[];

export function SoFarToday({ data, go }: { data: OpsOverview; go: Go }) {
  const { tr, locale } = useLocale();
  // `waste` can be absent from the payload: no row, rather than a zero the server never sent.
  const present = MONEY_KEYS.filter((k) => data.exceptions[k] !== null);
  return (
    <Panel data-testid="so-far-today" title={<CardTitle icon="fileText">{tr('ws.manager.ops.today.title')}</CardTitle>}>
      <RowList chevrons>
        {present.map((k) => {
          const f = data.exceptions[k]!;
          return (
            <FigureRow
              key={k}
              label={tr(`ws.manager.ops.today.${k}`)}
              hint={countPhrase('ws.manager.ops.today.times', f.count, locale)}
              value={f.amountIqd === null ? f.count : <Money amount={f.amountIqd} />}
              onOpen={() => go(auditDrillHref(k))}
            />
          );
        })}
        <FigureRow label={tr('ws.manager.ops.today.noShows')} value={data.bookings.noShows} />
        <FigureRow label={tr('ws.manager.ops.today.cancelled')} value={data.bookings.cancelledToday} />
      </RowList>
      <PanelLinks
        links={[
          { label: tr('ws.manager.ops.today.reports'), href: '/reports/courts' },
          { label: tr('ws.manager.ops.today.audit'), href: '/admin/audit' },
        ]}
        go={go}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Who worked today
// ---------------------------------------------------------------------------

/**
 * Deliberately a plain table with no bars, ordered by name (the server's
 * order): a bar beside each person's count is how a record of the shift
 * becomes a leaderboard (PRODUCT.md anti-references).
 */
export function WhoWorked({ rows }: { rows: OpsStaffRow[] }) {
  const { tr, locale } = useLocale();
  const cap = useListCap(rows);
  const columns: Column<OpsStaffRow>[] = [
    { key: 'name', header: tr('ws.manager.ops.staff.name'), truncate: true, truncateTitle: (r) => r.name, render: (r) => <bdi>{r.name}</bdi> },
    { key: 'role', header: tr('ws.manager.ops.staff.role'), render: (r) => (r.role ? <RoleLabel role={r.role} /> : '—') },
    { key: 'orders', header: tr('ws.manager.ops.staff.orders'), numeric: true, render: (r) => formatNumber(r.ordersTaken, locale) },
    { key: 'bookings', header: tr('ws.manager.ops.staff.bookings'), numeric: true, render: (r) => formatNumber(r.bookingsCreated, locale) },
    {
      key: 'payments',
      header: tr('ws.manager.ops.staff.payments'),
      numeric: true,
      render: (r) => (r.paymentsTaken === null ? '—' : formatNumber(r.paymentsTaken, locale)),
    },
  ];
  return (
    <Panel data-testid="who-worked" title={<CardTitle icon="users">{tr('ws.manager.ops.staff.title')}</CardTitle>}>
      <p style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.staff.lead')}</p>
      {rows.length === 0 ? (
        // Nobody has recorded anything yet is not a fault and not a filter.
        <EmptyState compact kind="nothingToDo" icon="users" title={tr('ws.manager.ops.staff.empty')} titleAs="h3" />
      ) : (
        <>
          <DataTable columns={columns} rows={cap.shown} rowKey={(r, i) => r.staffId || String(i)} dense aria-label={tr('ws.manager.ops.staff.title')} />
          <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
        </>
      )}
    </Panel>
  );
}

function RoleLabel({ role }: { role: string }) {
  const { tr } = useLocale();
  const known = (STAFF_ROLES as readonly string[]).includes(role);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
      <Icon name="user" size={13} />
      {known ? tr(`op.roles.${role as StaffRole}`) : role}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The day not open
// ---------------------------------------------------------------------------

/**
 * No business day open: the one thing on the page that stops the till, so it
 * is one banner above everything, with the page's only primary button. It used
 * to be a "Needs you now" row AND the closing card's body, saying it twice.
 */
export function DayClosedBanner({ go }: { go: Go }) {
  const { tr } = useLocale();
  return (
    <section
      aria-labelledby="ops-day-closed"
      data-testid="day-closed"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 'var(--tp-sp-4)',
        paddingBlock: 'var(--tp-sp-4)',
        paddingInline: 'var(--tp-sp-5)',
        borderRadius: 'var(--tp-radius-panel)',
        border: '1px solid var(--tp-warn-mark)',
        background: 'var(--tp-warn-soft)',
      }}
    >
      <span
        aria-hidden="true"
        style={{ display: 'grid', placeItems: 'center', flex: '0 0 auto', inlineSize: '2.5rem', blockSize: '2.5rem', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-surface)', color: MARK.warn }}
      >
        <Icon name="lock" size={20} />
      </span>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 20rem', minInlineSize: 0 }}>
        <h2 id="ops-day-closed" style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', fontWeight: 700, color: MARK_FG.warn }}>
          {tr('ws.manager.ops.closed.title')}
        </h2>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-fg)' }}>{tr('ws.manager.ops.closed.body')}</p>
      </div>
      <Button kind="primary" iconEnd="arrowUpRight" onClick={() => go('/admin/day-close')}>
        {tr('ws.manager.ops.closed.action')}
      </Button>
    </section>
  );
}

/** The heading's subtitle: which business day this is and since when it is open. */
export function daySubtitle(data: OpsOverview, tr: ReturnType<typeof useLocale>['tr'], locale: 'en' | 'ar'): string | undefined {
  const d = data.dayClose;
  // A business date is a calendar date: read it at noon UTC, which is the same
  // date in Baghdad (the formatters' zone) whatever this machine's own zone is.
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
  if (d.open && d.businessDate && d.openedAt) {
    const date = day(d.businessDate);
    return tr('ws.manager.ops.dayOpen', {
      weekday: formatWeekdayLong(date, locale),
      date: formatDate(date, locale),
      time: formatTime(new Date(d.openedAt), locale),
    });
  }
  if (!d.open && data.today) {
    const date = day(data.today);
    return tr('ws.manager.ops.dayClosedOn', { weekday: formatWeekdayLong(date, locale), date: formatDate(date, locale) });
  }
  return undefined;
}
