/**
 * Opening hours AND closed days (SOW L319) — one opening period per day, plus
 * the list of dates the venue does not trade at all. Both save through
 * `app.set_opening_hours` (0013), which has always taken `p_closed_dates`.
 * Mounted at /admin/hours and as the first tab of VenueSettingsScreen (06.49).
 *
 * OVERNIGHT. Touch trades 09:00 → 02:00, so a closing time EARLIER than the
 * opening time is the normal case on this screen. `venue_settings.opening_hours`
 * cannot express that directly — its windows are measured from each day's own
 * midnight — so such a night is stored as two windows on adjacent days
 * (`[["00:00","02:00"],["09:00","24:00"]]`).
 *
 * This screen used to read `windows[0]` and write `[[open, close]]`, which
 * silently DELETED the inherited 00:00–02:00 tail on every save. The conversion
 * now goes through `readOpeningHours` / `writeOpeningHours` in @touch/core, which
 * is the single implementation shared with the desk grid and the public footer.
 * A day carrying a genuine multi-period split (a siesta close) is shown
 * read-only rather than flattened.
 *
 * Closed dates: the column has existed since 0006, `assert_bookable` refuses
 * bookings on those days and the desk calendar greys them out; this is the one
 * place that writes the list.
 *
 * 0390 (F-51): a day added to the list that still has bookings on it cannot be
 * saved until each is cancelled, marked no-show or paid (ClosedDayBookings
 * lists them with those three actions; the server refuses the same).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readOpeningHours, writeOpeningHours, type DayKey } from '@touch/core';
import { formatDate, formatWeekdayLong, formatWeekdayShort } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Skeleton, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, MessagePresenter, Panel, SegmentedControl, StatusBadge, asyncStatus } from '../../components/kit';
import { MAX_CLOSED_RANGE_DAYS, closedDateRange, addedClosedDates, closedDayBlock, isIsoDate, normalizeClosedDates, removeClosedDate, sameClosedDates, splitClosedDates } from './closedDates';
import { ClosedDayBookings, useClosedDayBookings } from './ClosedDayBookings';
import { refusalCode } from '../protocols/errors';

const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * A close at or before the open means the venue shuts after midnight. Mirrors
 * `splitOvernight` in @touch/core — kept here only to label the input live as the
 * manager types, before anything is serialised.
 */
function isOvernight(open: string, close: string): boolean {
  return close === '00:00' ? false : close <= open;
}

interface DayDraft {
  closed: boolean;
  open: string;
  close: string;
  /** The close falls on the next calendar day (09:00 → 02:00). Derived, not edited. */
  overnight: boolean;
  /** The stored day has more periods than one open/close pair can describe. */
  split: boolean;
}

function draftFrom(hours: Parameters<typeof readOpeningHours>[0]): Record<DayKey, DayDraft> {
  const pairs = readOpeningHours(hours, DAY_KEYS);
  const next = {} as Record<DayKey, DayDraft>;
  for (const key of DAY_KEYS) {
    const p = pairs[key];
    next[key] = { closed: p.closed, open: p.open, close: p.close, overnight: p.overnight, split: p.split };
  }
  return next;
}

