/**
 * Opening hours AND closed days (SOW L319) — one window per day (Phase 1;
 * midnight-crossing windows are unsupported by the slot grid), plus the list of
 * dates the venue does not trade at all. Both save through
 * `app.set_opening_hours` (0013), which has always taken `p_closed_dates`.
 *
 * The closed-dates half is new: the column has existed since 0006,
 * `assert_bookable` refuses bookings on those days and the desk calendar greys
 * them out, but nothing could WRITE the list — closing for Eid meant a SQL
 * statement against the client's production database.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DayKey } from '@touch/core';
import { appRpc } from '../../lib/appRpc';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, card, inputStyle } from '../../components/ui';
import {
  addClosedDate,
  isIsoDate,
  removeClosedDate,
  sameClosedDates,
  splitClosedDates,
} from './closedDates';

const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface DayDraft {
  closed: boolean;
  open: string;
  close: string;
}

export function OpeningHoursEditor() {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<DayKey, DayDraft> | null>(null);
  const [closed, setClosed] = useState<string[] | null>(null);
  const [newDate, setNewDate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Shared fetcher. This selected a NARROWER column set under the same key as
  // the desk calendar, which then read `timezone` as undefined and rendered the
  // whole grid in the fallback timezone, silently.
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });

  useEffect(() => {
    if (!settingsQ.data || draft) return;
    const next = {} as Record<DayKey, DayDraft>;
    for (const key of DAY_KEYS) {
      const windows = settingsQ.data.opening_hours[key] ?? [];
      const first = windows[0];
      next[key] = first
        ? { closed: false, open: first[0], close: first[1] }
        : { closed: true, open: '09:00', close: '23:00' };
    }
    setDraft(next);
    setClosed(settingsQ.data.closed_dates ?? []);
  }, [settingsQ.data, draft]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const hours: Record<string, [string, string][]> = {};
      for (const key of DAY_KEYS) {
        const d = draft[key];
        hours[key] = d.closed ? [] : [[d.open, d.close]];
      }
      // Both halves in one call: they are one screen and one audit row.
      // An EMPTY array is meaningful — the RPC coalesces null to "unchanged",
      // so reopening the venue has to send [] rather than nothing.
      await appRpc('set_opening_hours', {
        p_opening_hours: hours,
        p_closed_dates: closed ?? [],
      });
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: QK.venueSettings });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!draft || closed === null) return <p>{tr('common.loading')}</p>;

  // The venue's own today, not the browser's — a station in another timezone
  // must not decide that tomorrow's closure is already in the past.
  const todayIso = new Date().toLocaleDateString('en-CA', {
    timeZone: settingsQ.data?.timezone ?? undefined,
  });
  const { upcoming, past } = splitClosedDates(closed, todayIso);
  const dirtyDates = !sameClosedDates(closed, settingsQ.data?.closed_dates ?? []);

  return (
    <div style={{ ...card, maxInlineSize: '34rem' }}>
      <h3 style={{ marginBlockStart: 0 }}>{tr('op.hours.title')}</h3>
      {DAY_KEYS.map((key) => {
        const d = draft[key];
        return (
          <div
            key={key}
            style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBlockEnd: '0.4rem' }}
          >
            <span style={{ inlineSize: '6rem' }}>{tr(`op.days.${key}`)}</span>
            <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={d.closed}
                onChange={(e) => setDraft({ ...draft, [key]: { ...d, closed: e.target.checked } })}
              />
              {tr('op.hours.closedDay')}
            </label>
            {!d.closed && (
              <>
                <input
                  style={{ ...inputStyle, inlineSize: 'auto' }}
                  dir="ltr"
                  type="time"
                  aria-label={tr('op.hours.open')}
                  value={d.open}
                  onChange={(e) => setDraft({ ...draft, [key]: { ...d, open: e.target.value } })}
                />
                <span>–</span>
                <input
                  style={{ ...inputStyle, inlineSize: 'auto' }}
                  dir="ltr"
                  type="time"
                  aria-label={tr('op.hours.close')}
                  value={d.close}
                  onChange={(e) => setDraft({ ...draft, [key]: { ...d, close: e.target.value } })}
                />
              </>
            )}
          </div>
        );
      })}
      <h3 style={{ marginBlockEnd: '0.2rem' }}>{tr('op.hours.closedDatesTitle')}</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)', marginBlockStart: 0 }}>
        {tr('op.hours.closedDatesHint')}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, inlineSize: 'auto' }}
          dir="ltr"
          type="date"
          aria-label={tr('op.hours.closedDateAdd')}
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />
        <Button
          disabled={!isIsoDate(newDate) || closed.includes(newDate)}
          onClick={() => {
            setClosed(addClosedDate(closed, newDate));
            setNewDate('');
            setSaved(false);
          }}
        >
          {tr('op.hours.closedDateAdd')}
        </Button>
      </div>

      {upcoming.length === 0 && (
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.hours.closedDatesNone')}</p>
      )}
      <ul style={{ listStyle: 'none', paddingInline: 0, marginBlock: '0.5rem' }}>
        {upcoming.map((d) => (
          <li
            key={d}
            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBlockEnd: '0.3rem' }}
          >
            <span dir="ltr" style={{ inlineSize: '7rem' }}>
              {d}
            </span>
            <Button
              kind="ghost"
              onClick={() => {
                setClosed(removeClosedDate(closed, d));
                setSaved(false);
              }}
            >
              {tr('op.common.remove')}
            </Button>
          </li>
        ))}
      </ul>

      {past.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
            {tr('op.hours.closedDatesPast', { count: past.length })}
          </summary>
          {/* Kept, not pruned: closed_dates is also the record of why a day has
              no takings, and dropping last Eid would make the day-close history
              unexplainable. */}
          <ul style={{ listStyle: 'none', paddingInline: 0 }}>
            {past.map((d) => (
              <li key={d} dir="ltr" style={{ color: 'var(--tp-muted-fg)' }}>
                {d}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ErrorText error={error} />
      {saved && <p style={{ color: 'var(--tp-accent)' }}>{tr('op.hours.saved')}</p>}
      <Button kind="primary" disabled={busy} onClick={() => void save()}>
        {tr('common.save')}
        {dirtyDates ? ' *' : ''}
      </Button>
    </div>
  );
}
