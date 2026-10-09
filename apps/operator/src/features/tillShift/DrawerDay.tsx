/**
 * The day on /till/drawer for whoever counts the drawer (manager, owner): every
 * shift on every till and the desk for one business day, with what each started
 * with, took, refunded, was expected to hold, was counted at, and the difference.
 *
 * The page used to list only the shifts on THIS station in a narrow aside, so an
 * owner on the office PC saw none of the tills' shifts. This reads
 * app.till_shift_list for the whole branch (no station), for the open day (else
 * the latest) or the day stepped to. A row is a shift: the blind count lives in
 * the till; here the stamped result is shown, with who signed it and any note.
 * Money taken at a station while no shift was open there is not on any shift;
 * it is named under the table so the day still adds up.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate, formatIQD, formatNumber, formatTime, formatTimeRange } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { DataTable, EmptyState, HeadlineFigure, Money, Panel, StatusBadge, AsyncStateWrapper, asyncStatus, type Column } from '../../components/kit';
import { ChevronBack, ChevronForward } from '../../components/icons';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { addDays } from '../deductions/venueDate';
import { fetchShiftList, tillShiftListKey } from './api';
import { DifferenceWords, shiftNotes } from './ShiftRows';
import { outcomeOf, type ListShift } from './tillShiftLogic';
import { activityParts, canStepForward, summariseDay } from './drawerDayLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

type Tr = ReturnType<typeof useLocale>['tr'];

/** The day's figures and shifts, with the stepper that moves between days. `openDayFloat` is the open day's float, shown only while that day is. */
export function DrawerDay({
  openDayDate,
  openDayFloat,
  actions,
  whenOpenDay,
}: {
  openDayDate: string | null;
  openDayFloat: number | null;
  actions?: ReactNode;
  /** Shown under the shifts only while the open day is the day shown (the drawer's own activity log). */
  whenOpenDay?: ReactNode;
}) {
  const { tr, locale } = useLocale();
  // null = the server's pick (the open day, else the latest); a date = stepped to.
  const [date, setDate] = useState<string | null>(null);
  const latestQ = useQuery({ queryKey: tillShiftListKey({}), queryFn: () => fetchShiftList({}), refetchInterval: 30_000 });
  const pickedQ = useQuery({
    queryKey: tillShiftListKey({ from: date, to: date }),
    queryFn: () => fetchShiftList({ from: date, to: date }),
    enabled: date !== null,
    refetchInterval: 30_000,
  });
  const q = date === null ? latestQ : pickedQ;
  const latest = latestQ.data?.from ?? null;
  const shown = date ?? latest;
  const stepTo = (next: string) => setDate(latest !== null && next >= latest ? null : next);

  const list = q.data;
  const summary = list ? summariseDay(list) : null;
  const onOpenDay = shown !== null && shown === openDayDate;
  const dayName = shown ? formatDate(new Date(`${shown}T12:00:00Z`), locale, 'UTC') : tr('common.loading');

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <Button aria-label={tr('ws.tillShift.dayView.prevDay')} disabled={shown === null} onClick={() => shown && stepTo(addDays(shown, -1))} data-testid="drawer.day.prev">
          <ChevronBack size={16} />
        </Button>
        <h2 id="drawer-day" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, minInlineSize: '11rem', textAlign: 'center', margin: 0 }} data-testid="drawer.day.name">
          <bdi>{dayName}</bdi>
        </h2>
        <Button aria-label={tr('ws.tillShift.dayView.nextDay')} disabled={!canStepForward(shown, latest)} onClick={() => shown && stepTo(addDays(shown, 1))} data-testid="drawer.day.next">
          <ChevronForward size={16} />
        </Button>
        {date !== null && (
          <Button kind="ghost" size="sm" onClick={() => setDate(null)}>
            {tr('ws.tillShift.dayView.latest')}
          </Button>
        )}
        {actions && <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 'var(--tp-sp-2)' }}>{actions}</span>}
      </div>

      <AsyncStateWrapper
        status={asyncStatus(q, () => false)}
        error={q.error}
        onRetry={() => void q.refetch()}
        compact
      >
        {list && summary && (
          <>
            <section
              aria-labelledby="drawer-day"
              data-testid="drawer.day.figures"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))', gap: 'var(--tp-sp-3)' }}
            >
              {onOpenDay && openDayFloat !== null && <HeadlineFigure label={tr('ws.cashier.drawer.float')} value={<Money amount={openDayFloat} />} hint={tr('ws.cashier.drawer.floatHint')} />}
              <HeadlineFigure
                label={tr('ws.tillShift.figures.cashIn')}
                value={<Money amount={summary.cashTaken} />}
                hint={summary.cashRefunded > 0 ? `${tr('ws.tillShift.figures.cashOut')}: ${formatIQD(summary.cashRefunded, locale)}` : undefined}
              />
              <HeadlineFigure label={tr('ws.tillShift.figures.card')} value={<Money amount={summary.cardTaken} />} />
              <HeadlineFigure
                label={tr('ws.tillShift.dayView.countedAtEnds')}
                value={summary.counted > 0 ? <Money amount={summary.countedIqd} /> : '—'}
                hint={tr('ws.tillShift.dayView.countedOf', { counted: formatNumber(summary.counted, locale), total: formatNumber(summary.shifts, locale) })}
              />
              <HeadlineFigure
                label={tr('ws.tillShift.figures.difference')}
                value={summary.counted > 0 ? <DifferenceWords variance={summary.varianceIqd} /> : '—'}
                hint={summary.open > 0 ? tr('ws.tillShift.dayView.stillOpen', { count: formatNumber(summary.open, locale) }) : undefined}
              />
            </section>

            <Panel title={<CardTitle icon="drawer">{tr('ws.tillShift.drawer.shiftsTitle')}</CardTitle>}>
              {list.shifts.length === 0 ? (
                <EmptyState compact kind="nothingToDo" icon="drawer" title={tr('ws.tillShift.drawer.shiftsEmpty')} />
              ) : (
                <DataTable<ListShift>
                  aria-label={tr('ws.tillShift.drawer.shiftsTitle')}
                  columns={shiftColumns(tr, locale)}
                  rows={list.shifts}
                  rowKey={(s) => s.id}
                  dense
                />
              )}
              {(summary.outsideCashIn > 0 || summary.outsideCashOut > 0) && (
                <p data-testid="drawer.day.outside" style={{ ...muted, margin: 0, marginBlockStart: 'var(--tp-sp-2)' }}>
                  {tr('ws.tillShift.dayView.outside', { taken: formatIQD(summary.outsideCashIn, locale), refunded: formatIQD(summary.outsideCashOut, locale) })}
                </p>
              )}
            </Panel>
            {onOpenDay && whenOpenDay}
          </>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