export function OpeningHoursEditor() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<DayKey, DayDraft> | null>(null);
  const [closed, setClosed] = useState<string[] | null>(null);
  const [hoursDirty, setHoursDirty] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [mode, setMode] = useState<'day' | 'range'>('day');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Shared fetcher: a narrower select under the same key once left the desk
  // calendar without `timezone`, rendering the whole grid in the fallback zone.
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const added = addedClosedDates(closed ?? [], settingsQ.data?.closed_dates ?? []);
  const bookingsQ = useClosedDayBookings(added);
  const block = closedDayBlock(added, { loading: bookingsQ.isLoading, error: bookingsQ.isError, count: bookingsQ.data?.length ?? 0 });

  useEffect(() => {
    if (!settingsQ.data || draft) return;
    setDraft(draftFrom(settingsQ.data.opening_hours));
    setClosed(settingsQ.data.closed_dates ?? []);
  }, [settingsQ.data, draft]);

  function editDay(key: DayKey, patch: Partial<DayDraft>) {
    if (!draft) return;
    const d = draft[key];
    const next = { ...d, ...patch };
    next.overnight = next.closed ? false : isOvernight(next.open, next.close);
    setDraft({ ...draft, [key]: next });
    setHoursDirty(true);
    setSaved(false);
  }

  function discard() {
    if (!settingsQ.data) return;
    setDraft(draftFrom(settingsQ.data.opening_hours));
    setClosed(settingsQ.data.closed_dates ?? []);
    setHoursDirty(false);
    setError(null);
    setSaved(false);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // writeOpeningHours places each day's evening window and pushes every
      // overnight tail onto the FOLLOWING day — including wrapping Saturday's
      // tail onto Sunday. Never rebuild this inline.
      const hours = writeOpeningHours(draft, DAY_KEYS);
      // Both halves in one call: one screen, one audit row. An EMPTY array is
      // meaningful — the RPC coalesces null to "unchanged".
      await appRpc('set_opening_hours', { p_opening_hours: hours, p_closed_dates: closed ?? [] });
      setSaved(true);
      setHoursDirty(false);
      void queryClient.invalidateQueries({ queryKey: QK.venueSettings });
    } catch (e) {
      setError(e);
      // A booking landed on a new closed day meanwhile: the list catches up.
      if (refusalCode(e) === 'CLOSED_DAY_HAS_BOOKINGS') void queryClient.invalidateQueries({ queryKey: ['closed-day-bookings'] });
    } finally {
      setBusy(false);
    }
  }

  const status = asyncStatus(settingsQ, () => false);
  if (status !== 'ready' || !draft || closed === null) {
    return (
      <AsyncStateWrapper status={status === 'ready' ? 'loading' : status} error={settingsQ.error} onRetry={() => void settingsQ.refetch()} skeleton={<Skeleton lines={8} />}>
        {null}
      </AsyncStateWrapper>
    );
  }

  // The venue's own today, not the browser's — a station in another timezone
  // must not decide that tomorrow's closure is already in the past.
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: settingsQ.data?.timezone ?? undefined });
  const { upcoming, past } = splitClosedDates(closed, todayIso);
  const datesDirty = !sameClosedDates(closed, settingsQ.data?.closed_dates ?? []);
  const dirty = hoursDirty || datesDirty;
  // Noon UTC printed in UTC: the calendar day itself, whatever timezone the
  // station runs in. `T00:00:00` local could print the day before.
  const showDate = (iso: string) => {
    const noon = new Date(`${iso}T12:00:00Z`);
    return `${formatWeekdayShort(noon, locale, 'UTC')} ${formatDate(noon, locale, 'UTC')}`;
  };

  const showDateOnly = (iso: string) => formatDate(new Date(`${iso}T12:00:00Z`), locale, 'UTC');
  const showWeekday = (iso: string) => formatWeekdayLong(new Date(`${iso}T12:00:00Z`), locale, 'UTC');

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', maxInlineSize: '88rem' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 30rem), 1fr))', alignItems: 'stretch' }}>
      <Panel title={tr('op.hours.title')} padded={false} fill>
        <div role="group" aria-label={tr('op.hours.title')} style={{ display: 'grid' }}>
          {DAY_KEYS.map((key) => {
            const d = draft[key];
            return (
              <div
                key={key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '4.5rem auto minmax(0, 1fr)',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-3)',
                  paddingBlock: 'var(--tp-sp-2)',
                  paddingInline: 'var(--tp-sp-3)',
                  borderBlockEnd: '1px solid var(--tp-border)',
                }}
              >
                <span style={{ fontWeight: 600 }}>{tr(`op.days.${key}`)}</span>
                <label style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', fontSize: 'var(--tp-fs-sm)' }}>
                  <input type="checkbox" checked={d.closed} disabled={busy} onChange={(e) => editDay(key, { closed: e.target.checked })} />
                  {tr('op.hours.closedDay')}
                </label>
                <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap', minBlockSize: 'var(--tp-row-h)' }}>
                  {!d.closed && (
                    <>
                      <input
                        style={{ ...inputStyle, inlineSize: 'auto' }}
                        dir="ltr"
                        type="time"
                        disabled={d.split || busy}
                        aria-label={tr('op.hours.open')}
                        value={d.open}
                        onChange={(e) => editDay(key, { open: e.target.value })}
                      />
                      <span style={{ color: 'var(--tp-muted-fg)' }}>–</span>
                      <input
                        style={{ ...inputStyle, inlineSize: 'auto' }}
                        dir="ltr"
                        type="time"
                        disabled={d.split || busy}
                        aria-label={tr('op.hours.close')}
                        value={d.close}
                        onChange={(e) => editDay(key, { close: e.target.value })}
                      />
                      {d.overnight && <StatusBadge tone="info" size="sm" dot={false} label={tr('op.hours.nextDay')} />}
                      {d.split && <StatusBadge tone="warn" size="sm" label={tr('ws.kit.common.readOnly')} />}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {DAY_KEYS.some((k) => draft[k].split) && (
          <MessagePresenter tone="refused" message={tr('op.hours.splitNotice')} style={{ marginBlock: 'var(--tp-sp-3)', marginInline: 'var(--tp-sp-3)' }} />
        )}
      </Panel>

      <Panel title={tr('op.hours.closedDatesTitle')} fill>
        {(() => {
          const hasEnd = mode === 'range' && endDate !== '';
          const range = hasEnd ? closedDateRange(newDate, endDate) : isIsoDate(newDate) ? [newDate] : [];
          const fresh = range.filter((d) => !closed.includes(d));
          const badRange = hasEnd && isIsoDate(newDate) && range.length === 0;
          const label = !isIsoDate(newDate)
            ? tr('op.hours.closedDatePick')
            : badRange
              ? tr('op.hours.closedRangeInvalid', { max: MAX_CLOSED_RANGE_DAYS })
              : fresh.length === 0
                ? tr('op.hours.closedDateAlready', { date: showDate(newDate) })
                : range.length === 1
                  ? tr('op.hours.closedDateAddPicked', { date: showDate(newDate) })
                  : tr('op.hours.closedRangeAdd', { from: showDate(range[0]!), to: showDate(range[range.length - 1]!), count: fresh.length });
          return (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
              <SegmentedControl
                aria-label={tr('op.hours.closedDatesTitle')}
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  if (m === 'day') setEndDate('');
                }}
                options={[
                  { value: 'day', label: tr('op.hours.closedModeDay') },
                  { value: 'range', label: tr('op.hours.closedModeRange') },
                ]}
              />
              <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', justifyItems: 'stretch', inlineSize: '100%', border: '1px dashed var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', padding: 'var(--tp-sp-3)' }}>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  {mode === 'range' && <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--tp-muted-fg)' }}>{tr('op.hours.closedFrom')}</span>}
                  <input
                    style={{ ...inputStyle, inlineSize: 'auto' }}
                    dir="ltr"
                    type="date"
                    aria-label={tr('op.hours.closedDateAdd')}
                    value={newDate}
                    disabled={busy}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                  {mode === 'range' && (
                    <>
                      <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--tp-muted-fg)' }}>{tr('op.hours.closedTo')}</span>
                      <input
                        style={{ ...inputStyle, inlineSize: 'auto' }}
                        dir="ltr"
                        type="date"
                        aria-label={tr('op.hours.closedRangeEnd')}
                        value={endDate}
                        min={isIsoDate(newDate) ? newDate : undefined}
                        disabled={busy}
                        onChange={(e) => setEndDate(e.target.value)}
                      />
                    </>
                  )}
                </div>
                <Button
                  kind={fresh.length > 0 ? 'primary' : 'default'}
                  style={{ inlineSize: '100%', justifyContent: 'center' }}
                  disabled={busy || fresh.length === 0}
                  onClick={() => {
                    setClosed(normalizeClosedDates([...closed, ...fresh]));
                    setNewDate('');
                    setEndDate('');
                    setSaved(false);
                  }}
                >
                  {label}
                </Button>
              </div>
            </div>
          );
        })()}

        {upcoming.length === 0 ? (
          <p style={{ color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-2-5)' }}>{tr('op.hours.closedDatesNone')}</p>
        ) : (
          <div
            className="tp-table-frame"
            style={{ marginBlockStart: 'var(--tp-sp-3)', overflow: 'hidden', border: '1px solid var(--tp-table-edge, var(--tp-panel-edge))', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-table-body, var(--tp-panel-body))' }}
          >
            <table className="tp-table">
              <thead>
                <tr>
                  <th>{tr('op.hours.closedColDate')}</th>
                  <th>{tr('op.hours.closedColDay')}</th>
                  <th aria-label={tr('op.common.remove')} />
                </tr>
              </thead>
              <tbody>
                {upcoming.map((d) => (
                  <tr key={d}>
                    <td><bdi>{showDateOnly(d)}</bdi></td>
                    <td>{showWeekday(d)}</td>
                    <td data-align="end">
                      <Button
                        size="sm"
                        icon="trash"
                        disabled={busy}
                        className="tp-remove-btn"
                        onClick={() => { setClosed(removeClosedDate(closed, d)); setSaved(false); }}
                      >
                        {tr('op.common.remove')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {past.length > 0 && (
          <details style={{ marginBlockStart: 'var(--tp-sp-2-5)' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr('op.hours.closedDatesPast', { count: past.length })}
            </summary>
            {/* Kept, not pruned: closed_dates is also the record of why a day has
                no takings, and dropping last Eid would make the day-close history
                unexplainable. */}
            <ul style={{ listStyle: 'none', paddingInline: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
              {past.map((d) => (
                <li key={d} style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                  <bdi>{showDate(d)}</bdi>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>
      </div>

      <ClosedDayBookings dates={added} tz={settingsQ.data?.timezone ?? undefined} />

      <ErrorText error={error} style={{ marginBlock: 0 }} />
      {saved && !dirty && <MessagePresenter tone="success" message={tr('op.hours.saved')} />}
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          kind="primary"
          icon="check"
          busy={busy}
          disabled={!dirty || block !== null}
          disabledReason={
            !dirty
              ? tr('ws.manager.disabled.noChanges')
              : block === 'bookings'
                ? tr('op.hours.bookingsBlocked', { count: String(bookingsQ.data?.length ?? 0) })
                : block === 'checking'
                  ? tr('op.hours.bookingsChecking')
                  : block === 'error'
                    ? tr('op.hours.bookingsError')
                    : undefined
          }
          data-testid="hours.save"
          onClick={() => void save()}
        >
          {tr('common.save')}
        </Button>
        <Button kind="ghost" disabled={busy || !dirty} onClick={discard}>
          {tr('ws.kit.actions.discard')}
        </Button>
        {dirty && <StatusBadge tone="warn" label={tr('ws.kit.actions.unsaved')} />}
      </div>
    </div>
  );
}
