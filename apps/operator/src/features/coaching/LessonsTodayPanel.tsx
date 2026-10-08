/**
 * The Today board's "Lessons today" group (docs/design/coaching/operator.md
 * §5.11): the night's lessons by start, each with its time and court, kind,
 * what it is (type, coach, and a private lesson's booker), places, what is
 * still to pay, and its tags. Pure presentation: data in, events out.
 *
 * States:
 *  - coaching off, none listed: hidden (the booking dialog's Lesson kind
 *    still stages one, R51);
 *  - coaching off, some listed: the rows, New lesson, and a line saying
 *    lessons already booked carry on;
 *  - coaching on, none tonight: "No lessons today" and New lesson;
 *  - a failed first read: the §5.5 notice with Retry; RPC_MISSING: hidden.
 *
 * Every write it leads to is online only (CD-6): offline, New lesson stays on
 * screen, disabled, with the reason. Take payment opens the lesson: the
 * envelope does not carry enrolment ids, so the lesson screen picks the
 * sign-up (`?pay=` needs one).
 */
import type { ReactNode } from 'react';
import {
  formatNumber,
  formatTime,
  formatTimeRange,
  isolate,
  type Locale,
  type MessageKey,
} from '@touch/i18n';
import { Button } from '../../components/ui';
import { Panel, StatusBadge, ViewMore, useListCap, type Tone } from '../../components/kit';
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';
import { LessonBadge } from './LessonBadge';
import { LessonPayCell } from './LessonPayCell';
import { LessonReadNotice } from './LessonReadNotice';
import {
  coachNameOf,
  courseTitleOf,
  courtNameOf,
  lessonPayState,
  lessonPlacesChip,
  lessonTags,
  placesChipText,
  typeNameOf,
  type LessonTag,
  type Tr,
} from './lessonLogic';
import type { DeskLesson, DeskLessons } from './lessonPayloads';
import type { LessonReadStatus } from './useCoaching';

export interface LessonsTodayPanelProps {
  status: LessonReadStatus<DeskLessons>;
  tz: string;
  /** The payload's clock (`nowOf(server_now, elapsed)`): pay warnings, tags. */
  nowMs: number;
  /** CAPABILITY_ROLES.runLessons: New lesson. */
  runLessons: boolean;
  /** CAPABILITY_ROLES.takeLessonPayment: Take payment on a row that owes. */
  takeLessonPayment: boolean;
  /** The station reaches the server (lib/stationReach): every coaching write is online only. */
  reachable: boolean;
  onOpenLesson: (lessonId: string) => void;
  onPayLesson: (lessonId: string) => void;
  onNewLesson: () => void;
  onRetry: () => void;
}

const TAG_TONE: Record<LessonTag['id'], Tone> = {
  needsMore: 'warn',
  awaitingOnline: 'info',
  startsIn: 'neutral',
  coachUnpaid: 'warn',
};

function tagText(tag: LessonTag, tr: Tr, locale: Locale, tz: string): string {
  switch (tag.id) {
    case 'needsMore':
      return tr('ws.coaching.common.tags.needsMore', {
        count: formatNumber(tag.short, locale),
        time: formatTime(new Date(tag.cutoffAt), locale, tz),
      });
    case 'awaitingOnline':
      return tr('ws.coaching.common.tags.awaitingOnline');
    case 'startsIn':
      return tr('ws.coaching.common.tags.startsIn', { minutes: formatNumber(tag.minutes, locale) });
    case 'coachUnpaid':
      return tr('ws.coaching.common.pay.coachBookedUnpaid');
  }
}

/** "{type} · {coach}", a course's title for its type, a private lesson's booker after. */
export function lessonWhat(lesson: DeskLesson, locale: Locale, tr: Tr): string {
  const type = typeNameOf(lesson, locale) || tr(`ws.coaching.common.kind.${lesson.kind}`);
  const what = lesson.kind === 'course' ? courseTitleOf(lesson.course, type, locale) : type;
  const coach = coachNameOf(lesson, locale);
  // Names inside the line are isolated, so an Arabic name in an English line keeps its order.
  const parts = [what, coach.trim() ? isolate(coach) : ''];
  if (lesson.kind === 'private' && lesson.label?.trim()) parts.push(isolate(lesson.label));
  return parts.filter((p) => p !== '').join(' · ');
}

