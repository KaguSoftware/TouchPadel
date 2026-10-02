/**
 * /admin/coaches › Hours (docs/design/coaching/operator.md §5.13.3; C-4,
 * CD-10, R73): a manager overrides a coach's weekly hours and time off.
 *
 * - A coach Select (active and paused; `?coach=` picks one).
 * - Weekly hours, Sunday first (`weekday` 0..6): each day's windows, each a
 *   start and an end Select on the half hour from 00:00 to 24:00 (24:00 is an
 *   end a native time input cannot hold), Add a window, remove, Copy to every
 *   day. Muted under a day: the coach's windows at other branches. Above the
 *   grid: who set them last. Pure checks before Save (coachHoursLogic); an
 *   overlap with another branch is only a warning, and the server's
 *   HOURS_OVERLAP / HOURS_INVALID detail is mapped back to the window sent.
 * - Time off: what is coming, Add time off, Cancel per row.
 *
 * Every write is online only (CD-6).
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  VENUE_TZ,
  formatDate,
  formatWeekdayShort,
  isolate,
  isolateLtr,
  type MessageKey,
} from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { pickName, useLocale } from '../../../lib/i18n';
import { useVenue } from '../../../lib/venue';
import { currentBranchId } from '../../../lib/venueScope';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Select, inputStyle } from '../../../components/ui';
import { EmptyState, MessagePresenter, Panel } from '../../../components/kit';
import { DateField } from '../../../components/inputs';
import { coachingErrorText, countOf, nowOf } from '../../coaching/lessonLogic';
import type {
  AdminCoach,
  CoachesAdmin as CoachesAdminData,
  TimeOff,
} from '../../coaching/lessonPayloads';
import { invalidateCoachesAdmin } from '../../coaching/useCoaching';
import { coachName, hoursCoaches } from './coachesLogic';
import {
  END_OPTIONS,
  START_OPTIONS,
  TIME_OFF_REASON_MAX,
  WEEKDAYS,
  addWindow,
  copyToEveryDay,
  dayKeyOf,
  draftFromHours,
  elsewhereByDay,
  elsewhereOverlaps,
  emptyTimeOff,
  hhmm,
  hoursErrors,
  overlapWindow,
  removeWindow,
  sameHours,
  setWindow,
  timeOffArgs,
  timeOffErrors,
  toWindows,
  upcomingTimeOff,
  wallClockOf,
  type HoursDraft,
  type SentWindow,
  type TimeOffDraft,
} from './coachHoursLogic';

const H = 'ws.coaching.coachHours';

/** "Mon 13 Oct 2026" for a branch-local 'YYYY-MM-DD' (read at noon UTC, so no zone moves it). */
function dayLabel(date: string, locale: 'en' | 'ar'): string {
  const noon = new Date(`${date}T12:00:00Z`);
  return `${formatWeekdayShort(noon, locale, 'UTC')} ${formatDate(noon, locale, 'UTC')}`;
}

