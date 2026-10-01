/**
 * Reschedule a lesson (docs/design/coaching/operator.md §5.10.9; R8, R32,
 * R47, R66): every kind, a private lesson, a group session or one session of a
 * course. A date and a 30-minute start on that night; the length stays. The
 * server moves it to any free court, tells everyone in it, and lets guests who
 * booked in the app cancel free until the new start. A group session's (a
 * course's session 1) cut-off moves with it, so a start whose cut-off has
 * already passed is mirrored here and refused there (`LESSON_CLOSED`
 * `cutoff`). A held lesson never opens this (R32: the header shows it
 * disabled). One app.desk_reschedule_session call; refusals stay in the
 * dialog, beside the button. Online only (CD-6).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tradingSpan, wallTimeToUtc, type DayKey } from '@touch/core';
import { formatNumber, formatTime, isolate, VENUE_TZ } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, Select } from '../../components/ui';
import { DateField } from '../../components/inputs';
import { MessagePresenter } from '../../components/kit';
import { DAY_KEYS } from '../desk/useTradingNight';
import { localDateOf } from '../desk/weekLogic';
import { coachingErrorText, courtNameOf, nowOf } from './lessonLogic';
import { readRescheduled, type LessonInfo } from './lessonPayloads';
import { rescheduleBlock, rescheduleCutoff, rescheduleStarts } from './lessonScreenLogic';
import { invalidateLessonBooking } from './useCoaching';

export interface RescheduleDialogProps {
  lesson: LessonInfo;
  /** The trading night the lesson is on now (its date opens the picker). */
  night: string;
  /** How long ago the payload's `server_now` was read. */
  elapsedMs: number;
  onClose: () => void;
}

export function RescheduleDialog({ lesson, night, elapsedMs, onClose }: RescheduleDialogProps) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const hours = settingsQ.data?.opening_hours;
  const nowMs = nowOf(lesson.server_now, elapsedMs);
  const durationMin =
    lesson.duration_min ??
    Math.max(30, Math.round((Date.parse(lesson.end_at) - Date.parse(lesson.start_at)) / 60_000));

  const [date, setDate] = useState(night);
  const [startIso, setStartIso] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const closed = (settingsQ.data?.closed_dates ?? []).includes(date);
  const starts = useMemo(() => {
    const dayIndex = new Date(`${date}T12:00:00Z`).getUTCDay();
    const span = hours
      ? tradingSpan(
          hours[DAY_KEYS[dayIndex] as DayKey] ?? [],
          hours[DAY_KEYS[(dayIndex + 1) % 7] as DayKey] ?? [],
        )
      : null;
    return rescheduleStarts({
      span,
      durationMin,
      nowMs,
      closed,
      toUtc: (m) => wallTimeToUtc(date, m, tz),
    });
  }, [date, hours, durationMin, nowMs, closed, tz]);

  const cutoff = startIso ? rescheduleCutoff(lesson, startIso, nowMs) : null;
  const block = rescheduleBlock({
    reachable,
    startIso,
    currentStartIso: lesson.start_at,
    cutoff,
  });
  const blocked =
    block === 'offline'
      ? tr('ws.coaching.offline.needsConnection')
      : block === 'pickStart'
        ? tr('ws.coaching.reschedule.pickStart')
        : block === 'sameStart'
          ? tr('ws.coaching.reschedule.sameStart')
          : block === 'cutoffPassed' && cutoff
            ? tr('ws.coaching.reschedule.cutoffPassed', {
                time: formatTime(new Date(cutoff.cutoffAt), locale, tz),
              })
            : undefined;
  const endsAt = startIso ? new Date(Date.parse(startIso) + durationMin * 60_000) : null;

  async function submit() {
    if (!startIso || blocked !== undefined) return;
    setBusy(true);
    setError(null);
    try {
      // No type argument on the call: the assistant map finds callers by `appRpc('<name>'` (§5.1).
      const out = readRescheduled(
        await appRpc('desk_reschedule_session', { p_lesson_id: lesson.id, p_start_at: startIso }),
      );
      invalidateLessonBooking(qc);
      const at = out.start_at ?? startIso;
      toast.ok(
        tr('ws.coaching.reschedule.done', {
          time: formatTime(new Date(at), locale, tz),
          court: isolate(courtNameOf(out, locale) || courtNameOf(lesson, locale) || '—'),
        }),
      );
      onClose();
    } catch (e) {
      setError(e);
      invalidateLessonBooking(qc);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr('ws.coaching.reschedule.title')}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="calendar"
            busy={busy}
            disabled={blocked !== undefined}
            disabledReason={blocked}
            onClick={() => void submit()}
          >
            {tr('ws.coaching.reschedule.submit')}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        {tr('ws.coaching.reschedule.body')}
        {lesson.kind === 'group' && <> {tr('ws.coaching.reschedule.groupCutoff')}</>}
      </p>
      <div className="tp-grid" data-cols="2" style={{ columnGap: 'var(--tp-sp-3)' }}>
        <Field label={tr('ws.coaching.reschedule.date')}>
          <DateField
            value={date}
            min={localDateOf(new Date(nowMs).toISOString(), tz)}
            disabled={busy}
            onChange={(next) => {
              setDate(next);
              setStartIso(null);
              setError(null);
            }}
          />
        </Field>
        <Field label={tr('ws.coaching.reschedule.start')}>
          <Select
            value={startIso ?? ''}
            disabled={busy || starts.length === 0}
            placeholder={tr('ws.coaching.reschedule.pickStart')}
            onChange={(v) => {
              setStartIso(v);
              setError(null);
            }}
            options={starts.map((s) => ({
              value: s.iso,
              label: formatTime(new Date(s.iso), locale, tz),
            }))}
          />
        </Field>
      </div>
      {starts.length === 0 && (
        <MessagePresenter
          tone="refused"
          message={tr(
            closed ? 'ws.coaching.reschedule.closedDate' : 'ws.coaching.reschedule.noStarts',
          )}
          style={{ marginBlockEnd: 'var(--tp-sp-2)' }}
        />
      )}
      {endsAt && (
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.coaching.reschedule.length', {
            time: formatTime(endsAt, locale, tz),
            minutes: formatNumber(durationMin, locale),
          })}
        </p>
      )}
      {cutoff && !cutoff.passed && (
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.coaching.reschedule.cutoffAt', {
            time: formatTime(new Date(cutoff.cutoffAt), locale, tz),
          })}
        </p>
      )}
      {cutoff?.passed && blocked && (
        <MessagePresenter
          tone="refused"
          message={blocked}
          style={{ marginBlockStart: 'var(--tp-sp-2)' }}
        />
      )}
      <ErrorText
        error={error}
        message={error ? coachingErrorText(error, tr, {}, { scope: 'lesson' }) : null}
      />
    </Modal>
  );
}
