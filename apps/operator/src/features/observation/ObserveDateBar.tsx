/**
 * The date and zoom controls both observe boards share: step back and forward
 * (a day at a time, or a month when zoomed out), jump to today, and the zoom
 * button that pulls back to the month calendar and returns to the day.
 *
 * ← → move the date and D / M change level, as on the desk calendar, so the
 * keys an owner learns on one carry to the other. The keys are named in the
 * buttons' tooltips rather than in a legend beside them: a row of key caps
 * and "Arrow keys move the date · D day view · M month view" was the widest
 * thing on the toolbar and told a mouse user nothing they needed.
 */
import { useEffect } from 'react';
import { formatMonthYear } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, inputStyle } from '../../components/ui';
import { Toolbar } from '../../components/kit';
import { shiftIsoDate } from '../desk/weekLogic';
import { shiftMonth } from '../desk/calendar/monthLogic';
import type { ZoomLevel } from '../desk/calendar/ZoomStage';

/** "Thursday" — the long weekday of a 'YYYY-MM-DD' taken at UTC noon. */
function formatWeekdayLong(noonUtc: Date, locale: 'en' | 'ar'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-IQ-u-nu-latn', { weekday: 'long', timeZone: 'UTC' }).format(noonUtc);
}

export function ObserveDateBar({
  date,
  today,
  level,
  onDate,
  onLevel,
  keysDisabled,
}: {
  date: string;
  today: string;
  level: ZoomLevel;
  onDate: (d: string) => void;
  onLevel: (l: ZoomLevel) => void;
  /** While a panel owns the keyboard. */
  keysDisabled?: boolean;
}) {
  const { tr, locale, dir } = useLocale();
  const step = (d: string, n: 1 | -1) => (level === 'month' ? shiftMonth(d, n) : shiftIsoDate(d, n));

  useEffect(() => {
    if (keysDisabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === forward) {
        e.preventDefault();
        onDate(step(date, 1));
      } else if (e.key === backward) {
        e.preventDefault();
        onDate(step(date, -1));
      } else if (e.key === 'd' || e.key === 'D') {
        onLevel('day');
      } else if (e.key === 'm' || e.key === 'M') {
        onLevel('month');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const noon = new Date(`${date}T12:00:00Z`);
  // The arrow that moves in each direction, as it reads on the key cap.
  const backKey = dir === 'rtl' ? '→' : '←';
  const forwardKey = dir === 'rtl' ? '←' : '→';
  return (
    <Toolbar style={{ marginBlockEnd: 0 }}>
      <Button onClick={() => onDate(step(date, -1))} title={`${level === 'month' ? tr('ws.kit.calendar.prevMonth') : tr('ws.courtDesk.calendar.prev')} (${backKey})`}>
        ‹
      </Button>
      <input
        type="date"
        aria-label={tr('ws.courtDesk.common.date')}
        value={date}
        onChange={(e) => e.target.value && onDate(e.target.value)}
        style={{ ...inputStyle, inlineSize: 'auto' }}
      />
      <Button onClick={() => onDate(step(date, 1))} title={`${level === 'month' ? tr('ws.kit.calendar.nextMonth') : tr('ws.courtDesk.calendar.next')} (${forwardKey})`}>
        ›
      </Button>
      <Button onClick={() => onDate(today)} disabled={date === today}>
        {tr('common.today')}
      </Button>
      <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginInlineStart: '0.25rem' }}>
        {/* The date field already prints the day in numbers; the weekday is what
            it does not say (a Thursday and a Saturday are different nights). */}
        <bdi>{level === 'month' ? formatMonthYear(noon, locale, 'UTC') : formatWeekdayLong(noon, locale)}</bdi>
      </span>
      <Button
        kind={level === 'month' ? 'soft' : 'default'}
        icon={level === 'month' ? 'zoomIn' : 'zoomOut'}
        onClick={() => onLevel(level === 'month' ? 'day' : 'month')}
        title={`${level === 'month' ? tr('ws.kit.calendar.zoomInHint') : tr('ws.kit.calendar.zoomOutHint')} (${level === 'month' ? 'D' : 'M'})`}
      >
        {level === 'month' ? tr('op.desk.viewDay') : tr('ws.kit.calendar.month')}
      </Button>
    </Toolbar>
  );
}
