/**
 * /admin/coaches › Lesson types (docs/design/coaching/operator.md §5.13.2):
 * the types at this branch grouped Private · Group · Course, and a sticky
 * editor beside them (LessonTypeEditor).
 *
 * A row: the name, the length, the places ("Up to 4 people" / "2–8 places",
 * a course's sessions), the price (or "No price yet") with the court share,
 * and the state: Draft, On sale, Off, plus "Price change in progress" while a
 * proposal is open (`pending_run`), linking to that run on /protocols.
 */
import { useNavigate } from '@tanstack/react-router';
import { formatIQD, formatNumber, isolateLtr } from '@touch/i18n';
import { pickName, useLocale } from '../../../lib/i18n';
import { Button } from '../../../components/ui';
import {
  DataTable,
  EmptyState,
  Money,
  StatusBadge,
  type Column,
  type Tone,
} from '../../../components/kit';
import { countOf } from '../../coaching/lessonLogic';
import {
  LESSON_KINDS,
  type AdminLessonType,
  type CoachesAdmin as CoachesAdminData,
} from '../../coaching/lessonPayloads';
import { useCoachingCaps } from '../../coaching/useCoaching';
import { LessonTypeEditor } from './LessonTypeEditor';
import {
  groupTypes,
  newLessonTypeDraft,
  typeState,
  type LessonTypeDraft,
  type LessonTypeState,
} from './lessonTypeLogic';

const T = 'ws.coaching.lessonTypes';

const STATE_TONE: Record<LessonTypeState, Tone> = {
  draft: 'neutral',
  onSale: 'success',
  off: 'neutral',
};

export function LessonTypesTab({
  data,
  selectedId,
  newDraft,
  reachable,
  onSelect,
  onNewDraft,
  onCreated,
}: {
  data: CoachesAdminData;
  selectedId: string | null;
  newDraft: LessonTypeDraft | null;
  reachable: boolean;
  onSelect: (typeId: string | null) => void;
  onNewDraft: (draft: LessonTypeDraft) => void;
  onCreated: (typeId: string | null) => void;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const caps = useCoachingCaps();
  const groups = groupTypes(data.lesson_types);
  const selected = data.lesson_types.find((t) => t.lesson_type_id === selectedId) ?? null;
  const editing = selected !== null || newDraft !== null;
  const n = (v: number | null) => (v == null ? '—' : isolateLtr(formatNumber(v, locale)));

  const places = (t: AdminLessonType) => {
    if (t.kind === 'private') return tr(`${T}.upTo`, { count: n(t.max_places) });
    const range = tr(`${T}.placesRange`, { min: n(t.min_places), max: n(t.max_places) });
    return t.kind === 'course' && t.sessions_count != null
      ? `${range} · ${countOf('sessions', t.sessions_count, locale)}`
      : range;
  };

  const columns: Column<AdminLessonType>[] = [
    {
      key: 'name',
      header: tr(`${T}.columns.name`),
      render: (t) => <bdi style={{ fontWeight: 600 }}>{pickName(locale, t)}</bdi>,
    },
    ...(editing
      ? []
      : ([
          {
            key: 'length',
            header: tr(`${T}.columns.length`),
            render: (t) =>
              t.duration_min == null
                ? '—'
                : tr('ws.coaching.common.minutes', {
                    minutes: formatNumber(t.duration_min, locale),
                  }),
          },
          {
            key: 'places',
            header: tr(`${T}.columns.places`),
            render: (t) => <bdi>{places(t)}</bdi>,
          },
          {
            key: 'price',
            header: tr(`${T}.columns.price`),
            render: (t) => (
              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
                {t.price_iqd == null ? (
                  <span style={{ color: 'var(--tp-muted-fg)' }}>{tr(`${T}.noPrice`)}</span>
                ) : (
                  <Money amount={t.price_iqd} />
                )}
                {t.court_share_iqd != null && t.court_share_iqd > 0 && (
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                    {tr(`${T}.courtShare`, { amount: formatIQD(t.court_share_iqd, locale) })}
                  </span>
                )}
              </span>
            ),
          },
        ] satisfies Column<AdminLessonType>[])),
    {
      key: 'state',
      header: tr(`${T}.columns.state`),
      render: (t) => {
        const state = typeState(t);
        return (
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--tp-sp-1)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <StatusBadge size="sm" tone={STATE_TONE[state]} label={tr(`${T}.state.${state}`)} />
            {t.pending_run && (
              <Button
                size="sm"
                kind="ghost"
                iconEnd="arrowUpRight"
                onClick={() =>
                  void navigate({
                    to: '/protocols',
                    search: { run: t.pending_run!.run_id } as never,
                  })
                }
              >
                {tr(`${T}.pending`)}
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  const empty = data.lesson_types.length === 0;

  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-4)',
        gridTemplateColumns: editing ? 'minmax(0, 1fr) minmax(22rem, 30rem)' : 'minmax(0, 1fr)',
        alignItems: 'start',
      }}
    >
      <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {empty ? (
          <EmptyState
            icon="whistle"
            title={tr(`${T}.emptyTitle`)}
            body={tr(`${T}.emptyBody`)}
            action={
              caps.manageCoaches ? (
                <Button kind="primary" icon="plus" onClick={() => onNewDraft(newLessonTypeDraft())}>
                  {tr(`${T}.newType`)}
                </Button>
              ) : undefined
            }
          />
        ) : (
          LESSON_KINDS.filter((k) => groups[k].length > 0).map((k) => (
            <section
              key={k}
              aria-label={tr(`${T}.groups.${k}`)}
              style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 'var(--tp-fs-sm)',
                  fontWeight: 700,
                  color: 'var(--tp-muted-fg)',
                }}
              >
                {tr(`${T}.groups.${k}`)}
              </h3>
              <DataTable
                columns={columns}
                rows={groups[k]}
                rowKey={(t) => t.lesson_type_id}
                selectedKey={selected?.lesson_type_id ?? null}
                onRowClick={(t) => onSelect(t.lesson_type_id)}
                aria-label={tr(`${T}.groups.${k}`)}
              />
            </section>
          ))
        )}
      </div>
      {editing && (
        <LessonTypeEditor
          key={selected?.lesson_type_id ?? 'new'}
          type={selected}
          seed={selected ? null : newDraft}
          data={data}
          reachable={reachable}
          onClose={() => onSelect(null)}
          onCreated={onCreated}
          onMakeNew={onNewDraft}
        />
      )}
    </div>
  );
}
