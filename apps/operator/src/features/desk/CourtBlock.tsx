/**
 * 06.7 CourtBlockScreen — blocks court time for maintenance or a private
 * event. A block is a `maintenance` reservation created through the same
 * mutate('reservation.create') path the calendar uses; the exclusion
 * constraint decides, and SLOT_TAKEN is rendered as a rejected write.
 * States: ready · busy · conflict · error.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { VENUE_TZ } from '@touch/i18n';
import { clientRef } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { AppRpcError } from '../../lib/appRpc';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import {
  AsyncStateWrapper,
  ConflictNotice,
  MessagePresenter,
  PageHeader,
  Panel,
  asyncStatus,
} from '../../components/kit';
import { todayInTz } from './useTradingNight';

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

  const [courtId, setCourtId] = useState('');
  const [date, setDate] = useState(() => todayInTz(VENUE_TZ));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [done, setDone] = useState(false);
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
  const toMinRaw = toMinutes(to);
  // A block that ends "after midnight" (02:00 < 22:00) belongs to the same trading night.
  const toMin =
    fromMin !== null && toMinRaw !== null && toMinRaw <= fromMin ? toMinRaw + 24 * 60 : toMinRaw;
  const rangeInvalid = fromMin !== null && toMinRaw !== null && toMin !== null && toMin <= fromMin;

  // Past-ness is judged on the instant the block would start, not on the
  // wall-clock numbers: only wallTimeToUtc knows what 01:00 on this date means
  // in the venue's zone, and it is the same conversion the write itself uses.
  const today = todayInTz(tz);
  const dateIsPast = date < today;
  const startsInPast =
    !dateIsPast && fromMin !== null && wallTimeToUtc(date, fromMin, tz).getTime() < now;

  const missingCourt = effectiveCourt === '';
  const missingFrom = fromMin === null;
  const missingTo = toMinRaw === null;
  const missingReason = reason.trim().length === 0;
  const required = tr('ws.courtDesk.block.required');
  const courtError = attempted && missingCourt ? required : undefined;
  const dateError = dateIsPast ? tr('ws.courtDesk.block.pastDate') : undefined;
  const fromError =
    attempted && missingFrom
      ? required
      : startsInPast
        ? tr('ws.courtDesk.block.pastTime')
        : undefined;
  const toError =
    attempted && missingTo
      ? required
      : rangeInvalid
        ? tr('ws.courtDesk.block.invalidRange')
        : undefined;
  const reasonError = attempted && missingReason ? required : undefined;

  const valid =
    !missingCourt &&
    !missingFrom &&
    !missingTo &&
    !missingReason &&
    !rangeInvalid &&
    !dateIsPast &&
    !startsInPast;

  async function submit() {
    if (busy || !valid || fromMin === null || toMin === null) return;
    // The tick above is 30s coarse, so re-judge against a live clock here:
    // between the last render and this click the start may have gone by, and
    // the button must not be the one place a past block gets through. Pushing
    // `now` forward re-renders the field warning that explains the refusal.
    if (wallTimeToUtc(date, fromMin, tz).getTime() < Date.now()) {
      setNow(Date.now());
      return;
    }
    setBusy(true);
    setError(null);
    setConflict(false);
    setDone(false);
    try {
      await mutate('reservation.create', {
        clientRef: clientRef(),
        courtId: effectiveCourt,
        kind: 'maintenance',
        startAt: wallTimeToUtc(date, fromMin, tz).toISOString(),
        endAt: wallTimeToUtc(date, toMin, tz).toISOString(),
        notes: reason.trim(),
      });
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['reservationsWeek'] });
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
      <AsyncStateWrapper
        status={asyncStatus(courtsQ, (c) => c.length === 0)}
        error={courtsQ.error}
        onRetry={() => void courtsQ.refetch()}
      >
        {done ? (
          <Panel>
            <MessagePresenter
              tone="success"
              message={tr('ws.courtDesk.block.done')}
              style={{ marginBlockEnd: '0.75rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link to="/desk" className="tp-btn" data-kind="primary" data-size="md">
                {tr('ws.courtDesk.block.openCalendar')}
              </Link>
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
            {conflict && (
              <ConflictNotice
                body={tr('ws.courtDesk.block.conflictBody')}
                onResolve={() => setConflict(false)}
                style={{ marginBlockEnd: '0.85rem' }}
              />
            )}
            {/* The four short fields flow into as many columns as the window
                affords (one each on a narrow desk, four across on a wide one);
                the reason spans the full row so it uses the width rather than
                leaving it empty. Row gap is 0 — Field carries its own. */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
                columnGap: 'var(--tp-sp-4)',
                rowGap: 0,
              }}
            >
              <Field label={tr('ws.courtDesk.block.court')} required error={courtError}>
                <Select
                  value={effectiveCourt}
                  disabled={busy}
                  onChange={setCourtId}
                  options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))}
                />
              </Field>
              {/* `min` keeps yesterday out of the native picker; the warning is
                  what catches a date typed straight into the field. */}
              <Field label={tr('ws.courtDesk.block.date')} required error={dateError}>
                <input
                  type="date"
                  min={today}
                  style={inputStyle}
                  value={date}
                  disabled={busy}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                />
              </Field>
              <Field label={tr('ws.courtDesk.block.from')} required error={fromError}>
                <input
                  type="time"
                  step={1800}
                  style={inputStyle}
                  value={from}
                  disabled={busy}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label={tr('ws.courtDesk.block.to')} required error={toError}>
                <input
                  type="time"
                  step={1800}
                  style={inputStyle}
                  value={to}
                  disabled={busy}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
              <Field
                label={tr('ws.courtDesk.block.reason')}
                hint={tr('ws.courtDesk.block.reasonHint')}
                required
                error={reasonError}
                style={{ gridColumn: '1 / -1' }}
              >
                <input
                  style={inputStyle}
                  value={reason}
                  disabled={busy}
                  maxLength={200}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
            </div>
            <ErrorText error={error} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Link to="/desk" className="tp-btn" data-kind="ghost" data-size="md">
                {tr('common.cancel')}
              </Link>
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
