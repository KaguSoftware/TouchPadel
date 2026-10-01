/**
 * "Lesson refunds due" on Ops (docs/design/coaching/operator.md §5.17; R36,
 * R62, R75): desk money for lessons that were cancelled or left, at the
 * branch the rail shows (app.lesson_refunds_due, oldest lesson first). Gated
 * `permissionsFor().refund` (manager, owner).
 *
 * A row says who (the student as recorded, R44, and the phone), which lesson
 * (time, kind, coach, Open lesson), and for each payment what was paid and
 * how, what went back so far and what is due at the desk, with **Refund**
 * (the till's RefundDialog capped at the due, the goodwill switch lifting it,
 * features/coaching/LessonRefundsDue.tsx). A guest leaving a course says so
 * (C-23); a share Qi could not refund (`online_blocked_iqd`) says it needs
 * attention, links the online refunds panel and offers Record the handback.
 *
 * Mounted `hideWhenEmpty` on Today after the player reports: nothing while
 * nothing is due, and nothing on a server without coaching (RPC_MISSING). A
 * failed first read says so with Retry (§5.5).
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatIQD, VENUE_TZ } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { QK, fetchVenueSettings } from '../../lib/queries';
import { currentBranchId } from '../../lib/venueScope';
import { Button, Skeleton } from '../../components/ui';
import { EmptyState, Money, Panel } from '../../components/kit';
import { LessonBadge } from '../coaching/LessonBadge';
import { LessonReadNotice } from '../coaching/LessonReadNotice';
import { OnlineBlockedLine, RefundDueButton } from '../coaching/LessonRefundsDue';
import type { RefundDueItem } from '../coaching/lessonPayloads';
import { deskDueOf, isCourseLeave, methodWord, refundLabel } from '../coaching/lessonScreenLogic';
import { useCoachingCaps, useLessonRead, useRefundsDue } from '../coaching/useCoaching';
import { CardTitle } from './OpsVisuals';

const K = 'ws.coaching.lessonRefunds';

/** Whether the panel shows: a failed read always; on Today only once something is due. */
export function showLessonRefunds(opts: {
  rows: number | null;
  hideWhenEmpty: boolean;
  failed: boolean;
}): boolean {
  if (opts.failed) return true;
  if (opts.rows === null) return !opts.hideWhenEmpty;
  return opts.rows > 0 || !opts.hideWhenEmpty;
}

export function LessonRefundsDuePanel({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const { tr } = useLocale();
  const caps = useCoachingCaps();
  const branch = currentBranchId();
  const q = useRefundsDue(branch, caps.refund);
  const status = useLessonRead(q);
  const settingsQ = useQuery({
    queryKey: QK.venueSettings,
    queryFn: fetchVenueSettings,
    staleTime: 5 * 60_000,
  });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;

  if (!caps.refund || status.kind === 'absent') return null;
  const data = status.kind === 'ready' ? status.data : null;
  const rows = data?.items ?? null;
  if (
    !showLessonRefunds({
      rows: rows ? rows.length : null,
      hideWhenEmpty,
      failed: status.kind === 'failed',
    })
  )
    return null;

  return (
    <Panel
      title={<CardTitle icon="whistle">{tr(`${K}.title`)}</CardTitle>}
      actions={
        data && data.total_iqd !== null ? (
          <span aria-label={tr(`${K}.total`)} style={{ fontWeight: 700 }}>
            <Money amount={data.total_iqd} />
          </span>
        ) : undefined
      }
      data-testid="lesson-refunds"
    >
      <p
        style={{
          fontSize: 'var(--tp-fs-sm)',
          color: 'var(--tp-muted-fg)',
          marginBlockEnd: 'var(--tp-sp-2)',
          maxInlineSize: '70ch',
        }}
      >
        {tr(`${K}.lead`)}
      </p>
      {status.kind === 'loading' && <Skeleton lines={3} blockSize="1.4rem" />}
      <LessonReadNotice status={status} onRetry={() => void q.refetch()} tz={tz} />
      {rows && rows.length === 0 && (
        <EmptyState
          compact
          icon="checkCircle"
          kind="nothingToDo"
          title={tr(`${K}.empty`)}
          titleAs="h3"
        />
      )}
      {rows && rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
          {rows.map((item) => (
            <RefundRow key={item.enrolment_id} item={item} tz={tz} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RefundRow({ item, tz }: { item: RefundDueItem; tz: string }) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const iqd = (n: number | null) => (n === null ? '—' : formatIQD(n, locale));
  const coach = pickName(locale, {
    name_en: item.coach_name_en ?? '',
    name_ar: item.coach_name_ar ?? '',
  });
  const due = deskDueOf(item);
  const lessonId = item.lesson_id;
  return (
    <li
      data-testid="lesson-refund"
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        paddingBlock: 'var(--tp-sp-3)',
        borderBlockEnd: '1px solid var(--tp-border)',
      }}
    >
      <div
        style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <strong>
          <bdi>{refundLabel(item, tr)}</bdi>
        </strong>
        {item.phone && (
          <bdi
            dir="ltr"
            style={{
              fontSize: 'var(--tp-fs-sm)',
              color: 'var(--tp-muted-fg)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {item.phone}
          </bdi>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--tp-sp-2)',
          alignItems: 'center',
          flexWrap: 'wrap',
          fontSize: 'var(--tp-fs-sm)',
        }}
      >
        {item.start_at && (
          <bdi style={{ color: 'var(--tp-muted-fg)' }}>
            {formatDateTime(new Date(item.start_at), locale, tz)}
          </bdi>
        )}
        <LessonBadge kind={item.kind} />
        {coach && <bdi style={{ color: 'var(--tp-muted-fg)' }}>{coach}</bdi>}
        {lessonId && (
          <Button
            size="sm"
            kind="ghost"
            icon="whistle"
            iconEnd="arrowUpRight"
            onClick={() => void navigate({ to: '/desk/lessons/$id', params: { id: lessonId } })}
          >
            {tr('ws.coaching.common.openLesson')}
          </Button>
        )}
      </div>

      {item.payments.map((p) => (
        <div
          key={p.payment_id}
          style={{
            display: 'flex',
            gap: 'var(--tp-sp-3)',
            alignItems: 'center',
            flexWrap: 'wrap',
            fontSize: 'var(--tp-fs-sm)',
          }}
        >
          <span>
            {tr(`${K}.paid`, { amount: iqd(p.amount_iqd), method: methodWord(p.method, tr) })}
          </span>
          <span style={{ color: 'var(--tp-muted-fg)' }}>
            {tr(`${K}.refundedSoFar`, { amount: iqd(p.refunded_iqd ?? 0) })}
          </span>
          {due > 0 && (p.refundable_iqd === null || p.refundable_iqd > 0) && (
            <RefundDueButton item={item} payment={p} />
          )}
        </div>
      ))}

      <span
        style={{ fontWeight: 600, color: due > 0 ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)' }}
      >
        {tr(`${K}.due`, { amount: iqd(item.refund_due_desk_iqd) })}
      </span>
      {isCourseLeave(item) && (
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.coaching.refunds.courseLeave')}
        </span>
      )}
      <OnlineBlockedLine item={item} />
    </li>
  );
}
