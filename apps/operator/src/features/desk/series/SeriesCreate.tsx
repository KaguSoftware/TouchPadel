/**
 * 06.5 RecurringSeriesCreateScreen — a whole series in one action.
 * Flow: build the pattern → "Check clashes" (preview_series, read-only) →
 * resolve every clash (skip the date, or move it to a court the server says
 * is free) → create_series in one transaction. Every clash must be resolved
 * before the series is created (spec 06.5). States: ready · checking ·
 * conflictsFound · busy · error.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatDate, formatNumber, formatTimeRange, VENUE_TZ } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { clientRef, deviceId, station } from '../../../lib/idem';
import { QK, fetchActiveCourts, fetchVenueSettings, type CourtRow } from '../../../lib/queries';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../../components/ui';
import {
  AsyncStateWrapper,
  MessagePresenter,
  PageHeader,
  Panel,
  SegmentedControl,
  StatusBadge,
  asyncStatus,
} from '../../../components/kit';
import { Icon } from '../../../components/icons';
import {
  nameFromQuery,
  phoneDigitCount,
  phoneFromQuery,
  sanitizeName,
  sanitizePhone,
} from '../deskLogic';
import { todayInTz } from '../useTradingNight';
import { CustomerPicker, type PickedCustomer } from '../customers/CustomerPicker';
import type {
  SeriesCreateResult,
  SeriesOccurrencePreview,
  SeriesPattern,
  SeriesPreview,
} from '../deskTypes';
import {
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

/** "{station}:series.create:{ulid}" — the same shape mutate() uses, for an RPC outside the queue. */
function seriesIdempotencyKey(): string {
  const ref = clientRef();
  return `${station()}:series.create:${ref.slice(ref.lastIndexOf('-') + 1)}`;
}

type Phase = 'ready' | 'checking' | 'conflictsFound' | 'busy' | 'error';

