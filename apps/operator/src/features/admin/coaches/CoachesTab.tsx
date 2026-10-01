/**
 * /admin/coaches › Coaches (docs/design/coaching/operator.md §5.13.1): the
 * CourtsAdmin shape, a list and a sticky editor beside it.
 *
 * A row: the photo, the display name in the screen's language, the status
 * (Active / Paused / Retired), "Waiting for the coach to accept" while the
 * coach has not accepted a public profile (C-22, R61), "Account deleted"
 * (R63), branches, lesson types here, upcoming lessons, and "No hours yet".
 * Retired coaches fold behind "Show retired coaches".
 */
import { useState } from 'react';
import { formatNumber, isolateLtr } from '@touch/i18n';
import { useLocale } from '../../../lib/i18n';
import { Button } from '../../../components/ui';
import { DataTable, EmptyState, StatusBadge, type Column } from '../../../components/kit';
import type { AdminCoach, CoachesAdmin as CoachesAdminData } from '../../coaching/lessonPayloads';
import { useCoachingCaps } from '../../coaching/useCoaching';
import { CoachBadges, CoachEditor, CoachPhoto, type TypesRefusal } from './CoachEditor';
import { coachName, splitRetired } from './coachesLogic';

const K = 'ws.coaching.coachesAdmin';

export function CoachesTab({
  data,
  selectedId,
  reachable,
  typesRefusal,
  onSelect,
  onPromote,
  onMakeAgain,
}: {
  data: CoachesAdminData;
  selectedId: string | null;
  reachable: boolean;
  typesRefusal: TypesRefusal | null;
  onSelect: (coachId: string | null) => void;
  onPromote: () => void;
  onMakeAgain: (c: AdminCoach) => void;
}) {
  const { tr, locale } = useLocale();
  const caps = useCoachingCaps();
  const [showRetired, setShowRetired] = useState(false);
  const { current, retired } = splitRetired(data.coaches);
  const selected = data.coaches.find((c) => c.coach_id === selectedId) ?? null;
  // The coach being edited stays listed even when retired and folded.
  const rows = showRetired
    ? [...current, ...retired]
    : [...current, ...retired.filter((c) => c.coach_id === selected?.coach_id)];
  const open = selected !== null;
  const n = (v: number | null | undefined) => isolateLtr(formatNumber(v ?? 0, locale));

  const columns: Column<AdminCoach>[] = [
    {
      key: 'photo',
      header: <span className="tp-sr-only">{tr(`${K}.columns.photo`)}</span>,
      width: '3.5rem',
      render: (c) => <CoachPhoto path={c.photo_path} name={coachName(c, locale)} />,
    },
    {
      key: 'coach',
      header: tr(`${K}.columns.coach`),
      render: (c) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi
            style={{
              fontWeight: 600,
              color: c.status === 'retired' ? 'var(--tp-muted-fg)' : undefined,
            }}
          >
            {coachName(c, locale)}
          </bdi>
          {!open && <CoachBadges coach={c} />}
        </span>
      ),
    },
    ...(open
      ? []
      : ([
          {
            key: 'here',
            header: tr(`${K}.columns.here`),
            render: (c) => (
              <span
                style={{
                  display: 'flex',
                  gap: 'var(--tp-sp-2)',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  fontSize: 'var(--tp-fs-sm)',
                  color: 'var(--tp-muted-fg)',
                }}
              >
                <span>{tr(`${K}.branchesCount`, { count: n(c.venue_ids.length) })}</span>
                <span>{tr(`${K}.typesCount`, { count: n(c.lesson_type_ids.length) })}</span>
                <span>{tr(`${K}.upcomingCount`, { count: n(c.upcoming_lessons) })}</span>
                {c.status !== 'retired' && c.hours.length === 0 && (
                  <StatusBadge size="sm" tone="warn" label={tr(`${K}.noHours`)} />
                )}
              </span>
            ),
          },
          {
            key: 'actions',
            header: <span className="tp-sr-only">{tr(`${K}.columns.actions`)}</span>,
            align: 'end',
            width: '6rem',
            render: (c) => (
              <Button
                size="sm"
                icon="note"
                aria-label={`${tr(`${K}.open`)}: ${coachName(c, locale)}`}
                onClick={() => onSelect(c.coach_id)}
              >
                {tr(`${K}.open`)}
              </Button>
            ),
          },
        ] satisfies Column<AdminCoach>[])),
    ...(open
      ? ([
          {
            key: 'status',
            header: tr(`${K}.columns.status`),
            render: (c) => <CoachBadges coach={c} />,
          },
        ] satisfies Column<AdminCoach>[])
      : []),
  ];

  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-4)',
        gridTemplateColumns: open ? 'minmax(0, 1fr) minmax(22rem, 30rem)' : 'minmax(0, 1fr)',
        alignItems: 'start',
      }}
    >
      <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {data.coaches.length === 0 ? (
          <EmptyState
            icon="whistle"
            title={tr(`${K}.emptyTitle`)}
            body={tr(`${K}.emptyBody`)}
            action={
              caps.manageCoaches ? (
                <Button kind="primary" icon="plus" onClick={onPromote}>
                  {tr(`${K}.makeCoach`)}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(c) => c.coach_id}
              selectedKey={selected?.coach_id ?? null}
              onRowClick={(c) => onSelect(c.coach_id)}
              aria-label={tr(`${K}.title`)}
            />
            {retired.length > 0 && (
              <div style={{ display: 'flex' }}>
                <Button
                  size="sm"
                  kind="ghost"
                  style={{ marginInlineStart: 'auto' }}
                  onClick={() => setShowRetired((v) => !v)}
                >
                  {showRetired
                    ? tr(`${K}.hideRetired`)
                    : tr(`${K}.showRetired`, { count: n(retired.length) })}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {selected && (
        <CoachEditor
          key={selected.coach_id}
          coach={selected}
          data={data}
          reachable={reachable}
          typesRefusal={typesRefusal?.coachId === selected.coach_id ? typesRefusal : null}
          onClose={() => onSelect(null)}
          onMakeAgain={() => onMakeAgain(selected)}
        />
      )}
    </div>
  );
}
