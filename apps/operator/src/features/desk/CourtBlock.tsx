/**
 * 06.7 CourtBlockScreen — blocks court time for maintenance or a private
 * event. A block is a `maintenance` reservation created through the same
 * mutate('reservation.create') path the calendar uses; the exclusion
 * constraint decides, and SLOT_TAKEN is rendered as a rejected write.
 * States: ready · busy · conflict · error.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { VENUE_TZ } from '@touch/i18n';
import { clientRef } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { AppRpcError } from '../../lib/appRpc';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { DateField } from '../../components/inputs';
import { AsyncStateWrapper, ConflictNotice, MessagePresenter, PageHeader, Panel, asyncStatus } from '../../components/kit';
import { blockRangeInvalid } from './deskLogic';
import { todayInTz, tonightInTz } from './useTradingNight';
import { nightTimeToUtc } from './calendar/monthLogic';

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function CourtBlockScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const courts = courtsQ.data ?? [];

  const navigate = useNavigate();
  // Opened from the calendar: start on the day the calendar was showing.
  const search = useSearch({ strict: false }) as { date?: string };
  const [courtId, setCourtId] = useState('');
  const [date, setDate] = useState(() => search.date ?? todayInTz(VENUE_TZ));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [done, setDone] = useState(false);
  // The block went onto the queue: saved here, not yet holding the court.
  const [queued, setQueued] = useState(false);
  /**
   * The empty fields stay silent until the operator asks for the block — a form
   * that shouts "required" at a field nobody has reached yet is noise. The
   * clash and past-time warnings are the exception: those answer something the
   * operator just typed, so they appear as soon as the value does.
   */
  const [attempted, setAttempted] = useState(false);
  /**
   * "In the past" is a moving target. Without a tick the warning is only ever
   * as fresh as the last keystroke, so a form left open across the start time
   * would keep offering a slot that has already gone.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const effectiveCourt = courtId || courts[0]?.id || '';
  const fromMin = toMinutes(from);
  const toMin = toMinutes(to);
  const rangeInvalid = blockRangeInvalid(fromMin, toMin);

  // The date is a trading NIGHT, as the calendar that opens this form means it:
  // 00:30–01:30 "on Friday" is Friday night's tail, on Saturday's calendar
  // date. It used to be read as a calendar date and blocked the night before.
  // Past-ness is judged on the instant the block would start, through the same
  // conversion the write itself uses.
  const hours = settingsQ.data?.opening_hours;
  const at = (min: number) => nightTimeToUtc(date, min, tz, hours);
  // 01:30–03:00: the start is in the tail (next date), the end is not; the end
  // then belongs to the same next date, never before the start.
  const endAt = (fromM: number, toM: number) => {
    const start = at(fromM);
    const end = at(toM);
    return end <= start ? new Date(end.getTime() + 24 * 60 * 60_000) : end;
  };
  const today = settingsQ.data ? tonightInTz(tz, hours) : todayInTz(tz);
  // Opened without a date: start on the night trading now, once hours are known.
  const anchored = useRef(Boolean(search.date));
  useEffect(() => {
    if (anchored.current || !settingsQ.data) return;
    anchored.current = true;
    setDate(tonightInTz(settingsQ.data.timezone, settingsQ.data.opening_hours));
  }, [settingsQ.data]);
  const dateIsPast = date < today;
  const startsInPast = !dateIsPast && fromMin !== null && at(fromMin).getTime() < now;

  const missingCourt = effectiveCourt === '';
  const missingFrom = fromMin === null;
  const missingTo = toMin === null;
  const missingReason = reason.trim().length === 0;
  const required = tr('ws.courtDesk.block.required');
  const courtError = attempted && missingCourt ? required : undefined;
  const dateError = dateIsPast ? tr('ws.courtDesk.block.pastDate') : undefined;
  const fromError = attempted && missingFrom ? required : startsInPast ? tr('ws.courtDesk.block.pastTime') : undefined;
  const toError = attempted && missingTo ? required : rangeInvalid ? tr('ws.courtDesk.block.invalidRange') : undefined;
  const reasonError = attempted && missingReason ? required : undefined;

  const valid = !missingCourt && !missingFrom && !missingTo && !missingReason && !rangeInvalid && !dateIsPast && !startsInPast;

  async function submit() {
    if (busy || !valid || fromMin === null || toMin === null) return;
    // The tick above is 30s coarse, so re-judge against a live clock here:
    // between the last render and this click the start may have gone by, and
    // the button must not be the one place a past block gets through. Pushing
    // `now` forward re-renders the field warning that explains the refusal.
    if (at(fromMin).getTime() < Date.now()) {
      setNow(Date.now());
      return;
    }
    setBusy(true);
    setError(null);
    setConflict(false);
    setDone(false);
    try {
      const outcome = await mutate('reservation.create', {
        clientRef: clientRef(),
        courtId: effectiveCourt,
        kind: 'maintenance',
        startAt: at(fromMin).toISOString(),
        endAt: endAt(fromMin, toMin).toISOString(),
        notes: reason.trim(),
      });
      setDone(true);
      setQueued(outcome.queued);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'SLOT_TAKEN') setConflict(true);
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={tr('ws.courtDesk.block.title')} subtitle={tr('ws.courtDesk.block.lead')} />
      <AsyncStateWrapper status={asyncStatus(courtsQ, (c) => c.length === 0)} error={courtsQ.error} onRetry={() => void courtsQ.refetch()}>
        {done ? (
          <Panel>
            <MessagePresenter
              tone={queued ? 'info' : 'success'}
              message={queued ? tr('ws.courtDesk.detail.queued') : tr('ws.courtDesk.block.done')}
              style={{ marginBlockEnd: '0.75rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button kind="primary" icon="calendar" onClick={() => void navigate({ to: '/desk', search: { date } as never })}>
                {tr('ws.courtDesk.block.openCalendar')}
              </Button>
              <Button
                onClick={() => {
                  setDone(false);
                  setAttempted(false);
                  setFrom('');
                  setTo('');
                  setReason('');
                }}
              >
                {tr('ws.courtDesk.block.another')}
              </Button>
            </div>
          </Panel>
        ) : (
          <Panel>
            {conflict && <ConflictNotice body={tr('ws.courtDesk.block.conflictBody')} onResolve={() => setConflict(false)} style={{ marginBlockEnd: '0.85rem' }} />}
            {/* The four short fields flow into as many columns as the window
                affords (one each on a narrow desk, four across on a wide one);
                the reason spans the full row so it uses the width rather than
                leaving it empty. Row gap is 0 — Field carries its own. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', columnGap: 'var(--tp-sp-4)', rowGap: 0 }}>
              <Field label={tr('ws.courtDesk.block.court')} required error={courtError}>
                <Select value={effectiveCourt} disabled={busy} onChange={setCourtId} options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))} />
              </Field>
              {/* `min` keeps yesterday out of the native picker; the warning is
                  what catches a date typed straight into the field. */}
              <Field label={tr('ws.courtDesk.block.date')} required error={dateError}>
                <DateField value={date} onChange={setDate} min={today} disabled={busy} />
              </Field>
              <Field label={tr('ws.courtDesk.block.from')} required error={fromError}>
                <input type="time" step={1800} style={inputStyle} value={from} disabled={busy} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label={tr('ws.courtDesk.block.to')} required error={toError}>
                <input type="time" step={1800} style={inputStyle} value={to} disabled={busy} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Field label={tr('ws.courtDesk.block.reason')} hint={tr('ws.courtDesk.block.reasonHint')} required error={reasonError} style={{ gridColumn: '1 / -1' }}>
                <input style={inputStyle} value={reason} disabled={busy} maxLength={200} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
            <ErrorText error={error} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button kind="ghost" onClick={() => void navigate({ to: '/desk', search: { date } as never })}>
                {tr('common.cancel')}
              </Button>
              {/* Left enabled on purpose: a disabled button cannot be pressed,
                  and the press is what asks the form which fields are missing. */}
              <Button
                kind="primary"
                icon="ban"
                busy={busy}
                onClick={() => {
                  setAttempted(true);
                  if (valid) void submit();
                }}
              >
                {tr('ws.courtDesk.block.submit')}
              </Button>
            </div>
          </Panel>
        )}
      </AsyncStateWrapper>
    </div>
  );
}