/** How much of the form the operator has asked about, and may therefore be told about. */
type ErrorScope = 'none' | 'pattern' | 'all';

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

  const [preview, setPreview] = useState<{
    key: string;
    occurrences: SeriesOccurrencePreview[];
  } | null>(null);
  const [resolutions, setResolutions] = useState<ResolutionMap>({});
  const [checking, setChecking] = useState(false);
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
  const stale = preview !== null && preview.key !== key;
  const occurrences = preview?.occurrences ?? [];
  const unresolved = unresolvedDates(occurrences, resolutions);
  const clashes = conflictCount(occurrences);
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

  const phase: Phase = busy
    ? 'busy'
    : checking
      ? 'checking'
      : error != null
        ? 'error'
        : preview && !stale && clashes > 0
          ? 'conflictsFound'
          : 'ready';
  const canSubmit = phase === 'ready' || (phase === 'conflictsFound' && unresolved.length === 0);
  const submitReady =
    preview !== null &&
    !stale &&
    canSubmit &&
    hasCustomer &&
    problem === null &&
    !phoneUnusable &&
    !busy &&
    !checking;

  /*
   * Rulebook 4.3. Five conditions used to hold these two buttons shut, and a
   * shut button says nothing about WHICH box is empty — the desk had to guess,
   * or reverse-engineer the rule. The buttons are live now, and a click that
   * cannot go through names every unmet condition in red under the box it
   * belongs to. `errorScope` keeps that honest: "Check clashes" does not need a
   * customer, so it never accuses the customer panel of anything.
   *
   * Each condition is computed on its own rather than read off draftProblem,
   * which stops at the first: an empty court used to hide an empty time.
   */
  const patternErrors: PatternErrors = {
    court: !effective.courtId ? tr('ws.courtDesk.series.invalidCourt') : undefined,
    time: !TIME_RE.test(effective.startTime) ? tr('ws.courtDesk.series.invalidTime') : undefined,
    weekdays:
      effective.pattern === 'weekdays' && effective.weekdays.length === 0
        ? tr('ws.courtDesk.series.invalidWeekdays')
        : undefined,
    startsOn: effective.startsOn < today ? tr('ws.courtDesk.series.invalidPast') : undefined,
    weeks:
      effective.endMode === 'weeks' && (!Number.isInteger(effective.weeks) || effective.weeks < 1)
        ? tr('ws.courtDesk.series.invalidWeeks')
        : undefined,
    endsOn:
      effective.endMode === 'date' && effective.endsOn <= effective.startsOn
        ? tr('ws.courtDesk.series.invalidEnd')
        : undefined,
  };
  const shownPatternErrors: PatternErrors = errorScope === 'none' ? {} : patternErrors;
  const nameError =
    errorScope === 'all' && !hasCustomer ? tr('ws.courtDesk.series.invalidName') : undefined;
  const phoneError =
    errorScope !== 'all'
      ? undefined
      : phoneMissing
        ? tr('ws.courtDesk.series.phoneRequired')
        : phoneTooShort
          ? tr('ws.courtDesk.series.invalidPhone')
          : undefined;
  const anyFieldError =
    problem !== null || (errorScope === 'all' && (!hasCustomer || phoneUnusable));

  async function runCheck() {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const data = await appRpc<SeriesPreview>('preview_series', seriesRpcArgs(effective));
      const occ = data?.occurrences ?? [];
      setPreview({ key, occurrences: occ });
      setResolutions((prev) => pruneResolutions(occ, prev));
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  }

  /** Always clickable; only the pattern half of the form gates the RPC. */
  function checkClashes() {
    setErrorScope((prev) => (prev === 'all' ? 'all' : 'pattern'));
    if (problem !== null) return;
    void runCheck();
  }

  async function submit() {
    setErrorScope('all');
    if (problem !== null || !hasCustomer || phoneUnusable || busy || checking) return;
    // Nothing is ever created without a preview, so the first click here runs
    // the check instead of dead-ending the operator on "check clashes first".
    if (preview === null || stale) {
      void runCheck();
      return;
    }
    if (unresolved.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const data = await appRpc<SeriesCreateResult>('create_series', {
        ...seriesRpcArgs(effective),
        p_guest_id: customer?.id ?? null,
        p_guest_name: (walkInName.trim() || customer?.name) ?? null,
        p_guest_phone: (walkInPhone.trim() || customer?.phone) ?? null,
        p_notes: notes.trim() || null,
        p_resolutions: resolutionsForRpc(occurrences, resolutions),
        p_idempotency_key: seriesIdempotencyKey(),
        p_device_id: deviceId(),
      });
      setResult(data);
      setPreview(null);
      setResolutions({});
      setErrorScope('none');
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['reservationsWeek'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** One line beside the footer buttons, for what no single field can carry. */
  const footerHint = submitReady
    ? undefined
    : anyFieldError
      ? errorScope === 'none'
        ? undefined
        : tr('ws.courtDesk.series.fixFields')
      : preview === null
        ? tr('ws.courtDesk.series.needsCheck')
        : stale
          ? tr('ws.courtDesk.series.staleDraft')
          : unresolved.length > 0
            ? tr('ws.courtDesk.series.unresolved', {
                count: formatNumber(unresolved.length, locale),
              })
            : undefined;

  return (
    <div>
      <PageHeader
        title={tr('ws.courtDesk.series.title')}
        subtitle={tr('ws.courtDesk.series.lead')}
      />
      <AsyncStateWrapper
        status={asyncStatus(courtsQ, (c) => c.length === 0)}
        error={courtsQ.error}
        onRetry={() => void courtsQ.refetch()}
      >
        {result ? (
          <Panel>
            <MessagePresenter
              tone="success"
              message={tr('ws.courtDesk.series.created', {
                created: formatNumber(result.created.length, locale),
                skipped: formatNumber(result.skipped.length, locale),
              })}
              style={{ marginBlockEnd: '0.75rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link
                to="/desk/series/$id"
                params={{ id: result.seriesId }}
                className="tp-btn"
                data-kind="primary"
                data-size="md"
              >
                {tr('ws.courtDesk.series.openSeries')}
              </Link>
              <Link to="/desk" className="tp-btn" data-kind="default" data-size="md">
                {tr('ws.courtDesk.block.openCalendar')}
              </Link>
              <Button onClick={() => setResult(null)}>{tr('ws.courtDesk.series.title')}</Button>
            </div>
          </Panel>
        ) : (
          /*
           * Pattern and customer sit side by side — two inputs of equal
           * standing — and the occurrences they produce run the full width
           * underneath, which is where a table of dates can actually be read.
           */
          <div className="tp-split" style={{ gap: '1rem' }}>
            <Panel title={tr('ws.courtDesk.series.pattern')} bodyClassName="tp-cq">
              <SeriesPatternBuilder
                draft={effective}
                courts={courts}
                disabled={busy}
                minDate={today}
                errors={shownPatternErrors}
                onChange={setDraft}
              />
            </Panel>

            <Panel title={tr('ws.courtDesk.series.customer')} bodyClassName="tp-cq">
              <p
                style={{
                  color: 'var(--tp-muted-fg)',
                  fontSize: 'var(--tp-fs-sm)',
                  marginBlockEnd: '0.6rem',
                  marginBlockStart: 0,
                }}
              >
                {tr('ws.courtDesk.series.customerHint')}
              </p>
              <CustomerPicker
                value={customer}
                disabled={busy}
                onQueryChange={(q) => {
                  if (!nameTouched) setWalkInName(nameFromQuery(q));
                  if (!phoneTouched) setWalkInPhone(phoneFromQuery(q));
                }}
                onChange={(next) => {
                  setCustomer(next);
                  if (next) {
                    // What the account says outranks what was searched for.
                    if (!nameTouched || walkInName.trim() === '')
                      setWalkInName(sanitizeName(next.name));
                    if (next.phone && (!phoneTouched || walkInPhone.trim() === ''))
                      setWalkInPhone(sanitizePhone(next.phone));
                  }
                }}
              />
              <div className="tp-grid" data-cols="2" style={{ gap: '0.75rem' }}>
                <Field
                  label={tr('ws.courtDesk.series.walkInName')}
                  required={customer === null}
                  error={nameError}
                >
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
                <Field label={tr('ws.courtDesk.series.walkInPhone')} required error={phoneError}>
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
              <Field label={tr('ws.courtDesk.series.notes')} style={{ marginBlockEnd: 0 }}>
                <input
                  style={inputStyle}
                  value={notes}
                  disabled={busy}
                  maxLength={1000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </Panel>

            <Panel
              title={tr('ws.courtDesk.series.previewTitle')}
              className="tp-split-full"
              actions={
                preview && !checking ? (
                  <StatusBadge
                    size="sm"
                    tone={stale ? 'neutral' : clashes > 0 ? 'danger' : 'success'}
                    label={tr('ws.courtDesk.series.previewLead', {
                      count: formatNumber(occurrences.length, locale),
                      conflicts: formatNumber(clashes, locale),
                    })}
                  />
                ) : undefined
              }
            >
              <ErrorText error={error} />
              {checking && (
                <p style={{ color: 'var(--tp-muted-fg)', margin: 0 }}>
                  {tr('ws.courtDesk.series.checking')}
                </p>
              )}
              {!checking && preview === null && (
                <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>
                  {tr('ws.courtDesk.series.emptyPreview')}
                </p>
              )}
              {stale && !checking && (
                <MessagePresenter
                  tone="refused"
                  message={tr('ws.courtDesk.series.staleDraft')}
                  style={{ marginBlockEnd: '0.6rem' }}
                />
              )}
              {preview && !checking && (
                <>
                  {clashes === 0 ? (
                    <MessagePresenter
                      tone="success"
                      message={tr('ws.courtDesk.series.noClashes')}
                      style={{ marginBlockEnd: '0.6rem' }}
                    />
                  ) : unresolved.length > 0 ? (
                    <MessagePresenter
                      tone="refused"
                      message={tr('ws.courtDesk.series.unresolved', {
                        count: formatNumber(unresolved.length, locale),
                      })}
                      style={{ marginBlockEnd: '0.6rem' }}
                    />
                  ) : (
                    <MessagePresenter
                      tone="success"
                      message={tr('ws.courtDesk.series.allResolved')}
                      style={{ marginBlockEnd: '0.6rem' }}
                    />
                  )}
                  <ClashPreviewList
                    occurrences={occurrences}
                    courts={courts}
                    resolutions={resolutions}
                    tz={tz}
                    disabled={busy}
                    onResolve={(date, action, courtId) =>
                      setResolutions((prev) => ({
                        ...prev,
                        [date]:
                          action === 'skip'
                            ? { date, action }
                            : { date, action, courtId: courtId! },
                      }))
                    }
                  />
                </>
              )}
              {/*
                Every action in one bar at the foot of the panel, bled to its
                edges. They used to be split between the panel header and a
                floating row, so the two halves of one decision — check, then
                create — never sat next to each other, and "cancel" outranked
                both by sitting where the eye lands first.
              */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBlockStart: '0.85rem',
                  marginInline: '-0.85rem',
                  marginBlockEnd: '-0.75rem',
                  paddingBlock: '0.6rem',
                  paddingInline: '0.85rem',
                  borderBlockStart: '1px solid var(--tp-border)',
                  background: 'var(--tp-surface-2)',
                }}
              >
                {footerHint && (
                  <span
                    style={{
                      display: 'inline-flex',
                      gap: '0.35rem',
                      alignItems: 'center',
                      fontSize: 'var(--tp-fs-sm)',
                      color: 'var(--tp-muted-fg)',
                      minInlineSize: 0,
                    }}
                  >
                    <Icon name="info" size={14} />
                    {footerHint}
                  </span>
                )}
                <span
                  style={{
                    display: 'inline-flex',
                    gap: '0.5rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    marginInlineStart: 'auto',
                  }}
                >
                  <Link to="/desk" className="tp-btn" data-kind="ghost" data-size="md">
                    {tr('common.cancel')}
                  </Link>
                  <Button icon="search" busy={checking} disabled={busy} onClick={checkClashes}>
                    {preview
                      ? tr('ws.courtDesk.series.recheck')
                      : tr('ws.courtDesk.series.checkClashes')}
                  </Button>
                  <Button
                    kind="primary"
                    icon="repeat"
                    busy={busy}
                    disabled={checking}
                    onClick={() => void submit()}
                  >
                    {tr('ws.courtDesk.series.submit')}
                  </Button>
                </span>
              </div>
            </Panel>
          </div>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeriesPatternBuilder (spec §07): weekly · fortnightly · chosen weekdays;
// time; duration from the court; number of weeks OR an end date, no limit.
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
  return (
    <div>
      <Field label={tr('ws.courtDesk.series.court')} required error={errors?.court}>
        <Select
          value={draft.courtId}
          disabled={disabled}
          onChange={(courtId) => set({ courtId, durationMin: 0 })}
          options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))}
        />
      </Field>
      {/* group: a <label> around a set of buttons forwards hover AND click to
          the first of them — see Field. */}
      <Field label={tr('ws.courtDesk.series.pattern')} group>
        <SegmentedControl<SeriesPattern>
          value={draft.pattern}
          onChange={(pattern) => set({ pattern })}
          options={[
            { value: 'weekly', label: tr('ws.courtDesk.series.weekly') },
            { value: 'fortnightly', label: tr('ws.courtDesk.series.fortnightly') },
            { value: 'weekdays', label: tr('ws.courtDesk.series.weekdays') },
          ]}
        />
      </Field>
      {draft.pattern === 'weekdays' && (
        <Field
          label={tr('ws.courtDesk.series.weekdaysPick')}
          required
          group
          error={errors?.weekdays}
        >
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
                  onClick={() =>
                    set({
                      weekdays: on ? draft.weekdays.filter((d) => d !== i) : [...draft.weekdays, i],
                    })
                  }
                >
                  {tr(`ws.courtDesk.common.weekday.${k}`)}
                </Button>
              );
            })}
          </div>
        </Field>
      )}
      <div className="tp-grid" data-cols="3" style={{ gap: '0.75rem' }}>
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
          <input
            type="time"
            step={1800}
            style={inputStyle}
            value={draft.startTime}
            disabled={disabled}
            onChange={(e) => set({ startTime: e.target.value })}
          />
        </Field>
        <Field label={tr('ws.courtDesk.series.duration')}>
          <select
            style={inputStyle}
            value={draft.durationMin}
            disabled={disabled}
            onChange={(e) => set({ durationMin: Number(e.target.value) })}
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {tr('op.common.minutesShort', { minutes: d })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {/* How it ends and WHEN it ends are one decision, so they share a row.
          The weeks box used to be a stubby 8rem stub floating under a
          full-width control. */}
      <div className="tp-grid" data-cols="2" style={{ gap: '0.75rem' }}>
        <Field label={tr('ws.courtDesk.series.endMode')} group style={{ marginBlockEnd: 0 }}>
          <SegmentedControl<'weeks' | 'date'>
            value={draft.endMode}
            onChange={(endMode) => set({ endMode })}
            options={[
              { value: 'weeks', label: tr('ws.courtDesk.series.afterWeeks') },
              { value: 'date', label: tr('ws.courtDesk.series.onDate') },
            ]}
          />
        </Field>
        {draft.endMode === 'weeks' ? (
          <Field
            label={tr('ws.courtDesk.series.weeks')}
            required
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
          <Field
            label={tr('ws.courtDesk.series.endsOn')}
            required
            error={errors?.endsOn}
            style={{ marginBlockEnd: 0 }}
          >
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
}: {
  occurrences: readonly SeriesOccurrencePreview[];
  courts: readonly CourtRow[];
  resolutions: ResolutionMap;
  tz: string;
  disabled?: boolean;
  onResolve: (date: string, action: 'skip' | 'moveCourt', courtId?: string) => void;
}) {
  const { tr, locale } = useLocale();
  const courtName = (id: string) =>
    pickName(
      locale,
      courts.find((c) => c.id === id),
    ) || id;
  return (
    <div
      style={{
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-panel)',
        overflow: 'auto',
        maxBlockSize: '60vh',
      }}
    >
      <table
        className="tp-table"
        data-dense="true"
        aria-label={tr('ws.courtDesk.series.previewTitle')}
      >
        <thead>
          <tr>
            <th>{tr('ws.courtDesk.series.date')}</th>
            <th>{tr('ws.courtDesk.series.time')}</th>
            <th>{tr('ws.courtDesk.series.outcome')}</th>
          </tr>
        </thead>
        <tbody>
          {occurrences.map((o) => {
            const res = resolutions[o.date];
            const start = new Date(o.startsAt);
            const end = new Date(o.endsAt);
            return (
              <tr
                key={o.date}
                style={{ background: o.conflict && !res ? 'var(--tp-danger-soft)' : undefined }}
              >
                <td style={{ whiteSpace: 'nowrap' }}>
                  <bdi>{formatDate(start, locale, tz)}</bdi>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  <bdi>{formatTimeRange(start, end, locale, tz)}</bdi>
                </td>
                <td>
                  {!o.conflict ? (
                    <StatusBadge
                      size="sm"
                      tone="success"
                      label={tr('ws.courtDesk.series.free')}
                      icon="check"
                    />
                  ) : res ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        gap: '0.4rem',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <StatusBadge
                        size="sm"
                        tone="neutral"
                        label={
                          res.action === 'skip'
                            ? tr('ws.courtDesk.series.resolution.skip')
                            : tr('ws.courtDesk.series.resolution.moveCourt', {
                                court: courtName(res.courtId),
                              })
                        }
                      />
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="undo"
                        disabled={disabled}
                        onClick={() => onResolve(o.date, 'skip')}
                        aria-label={tr('ws.courtDesk.series.resolveSkip')}
                      />
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-flex',
                        gap: '0.4rem',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <StatusBadge
                        size="sm"
                        tone="danger"
                        label={tr('ws.courtDesk.series.clash')}
                        icon="alert"
                      />
                      <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() => onResolve(o.date, 'skip')}
                      >
                        {tr('ws.courtDesk.series.resolveSkip')}
                      </Button>
                      {o.conflict.alternativeCourtIds.length > 0 ? (
                        o.conflict.alternativeCourtIds.map((cid) => (
                          <Button
                            key={cid}
                            size="sm"
                            kind="soft"
                            disabled={disabled}
                            onClick={() => onResolve(o.date, 'moveCourt', cid)}
                          >
                            {tr('ws.courtDesk.series.resolveMoveTo', { court: courtName(cid) })}
                          </Button>
                        ))
                      ) : (
                        <span
                          style={{
                            fontSize: 'var(--tp-fs-xs)',
                            color: 'var(--tp-muted-fg)',
                            display: 'inline-flex',
                            gap: '0.25rem',
                            alignItems: 'center',
                          }}
                        >
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