function shiftColumns(tr: Tr, locale: ReturnType<typeof useLocale>['locale']): Column<ListShift>[] {
  const money = (get: (s: ListShift) => number | null): Column<ListShift>['render'] => (s) => (get(s) === null ? <span style={muted}>—</span> : <Money amount={get(s)} style={{ whiteSpace: 'nowrap' }} />);
  return [
    {
      key: 'person',
      header: tr('ws.tillShift.report.columns.person'),
      width: '16rem',
      truncateTitle: (s) => s.staff_name,
      render: (s) => {
        const notes = [
          ...shiftNotes(tr, locale, s),
          ...(s.close_note ? [`${tr('ws.tillShift.close.note')}: ${s.close_note}`] : []),
        ];
        // Each item is its own isolated run: a station id is Latin, the labels Arabic.
        const items = [s.station_id, ...activityParts(s).map((p) => `${tr(`ws.tillShift.figures.${p.key}`)} ${formatNumber(p.count, locale)}`)].filter(Boolean);
        return (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <bdi style={{ fontWeight: 600 }}>{s.staff_name}</bdi>
            <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', display: 'flex', flexWrap: 'wrap', columnGap: 'var(--tp-sp-1-5)' }}>
              {items.map((item, i) => (
                <span key={item}>
                  {i > 0 && <span aria-hidden="true">· </span>}
                  <bdi>{item}</bdi>
                </span>
              ))}
            </span>
            {notes.length > 0 && (
              <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', overflowWrap: 'anywhere' }}>
                <bdi>{notes.join(' · ')}</bdi>
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'times',
      header: tr('ws.tillShift.report.columns.times'),
      render: (s) => (
        <bdi style={{ whiteSpace: 'nowrap' }}>
          {s.closed_at ? formatTimeRange(new Date(s.opened_at), new Date(s.closed_at), locale) : tr('ws.tillShift.drawer.since', { time: formatTime(new Date(s.opened_at), locale) })}
        </bdi>
      ),
    },
    { key: 'float', header: tr('ws.tillShift.figures.float'), numeric: true, render: money((s) => s.opening_float_iqd) },
    { key: 'cashIn', header: tr('ws.tillShift.figures.cashIn'), numeric: true, render: money((s) => s.cash_payments_iqd) },
    { key: 'cashOut', header: tr('ws.tillShift.figures.cashOut'), numeric: true, render: money((s) => s.cash_refunds_iqd) },
    {
      key: 'expected',
      header: tr('ws.tillShift.figures.expected'),
      numeric: true,
      render: (s) => <Money amount={s.cash_expected_iqd} style={{ whiteSpace: 'nowrap' }} />,
    },
    { key: 'counted', header: tr('ws.tillShift.dayView.countedAtEnd'), numeric: true, render: money((s) => s.cash_counted_iqd) },
    {
      key: 'difference',
      header: tr('ws.tillShift.figures.difference'),
      numeric: true,
      render: (s) => {
        if (s.closed_at === null) return <StatusBadge size="sm" tone="info" label={tr('ws.tillShift.row.open')} />;
        if (s.closed_via === 'day_close') return <span style={{ color: MARK_FG.warn, fontWeight: 600 }}>{tr('ws.tillShift.row.endedWithDay')}</span>;
        return outcomeOf(s.cash_variance_iqd) ? <DifferenceWords variance={s.cash_variance_iqd} /> : <span style={muted}>—</span>;
      },
    },
  ];
}
