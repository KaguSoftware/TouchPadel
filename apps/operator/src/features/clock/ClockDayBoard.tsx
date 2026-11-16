/**
 * Attendance › Today (0442): who is at work, who is late and not in, who missed a shift or never
 * logged out, and every refused attempt in plain words ("Tried from 4.2 km away"), for one day
 * (today, or up to 60 days back). From app.clock_day; the status words are derived in
 * dayStatus.ts. Reset phone unbinds a person's logging phone (app.clock_reset_device) when they
 * changed phones.
 *
 * Most urgent first, three people then View more (the owner's list rule, 2026-10-08).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber, formatTime, formatTimeRange, isolate, type MessageKey } from '@touch/i18n';
import { isRpcMissing } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useVenue } from '../../lib/venue';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import { DateField } from '../../components/inputs';
import { DataTable, EmptyState, Money, StatusBadge, ViewMore, useListCap, type Column, type Tone } from '../../components/kit';
import { CK, fetchClockDay, resetClockDevice } from './api';
import {
  blockLines,
  boardCounts,
  dayBounds,
  distanceParts,
  personStatus,
  readClockDay,
  refusalWord,
  sortForBoard,
  type DayEvent,
  type DayPerson,
  type PersonStatus,
  type StatusWord,
} from './dayStatus';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

interface Row {
  person: DayPerson;
  status: PersonStatus;
}

const TONE: Record<StatusWord['word'], Tone> = {
  off: 'neutral',
  notInYet: 'neutral',
  lateNotIn: 'danger',
  atWork: 'live',
  noLogout: 'warn',
  finished: 'neutral',
  missed: 'danger',
  late: 'warn',
  leftEarly: 'warn',
  refused: 'danger',
};

export function ClockDayBoard() {
  const { tr, locale } = useLocale();
  const { branchId, current } = useVenue();
  const tz = current?.timezone ?? undefined;
  const [date, setDate] = useState<string | null>(null);
  const q = useQuery({
    queryKey: CK.day(branchId, date),
    enabled: Boolean(branchId),
    queryFn: () => fetchClockDay(date),
    refetchInterval: date === null ? 60_000 : false,
  });
  const day = readClockDay(q.data);
  const rows = sortForBoard(day.people.map((person) => ({ person, status: personStatus(person, day.now) })));
  const cap = useListCap(rows);
  const counts = boardCounts(rows.map((r) => r.status));
  const today = day.today;
  const bounds = today ? dayBounds(today) : null;
  const isToday = date === null || date === today;
  const time = (iso: string) => formatTime(new Date(iso), locale, tz);
  const range = (a: string, b: string) => formatTimeRange(new Date(a), new Date(b), locale, tz);

  if (q.error && isRpcMissing(q.error)) return <EmptyState icon="clock" title={tr('ws.clock.board.unavailable')} />;

  return (
    <section aria-labelledby="clock-board-title" style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="clock-board">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <h2 id="clock-board-title" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, marginInlineEnd: 'var(--tp-sp-2)' }}>
          {isToday ? tr('ws.clock.board.today') : tr('ws.clock.board.pastDay')}
        </h2>
        <DateField
          value={date ?? today ?? ''}
          min={bounds?.min}
          max={bounds?.max}
          disabled={!today}
          ariaLabel={tr('ws.clock.board.pickDay')}
          onChange={(v) => setDate(v === today ? null : v)}
          style={{ inlineSize: 'auto' }}
        />
        {!isToday && (
          <Button size="sm" kind="ghost" onClick={() => setDate(null)}>
            {tr('ws.clock.board.backToToday')}
          </Button>
        )}
      </div>

      {q.data !== undefined && rows.length > 0 && (
        <p style={{ margin: 0, display: 'flex', gap: 'var(--tp-sp-1) var(--tp-sp-4)', flexWrap: 'wrap' }} data-testid="clock-board-counts">
          {isToday && <Count label={tr('ws.clock.board.counts.atWork')} n={counts.atWork} />}
          {isToday && <Count label={tr('ws.clock.board.counts.lateNotIn')} n={counts.lateNotIn} alert />}
          {isToday && <Count label={tr('ws.clock.board.counts.notInYet')} n={counts.notInYet} />}
          <Count label={tr('ws.clock.board.counts.missed')} n={counts.missed} alert />
          <Count label={tr('ws.clock.board.counts.noLogout')} n={counts.noLogout} alert />
        </p>
      )}

      {q.isError && q.data === undefined ? (
        <div role="alert" style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('common.retry')}
          </Button>
        </div>
      ) : q.data === undefined ? (
        <Skeleton lines={4} />
      ) : rows.length === 0 ? (
        <EmptyState kind="nothingToDo" icon="clock" title={tr('ws.clock.board.empty')} body={tr('ws.clock.board.emptyBody')} />
      ) : (
        <BoardTable rows={cap.shown} time={time} range={range} locale={locale} />
      )}
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} style={{ marginBlockStart: 0 }} />
    </section>
  );
}

function Count({ label, n, alert }: { label: string; n: number; alert?: boolean }) {
  const { locale } = useLocale();
  return (
    <span style={{ fontSize: 'var(--tp-fs-sm)', color: alert && n > 0 ? 'var(--tp-danger-fg)' : 'var(--tp-muted-fg)' }}>
      {label} <strong style={{ fontVariantNumeric: 'tabular-nums', color: alert && n > 0 ? 'var(--tp-danger-fg)' : 'var(--tp-fg)' }}>{formatNumber(n, locale)}</strong>
    </span>
  );
}

function useStatusLabel(time: (iso: string) => string) {
  const { tr, locale } = useLocale();
  const n = (v: number) => formatNumber(v, locale);
  const job = (r: string | null) => (r ? tr(`op.roles.${r}` as MessageKey) : '');
  return (w: StatusWord): string => {
    switch (w.word) {
      case 'off':
        return tr('ws.clock.board.status.off');
      case 'notInYet':
        return tr('ws.clock.board.status.notInYet', { time: time(w.at) });
      case 'lateNotIn':
        return tr('ws.clock.board.status.lateNotIn', { time: time(w.since) });
      case 'atWork':
        return w.role ? tr('ws.clock.board.status.atWorkAs', { time: time(w.since), job: job(w.role) }) : tr('ws.clock.board.status.atWork', { time: time(w.since) });
      case 'noLogout':
        return tr('ws.clock.board.status.noLogout', { time: time(w.since) });
      case 'finished':
        return tr('ws.clock.board.status.finished', { time: time(w.at) });
      case 'missed':
        return w.count === 1 ? tr('ws.clock.board.status.missedOne') : tr('ws.clock.board.status.missedMany', { n: n(w.count) });
      case 'late':
        return tr('ws.clock.board.status.late', { minutes: n(w.minutes) });
      case 'leftEarly':
        return tr('ws.clock.board.status.leftEarly', { minutes: n(w.minutes) });
      case 'refused':
        return tr('ws.clock.board.status.refused', { n: n(w.count) });
    }
  };
}

function useRefusalText() {
  const { tr, locale } = useLocale();
  return (e: DayEvent): string => {
    const word = refusalWord(e);
    if (word === 'far' && e.distanceM !== null) {
      const d = distanceParts(e.distanceM);
      const distance = tr(d.unit === 'm' ? 'ws.clock.board.units.m' : 'ws.clock.board.units.km', { n: formatNumber(d.value, locale) });
      return tr('ws.clock.board.refusal.far', { distance: isolate(distance) });
    }
    if (word === 'rough' && e.accuracyM !== null) return tr('ws.clock.board.refusal.roughBy', { n: formatNumber(e.accuracyM, locale) });
    return tr(`ws.clock.board.refusal.${word}`);
  };
}

function BoardTable({ rows, time, range, locale }: { rows: readonly Row[]; time: (iso: string) => string; range: (a: string, b: string) => string; locale: 'en' | 'ar' }) {
  const { tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const label = useStatusLabel(time);
  const refusalText = useRefusalText();
  const n = (v: number) => formatNumber(v, locale);

  const reset = useMutation({
    mutationFn: (staffId: string) => resetClockDevice(staffId),
    onSuccess: () => {
      toast.ok(tr('ws.clock.board.reset.done'));
      void qc.invalidateQueries({ queryKey: CK.all });
    },
    onError: (e) => toast.err(e),
  });
  async function askReset(p: DayPerson) {
    const yes = await confirm({
      title: tr('ws.clock.board.reset.title', { name: isolate(p.displayName) }),
      body: tr('ws.clock.board.reset.body'),
      confirmLabel: tr('ws.clock.board.reset.confirm'),
      kind: 'danger',
    });
    if (yes) reset.mutate(p.staffId);
  }

  const columns: Column<Row>[] = [
    {
      key: 'person',
      header: tr('ws.clock.board.cols.person'),
      render: ({ person: p }) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi style={{ fontWeight: 600 }}>{p.displayName}</bdi>
          {p.role && <span style={muted}>{tr(`op.roles.${p.role}` as MessageKey)}</span>}
        </span>
      ),
      truncateTitle: ({ person }) => person.displayName,
    },
    {
      key: 'status',
      header: tr('ws.clock.board.cols.status'),
      render: ({ person: p, status }) => (
        <span style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap', alignItems: 'center' }}>
          {status.words.map((w, i) => (
            <StatusBadge key={`${w.word}-${i}`} size="sm" tone={TONE[w.word]} dot={i === 0} label={label(w)} />
          ))}
          {p.attendance?.source === 'manual' && <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', flexBasis: '100%' }}>{tr('ws.clock.board.manualKept')}</span>}
          {p.attendance && p.attendance.penaltyIqd > 0 && (
            <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', flexBasis: '100%' }}>
              {tr('ws.clock.board.penalty')} <Money amount={p.attendance.penaltyIqd} />
            </span>
          )}
        </span>
      ),
      truncateTitle: ({ status }) => status.words.map(label).join(', '),
    },
    {
      key: 'hours',
      header: tr('ws.clock.board.cols.hours'),
      render: ({ person: p }) => {
        const lines = blockLines(p);
        if (lines.length === 0) return <span style={muted}>{tr('ws.clock.board.noHours')}</span>;
        return (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {lines.map((b) => (
              <span key={b.starts}>
                <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{range(b.starts, b.ends)}</span>
                {b.parts.length > 1 && (
                  <span style={{ ...muted, display: 'block', fontSize: 'var(--tp-fs-xs)' }}>
                    {b.parts
                      .slice(1)
                      .map((part) => tr('ws.clock.board.switchAt', { job: part.role ? tr(`op.roles.${part.role}` as MessageKey) : '', time: time(part.starts) }))
                      .join(' · ')}
                  </span>
                )}
              </span>
            ))}
          </span>
        );
      },
      truncateTitle: ({ person }) => blockLines(person).map((b) => range(b.starts, b.ends)).join(', '),
    },
    {
      key: 'scans',
      header: tr('ws.clock.board.cols.scans'),
      render: ({ status }) =>
        status.accepted.length === 0 ? (
          <span style={muted}>—</span>
        ) : (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {status.accepted.map((e) => (
              <span key={e.id} style={{ whiteSpace: 'nowrap' }}>
                {tr(e.kind === 'in' ? 'ws.clock.board.scanIn' : 'ws.clock.board.scanOut', { time: time(e.at) })}
                {e.kind === 'in' && e.lateMinutes > 0 && <span style={{ color: 'var(--tp-warn-fg)' }}> · {tr('ws.clock.board.lateBy', { minutes: n(e.lateMinutes) })}</span>}
                {e.kind === 'out' && e.earlyMinutes > 0 && <span style={{ color: 'var(--tp-warn-fg)' }}> · {tr('ws.clock.board.earlyBy', { minutes: n(e.earlyMinutes) })}</span>}
              </span>
            ))}
          </span>
        ),
      truncateTitle: ({ status }) => status.accepted.map((e) => `${e.kind} ${time(e.at)}`).join(', '),
    },
    {
      key: 'refused',
      header: tr('ws.clock.board.cols.refused'),
      render: ({ status }) =>
        status.refused.length === 0 ? (
          <span style={muted}>—</span>
        ) : (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            {status.refused.map((e) => (
              <span key={e.id} style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time(e.at)}</span> · {refusalText(e)}
              </span>
            ))}
          </span>
        ),
      truncateTitle: ({ status }) => status.refused.map((e) => `${time(e.at)} ${refusalText(e)}`).join(', '),
    },
    {
      key: 'actions',
      header: <span className="tp-sr-only">{tr('ws.clock.board.cols.actions')}</span>,
      align: 'end',
      render: ({ person: p }) =>
        p.deviceBound ? (
          <Button size="sm" kind="ghost" icon="phone" busy={reset.isPending && reset.variables === p.staffId} onClick={() => void askReset(p)} data-testid={`clock-reset-${p.staffId}`}>
            {tr('ws.clock.board.reset.action')}
          </Button>
        ) : null,
      truncateTitle: () => '',
    },
  ];

  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.person.staffId} aria-label={tr('ws.clock.board.aria')} />;
}