export function LessonsTodayPanel(p: LessonsTodayPanelProps) {
  const { tr, locale } = useLocale();
  const title: MessageKey = 'ws.coaching.today.title';
  const heading = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <Icon name="whistle" size={16} style={{ color: 'var(--tp-muted-fg)' }} />
      {tr(title)}
    </span>
  );
  const offline = p.reachable ? undefined : tr('ws.coaching.offline.needsConnection');
  // Sorted before the early returns so the cap hook runs on every render.
  const rows =
    p.status.kind === 'ready'
      ? [...p.status.data.lessons].sort((a, b) => a.start_at.localeCompare(b.start_at))
      : [];
  const cap = useListCap(rows);

  if (p.status.kind === 'failed') {
    return (
      <Panel title={heading}>
        <LessonReadNotice status={p.status} onRetry={p.onRetry} tz={p.tz} />
      </Panel>
    );
  }
  if (p.status.kind !== 'ready') return null;

  const enabled = p.status.data.coaching_enabled;
  if (!enabled && rows.length === 0) return null;

  const newLesson = p.runLessons ? (
    <Button
      size="sm"
      kind="primary"
      icon="plus"
      disabled={!p.reachable}
      disabledReason={offline}
      onClick={p.onNewLesson}
    >
      {tr('ws.coaching.common.newLesson')}
    </Button>
  ) : undefined;

  return (
    <Panel title={heading} actions={newLesson}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <LessonReadNotice status={p.status} onRetry={p.onRetry} tz={p.tz} compact />
        {!enabled && (
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('ws.coaching.today.off')}
          </p>
        )}
        {rows.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.coaching.today.none')}</p>
        ) : (
          <ul
            aria-label={tr(title)}
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 'var(--tp-sp-2)',
            }}
          >
            {cap.shown.map((lesson) => {
              const when = tr('ws.coaching.today.when', {
                time: formatTimeRange(
                  new Date(lesson.start_at),
                  new Date(lesson.end_at),
                  locale,
                  p.tz,
                ),
                court: courtNameOf(lesson, locale) || '—',
              });
              const what = lessonWhat(lesson, locale, tr);
              const chip = lessonPlacesChip(lesson);
              const owes = lessonPayState(lesson, p.nowMs).owing > 0;
              const tags = lessonTags(lesson, p.nowMs);
              return (
                <li
                  key={lesson.lesson_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--tp-sp-3)',
                    flexWrap: 'wrap',
                    paddingBlock: 'var(--tp-sp-2)',
                    paddingInline: 'var(--tp-sp-3)',
                    borderRadius: 'var(--tp-radius-ctl)',
                    background: 'var(--tp-surface-2)',
                    borderInlineStart: '3px solid var(--tp-lesson)',
                  }}
                >
                  <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: '10rem' }}>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <bdi>{when}</bdi>
                    </strong>
                    <span>
                      <LessonBadge kind={lesson.kind} held={lesson.status === 'held'} />
                    </span>
                  </span>
                  <span
                    style={{
                      display: 'grid',
                      gap: 'var(--tp-sp-0)',
                      flex: '1 1 14rem',
                      minInlineSize: 0,
                    }}
                  >
                    <strong>
                      <bdi>{what}</bdi>
                    </strong>
                    <span
                      style={{
                        display: 'inline-flex',
                        gap: 'var(--tp-sp-1) var(--tp-sp-3)',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        fontSize: 'var(--tp-fs-sm)',
                        color: 'var(--tp-muted-fg)',
                      }}
                    >
                      {chip?.kind === 'places' && (
                        <Figure>
                          {tr('ws.coaching.common.places', {
                            taken: formatNumber(chip.taken, locale),
                            total: formatNumber(chip.total, locale),
                          })}
                        </Figure>
                      )}
                      {chip?.kind === 'party' && <Figure>{placesChipText(chip, locale)}</Figure>}
                      <LessonPayCell lesson={lesson} nowMs={p.nowMs} showCoachFlag={false} />
                    </span>
                    {tags.length > 0 && (
                      <span
                        style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}
                      >
                        {tags.map((tag) => (
                          <StatusBadge
                            key={tag.id}
                            size="sm"
                            tone={TAG_TONE[tag.id]}
                            label={tagText(tag, tr, locale, p.tz)}
                          />
                        ))}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      gap: 'var(--tp-sp-2)',
                      alignItems: 'center',
                      marginInlineStart: 'auto',
                    }}
                  >
                    {p.takeLessonPayment && owes && (
                      <Button
                        size="sm"
                        icon="banknote"
                        onClick={() => p.onPayLesson(lesson.lesson_id)}
                        aria-label={`${tr('ws.coaching.common.take.button')} ${what}`}
                      >
                        {tr('ws.coaching.common.take.button')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      kind="ghost"
                      iconEnd="chevronEnd"
                      onClick={() => p.onOpenLesson(lesson.lesson_id)}
                      aria-label={`${tr('ws.coaching.today.open')} ${what}`}
                    >
                      {tr('ws.coaching.today.open')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <ViewMore
          hidden={cap.hidden}
          open={cap.open}
          onToggle={cap.toggle}
          style={{ marginBlockStart: 0 }}
        />
      </div>
    </Panel>
  );
}

function Figure({ children }: { children: ReactNode }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{children}</span>;
}
