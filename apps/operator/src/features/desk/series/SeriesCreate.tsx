/**
 * 06.5 RecurringSeriesCreateScreen — a whole series in one action.
 * Flow: build the pattern → "Check clashes" (preview_series, read-only) →
 * resolve every clash (skip the date, or move it to a court the server says
 * is free) → create_series in one transaction. Submission stays disabled
 * while any clash is unresolved (spec 06.5). States: ready · checking ·
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
import { AsyncStateWrapper, MessagePresenter, PageHeader, Panel, SegmentedControl, StatusBadge, asyncStatus } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { todayInTz } from '../useTradingNight';
import { CustomerPicker, type PickedCustomer } from '../customers/CustomerPicker';
import type { SeriesCreateResult, SeriesOccurrencePreview, SeriesPattern, SeriesPreview } from '../deskTypes';
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

/** "{station}:series.create:{ulid}" — the same shape mutate() uses, for an RPC outside the queue. */
function seriesIdempotencyKey(): string {
  const ref = clientRef();
  return `${station()}:series.create:${ref.slice(ref.lastIndexOf('-') + 1)}`;
}

type Phase = 'ready' | 'checking' | 'conflictsFound' | 'busy' | 'error';

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

  const [preview, setPreview] = useState<{ key: string; occurrences: SeriesOccurrencePreview[] } | null>(null);
  const [resolutions, setResolutions] = useState<ResolutionMap>({});
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SeriesCreateResult | null>(null);

  const court = courts.find((c) => c.id === draft.courtId) ?? courts[0];
  const effective: SeriesDraft = useMemo(
    () => ({
      ...draft,
      courtId: draft.courtId || court?.id || '',
      durationMin: draft.durationMin || court?.duration_options?.[0] || 60,
    }),
    [draft, court],
  );
  const problem = draftProblem(effective);
  const key = draftKey(effective);
  const stale = preview !== null && preview.key !== key;
  const occurrences = preview?.occurrences ?? [];
  const unresolved = unresolvedDates(occurrences, resolutions);
  const clashes = conflictCount(occurrences);
  const hasCustomer = customer !== null || walkInName.trim().length > 0;

  const phase: Phase = busy ? 'busy' : checking ? 'checking' : error != null ? 'error' : preview && !stale && clashes > 0 ? 'conflictsFound' : 'ready';
  const canSubmit = phase === 'ready' || (phase === 'conflictsFound' && unresolved.length === 0);
  const submitEnabled = preview !== null && !stale && canSubmit && hasCustomer && problem === null && !busy && !checking;

  async function checkClashes() {
    if (problem !== null) return;
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

  async function submit() {
    if (!submitEnabled) return;
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
      void queryClient.invalidateQueries({ queryKey: ['reservations'] });
      void queryClient.invalidateQueries({ queryKey: ['reservationsWeek'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const problemText =
    problem === 'weekdays' ? tr('ws.courtDesk.series.invalidWeekdays') : problem === 'weeks' ? tr('ws.courtDesk.series.invalidWeeks') : problem === 'end' ? tr('ws.courtDesk.series.invalidEnd') : null;

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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link to="/desk/series/$id" params={{ id: result.seriesId }} className="tp-btn" data-kind="primary" data-size="md">
                {tr('ws.courtDesk.series.openSeries')}
              </Link>
              <Link to="/desk" className="tp-btn" data-kind="default" data-size="md">
                {tr('ws.courtDesk.block.openCalendar')}
              </Link>
              <Button onClick={() => setResult(null)}>{tr('ws.courtDesk.series.title')}</Button>
            </div>
          </Panel>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: '1rem' }}>
              <Panel title={tr('ws.courtDesk.series.pattern')}>
                <SeriesPatternBuilder draft={effective} courts={courts} disabled={busy} onChange={setDraft} />
                {problemText && <MessagePresenter tone="refused" message={problemText} style={{ marginBlockStart: '0.25rem' }} />}
              </Panel>
              <Panel title={tr('ws.courtDesk.series.customer')}>
                <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', marginBlockEnd: '0.6rem' }}>{tr('ws.courtDesk.series.customerHint')}</p>
                <CustomerPicker
                  value={customer}
                  disabled={busy}
                  onChange={(next) => {
                    setCustomer(next);
                    if (next && !walkInName) setWalkInName(next.name);
                    if (next && !walkInPhone && next.phone) setWalkInPhone(next.phone);
                  }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <Field label={tr('ws.courtDesk.series.walkInName')} required={customer === null}>
                    <input style={inputStyle} value={walkInName} disabled={busy} onChange={(e) => setWalkInName(e.target.value)} />
                  </Field>
                  <Field label={tr('ws.courtDesk.series.walkInPhone')}>
                    <input style={inputStyle} dir="ltr" inputMode="tel" value={walkInPhone} disabled={busy} onChange={(e) => setWalkInPhone(e.target.value)} />
                  </Field>
                </div>
                <Field label={tr('ws.courtDesk.series.notes')}>
                  <input style={inputStyle} value={notes} disabled={busy} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </Panel>
            </div>

            <Panel
              title={tr('ws.courtDesk.series.previewTitle')}
              actions={
                <Button kind={preview ? 'default' : 'primary'} icon="search" busy={checking} disabled={busy || problem !== null} onClick={() => void checkClashes()}>
                  {preview ? tr('ws.courtDesk.series.recheck') : tr('ws.courtDesk.series.checkClashes')}
                </Button>
              }
            >
              <ErrorText error={error} />
              {checking && <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.series.checking')}</p>}
              {stale && !checking && <MessagePresenter tone="refused" message={tr('ws.courtDesk.series.staleDraft')} style={{ marginBlockEnd: '0.6rem' }} />}
              {preview && !checking && (
                <>
                  <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.5rem' }}>
                    {tr('ws.courtDesk.series.previewLead', { count: formatNumber(occurrences.length, locale), conflicts: formatNumber(clashes, locale) })}
                  </p>
                  {clashes === 0 ? (
                    <MessagePresenter tone="success" message={tr('ws.courtDesk.series.noClashes')} style={{ marginBlockEnd: '0.6rem' }} />
                  ) : unresolved.length > 0 ? (
                    <MessagePresenter tone="refused" message={tr('ws.courtDesk.series.unresolved', { count: formatNumber(unresolved.length, locale) })} style={{ marginBlockEnd: '0.6rem' }} />
                  ) : (
                    <MessagePresenter tone="success" message={tr('ws.courtDesk.series.allResolved')} style={{ marginBlockEnd: '0.6rem' }} />
                  )}
                  <ClashPreviewList
                    occurrences={occurrences}
                    courts={courts}
                    resolutions={resolutions}
                    tz={tz}
                    disabled={busy}
                    onResolve={(date, action, courtId) =>
                      setResolutions((prev) => ({ ...prev, [date]: action === 'skip' ? { date, action } : { date, action, courtId: courtId! } }))
                    }
                  />
                </>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginBlockStart: '0.85rem' }}>
                <Link to="/desk" className="tp-btn" data-kind="ghost" data-size="md">
                  {tr('common.cancel')}
                </Link>
                <Button kind="primary" icon="repeat" busy={busy} disabled={!submitEnabled} onClick={() => void submit()}>
                  {tr('ws.courtDesk.series.submit')}
                </Button>
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
  onChange,
}: {
  draft: SeriesDraft;
  courts: readonly CourtRow[];
  disabled?: boolean;
  onChange: (next: SeriesDraft) => void;
}) {
  const { tr, locale } = useLocale();
  const court = courts.find((c) => c.id === draft.courtId);
  const durations = court?.duration_options?.length ? court.duration_options : [60, 90, 120];
  const set = (patch: Partial<SeriesDraft>) => onChange({ ...draft, ...patch });
  return (
    <div>
      <Field label={tr('ws.courtDesk.series.court')} required>
        <Select value={draft.courtId} disabled={disabled} onChange={(courtId) => set({ courtId, durationMin: 0 })} options={courts.map((c) => ({ value: c.id, label: pickName(locale, c) }))} />
      </Field>
      <Field label={tr('ws.courtDesk.series.pattern')}>
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
        <Field label={tr('ws.courtDesk.series.weekdaysPick')} required>
          <div role="group" aria-label={tr('ws.courtDesk.series.weekdaysPick')} style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {WEEKDAY_KEYS.map((k, i) => {
              const on = draft.weekdays.includes(i);
              return (
                <Button key={k} size="sm" kind={on ? 'primary' : 'default'} aria-pressed={on} disabled={disabled} onClick={() => set({ weekdays: on ? draft.weekdays.filter((d) => d !== i) : [...draft.weekdays, i] })}>
                  {tr(`ws.courtDesk.common.weekday.${k}`)}
                </Button>
              );
            })}
          </div>
        </Field>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
        <Field label={tr('ws.courtDesk.series.startsOn')} required>
          <input type="date" style={inputStyle} value={draft.startsOn} disabled={disabled} onChange={(e) => e.target.value && set({ startsOn: e.target.value })} />
        </Field>
        <Field label={tr('ws.courtDesk.series.time')} required>
          <input type="time" step={1800} style={inputStyle} value={draft.startTime} disabled={disabled} onChange={(e) => set({ startTime: e.target.value })} />
        </Field>
        <Field label={tr('ws.courtDesk.series.duration')}>
          <select style={inputStyle} value={draft.durationMin} disabled={disabled} onChange={(e) => set({ durationMin: Number(e.target.value) })}>
            {durations.map((d) => (
              <option key={d} value={d}>
                {tr('op.common.minutesShort', { minutes: d })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={tr('ws.courtDesk.series.endMode')}>
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
        <Field label={tr('ws.courtDesk.series.weeks')} required>
          <input type="number" min={1} step={1} inputMode="numeric" style={{ ...inputStyle, inlineSize: '8rem' }} value={draft.weeks} disabled={disabled} onChange={(e) => set({ weeks: Number(e.target.value) })} />
        </Field>
      ) : (
        <Field label={tr('ws.courtDesk.series.endsOn')} required>
          <input type="date" style={inputStyle} value={draft.endsOn} min={draft.startsOn} disabled={disabled} onChange={(e) => e.target.value && set({ endsOn: e.target.value })} />
        </Field>
      )}
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
  const courtName = (id: string) => pickName(locale, courts.find((c) => c.id === id)) || id;
  return (
    <div style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', overflow: 'auto', maxBlockSize: '60vh' }}>
      <table className="tp-table" data-dense="true" aria-label={tr('ws.courtDesk.series.previewTitle')}>
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
              <tr key={o.date} style={{ background: o.conflict && !res ? 'var(--tp-danger-soft)' : undefined }}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <bdi>{formatDate(start, locale, tz)}</bdi>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  <bdi>{formatTimeRange(start, end, locale, tz)}</bdi>
                </td>
                <td>
                  {!o.conflict ? (
                    <StatusBadge size="sm" tone="success" label={tr('ws.courtDesk.series.free')} icon="check" />
                  ) : res ? (
                    <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <StatusBadge size="sm" tone="neutral" label={res.action === 'skip' ? tr('ws.courtDesk.series.resolution.skip') : tr('ws.courtDesk.series.resolution.moveCourt', { court: courtName(res.courtId) })} />
                      <Button size="sm" kind="ghost" icon="undo" disabled={disabled} onClick={() => onResolve(o.date, 'skip')} aria-label={tr('ws.courtDesk.series.resolveSkip')} />
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
