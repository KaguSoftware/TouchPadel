/**
 * Shifts as rows (wave5-addendum §5.2), for the day-close step and the drawer
 * screen's "Shifts on this till". MGMT only: every figure here is the stamped
 * one from app.till_shift_list (an open shift's are its running figures), and
 * the difference reads as a sign word first, colour second.
 *
 * A row says who, where and when on its first line with the outcome at the end
 * of it, then the figures that outcome came from as label and value pairs,
 * Expected before Counted, each figure on one line: a run-on sentence of
 * amounts wrapped mid-figure in Arabic and could not be compared down the
 * list. Nothing is ranked: rows keep the order they started in. Day close's
 * column is as narrow as the drawer's aside, so both use these rows; the
 * staff report, which has the width, has the columns (ShiftReport).
 */
import type { ReactNode } from 'react';
import { formatIQD, formatTime, formatTimeRange, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Money, StatusBadge } from '../../components/kit';
import { MARK_FG } from '../ops/OpsVisuals';
import { outcomeOf, type ListShift } from './tillShiftLogic';

export function ShiftRows({
  shifts,
  showStation = true,
  onCloseOpen,
}: {
  shifts: readonly ListShift[];
  showStation?: boolean;
  /** Offered on an open shift at this station (the drawer screen): "Close Ali's shift". */
  onCloseOpen?: (shift: ListShift) => void;
}) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
      {shifts.map((s) => (
        <ShiftRow key={s.id} shift={s} showStation={showStation} onCloseOpen={onCloseOpen} />
      ))}
    </ul>
  );
}

type Tr = ReturnType<typeof useLocale>['tr'];

/** What else a shift's row says in words: a handover that did not match, and who signed with a manager's PIN. */
export function shiftNotes(tr: Tr, locale: 'en' | 'ar', s: ListShift): string[] {
  const money = (n: number) => formatIQD(n, locale);
  const notes: string[] = [];
  if (s.handover_difference_iqd !== null && s.handover_difference_iqd !== 0) {
    notes.push(
      `${tr('ws.tillShift.figures.handover')}: ${
        s.handover_difference_iqd > 0
          ? tr('ws.tillShift.figures.handoverMore', { amount: money(s.handover_difference_iqd) })
          : tr('ws.tillShift.figures.handoverLess', { amount: money(-s.handover_difference_iqd) })
      }`,
    );
  }
  if (s.closed_via === 'manager_pin' && s.authorized_by_name) notes.push(tr('ws.tillShift.row.byManager', { name: isolate(s.authorized_by_name) }));
  return notes;
}

function ShiftRow({ shift: s, showStation, onCloseOpen }: { shift: ListShift; showStation: boolean; onCloseOpen?: (shift: ListShift) => void }) {
  const { tr, locale } = useLocale();
  const open = s.closed_at === null;
  const when = open
    ? tr('ws.tillShift.drawer.since', { time: formatTime(new Date(s.opened_at), locale) })
    : formatTimeRange(new Date(s.opened_at), new Date(s.closed_at as string), locale);

  let outcome: ReactNode;
  if (open) outcome = <StatusBadge size="sm" tone="info" label={tr('ws.tillShift.row.open')} />;
  else if (s.closed_via === 'day_close') outcome = <span style={{ color: MARK_FG.warn, fontWeight: 600 }}>{tr('ws.tillShift.row.endedWithDay')}</span>;
  else outcome = <DifferenceWords variance={s.cash_variance_iqd} />;

  // Expected first, then what was counted against it, then the float it started with.
  const figures: [string, number][] = [
    [open ? tr('ws.tillShift.drawer.expectedNow') : tr('ws.tillShift.figures.expected'), s.cash_expected_iqd],
    ...(!open && s.cash_counted_iqd !== null ? ([[tr('ws.tillShift.figures.counted'), s.cash_counted_iqd]] as [string, number][]) : []),
    [tr('ws.tillShift.figures.float'), s.opening_float_iqd],
  ];
  const notes = shiftNotes(tr, locale, s);

  return (
    <li
      data-shift={s.id}
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-0)',
        paddingBlock: 'var(--tp-sp-1-5)',
        paddingInline: 'var(--tp-sp-2)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
        fontSize: 'var(--tp-fs-sm)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        <bdi style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{s.staff_name}</bdi>
        {showStation && <bdi style={{ color: 'var(--tp-muted-fg)' }}>{s.station_id}</bdi>}
        <bdi style={{ color: 'var(--tp-muted-fg)' }}>{when}</bdi>
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          {outcome}
          {open && onCloseOpen && (
            <Button size="sm" kind="soft" icon="lock" onClick={() => onCloseOpen(s)}>
              {tr('ws.tillShift.rail.closeOthers', { name: isolate(s.staff_name) })}
            </Button>
          )}
        </span>
      </span>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8.5rem, 1fr))', gap: 'var(--tp-sp-1) var(--tp-sp-3)', margin: 0 }}>
        {figures.map(([label, amount]) => (
          <div key={label} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
            <dt style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>{label}</dt>
            <dd style={{ margin: 0 }}>
              <Money amount={amount} style={{ whiteSpace: 'nowrap', fontWeight: 600 }} />
            </dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 && (
        <span style={{ color: 'var(--tp-muted-fg)', overflowWrap: 'anywhere' }}>
          <bdi>{notes.join(' · ')}</bdi>
        </span>
      )}
    </li>
  );
}

/** "Short by 5,000 IQD" / "Over by …" / "The drawer matches"; "—" for no count. */
export function DifferenceWords({ variance }: { variance: number | null }) {
  const { tr, locale } = useLocale();
  const o = outcomeOf(variance);
  if (!o) return <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>;
  const amount = formatIQD(o.magnitude, locale);
  if (o.sign === 'exact') return <span style={{ color: MARK_FG.success, fontWeight: 700 }}>{tr('ws.tillShift.close.exact')}</span>;
  return (
    <span style={{ color: o.sign === 'short' ? MARK_FG.danger : MARK_FG.warn, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <bdi>{o.sign === 'short' ? tr('ws.tillShift.close.short', { amount }) : tr('ws.tillShift.close.over', { amount })}</bdi>
    </span>
  );
}
