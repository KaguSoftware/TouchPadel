/**
 * The rail's till-shift row (wave5-addendum §5.1), directly under the break
 * row and drawn the same way: one button in the rail's own box, one muted
 * caption under it.
 *
 *   no shift   "Start my shift"; when it cannot be pressed yet, disabled with
 *              the reason in the caption (the day is not open, or the shift is
 *              open on another till).
 *   mine       "End my shift", captioned "My shift · since 9:02 AM".
 *   another's  "Close this shift" (a manager's PIN signs it), captioned
 *              "Ali's shift · since 9:02 AM": the name lives in the caption,
 *              which wraps, so a long one never pushes the rail wider.
 *   nothing    a station with no drawer, a role that holds no shift, a status
 *              not known yet, or a manager with no shift here (tillShiftLogic
 *              railShift): drawing a guess would lie.
 *
 * The station's till and the court desk both carry it (§2.9.9).
 */
import type { CSSProperties } from 'react';
import { formatTime, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Icon } from '../../components/icons';
import { useTillShift } from './shiftContext';

export function ShiftRailControl({ style, captionStyle }: { style: CSSProperties; captionStyle: CSSProperties }) {
  const { tr, locale } = useLocale();
  const shift = useTillShift();
  const r = shift.rail;
  if (!r) return null;
  const time = (iso: string) => formatTime(new Date(iso), locale);

  if (r.kind === 'start') {
    const reason =
      r.blocked === 'noDay'
        ? tr('ws.tillShift.rail.noDay')
        : r.blocked
          ? tr('ws.tillShift.rail.elsewhere', { station: isolate(r.blocked.elsewhere) })
          : null;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--tp-sp-0)' }}>
        <button
          type="button"
          className="tp-nav-item"
          data-testid="rail.shift.start"
          style={{ ...style, opacity: reason ? 0.6 : 1, cursor: reason ? 'not-allowed' : 'pointer' }}
          disabled={reason !== null}
          aria-describedby={reason ? 'tp-shift-caption' : undefined}
          onClick={shift.openStart}
        >
          <Icon name="drawer" size={16} />
          <span>{tr('ws.tillShift.rail.start')}</span>
        </button>
        {reason && (
          <p id="tp-shift-caption" style={captionStyle}>
            {reason}
          </p>
        )}
      </div>
    );
  }

  const mine = r.kind === 'mine';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--tp-sp-0)' }}>
      <button
        type="button"
        className="tp-nav-item"
        data-testid={mine ? 'rail.shift.end' : 'rail.shift.close'}
        style={style}
        aria-describedby="tp-shift-caption"
        onClick={() => shift.openClose()}
      >
        <Icon name="lock" size={16} />
        <span>{mine ? tr('ws.tillShift.rail.end') : tr('ws.tillShift.rail.closeThis')}</span>
      </button>
      <p id="tp-shift-caption" style={{ ...captionStyle, overflowWrap: 'anywhere' }}>
        {mine ? tr('ws.tillShift.rail.mine', { time: time(r.openedAt) }) : tr('ws.tillShift.rail.others', { name: isolate(r.name), time: time(r.openedAt) })}
      </p>
    </div>
  );
}
