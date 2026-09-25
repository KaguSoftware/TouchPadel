/**
 * 06.7 CourtBlockScreen — blocks court time for maintenance or a private
 * event. A block is a `maintenance` reservation created through the same
 * mutate('reservation.create') path the calendar uses; the exclusion
 * constraint decides, and SLOT_TAKEN is rendered as a rejected write.
 * States: ready · busy · conflict · error.
 *
 * EVENT MODE (`?run=&step=`, build-contracts-2026-09-23 §5.5). Opened from a
 * tournament's courts step on Protocols or My tasks: the courts and times come
 * from the plan (app.tournament_context), every court of every range at once,
 * across days. app.block_courts_for_event writes them as the run's event
 * blocks, or, with anything in the way, writes nothing and lists it to move
 * first. Then the desk sends the courts step with the blocks (submit_step).
 * Online only: the protocol writes are not queued mutations (§5.3).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { VENUE_TZ, formatDateTime, formatTime, isolate } from '@touch/i18n';
import { clientRef } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { canAccess, useAuth } from '../../lib/auth';
import { QK, fetchActiveCourts, fetchVenueSettings } from '../../lib/queries';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { DateField } from '../../components/inputs';
import {
  AsyncStateWrapper,
  ConflictNotice,
  DataTable,
  MessagePresenter,
  PageHeader,
  Panel,
  StatusBadge,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { blockRangeInvalid } from './deskLogic';
import { todayInTz, tonightInTz } from './useTradingNight';
import { nightTimeToUtc, tradingDateOf } from './calendar/monthLogic';
import {
  MOVED_NOTE_MAX,
  blocksToSend,
  courtsRecord,
  plannedBlockIds,
  plannedWindows,
  readBlockAnswer,
  readCourtsStep,
  readTournamentContext,
  type BlockConflict,
  type PlannedWindow,
} from './eventBlock';

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function CourtBlockScreen() {
  // Both or neither: the route drops a lone run or step.
  const search = useSearch({ strict: false }) as { run?: string; step?: string };
  if (search.run && search.step) return <EventBlockMode runId={search.run} stepId={search.step} />;
  return <MaintenanceBlock />;
}

function MaintenanceBlock() {
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

// ---------------------------------------------------------------------------
// Event mode: a tournament's courts step (`?run=&step=`).
// ---------------------------------------------------------------------------

function EventBlockMode({ runId, stepId }: { runId: string; stepId: string }) {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { staff } = useAuth();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  // Under ['protocols', …] like the Protocols page's own keys (§5.2), so a
  // decision there, or a send here, refreshes both.
  const stepQ = useQuery({
    queryKey: ['protocols', 'step', stepId],
    queryFn: () => appRpc<unknown>('protocol_step_detail', { p_run_step_id: stepId }),
    select: readCourtsStep,
  });
  const ctxQ = useQuery({
    queryKey: ['protocols', 'context', 'courts', runId],
    queryFn: () => appRpc<unknown>('tournament_context', { p_run_step_id: stepId }),
    select: readTournamentContext,
  });

  const [conflicts, setConflicts] = useState<BlockConflict[]>([]);
  const [justBlocked, setJustBlocked] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  // Minted when the form opens, reused on a retry, replaced after an answer
  // (§5.3). A conflict is an answer too: the server keeps it under the key.
  const blockKey = useRef(`event.block:${crypto.randomUUID()}`);
  const submitKey = useRef(`protocol.submit:${crypto.randomUUID()}`);

  const ctx = ctxQ.data;
  const windows = ctx ? plannedWindows(ctx) : [];
  const remaining = blocksToSend(windows).length;
  const blockedCount = plannedBlockIds(windows).length;
  const step = stepQ.data;
  const canWork = Boolean(step?.isCourtsStep && step.status === 'open' && step.canSubmit);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['protocols'] });
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
  };

  const block = useMutation({
    mutationFn: () =>
      appRpc<unknown>('block_courts_for_event', {
        p_run_id: runId,
        p_blocks: blocksToSend(windows),
        p_idempotency_key: blockKey.current,
      }),
    onSuccess: (data) => {
      blockKey.current = `event.block:${crypto.randomUUID()}`;
      const answer = readBlockAnswer(data);
      setConflicts(answer.conflicts);
      setJustBlocked(answer.conflicts.length === 0 && answer.blocked.length > 0);
      refresh();
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      appRpc<unknown>('submit_step', {
        p_run_step_id: stepId,
        p_record: ctx ? courtsRecord(ctx, note) : {},
        p_photos: [],
        p_idempotency_key: submitKey.current,
      }),
    onSuccess: () => {
      submitKey.current = `protocol.submit:${crypto.randomUUID()}`;
      setSent(true);
      refresh();
    },
  });

  // Back to where the step was opened: the run's sheet for management, My
  // tasks for the desk.
  function back() {
    if (canAccess(staff?.role, '/protocols')) void navigate({ to: '/protocols', search: { run: runId, step: stepId } });
    else if (canAccess(staff?.role, '/tasks')) void navigate({ to: '/tasks' });
    else void navigate({ to: '/desk', search: {} as never });
  }
  function openCalendar() {
    const first = windows[0];
    const date = first && settingsQ.data ? tradingDateOf(first.from, tz, settingsQ.data.opening_hours) : undefined;
    void navigate({ to: '/desk', search: (date ? { date } : {}) as never });
  }

  const nameOf = (n: { en: string; ar: string }) => (locale === 'ar' ? n.ar || n.en : n.en || n.ar);
  const courtName = (courtId: string) => {
    for (const r of ctx?.ranges ?? []) {
      const i = r.courtIds.indexOf(courtId);
      if (i >= 0 && r.courtNames[i]) return nameOf(r.courtNames[i]!);
    }
    return '';
  };
  // One window in the venue's time: "12 Oct 2026, 6:00 PM–10:00 PM", the end's
  // date added only when it falls on another day.
  function windowText(from: string, to: string): string {
    const a = new Date(from);
    const b = new Date(to);
    const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz });
    return isolate(`${formatDateTime(a, locale, tz)}–${day(a) === day(b) ? formatTime(b, locale, tz) : formatDateTime(b, locale, tz)}`);
  }
  const kindLabel = (kind: string) =>
    kind === 'booking' || kind === 'hold' || kind === 'maintenance' ? tr(`ws.events.block.conflictKind.${kind}`) : kind;

  const columns: Column<PlannedWindow>[] = [
    {
      key: 'court',
      header: tr('ws.events.block.columns.court'),
      render: (w) => <bdi>{nameOf(w.courtName)}</bdi>,
      truncateTitle: (w) => nameOf(w.courtName),
    },
    { key: 'when', header: tr('ws.events.block.columns.when'), render: (w) => windowText(w.from, w.to) },
    {
      key: 'state',
      header: tr('ws.events.block.columns.state'),
      align: 'end',
      render: (w) =>
        w.reservationId ? (
          <StatusBadge size="sm" tone="success" label={tr('ws.events.block.state.blocked')} />
        ) : (
          <StatusBadge size="sm" tone="neutral" label={tr('ws.events.block.state.toBlock')} />
        ),
    },
  ];

  const facts = ctx
    ? [
        ctx.tournamentClass ? tr('ws.events.block.classLabel', { class: ctx.tournamentClass }) : null,
        ctx.capacity ? tr(`ws.events.block.capacity.${ctx.capacity.unit}`, { count: String(ctx.capacity.count) }) : null,
      ].filter((x): x is string => x !== null)
    : [];

  return (
    <div>
      <PageHeader
        title={tr('ws.events.block.title')}
        subtitle={tr('ws.events.block.lead')}
        actions={
          <Button kind="ghost" onClick={back}>
            {tr('ws.events.block.back')}
          </Button>
        }
      />
      <ErrorText error={stepQ.error} />
      {step && !step.isCourtsStep ? (
        <MessagePresenter tone="refused" message={tr('ws.events.block.notCourts')} />
      ) : (
        <AsyncStateWrapper
          status={asyncStatus(ctxQ, (c) => c.ranges.length === 0)}
          error={ctxQ.error}
          onRetry={() => void ctxQ.refetch()}
          emptyContent={<MessagePresenter tone="info" message={tr('ws.events.block.noWindows')} />}
        >
          {ctx && (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
              <Panel title={<bdi>{nameOf(ctx.name)}</bdi>}>
                {facts.length > 0 && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{facts.join(' · ')}</p>}
                {step && !canWork && !sent && (
                  <MessagePresenter
                    tone="info"
                    message={tr('ws.events.block.notOpen', { status: step.status ? tr(`work.protocol.stepStatus.${step.status as 'open'}`) : '—' })}
                    style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
                  />
                )}
                {conflicts.length > 0 && (
                  <ConflictNotice
                    body={tr('ws.events.block.conflictBody')}
                    onResolve={canWork ? () => block.mutate() : undefined}
                    resolveLabel={tr('ws.events.block.checkAgain')}
                    style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
                  >
                    <ul style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', margin: 0, paddingInlineStart: '1.1rem' }}>
                      {conflicts.map((c) => (
                        <li key={c.reservationId}>
                          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span>
                              <bdi>{courtName(c.courtId)}</bdi> · {windowText(c.startAt, c.endAt)} · {kindLabel(c.kind)}
                            </span>
                            {c.kind === 'booking' && (
                              <Button size="sm" onClick={() => void navigate({ to: '/desk/bookings/$id', params: { id: c.reservationId } })}>
                                {tr('ws.events.block.openBooking')}
                              </Button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </ConflictNotice>
                )}
                {justBlocked && conflicts.length === 0 && (
                  <MessagePresenter tone="success" message={tr('ws.events.block.blockedDone')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
                )}
                <DataTable columns={columns} rows={windows} rowKey={(w) => w.key} aria-label={tr('ws.events.block.windows')} dense />
                <ErrorText error={block.error} />
                {canWork && !sent && (
                  <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', alignItems: 'center', marginBlockStart: 'var(--tp-sp-3)' }}>
                    {remaining === 0 ? (
                      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.events.block.allBlocked')}</span>
                    ) : (
                      <Button kind="primary" icon="ban" busy={block.isPending} onClick={() => block.mutate()}>
                        {tr('ws.events.block.blockAll', { count: String(remaining) })}
                      </Button>
                    )}
                  </div>
                )}
              </Panel>

              {sent ? (
                <Panel>
                  <MessagePresenter tone="success" message={tr('ws.events.block.send.done')} style={{ marginBlockEnd: '0.75rem' }} />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button kind="primary" onClick={back}>
                      {tr('ws.events.block.back')}
                    </Button>
                    <Button icon="calendar" onClick={openCalendar}>
                      {tr('ws.events.block.openCalendar')}
                    </Button>
                  </div>
                </Panel>
              ) : (
                canWork && (
                  <Panel title={tr('ws.events.block.send.title')}>
                    <Field label={tr('ws.events.block.send.note')} hint={tr('ws.events.block.send.noteHint')}>
                      <textarea
                        style={{ ...inputStyle, minBlockSize: '4.5rem', resize: 'vertical' }}
                        value={note}
                        maxLength={MOVED_NOTE_MAX}
                        disabled={submit.isPending}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </Field>
                    {blockedCount > 0 && remaining > 0 && (
                      <MessagePresenter tone="refused" icon="alert" message={tr('ws.events.block.send.remaining', { count: String(remaining) })} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
                    )}
                    <ErrorText error={submit.error} />
                    <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end' }}>
                      <Button
                        kind="primary"
                        disabled={blockedCount === 0}
                        disabledReason={blockedCount === 0 ? tr('ws.events.block.send.needsBlock') : undefined}
                        busy={submit.isPending}
                        onClick={() => submit.mutate()}
                      >
                        {tr('ws.events.block.send.submit')}
                      </Button>
                    </div>
                  </Panel>
                )
              )}
            </div>
          )}
        </AsyncStateWrapper>
      )}
    </div>
  );
}
