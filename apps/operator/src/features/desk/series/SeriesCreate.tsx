/**
 * 06.5 RecurringSeriesCreateScreen — a whole series in one action.
 *
 * Redone 2026-09-22 (UX pass, "you are Majed"). What a desk clerk met before:
 * a "Check clashes" button that had to be pressed before any date appeared,
 * and pressed again after every change ("the pattern changed since the last
 * check"); "Weekly" that silently meant "the first date's weekday"; "After 8
 * weeks" that quietly meant four sessions when fortnightly; and a customer
 * search plus two more boxes that read as three different things. Now:
 *
 *  - The page reads top to bottom as the conversation at the counter goes:
 *    WHO it is for, WHEN it repeats, and — beside them, always in view —
 *    WHAT WILL BE BOOKED, in one sentence and as the list of dates.
 *  - The dates are checked live: as soon as the pattern is complete,
 *    preview_series (read-only) runs, debounced, and re-runs on every change.
 *    There is no check button and nothing can be stale.
 *  - A clash is decided on its own row (skip it, or move it to a court the
 *    server says is free); the main button counts what will actually be
 *    booked — "Book 7 sessions" — and names what is still missing when it
 *    cannot go yet.
 *  - No group size: padel is four players, always (owner call, 2026-09-22).
 *
 * Unchanged contract: create_series in one transaction, every clash resolved
 * first (spec 06.5), the phone required so a moved date has someone to tell.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatNumber, formatTimeRange, formatWeekdayShort, VENUE_TZ } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { clientRef, deviceId, station } from '../../../lib/idem';
import { QK, fetchActiveCourts, fetchVenueSettings, type CourtRow } from '../../../lib/queries';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../../components/ui';
import { AsyncStateWrapper, MessagePresenter, PageHeader, Panel, SegmentedControl, StatusBadge, asyncStatus } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { nameFromQuery, phoneDigitCount, phoneFromQuery, sanitizeName, sanitizePhone } from '../deskLogic';
import { todayInTz } from '../useTradingNight';
import { useDebounced } from '../useDebounced';
import { CustomerPicker, type PickedCustomer } from '../customers/CustomerPicker';
import type { SeriesCreateResult, SeriesOccurrencePreview, SeriesPattern, SeriesPreview } from '../deskTypes';
import {
  bookableCount,
  conflictCount,
  draftKey,
  draftProblem,
  pruneResolutions,
  resolutionsForRpc,
  seriesRpcArgs,
  unresolvedDates,
  type ResolutionMap,
  type SeriesDraft,
} from './seriesLogic';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const TIME_RE = /^\d{2}:\d{2}$/;
/** Short enough that no country's number reaches it — a typo, not a number. */
const PHONE_MIN_DIGITS = 7;
/** Long enough that typing "20:30" or a week count does not fire a preview per keystroke. */
const PREVIEW_DEBOUNCE_MS = 400;

/** "{station}:series.create:{ulid}" — the same shape mutate() uses, for an RPC outside the queue. */
function seriesIdempotencyKey(): string {
  const ref = clientRef();
  return `${station()}:series.create:${ref.slice(ref.lastIndexOf('-') + 1)}`;
}

/** Day of week of an ISO date, 0 = Sunday (the build plan's and Postgres' numbering). */
function dowOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** How much of the form the operator has asked about, and may therefore be told about. */
type ErrorScope = 'none' | 'all';

export interface PatternErrors {
  court?: string;
  time?: string;
  startsOn?: string;
  weekdays?: string;
  weeks?: string;
  endsOn?: string;
}

