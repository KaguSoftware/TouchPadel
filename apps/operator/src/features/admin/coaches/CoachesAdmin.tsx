/**
 * Setup › Coaches at `/admin/coaches` (docs/design/coaching/operator.md
 * §5.13): coaches, lesson types and hours at the rail's branch, one tab each,
 * bound to `?tab=` (route search `{tab, coach, promote, type}`,
 * routes/admin/coaches.tsx).
 *
 * One read, app.coaches_admin (`QK.coaching.admin(branch)`, 60 s while open).
 * A server without coaching (RPC_MISSING) shows the §5.5 empty state; with
 * coaching switched off at the branch an info line says guests see nothing
 * yet, and everything can still be set up. Every write is a direct
 * `appRpc('<name>', …)` at its call site, disabled offline (CD-6).
 *
 * `?coach=` opens that coach's editor (Coaches) or picks the coach (Hours);
 * `?promote=<customerId>` opens Make a coach with that customer picked (the
 * customer record's Make coach); `?type=` opens that lesson type.
 */
import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLocale } from '../../../lib/i18n';
import { useVenue } from '../../../lib/venue';
import { useStationReach } from '../../../lib/stationReach';
import { Button, Skeleton, Tabs } from '../../../components/ui';
import { EmptyState, MessagePresenter, PageHeader } from '../../../components/kit';
import { LessonReadNotice } from '../../coaching/LessonReadNotice';
import type { AdminCoach } from '../../coaching/lessonPayloads';
import { useCoachesAdmin, useCoachingCaps, useLessonRead } from '../../coaching/useCoaching';
import type { CoachesSearch, CoachesTab as TabId } from '../../../routes/admin/coaches';
import { CoachesTab } from './CoachesTab';
import type { TypesRefusal } from './CoachEditor';
import { CoachHoursTab } from './CoachHoursTab';
import { LessonTypesTab } from './LessonTypesTab';
import { PromoteCoachDialog, type PromoteSeed } from './PromoteCoachDialog';
import { newLessonTypeDraft, type LessonTypeDraft } from './lessonTypeLogic';

const K = 'ws.coaching.coachesAdmin';

export function CoachesAdmin() {
  const { tr } = useLocale();
  const { branchId } = useVenue();
  const navigate = useNavigate();
  const search = ((useSearch({ strict: false }) as CoachesSearch | undefined) ??
    {}) as CoachesSearch;
  const tab: TabId = search.tab ?? 'coaches';
  const caps = useCoachingCaps();
  const { reachable } = useStationReach();
  const q = useCoachesAdmin(branchId, { live: true });
  const status = useLessonRead(q);

  /** Make a coach opened from the button or "Make a coach again" (the record's opens by `?promote=`). */
  const [promoting, setPromoting] = useState<PromoteSeed | null>(null);
  /** A new lesson type (blank, or "Make a new lesson type…" prefilled). */
  const [newType, setNewType] = useState<LessonTypeDraft | null>(null);
  /** A promote whose lesson types were refused: the editor opens on the coach with the refusal. */
  const [typesRefusal, setTypesRefusal] = useState<TypesRefusal | null>(null);

  function go(next: CoachesSearch) {
    const clean: CoachesSearch = {};
    if (next.tab && next.tab !== 'coaches') clean.tab = next.tab;
    if (next.coach) clean.coach = next.coach;
    if (next.promote) clean.promote = next.promote;
    if (next.type) clean.type = next.type;
    void navigate({ to: '/admin/coaches', search: clean as never, replace: true });
  }

  const seed: PromoteSeed | null =
    promoting ??
    (search.promote ? { customerId: search.promote, customer: null, from: null } : null);

  function closePromote() {
    setPromoting(null);
    if (search.promote) go({ ...search, promote: undefined });
  }

  const data = status.kind === 'ready' ? status.data : null;

  const headerAction =
    !caps.manageCoaches || !data ? null : tab === 'coaches' ? (
      <Button
        kind="primary"
        icon="plus"
        onClick={() => setPromoting({ customerId: null, customer: null, from: null })}
      >
        {tr(`${K}.makeCoach`)}
      </Button>
    ) : tab === 'types' ? (
      <Button
        kind="primary"
        icon="plus"
        onClick={() => {
          setNewType(newLessonTypeDraft());
          go({ tab: 'types' });
        }}
      >
        {tr('ws.coaching.lessonTypes.newType')}
      </Button>
    ) : null;

  return (
    <div>
      <PageHeader title={tr(`${K}.title`)} subtitle={tr(`${K}.lead`)} actions={headerAction} />
      {status.kind === 'absent' ? (
        <EmptyState icon="whistle" title={tr('ws.coaching.offline.serverMissing')} />
      ) : (
        <>
          <Tabs<TabId>
            value={tab}
            onChange={(t) => go({ tab: t, coach: t === 'types' ? undefined : search.coach })}
            items={[
              { id: 'coaches', label: tr(`${K}.tabs.coaches`) },
              { id: 'types', label: tr(`${K}.tabs.types`) },
              { id: 'hours', label: tr(`${K}.tabs.hours`) },
            ]}
          />
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            {status.kind === 'loading' && <Skeleton lines={6} />}
            <LessonReadNotice status={status} onRetry={() => void q.refetch()} />
            {data && !data.coaching_enabled && (
              <MessagePresenter tone="info" icon="whistle" message={tr(`${K}.coachingOff`)} />
            )}
            {data && tab === 'coaches' && (
              <CoachesTab
                data={data}
                selectedId={search.coach ?? null}
                reachable={reachable}
                typesRefusal={typesRefusal}
                onSelect={(id) => {
                  if (id !== typesRefusal?.coachId) setTypesRefusal(null);
                  go({ tab: 'coaches', coach: id ?? undefined });
                }}
                onPromote={() => setPromoting({ customerId: null, customer: null, from: null })}
                onMakeAgain={(c: AdminCoach) =>
                  setPromoting({
                    customerId: c.profile_id,
                    customer: c.profile_id
                      ? { id: c.profile_id, name: c.full_name ?? '', phone: c.phone }
                      : null,
                    from: c,
                  })
                }
              />
            )}
            {data && tab === 'types' && (
              <LessonTypesTab
                data={data}
                selectedId={search.type ?? null}
                newDraft={newType}
                reachable={reachable}
                onSelect={(id) => {
                  setNewType(null);
                  go({ tab: 'types', type: id ?? undefined });
                }}
                onNewDraft={(draft) => {
                  setNewType(draft);
                  go({ tab: 'types' });
                }}
                onCreated={(id) => {
                  setNewType(null);
                  go({ tab: 'types', type: id ?? undefined });
                }}
              />
            )}
            {data && tab === 'hours' && (
              <CoachHoursTab
                data={data}
                coachId={search.coach ?? null}
                reachable={reachable}
                onPickCoach={(id) => go({ tab: 'hours', coach: id })}
              />
            )}
          </div>
        </>
      )}

      {seed && data && caps.manageCoaches && (
        <PromoteCoachDialog
          seed={seed}
          data={data}
          reachable={reachable}
          onClose={closePromote}
          onOpenCoach={(coachId) => {
            setPromoting(null);
            go({ tab: 'coaches', coach: coachId });
          }}
          onMade={(coachId, refusal) => {
            setPromoting(null);
            setTypesRefusal(refusal);
            go({ tab: 'coaches', coach: coachId ?? undefined });
          }}
        />
      )}
    </div>
  );
}
