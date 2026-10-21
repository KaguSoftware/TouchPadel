/**
 * `/desk/coaches`: the court desk's Coaches tab (0356, Sait 2026-10-21). One
 * trading night, every coach at the branch side by side: a timeline of when
 * they work (their hours here), the lessons they already teach (here, or busy
 * at another branch) and their time off, then the free starts of a private
 * lesson (app.coach_slots, which also checks opening hours and a free court).
 * Pressing a free start opens New lesson with that coach, type and start
 * picked; the desk picks or types the customer there. New lesson on a coach
 * opens the same dialog with the coach picked, for a group or a course too.
 *
 * Reads: app.desk_coach_schedule (the bands) and the night's desk_lessons
 * envelope (the catalogue the dialog books from, and the lessons' names).
 * Both live under ['coaching', 'desk'], so a booking refreshes both. The
 * bands' rules are coachDayLogic.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { wallTimeToUtc } from '@touch/core';
import { VENUE_TZ, formatDate, formatTime, formatTimeRange, formatWeekdayShort, isolate } from '@touch/i18n';
import { Button, Select, Skeleton } from '../../components/ui';
import { EmptyState, MessagePresenter, PageHeader, Panel, StatusBadge, Toolbar } from '../../components/kit';
import { DateField } from '../../components/inputs';
import { pickName, useLocale } from '../../lib/i18n';
import { todayInTz, tonightInTz, useTradingNight } from '../desk/useTradingNight';
import { LessonReadNotice } from './LessonReadNotice';
import {
  coachBands,
  hourMarks,
  hoursIntervals,
  lessonsOfCoach,
  nextDate,
  previousDate,
  typeForCoach,
  worksInSpan,
  type Band,
  type BandKind,
  type Span,
} from './coachDayLogic';
import { courtNameOf, lessonLabel } from './lessonLogic';
import type { DeskCoach, DeskLessons, ScheduleCoach } from './lessonPayloads';
import { StartLessonDialog } from './StartLessonDialog';
import { useCoachSchedule, useCoachSlots, useCoachingCaps, useDeskLessons, useLessonRead } from './useCoaching';

const BAND_STYLE: Record<BandKind, { background: string; border: string }> = {
  hours: { background: 'var(--tp-success-soft)', border: 'var(--tp-success)' },
  busy: { background: 'var(--tp-lesson)', border: 'var(--tp-lesson)' },
  off: { background: 'var(--tp-danger-soft)', border: 'var(--tp-danger)' },
};

interface BookCarry {
  coachId: string;
  typeId: string | null;
  startAt: Date;
}

export function CoachesBoardScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();

  const [date, setDate] = useState(() => todayInTz(VENUE_TZ));
  const night = useTradingNight(date);
  const { tz, settingsQ, courts } = night;
  const hours = settingsQ.data?.opening_hours;
  const tonight = settingsQ.data ? tonightInTz(tz, hours) : todayInTz(tz);
  // Open on the night trading now (at 00:40 that is yesterday's date), once.
  const anchored = useRef(false);
  useEffect(() => {
    if (!settingsQ.data || anchored.current) return;
    anchored.current = true;
    setDate(tonightInTz(settingsQ.data.timezone, settingsQ.data.opening_hours));
  }, [settingsQ.data]);

  const caps = useCoachingCaps();
  const lessonsQ = useDeskLessons(night.dayStart, night.dayEnd, settingsQ.isSuccess);
  const lessonsStatus = useLessonRead(lessonsQ);
  const desk = lessonsStatus.kind === 'ready' ? lessonsStatus.data : null;
  const scheduleQ = useCoachSchedule(night.dayStart, night.dayEnd, settingsQ.isSuccess);
  const scheduleStatus = useLessonRead(scheduleQ);
  const schedule = scheduleStatus.kind === 'ready' ? scheduleStatus.data : null;

  const span: Span = useMemo(
    () => ({
      fromMs: wallTimeToUtc(date, night.openMin, tz).getTime(),
      toMs: wallTimeToUtc(date, night.closeMin, tz).getTime(),
    }),
    [date, night.openMin, night.closeMin, tz],
  );
  const marks = useMemo(
    () => hourMarks(date, night.openMin, night.closeMin, tz, span),
    [date, night.openMin, night.closeMin, tz, span],
  );

  const privateTypes = (desk?.lesson_types ?? []).filter((t) => t.kind === 'private');
  const [typePick, setTypePick] = useState<string | null>(null);
  const [book, setBook] = useState<BookCarry | null>(null);

  const dayNoon = new Date(`${date}T12:00:00Z`);
  const empty = span.toMs <= span.fromMs;

  return (
    <>
      <PageHeader title={tr('ws.coaching.deskCoaches.title')} subtitle={tr('ws.coaching.deskCoaches.lead')} />
      <Toolbar
        end={
          privateTypes.length > 1 ? (
            <Select
              aria-label={tr('ws.coaching.deskCoaches.lessonType')}
              value={typePick ?? privateTypes[0]!.lesson_type_id}
              onChange={setTypePick}
              options={privateTypes.map((t) => ({
                value: t.lesson_type_id,
                label: pickName(locale, { name_en: t.name_en, name_ar: t.name_ar }),
              }))}
              style={{ inlineSize: 'auto' }}
            />
          ) : undefined
        }
      >
        <Button onClick={() => setDate(previousDate(date))} title={tr('ws.courtDesk.calendar.prev')}>
          ‹
        </Button>
        <DateField
          ariaLabel={tr('ws.courtDesk.common.date')}
          value={date}
          onChange={setDate}
          style={{ inlineSize: 'auto' }}
        />
        <Button onClick={() => setDate(nextDate(date))} title={tr('ws.courtDesk.calendar.next')}>
          ›
        </Button>
        <Button onClick={() => setDate(tonight)} disabled={date === tonight}>
          {tr('common.today')}
        </Button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 600 }}>
          <bdi>{`${formatWeekdayShort(dayNoon, locale, 'UTC')} · ${formatDate(dayNoon, locale, 'UTC')}`}</bdi>
          {date === tonight && <StatusBadge size="sm" tone="accent" label={tr('ws.courtDesk.calendar.tonight')} />}
        </span>
      </Toolbar>

      <Legend />

      {desk && !desk.coaching_enabled && (
        <MessagePresenter tone="info" icon="info" message={tr('ws.coaching.deskCoaches.off')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
      )}

      {!settingsQ.data || scheduleStatus.kind === 'loading' ? (
        <Skeleton lines={4} blockSize="4rem" />
      ) : scheduleStatus.kind === 'failed' || scheduleStatus.kind === 'absent' ? (
        <LessonReadNotice status={scheduleStatus} onRetry={() => void scheduleQ.refetch()} tz={tz} />
      ) : night.closed || empty ? (
        <EmptyState icon="calendar" title={tr('ws.coaching.deskCoaches.closed')} />
      ) : !schedule || schedule.coaches.length === 0 ? (
        <EmptyState icon="whistle" title={tr('ws.coaching.deskCoaches.none')} body={tr('ws.coaching.deskCoaches.noneBody')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)' }}>
          {scheduleStatus.stale && <LessonReadNotice status={scheduleStatus} onRetry={() => void scheduleQ.refetch()} tz={tz} compact />}
          {schedule.coaches.map((c) => (
            <CoachDay
              key={c.coach_id}
              coach={c}
              deskCoach={desk?.coaches.find((d) => d.coach_id === c.coach_id) ?? null}
              desk={desk}
              date={date}
              tz={tz}
              span={span}
              marks={marks}
              typePick={typePick}
              canBook={caps.runLessons && desk !== null}
              onBook={setBook}
              onOpenLesson={(id) => void navigate({ to: '/desk/lessons/$id', params: { id } })}
            />
          ))}
        </div>
      )}

      {book && desk && (
        <StartLessonDialog
          courtId={null}
          startAt={book.startAt}
          courts={courts}
          tz={tz}
          coachId={book.coachId}
          lessonTypeId={book.typeId}
          lessons={desk}
          lessonsAt={lessonsQ.dataUpdatedAt}
          onClose={() => setBook(null)}
        />
      )}
    </>
  );
}

function Legend() {
  const { tr } = useLocale();
  const items: { kind: BandKind; label: string }[] = [
    { kind: 'hours', label: tr('ws.coaching.deskCoaches.legend.hours') },
    { kind: 'busy', label: tr('ws.coaching.deskCoaches.legend.busy') },
    { kind: 'off', label: tr('ws.coaching.deskCoaches.legend.off') },
  ];
  return (
    <ul
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--tp-sp-4)',
        listStyle: 'none',
        padding: 0,
        margin: '0 0 var(--tp-sp-3)',
        fontSize: 'var(--tp-fs-sm)',
      }}
    >
      {items.map((i) => (
        <li key={i.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
          <span
            aria-hidden
            style={{
              inlineSize: '0.9rem',
              blockSize: '0.9rem',
              borderRadius: 'var(--tp-radius-sm)',
              background: BAND_STYLE[i.kind].background,
              border: `1px solid ${BAND_STYLE[i.kind].border}`,
            }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function CoachDay({
  coach,
  deskCoach,
  desk,
  date,
  tz,
  span,
  marks,
  typePick,
  canBook,
  onBook,
  onOpenLesson,
}: {
  coach: ScheduleCoach;
  deskCoach: DeskCoach | null;
  desk: DeskLessons | null;
  date: string;
  tz: string;
  span: Span;
  marks: { ms: number; at: number }[];
  typePick: string | null;
  canBook: boolean;
  onBook: (carry: BookCarry) => void;
  onOpenLesson: (lessonId: string) => void;
}) {
  const { tr, locale } = useLocale();
  const name = pickName(locale, { name_en: coach.display_name_en, name_ar: coach.display_name_ar });
  const paused = coach.status === 'paused';
  const bands = useMemo(() => coachBands(coach, date, tz, span), [coach, date, tz, span]);
  const works = worksInSpan(bands);
  const worksText = hoursIntervals(coach, date, tz)
    .filter((h) => h.toMs > span.fromMs && h.fromMs < span.toMs)
    .map((h) => formatTimeRange(new Date(h.fromMs), new Date(h.toMs), locale, tz))
    .join(', ');

  const type = desk && deskCoach ? typeForCoach(desk.lesson_types, deskCoach.lesson_type_ids, typePick) : null;
  const fromIso = new Date(span.fromMs).toISOString();
  const toIso = new Date(span.toMs).toISOString();
  const slotsQ = useCoachSlots(coach.coach_id, type?.lesson_type_id, fromIso, toIso, !paused && works && type !== null);
  const starts = slotsQ.data?.starts ?? [];
  const lessons = desk ? lessonsOfCoach(desk.lessons, coach.coach_id) : [];
  const time = (ms: number) => formatTime(new Date(ms), locale, tz);

  return (
    <Panel
      level={2}
      title={name}
      titleEnd={paused ? <StatusBadge size="sm" tone="warn" label={tr('ws.coaching.deskCoaches.paused')} /> : undefined}
      actions={
        canBook && !paused ? (
          <Button
            size="sm"
            icon="plus"
            onClick={() =>
              onBook({ coachId: coach.coach_id, typeId: null, startAt: new Date(Math.max(Date.now(), span.fromMs)) })
            }
          >
            {tr('ws.coaching.deskCoaches.newLesson')}
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)' }}>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {works ? tr('ws.coaching.deskCoaches.works', { times: worksText }) : tr('ws.coaching.deskCoaches.notWorking')}
        </p>

        <Timeline bands={bands} marks={marks} time={time} onOpenLesson={onOpenLesson} />

        {lessons.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-1)' }}>
            {lessons.map((l) => {
              const court = courtNameOf(l, locale);
              return (
                <li key={l.lesson_id}>
                  <Button size="sm" kind="ghost" onClick={() => onOpenLesson(l.lesson_id)}>
                    <bdi>{formatTimeRange(new Date(l.start_at), new Date(l.end_at), locale, tz)}</bdi>
                    {' · '}
                    {lessonLabel(l, locale, tr)}
                    {court ? ` · ${court}` : ''}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {paused ? null : !type ? (
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {desk ? tr('ws.coaching.deskCoaches.noPrivate') : ''}
          </p>
        ) : !works ? null : (
          <div>
            <p style={{ margin: '0 0 var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
              {tr('ws.coaching.deskCoaches.freeTimes', {
                type: isolate(pickName(locale, { name_en: type.name_en, name_ar: type.name_ar })),
              })}
            </p>
            {slotsQ.isLoading ? (
              <Skeleton lines={1} blockSize="2rem" />
            ) : slotsQ.isError ? (
              <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {tr('ws.coaching.start.slotsFailed')}
              </p>
            ) : starts.length === 0 ? (
              <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {tr('ws.coaching.deskCoaches.noFree')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)' }}>
                {starts.map((s) => (
                  <Button
                    key={s.start_at}
                    size="sm"
                    disabled={!canBook}
                    onClick={() =>
                      onBook({ coachId: coach.coach_id, typeId: type.lesson_type_id, startAt: new Date(s.start_at) })
                    }
                  >
                    {formatTime(new Date(s.start_at), locale, tz)}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Timeline({
  bands,
  marks,
  time,
  onOpenLesson,
}: {
  bands: readonly Band[];
  marks: readonly { ms: number; at: number }[];
  time: (ms: number) => string;
  onOpenLesson: (lessonId: string) => void;
}) {
  const { tr } = useLocale();
  // Every other hour labelled, so a long night stays readable.
  const labelled = marks.filter((_, i) => i % 2 === 0);
  return (
    <div>
      <div
        style={{
          position: 'relative',
          blockSize: '2rem',
          borderRadius: 'var(--tp-radius-sm)',
          background: 'var(--tp-surface-2)',
          border: '1px solid var(--tp-border)',
          overflow: 'hidden',
        }}
      >
        {marks.map((m) => (
          <span
            key={m.ms}
            aria-hidden
            style={{
              position: 'absolute',
              insetBlock: 0,
              insetInlineStart: `${m.at * 100}%`,
              borderInlineStart: '1px solid var(--tp-border)',
            }}
          />
        ))}
        {bands.map((b) => {
          const label = `${tr(`ws.coaching.deskCoaches.legend.${b.kind}`)} ${time(b.fromMs)}–${time(b.toMs)}`;
          const style = {
            position: 'absolute' as const,
            insetBlock: b.kind === 'hours' ? 0 : '0.3rem',
            insetInlineStart: `${b.start * 100}%`,
            inlineSize: `${b.size * 100}%`,
            background: BAND_STYLE[b.kind].background,
            border: `1px solid ${BAND_STYLE[b.kind].border}`,
            borderRadius: 'var(--tp-radius-sm)',
            boxSizing: 'border-box' as const,
            padding: 0,
          };
          return b.lessonId ? (
            <button
              key={`${b.kind}-${b.fromMs}`}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onOpenLesson(b.lessonId!)}
              style={{ ...style, cursor: 'pointer' }}
            />
          ) : (
            <span key={`${b.kind}-${b.fromMs}`} title={label} aria-label={label} role="img" style={style} />
          );
        })}
      </div>
      <div style={{ position: 'relative', blockSize: '1.1rem', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        {labelled.map((m) => (
          <span
            key={m.ms}
            style={{
              position: 'absolute',
              insetInlineStart: `${m.at * 100}%`,
              paddingInlineStart: '0.2rem',
              whiteSpace: 'nowrap',
              display: m.at > 0.92 ? 'none' : undefined,
            }}
          >
            <bdi>{time(m.ms)}</bdi>
          </span>
        ))}
      </div>
    </div>
  );
}