export function CoachHoursTab({
  data,
  coachId,
  reachable,
  onPickCoach,
}: {
  data: CoachesAdminData;
  coachId: string | null;
  reachable: boolean;
  onPickCoach: (coachId: string) => void;
}) {
  const { tr, locale } = useLocale();
  const coaches = hoursCoaches(data.coaches);
  const coach = coaches.find((c) => c.coach_id === coachId) ?? coaches[0] ?? null;

  if (coaches.length === 0) {
    return <EmptyState icon="clock" title={tr(`${H}.noCoaches`)} />;
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <Field label={tr(`${H}.coach`)} style={{ marginBlockEnd: 0, maxInlineSize: '24rem' }}>
        <Select<string>
          value={coach?.coach_id ?? ''}
          onChange={onPickCoach}
          placeholder={tr(`${H}.pickCoach`)}
          options={coaches.map((c) => ({ value: c.coach_id, label: coachName(c, locale) }))}
        />
      </Field>
      {coach && (
        <>
          <WeeklyHours key={`hours-${coach.coach_id}`} coach={coach} reachable={reachable} />
          <TimeOffPanel
            key={`off-${coach.coach_id}`}
            coach={coach}
            serverNow={data.server_now}
            reachable={reachable}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly hours (set_coach_hours)
// ---------------------------------------------------------------------------

function WeeklyHours({ coach: c, reachable }: { coach: AdminCoach; reachable: boolean }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { branchId, current } = useVenue();
  const tz = current?.timezone ?? VENUE_TZ;
  const savedKey = JSON.stringify(c.hours);
  const [draft, setDraft] = useState<HoursDraft>(() => draftFromHours(c.hours));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<SentWindow[]>([]);

  // A save (this one's, or the coach's own in coach mode) resets the grid to what is stored.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(draftFromHours(c.hours)), [savedKey]);

  const saved = draftFromHours(c.hours);
  const dirty = !sameHours(draft, saved);
  const problems = hoursErrors(draft);
  const clashes = elsewhereOverlaps(draft, c.hours_elsewhere);
  const elsewhere = elsewhereByDay(c.hours_elsewhere);
  const dayName = (weekday: number) => {
    const key = dayKeyOf(weekday);
    return key ? tr(`op.days.${key}`) : String(weekday);
  };
  const branchName = (w: { venue_name_en: string; venue_name_ar: string }) =>
    pickName(locale, { name_en: w.venue_name_en, name_ar: w.venue_name_ar });

  const code = error instanceof AppRpcError ? error.code : null;
  const target =
    code === 'HOURS_OVERLAP' || code === 'HOURS_INVALID'
      ? overlapWindow((error as AppRpcError).details ?? (error as AppRpcError).hint, sent)
      : null;
  const refusedAt = target && target.kind === 'window' ? target : null;
  const refusalText = error
    ? coachingErrorText(
        error,
        tr,
        { day: refusedAt ? dayName(refusedAt.weekday) : '' },
        { scope: 'admin' },
      )
    : null;

  function edit(next: HoursDraft) {
    setDraft(next);
    setError(null);
  }

  async function save() {
    setTried(true);
    if (problems.length > 0 || !reachable) return;
    const windows = toWindows(draft);
    setSent(windows);
    setBusy(true);
    setError(null);
    try {
      await appRpc('set_coach_hours', {
        p_coach_id: c.coach_id,
        p_venue_id: currentBranchId(),
        p_windows: windows,
      });
      toast.ok(tr(`${H}.saved`));
      setTried(false);
      invalidateCoachesAdmin(qc, branchId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const setBy =
    c.hours_set_by === 'coach' && c.hours_updated_at
      ? tr(`${H}.setByCoach`, { date: formatDate(new Date(c.hours_updated_at), locale, tz) })
      : c.hours_set_by === 'staff' && c.hours_updated_at
        ? tr(`${H}.setByStaff`, {
            name: isolate(c.hours_set_by_name ?? '—'),
            date: formatDate(new Date(c.hours_updated_at), locale, tz),
          })
        : c.hours.length === 0
          ? tr(`${H}.neverSet`)
          : null;

  return (
    <Panel title={tr(`${H}.weekly`)} data-testid="coach-hours">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {setBy && (
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {setBy}
          </p>
        )}
        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--tp-sp-2)',
          }}
        >
          {WEEKDAYS.map((weekday) => {
            const day = draft[weekday] ?? [];
            const name = dayName(weekday);
            return (
              <li
                key={weekday}
                aria-label={name}
                style={{
                  display: 'grid',
                  gap: 'var(--tp-sp-1)',
                  paddingBlock: 'var(--tp-sp-2)',
                  borderBlockEnd: '1px solid var(--tp-border)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--tp-sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ minInlineSize: '7rem' }}>{name}</strong>
                  {day.length === 0 && (
                    <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                      {tr(`${H}.notWorking`)}
                    </span>
                  )}
                  <span
                    style={{
                      marginInlineStart: 'auto',
                      display: 'inline-flex',
                      gap: 'var(--tp-sp-1)',
                    }}
                  >
                    <Button
                      size="sm"
                      kind="ghost"
                      icon="plus"
                      disabled={busy}
                      aria-label={`${tr(`${H}.addWindow`)}: ${name}`}
                      onClick={() => edit(addWindow(draft, weekday))}
                    >
                      {tr(`${H}.addWindow`)}
                    </Button>
                    {day.length > 0 && (
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="repeat"
                        disabled={busy}
                        aria-label={tr(`${H}.copyAllAria`, { day: name })}
                        onClick={() => edit(copyToEveryDay(draft, weekday))}
                      >
                        {tr(`${H}.copyAll`)}
                      </Button>
                    )}
                  </span>
                </div>
                {day.map((w, position) => {
                  const label = tr(`${H}.windowAria`, { day: name, n: String(position + 1) });
                  const problem = tried
                    ? problems.find((p) => p.weekday === weekday && p.position === position)
                    : undefined;
                  const refused =
                    refusedAt && refusedAt.weekday === weekday && refusedAt.position === position;
                  const clash = clashes.find(
                    (x) => x.weekday === weekday && x.position === position,
                  );
                  const startOpts = START_OPTIONS.includes(w.start)
                    ? START_OPTIONS
                    : [w.start, ...START_OPTIONS];
                  const endOpts = END_OPTIONS.includes(w.end)
                    ? END_OPTIONS
                    : [...END_OPTIONS, w.end];
                  return (
                    <div key={position} style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--tp-sp-2)',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Select<string>
                          value={w.start}
                          onChange={(v) => edit(setWindow(draft, weekday, position, { start: v }))}
                          options={startOpts.map((t) => ({ value: t, label: t }))}
                          aria-label={`${label} · ${tr(`${H}.start`)}`}
                          aria-invalid={!!problem || !!refused}
                          disabled={busy}
                          style={{ inlineSize: '7rem' }}
                        />
                        <span aria-hidden="true">–</span>
                        <Select<string>
                          value={w.end}
                          onChange={(v) => edit(setWindow(draft, weekday, position, { end: v }))}
                          options={endOpts.map((t) => ({ value: t, label: t }))}
                          aria-label={`${label} · ${tr(`${H}.end`)}`}
                          aria-invalid={!!problem || !!refused}
                          disabled={busy}
                          style={{ inlineSize: '7rem' }}
                        />
                        <Button
                          size="sm"
                          kind="ghost"
                          icon="x"
                          disabled={busy}
                          aria-label={`${tr(`${H}.removeWindow`)}: ${label}`}
                          onClick={() => edit(removeWindow(draft, weekday, position))}
                        />
                      </div>
                      {problem && (
                        <span
                          role="alert"
                          style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-danger-fg)' }}
                        >
                          {tr(`${H}.errors.${problem.error}` as MessageKey)}
                        </span>
                      )}
                      {refused && refusalText && (
                        <span
                          role="alert"
                          style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-danger-fg)' }}
                        >
                          {refusalText}
                        </span>
                      )}
                      {clash && (
                        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-warn-fg)' }}>
                          {tr(`${H}.overlapElsewhere`, {
                            day: name,
                            branch: isolate(branchName(clash.other)),
                          })}
                        </span>
                      )}
                    </div>
                  );
                })}
                {(elsewhere[weekday] ?? []).map((o, i) => (
                  <span
                    key={`else-${i}`}
                    style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}
                    data-elsewhere="true"
                  >
                    {tr(`${H}.elsewhere`, {
                      branch: isolate(branchName(o)),
                      from: isolateLtr(hhmm(o.start_time)),
                      to: isolateLtr(hhmm(o.end_time)),
                    })}
                  </span>
                ))}
              </li>
            );
          })}
        </ol>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr(`${H}.body`)}
        </p>
        {error != null && !refusedAt && <ErrorText error={error} message={refusalText} />}
        {dirty && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              justifyContent: 'flex-end',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Button kind="ghost" disabled={busy} onClick={() => edit(draftFromHours(c.hours))}>
              {tr(`${H}.discard`)}
            </Button>
            <Button
              kind="primary"
              icon="check"
              busy={busy}
              disabled={!reachable}
              disabledReason={tr('ws.coaching.offline.needsConnection')}
              onClick={() => void save()}
            >
              {tr(`${H}.save`)}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Time off (add_coach_time_off, cancel_coach_time_off)
// ---------------------------------------------------------------------------

function TimeOffPanel({
  coach: c,
  serverNow,
  reachable,
}: {
  coach: AdminCoach;
  serverNow: string | null;
  reachable: boolean;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { branchId, current } = useVenue();
  const tz = current?.timezone ?? VENUE_TZ;
  const offline = tr('ws.coaching.offline.needsConnection');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<TimeOffDraft>(emptyTimeOff);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [rowError, setRowError] = useState<unknown>(null);
  const name = coachName(c, locale);
  const list = upcomingTimeOff(c.time_off, nowOf(serverNow));
  const problem = timeOffErrors(draft, tz);
  const set = (p: Partial<TimeOffDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setError(null);
  };

  const span = (t: TimeOff) => {
    const from = wallClockOf(t.starts_at, tz);
    const to = wallClockOf(t.ends_at, tz, true);
    const side = (w: { date: string; time: string } | null) =>
      w ? `${dayLabel(w.date, locale)} ${isolateLtr(w.time)}` : '—';
    return tr(`${H}.span`, { from: side(from), to: side(to) });
  };
  const by = (t: TimeOff) =>
    t.set_by === 'coach'
      ? tr(`${H}.setByCoachShort`)
      : tr(`${H}.setByStaffShort`, { name: isolate(t.set_by_name ?? '—') });

  async function add() {
    setTried(true);
    const args = timeOffArgs(draft, tz);
    if (!args || !reachable) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('add_coach_time_off', { p_coach_id: c.coach_id, ...args });
      toast.ok(tr(`${H}.added`));
      setDraft(emptyTimeOff());
      setTried(false);
      setAdding(false);
      invalidateCoachesAdmin(qc, branchId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRow(t: TimeOff) {
    const ok = await confirm({
      title: tr(`${H}.cancelTitle`),
      body: (
        <>
          <p style={{ margin: 0 }}>{span(t)}</p>
          <p style={{ marginBlockStart: 'var(--tp-sp-2)' }}>{tr(`${H}.cancelBody`)}</p>
        </>
      ),
      confirmLabel: tr(`${H}.cancelConfirm`),
      cancelLabel: tr(`${H}.keep`),
      kind: 'danger',
    });
    if (!ok) return;
    setRowError(null);
    try {
      await appRpc('cancel_coach_time_off', { p_id: t.id });
      toast.ok(tr(`${H}.cancelled`));
    } catch (e) {
      setRowError(e);
    } finally {
      // INVALID_ARGUMENT p_id (already gone): the list is read again either way.
      invalidateCoachesAdmin(qc, branchId);
    }
  }

  const timeOffText = (e: unknown) => {
    const d = e instanceof AppRpcError ? Number((e.details ?? e.hint ?? '').trim()) : NaN;
    return coachingErrorText(
      e,
      tr,
      {
        name: isolate(name),
        lessons: countOf('lessons', Number.isFinite(d) ? d : 0, locale),
      },
      { scope: 'admin' },
    );
  };

  return (
    <Panel
      title={tr(`${H}.timeOff`)}
      data-testid="coach-time-off"
      actions={
        !adding ? (
          <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
            {tr(`${H}.addTimeOff`)}
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {list.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr(`${H}.noTimeOff`)}
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 'var(--tp-sp-1)',
            }}
          >
            {list.map((t) => (
              <li
                key={t.id}
                style={{
                  display: 'flex',
                  gap: 'var(--tp-sp-2)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ flex: '1 1 18rem', minInlineSize: 0 }}>
                  <bdi>{span(t)}</bdi>
                  {t.reason && (
                    <>
                      {' · '}
                      <bdi>{t.reason}</bdi>
                    </>
                  )}
                  <span style={{ color: 'var(--tp-muted-fg)' }}>{` · ${by(t)}`}</span>
                </span>
                <Button
                  size="sm"
                  kind="ghost"
                  icon="x"
                  disabled={!reachable}
                  disabledReason={offline}
                  aria-label={tr(`${H}.cancelAria`, { span: span(t) })}
                  onClick={() => void cancelRow(t)}
                >
                  {tr(`${H}.cancel`)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ErrorText
          error={rowError}
          message={rowError ? coachingErrorText(rowError, tr, {}, { scope: 'admin' }) : null}
        />

        {adding && (
          <div
            style={{
              display: 'grid',
              gap: 'var(--tp-sp-2)',
              paddingBlockStart: 'var(--tp-sp-2)',
              borderBlockStart: '1px solid var(--tp-border)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-3)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
              }}
            >
              <fieldset
                style={{
                  border: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  gap: 'var(--tp-sp-2)',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <legend
                  style={{
                    fontSize: 'var(--tp-fs-sm)',
                    fontWeight: 600,
                    marginBlockEnd: 'var(--tp-sp-1)',
                  }}
                >
                  {tr(`${H}.from`)}
                </legend>
                <DateField
                  value={draft.fromDate}
                  onChange={(v) => set({ fromDate: v })}
                  ariaLabel={`${tr(`${H}.from`)} · ${tr(`${H}.date`)}`}
                  disabled={busy}
                />
                <Select<string>
                  value={draft.fromTime}
                  onChange={(v) => set({ fromTime: v })}
                  options={START_OPTIONS.map((t) => ({ value: t, label: t }))}
                  aria-label={`${tr(`${H}.from`)} · ${tr(`${H}.time`)}`}
                  disabled={busy}
                  style={{ inlineSize: '7rem' }}
                />
              </fieldset>
              <fieldset
                style={{
                  border: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  gap: 'var(--tp-sp-2)',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <legend
                  style={{
                    fontSize: 'var(--tp-fs-sm)',
                    fontWeight: 600,
                    marginBlockEnd: 'var(--tp-sp-1)',
                  }}
                >
                  {tr(`${H}.to`)}
                </legend>
                <DateField
                  value={draft.toDate}
                  onChange={(v) => set({ toDate: v })}
                  ariaLabel={`${tr(`${H}.to`)} · ${tr(`${H}.date`)}`}
                  disabled={busy}
                />
                <Select<string>
                  value={draft.toTime}
                  onChange={(v) => set({ toTime: v })}
                  options={END_OPTIONS.map((t) => ({ value: t, label: t }))}
                  aria-label={`${tr(`${H}.to`)} · ${tr(`${H}.time`)}`}
                  disabled={busy}
                  style={{ inlineSize: '7rem' }}
                />
              </fieldset>
            </div>
            <Field
              label={tr(`${H}.reason`)}
              hint={tr(`${H}.reasonHint`)}
              optional
              style={{ marginBlockEnd: 0 }}
            >
              <input
                style={inputStyle}
                value={draft.reason}
                maxLength={TIME_OFF_REASON_MAX}
                disabled={busy}
                onChange={(e) => set({ reason: e.target.value })}
              />
            </Field>
            {tried && problem && (
              <MessagePresenter tone="refused" message={tr(`${H}.${problem}`)} />
            )}
            {error != null && <ErrorText error={error} message={timeOffText(error)} />}
            <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end' }}>
              <Button
                kind="ghost"
                disabled={busy}
                onClick={() => {
                  setAdding(false);
                  setDraft(emptyTimeOff());
                  setTried(false);
                  setError(null);
                }}
              >
                {tr('common.cancel')}
              </Button>
              <Button
                kind="primary"
                icon="check"
                busy={busy}
                disabled={!reachable}
                disabledReason={offline}
                onClick={() => void add()}
              >
                {tr(`${H}.addTimeOff`)}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