export function RecurringSeriesCreateScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const courts = courtsQ.data ?? [];

  const [draft, setDraft] = useState<SeriesDraft>(() => ({
    courtId: '',
    pattern: 'weekly',
    weekdays: [],
    startTime: '',
    durationMin: 0,
    startsOn: todayInTz(VENUE_TZ),
    endMode: 'weeks',
    weeks: 8,
    endsOn: '',
  }));
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [notes, setNotes] = useState('');
  /*
   * Whether each box below holds something the operator typed into it. While
   * one does not, the customer search mirrors every keystroke into it: a search
   * that turns out to have no account IS the walk-in case, and the desk used to
   * have to type the whole thing a second time to book it. The search takes
   * either a name or a number, so each box takes the half of the query that
   * belongs to it — letters to one, digits to the other.
   */
  const [nameTouched, setNameTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  const [resolutions, setResolutions] = useState<ResolutionMap>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SeriesCreateResult | null>(null);
  const [errorScope, setErrorScope] = useState<ErrorScope>('none');

  const court = courts.find((c) => c.id === draft.courtId) ?? courts[0];
  const effective: SeriesDraft = useMemo(
    () => ({
      ...draft,
      courtId: draft.courtId || court?.id || '',
      durationMin: draft.durationMin || court?.duration_options?.[0] || 60,
    }),
    [draft, court],
  );
  // The venue's own date: a station in another zone must not be able to book
  // into a day the courts have already finished.
  const today = todayInTz(tz);
  const problem = draftProblem(effective, today);
  const key = draftKey(effective);

  // Live preview. The key is debounced, not the query: typing "2", "20",
  // "20:3", "20:30" asks once, for the value the clerk stopped on.
  const settledKey = useDebounced(key, PREVIEW_DEBOUNCE_MS);
  const previewQ = useQuery({
    queryKey: ['seriesPreview', settledKey],
    enabled: problem === null && settledKey === key,
    queryFn: () => appRpc<SeriesPreview>('preview_series', JSON.parse(settledKey) as Record<string, unknown>),
    staleTime: 30_000,
    retry: false,
  });
  const previewCurrent = problem === null && settledKey === key && previewQ.data !== undefined && !previewQ.isError;
  const occurrences = previewCurrent ? (previewQ.data?.occurrences ?? []) : [];
  const checking = problem === null && (settledKey !== key || previewQ.isFetching) && !previewCurrent;
  // A resolution only counts while its date still clashes in what is on screen.
  const liveResolutions = pruneResolutions(occurrences, resolutions);
  const unresolved = unresolvedDates(occurrences, liveResolutions);
  const clashes = conflictCount(occurrences);
  const toBook = bookableCount(occurrences, liveResolutions);

  const hasCustomer = customer !== null || walkInName.trim().length > 0;
  /*
   * A series books the same slot for weeks. When one of those weeks has to be
   * moved or dropped there has to be someone to tell, so the number is what
   * create_series will actually send: the box if it holds one, otherwise the
   * linked account's.
   */
  const effectivePhone = walkInPhone.trim() || customer?.phone || '';
  const phoneDigits = phoneDigitCount(effectivePhone);
  const phoneMissing = phoneDigits === 0;
  const phoneTooShort = phoneDigits > 0 && phoneDigits < PHONE_MIN_DIGITS;
  const phoneUnusable = phoneMissing || phoneTooShort;

  /*
   * Rulebook 4.3: the button stays live, and a press that cannot go through
   * names every unmet condition in red under the box it belongs to. Each
   * condition is computed on its own rather than read off draftProblem, which
   * stops at the first: an empty court used to hide an empty time.
   */
  const patternErrors: PatternErrors = {
    court: !effective.courtId ? tr('ws.courtDesk.series.invalidCourt') : undefined,
    time: !TIME_RE.test(effective.startTime) ? tr('ws.courtDesk.series.invalidTime') : undefined,
    weekdays: effective.pattern === 'weekdays' && effective.weekdays.length === 0 ? tr('ws.courtDesk.series.invalidWeekdays') : undefined,
    startsOn: effective.startsOn < today ? tr('ws.courtDesk.series.invalidPast') : undefined,
    weeks: effective.endMode === 'weeks' && (!Number.isInteger(effective.weeks) || effective.weeks < 1) ? tr('ws.courtDesk.series.invalidWeeks') : undefined,
    endsOn: effective.endMode === 'date' && effective.endsOn <= effective.startsOn ? tr('ws.courtDesk.series.invalidEnd') : undefined,
  };
  const shown = errorScope === 'all';
  // A past date or an end before the start is worth saying the moment it is
  // typed — it is why no dates appear. An EMPTY box is not accused until the
  // clerk presses the button.
  const shownPatternErrors: PatternErrors = shown ? patternErrors : { startsOn: patternErrors.startsOn, endsOn: effective.endsOn ? patternErrors.endsOn : undefined };
  const nameError = shown && !hasCustomer ? tr('ws.courtDesk.series.invalidName') : undefined;
  const phoneError = !shown ? undefined : phoneMissing ? tr('ws.courtDesk.series.phoneRequired') : phoneTooShort ? tr('ws.courtDesk.series.invalidPhone') : undefined;

  const ready = problem === null && hasCustomer && !phoneUnusable && previewCurrent && unresolved.length === 0 && toBook > 0;

  /** What still stands between the clerk and the booking, in one line under the button. */
  const blocker =
    problem !== null || !hasCustomer || phoneUnusable
      ? shown
        ? tr('ws.courtDesk.series.fixFields')
        : undefined
      : checking
        ? tr('ws.courtDesk.series.checking')
        : unresolved.length > 0
          ? tr('ws.courtDesk.series.unresolved', { count: formatNumber(unresolved.length, locale) })
          : previewCurrent && toBook === 0
            ? tr('ws.courtDesk.series.nothingToBook')
            : undefined;

  async function submit() {
    setErrorScope('all');
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await appRpc<SeriesCreateResult>('create_series', {
        ...seriesRpcArgs(effective),
        p_guest_id: customer?.id ?? null,
        p_guest_name: (walkInName.trim() || customer?.name) ?? null,
        p_guest_phone: (walkInPhone.trim() || customer?.phone) ?? null,
        p_notes: notes.trim() || null,
        p_resolutions: resolutionsForRpc(occurrences, liveResolutions),
        p_idempotency_key: seriesIdempotencyKey(),
        p_device_id: deviceId(),
      });
      setResult(data);
      setResolutions({});
      setErrorScope('none');
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['reservationsMonth'] });
      void queryClient.invalidateQueries({ queryKey: ['seriesPreview'] });
    } catch (e) {
      setError(e);
      // Most refusals here are a date that stopped being free since the
      // preview: show the list as it is now.
      void previewQ.refetch();
    } finally {
      setBusy(false);
    }
  }

  function startAnother() {
    setResult(null);
    setCustomer(null);
    setWalkInName('');
    setWalkInPhone('');
    setNotes('');
    setNameTouched(false);
    setPhoneTouched(false);
  }

  const guestName = walkInName.trim() || customer?.name || '';

  return (
    <div>
      <PageHeader title={tr('ws.courtDesk.series.title')} subtitle={tr('ws.courtDesk.series.lead')} />
      <AsyncStateWrapper status={asyncStatus(courtsQ, (c) => c.length === 0)} error={courtsQ.error} onRetry={() => void courtsQ.refetch()}>
        {result ? (
          <Panel>
            <MessagePresenter
              tone="success"
              message={tr('ws.courtDesk.series.created', { created: formatNumber(result.created.length, locale), skipped: formatNumber(result.skipped.length, locale) })}
              style={{ marginBlockEnd: '0.75rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Button kind="primary" iconEnd="chevronEnd" onClick={() => void navigate({ to: '/desk/series/$id', params: { id: result.seriesId } })}>
                {tr('ws.courtDesk.series.openSeries')}
              </Button>
              <Button icon="calendar" onClick={() => void navigate({ to: '/desk' })}>
                {tr('ws.courtDesk.block.openCalendar')}
              </Button>
              <Button icon="plus" onClick={startAnother}>
                {tr('ws.courtDesk.series.another')}
              </Button>
            </div>
          </Panel>
        ) : (
          /*
           * The form on one side, what it will book on the other — the answer
           * stays in view while the clerk changes the question. Below 64rem
           * the two stack, form first.
           */
          <div className="tp-split" style={{ gap: '1rem', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '1rem', minInlineSize: 0 }}>
              <Panel title={tr('ws.courtDesk.series.whoTitle')} bodyClassName="tp-cq">
                <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: '0.6rem', marginBlockStart: 0 }}>{tr('ws.courtDesk.series.customerHint')}</p>
                <CustomerPicker
                  value={customer}
                  disabled={busy}
                  label={tr('ws.courtDesk.series.findAccount')}
                  onQueryChange={(q) => {
                    if (!nameTouched) setWalkInName(nameFromQuery(q));
                    if (!phoneTouched) setWalkInPhone(phoneFromQuery(q));
                  }}
                  onChange={(next) => {
                    setCustomer(next);
                    if (next) {
                      // What the account says outranks what was searched for.
                      if (!nameTouched || walkInName.trim() === '') setWalkInName(sanitizeName(next.name));
                      if (next.phone && (!phoneTouched || walkInPhone.trim() === '')) setWalkInPhone(sanitizePhone(next.phone));
                    }
                  }}
                />
                <div className="tp-grid" data-cols="2" style={{ gap: '0.75rem' }}>
                  <Field label={tr('ws.courtDesk.series.walkInName')} required={customer === null} error={nameError}>
                    <input
                      style={inputStyle}
                      value={walkInName}
                      disabled={busy}
                      maxLength={200}
                      onChange={(e) => {
                        setNameTouched(true);
                        setWalkInName(sanitizeName(e.target.value));
                      }}
                    />
                  </Field>
                  <Field label={tr('ws.courtDesk.series.walkInPhone')} required hint={tr('ws.courtDesk.series.phoneWhy')} error={phoneError}>
                    <input
                      style={inputStyle}
                      dir="ltr"
                      inputMode="tel"
                      autoComplete="off"
                      maxLength={30}
                      value={walkInPhone}
                      disabled={busy}
                      onChange={(e) => {
                        setPhoneTouched(true);
                        setWalkInPhone(sanitizePhone(e.target.value));
                      }}
                    />
                  </Field>
                </div>
                <Field label={tr('ws.courtDesk.series.notes')} optional style={{ marginBlockEnd: 0 }}>
                  <input style={inputStyle} value={notes} disabled={busy} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </Panel>

              <Panel title={tr('ws.courtDesk.series.whenTitle')} bodyClassName="tp-cq">
                <SeriesPatternBuilder draft={effective} courts={courts} disabled={busy} minDate={today} errors={shownPatternErrors} onChange={setDraft} />
              </Panel>
            </div>

            {/* Sticky: on a tall form the answer should not scroll away from
                the question being changed. */}
            <div style={{ position: 'sticky', insetBlockStart: 0, minInlineSize: 0 }}>
              <Panel
                title={tr('ws.courtDesk.series.bookedTitle')}
                actions={
                  previewCurrent ? (
                    <StatusBadge
                      size="sm"
                      tone={unresolved.length > 0 ? 'danger' : 'success'}
                      label={tr('ws.courtDesk.series.previewLead', { count: formatNumber(occurrences.length, locale), conflicts: formatNumber(clashes, locale) })}
                    />
                  ) : undefined
                }
              >
                <SeriesSummary draft={effective} courts={courts} guest={guestName} tz={tz} lastDate={occurrences.at(-1)?.startsAt ?? null} />
                {problem !== null ? (
                  <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>{tr('ws.courtDesk.series.emptyPreview')}</p>
                ) : previewQ.isError && settledKey === key ? (
                  <ErrorText error={previewQ.error} />
                ) : checking ? (
                  <p style={{ color: 'var(--tp-muted-fg)', margin: 0, display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                    <Icon name="search" size={14} /> {tr('ws.courtDesk.series.checking')}
                  </p>
                ) : (
                  <>
                    {clashes === 0 ? (
                      <MessagePresenter tone="success" message={tr('ws.courtDesk.series.noClashes')} style={{ marginBlockEnd: '0.6rem' }} />
                    ) : unresolved.length > 0 ? (
                      <MessagePresenter tone="refused" message={tr('ws.courtDesk.series.clashesFound', { count: formatNumber(clashes, locale) })} style={{ marginBlockEnd: '0.6rem' }} />
                    ) : (
                      <MessagePresenter tone="success" message={tr('ws.courtDesk.series.allResolved')} style={{ marginBlockEnd: '0.6rem' }} />
                    )}
                    <ClashPreviewList
                      occurrences={occurrences}
                      courts={courts}
                      resolutions={liveResolutions}
                      tz={tz}
                      disabled={busy}
                      onResolve={(date, action, courtId) => setResolutions((prev) => ({ ...prev, [date]: action === 'skip' ? { date, action } : { date, action, courtId: courtId! } }))}
                      onUnresolve={(date) =>
                        setResolutions((prev) => {
                          const next = { ...prev };
                          delete next[date];
                          return next;
                        })
                      }
                    />
                  </>
                )}
                <ErrorText error={error} />
                {/* One decision, one button, at the foot of the answer it acts
                    on. It says how many sessions it will book, so the clerk
                    can read the result back to the customer before pressing. */}
                <div
                  style={{
                    display: 'grid',
                    gap: '0.5rem',
                    marginBlockStart: '0.85rem',
                    marginInline: '-0.85rem',
                    marginBlockEnd: '-0.75rem',
                    paddingBlock: '0.75rem',
                    paddingInline: '0.85rem',
                    borderBlockStart: '1px solid var(--tp-border)',
                    background: 'var(--tp-surface-2)',
                  }}
                >
                  <Button kind="primary" size="lg" icon="repeat" busy={busy} onClick={() => void submit()} style={{ inlineSize: '100%', justifyContent: 'center' }}>
                    {previewCurrent && toBook > 0 ? tr('ws.courtDesk.series.submitCount', { count: formatNumber(toBook, locale) }) : tr('ws.courtDesk.series.submit')}
                  </Button>
                  {blocker && (
                    <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', textAlign: 'center' }}>
                      <Icon name="info" size={14} />
                      {blocker}
                    </span>
                  )}
                  <Button kind="ghost" onClick={() => void navigate({ to: '/desk' })} style={{ justifySelf: 'center' }}>
                    {tr('common.cancel')}
                  </Button>
                </div>
              </Panel>
            </div>
          </div>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeriesSummary — the pattern read back as one sentence, the way the clerk
// will say it to the customer: "Every Tuesday, 8:00 – 9:30 PM on Court 1".
// ---------------------------------------------------------------------------
function SeriesSummary({
  draft,
  courts,
  guest,
  tz,
  lastDate,
}: {
  draft: SeriesDraft;
  courts: readonly CourtRow[];
  guest: string;
  tz: string;
  /** The last session the preview lists, when there is one. */
  lastDate: string | null;
}) {
  const { tr, locale } = useLocale();
  const dayLong = (i: number) => tr(`ws.courtDesk.series.weekdayLong.${WEEKDAY_KEYS[i]!}`);
  const repeat =
    draft.pattern === 'weekdays'
      ? draft.weekdays.length > 0
        ? tr('ws.courtDesk.series.summaryDays', {
            days: [...draft.weekdays]
              .sort((a, b) => a - b)
              .map((i) => tr(`ws.courtDesk.common.weekday.${WEEKDAY_KEYS[i]!}`))
              .join(locale === 'ar' ? '، ' : ', '),
          })
        : null
      : tr(draft.pattern === 'fortnightly' ? 'ws.courtDesk.series.summaryFortnightly' : 'ws.courtDesk.series.summaryWeekly', { day: dayLong(dowOf(draft.startsOn)) });
  const courtName = pickName(locale, courts.find((c) => c.id === draft.courtId));
  const time = TIME_RE.test(draft.startTime)
    ? (() => {
        // The wall-clock time the clerk typed, formatted, not converted: an
        // arbitrary date in UTC keeps "20:30" as 20:30 in either locale.
        const [h, m] = draft.startTime.split(':').map(Number);
        const start = new Date(Date.UTC(2000, 0, 1, h!, m!));
        const end = new Date(start.getTime() + draft.durationMin * 60_000);
        return formatTimeRange(start, end, locale, 'UTC');
      })()
    : null;
  if (!repeat) return null;
  return (
    <div style={{ marginBlockEnd: '0.85rem' }}>
      <p style={{ margin: 0, fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
        {repeat}
        {time && (
          <>
            {', '}
            <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</bdi>
          </>
        )}
        {courtName && <> {tr('ws.courtDesk.series.summaryOnCourt', { court: courtName })}</>}
      </p>
      <p style={{ margin: 0, marginBlockStart: '0.2rem', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {lastDate
          ? tr('ws.courtDesk.series.summaryRange', {
              first: formatDate(new Date(`${draft.startsOn}T12:00:00Z`), locale, 'UTC'),
              last: formatDate(new Date(lastDate), locale, tz),
            })
          : tr('ws.courtDesk.series.summaryFrom', { first: formatDate(new Date(`${draft.startsOn}T12:00:00Z`), locale, 'UTC') })}
        {guest && (
          <>
            {' · '}
            <bdi>{guest}</bdi>
          </>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeriesPatternBuilder (spec §07): court; first date, time, duration; how it
// repeats; when it ends.
// ---------------------------------------------------------------------------
export function SeriesPatternBuilder({
  draft,
  courts,
  disabled,
  minDate,
  errors,
  onChange,
}: {
  draft: SeriesDraft;
  courts: readonly CourtRow[];
  disabled?: boolean;
  /** The earliest date the series may start — the venue's today. */
  minDate?: string;
  /** What is wrong with which box, once the operator has asked. */
  errors?: PatternErrors;
  onChange: (next: SeriesDraft) => void;
}) {
  const { tr, locale } = useLocale();
  const court = courts.find((c) => c.id === draft.courtId);
  const durations = court?.duration_options?.length ? court.duration_options : [60, 90, 120];
  const set = (patch: Partial<SeriesDraft>) => onChange({ ...draft, ...patch });
  const firstDay = tr(`ws.courtDesk.series.weekdayLong.${WEEKDAY_KEYS[dowOf(draft.startsOn)]!}`);
  return (
    <div>
      <Field label={tr('ws.courtDesk.series.court')} required error={errors?.court}>
        <Select value={draft.courtId} disabled={disabled} onChange={(courtId) => set({ courtId, durationMin: 0 })} options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))} />
      </Field>
      <div className="tp-grid" data-cols="2" style={{ gap: '0.75rem' }}>
        <Field label={tr('ws.courtDesk.series.startsOn')} required error={errors?.startsOn}>
          {/* `min` greys the past out of the picker; it does not stop a typed
              date, which is what errors.startsOn is for. */}
          <input
            type="date"
            style={inputStyle}
            value={draft.startsOn}
            min={minDate}
            disabled={disabled}
            onChange={(e) => e.target.value && set({ startsOn: e.target.value })}
          />
        </Field>
        <Field label={tr('ws.courtDesk.series.time')} required error={errors?.time}>
          <input type="time" step={1800} style={inputStyle} value={draft.startTime} disabled={disabled} onChange={(e) => set({ startTime: e.target.value })} />
        </Field>
      </div>
      {/* One press per length, not a dropdown: a court offers two or three,
          and all of them fit on the line. */}
      <Field label={tr('ws.courtDesk.series.duration')} group>
        <SegmentedControl<string>
          value={String(draft.durationMin)}
          onChange={(v) => set({ durationMin: Number(v) })}
          options={durations.map((d) => ({ value: String(d), label: tr('op.common.minutesShort', { minutes: d }), disabled }))}
        />
      </Field>
      {/* group: a <label> around a set of buttons forwards hover AND click to
          the first of them — see Field. */}
      <Field
        label={tr('ws.courtDesk.series.repeats')}
        group
        hint={draft.pattern === 'weekdays' ? undefined : tr('ws.courtDesk.series.repeatsOnFirstDay', { day: firstDay })}
      >
        <SegmentedControl<SeriesPattern>
          value={draft.pattern}
          onChange={(pattern) => set({ pattern })}
          options={[
            { value: 'weekly', label: tr('ws.courtDesk.series.weekly'), disabled },
            { value: 'fortnightly', label: tr('ws.courtDesk.series.fortnightly'), disabled },
            { value: 'weekdays', label: tr('ws.courtDesk.series.weekdays'), disabled },
          ]}
        />
      </Field>
      {draft.pattern === 'weekdays' && (
        <Field label={tr('ws.courtDesk.series.weekdaysPick')} required group error={errors?.weekdays}>
          {/*
            inline-flex, not flex: a full-width row made every pixel to the
            right of "Sat" part of the group, and while the group was wrapped in
            a <label> that dead space hovered and selected Sunday.
          */}
          <div role="group" style={{ display: 'inline-flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {WEEKDAY_KEYS.map((k, i) => {
              const on = draft.weekdays.includes(i);
              return (
                <Button
                  key={k}
                  size="sm"
                  kind={on ? 'primary' : 'default'}
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => set({ weekdays: on ? draft.weekdays.filter((d) => d !== i) : [...draft.weekdays, i] })}
                >
                  {tr(`ws.courtDesk.common.weekday.${k}`)}
                </Button>
              );
            })}
          </div>
        </Field>
      )}
      {/* How it ends and WHEN it ends are one decision, so they share a row. */}
      <div className="tp-grid" data-cols="2" style={{ gap: '0.75rem' }}>
        <Field label={tr('ws.courtDesk.series.endMode')} group style={{ marginBlockEnd: 0 }}>
          <SegmentedControl<'weeks' | 'date'>
            value={draft.endMode}
            onChange={(endMode) => set({ endMode })}
            options={[
              { value: 'weeks', label: tr('ws.courtDesk.series.afterWeeks'), disabled },
              { value: 'date', label: tr('ws.courtDesk.series.onDate'), disabled },
            ]}
          />
        </Field>
        {draft.endMode === 'weeks' ? (
          <Field
            label={tr('ws.courtDesk.series.weeks')}
            required
            // Fortnightly and chosen days do not book one session a week; the
            // summary beside the form gives the real count, this says why.
            hint={draft.pattern === 'fortnightly' ? tr('ws.courtDesk.series.weeksFortnightlyHint') : undefined}
            error={errors?.weeks}
            style={{ marginBlockEnd: 0 }}
          >
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              style={{ ...inputStyle, maxInlineSize: '12rem' }}
              value={draft.weeks}
              disabled={disabled}
              onChange={(e) => set({ weeks: Number(e.target.value) })}
            />
          </Field>
        ) : (
          <Field label={tr('ws.courtDesk.series.endsOn')} required error={errors?.endsOn} style={{ marginBlockEnd: 0 }}>
            <input
              type="date"
              style={inputStyle}
              value={draft.endsOn}
              min={minDate && minDate > draft.startsOn ? minDate : draft.startsOn}
              disabled={disabled}
              onChange={(e) => e.target.value && set({ endsOn: e.target.value })}
            />
          </Field>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClashPreviewList (spec §07): each date, free or clashing; per clash, skip
// or place on a court the server lists as free.
// ---------------------------------------------------------------------------
export function ClashPreviewList({
  occurrences,
  courts,
  resolutions,
  tz,
  disabled,
  onResolve,
  onUnresolve,
}: {
  occurrences: readonly SeriesOccurrencePreview[];
  courts: readonly CourtRow[];
  resolutions: ResolutionMap;
  tz: string;
  disabled?: boolean;
  onResolve: (date: string, action: 'skip' | 'moveCourt', courtId?: string) => void;
  /** Take a resolution back, so the clash can be decided again. */
  onUnresolve: (date: string) => void;
}) {
  const { tr, locale } = useLocale();
  const courtName = (id: string) => pickName(locale, courts.find((c) => c.id === id)) || id;
  return (
    <div style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', overflow: 'auto', maxBlockSize: '60vh' }}>
      <table className="tp-table" data-dense="true" aria-label={tr('ws.courtDesk.series.previewTitle')}>
        <thead>
          <tr>
            <th>{tr('ws.courtDesk.series.date')}</th>
            <th>{tr('ws.courtDesk.series.outcome')}</th>
          </tr>
        </thead>
        <tbody>
          {occurrences.map((o) => {
            const res = resolutions[o.date];
            const start = new Date(o.startsAt);
            // No time column: every row is the same time, and the summary
            // above already says it. The weekday is what a clerk checks.
            return (
              <tr key={o.date} style={{ background: o.conflict && !res ? 'var(--tp-danger-soft)' : undefined }}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <bdi>{`${formatWeekdayShort(start, locale, tz)} ${formatDate(start, locale, tz)}`}</bdi>
                </td>
                <td>
                  {!o.conflict ? (
                    <StatusBadge size="sm" tone="success" label={tr('ws.courtDesk.series.free')} icon="check" />
                  ) : res ? (
                    <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <StatusBadge size="sm" tone="neutral" label={res.action === 'skip' ? tr('ws.courtDesk.series.resolution.skip') : tr('ws.courtDesk.series.resolution.moveCourt', { court: courtName(res.courtId) })} />
                      {/* This undo used to call onResolve(date, 'skip') under the
                          label "Skip this date": pressing it on "Moved to Court 2"
                          silently turned the move into a skip. */}
                      <Button size="sm" kind="ghost" icon="undo" disabled={disabled} onClick={() => onUnresolve(o.date)}>
                        {tr('ws.courtDesk.series.undoResolution')}
                      </Button>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <StatusBadge size="sm" tone="danger" label={tr('ws.courtDesk.series.clash')} icon="alert" />
                      <Button size="sm" disabled={disabled} onClick={() => onResolve(o.date, 'skip')}>
                        {tr('ws.courtDesk.series.resolveSkip')}
                      </Button>
                      {o.conflict.alternativeCourtIds.length > 0 ? (
                        o.conflict.alternativeCourtIds.map((cid) => (
                          <Button key={cid} size="sm" kind="soft" disabled={disabled} onClick={() => onResolve(o.date, 'moveCourt', cid)}>
                            {tr('ws.courtDesk.series.resolveMoveTo', { court: courtName(cid) })}
                          </Button>
                        ))
                      ) : (
                        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', display: 'inline-flex', gap: '0.25rem', alignItems: 'center' }}>
                          <Icon name="info" size={12} /> {tr('ws.courtDesk.series.noAlternative')}
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
