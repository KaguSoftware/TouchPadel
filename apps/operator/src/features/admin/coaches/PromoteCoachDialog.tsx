/**
 * Make a coach (docs/design/coaching/operator.md §5.13.1; C-7, C-22, R43):
 * an existing guest account becomes a coach.
 *
 * Opened by the header button, by "Make a coach again" on a retired coach, or
 * by `?promote=<customerId>` from the customer record (the customer is read
 * once and picked). The account's own name and phone are shown to staff and
 * never labelled public: guests see the display names typed here. The photo
 * uploads to a fresh random folder (`ImageField folder="coaches"` with no
 * owner id; lib/storage.ts mints `coaches/<uuid>/<uuid>.<ext>`, R43).
 *
 * **Make coach** sends `coach_promote`, then `set_coach_lesson_types` when
 * types were ticked. If the second call is refused the coach exists anyway:
 * the editor opens on them with the refusal beside the types. The types are
 * this branch's, so they can be ticked only while this branch is (OP-09):
 * unticking it clears them and no types call is made, so a refusal always
 * has the editor (the coach is listed here) to show it.
 *
 * Only the branches this screen shows (the caller's own) are offered and sent:
 * "Make a coach again" leaves the retired coach's other branches to their
 * managers (OP-03), and says so.
 * `ALREADY_COACH` offers "Open {name}" when that coach is on this screen.
 *
 * A stepped wizard (Sait, 2026-10-22): the guest account, the profile guests
 * see, the branches and lesson types, then Review, where Make coach is sent.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { countPhrase, isolate } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { pickName, useLocale } from '../../../lib/i18n';
import { removeMedia } from '../../../lib/storage';
import { useVenue } from '../../../lib/venue';
import { currentBranchId } from '../../../lib/venueScope';
import { useToast } from '../../../components/toast';
import { Button } from '../../../components/ui';
import { ReviewList, StepWizard, WizardChecks, WizardNote } from '../../../components/StepWizard';
import { errorToMessageKey } from '../../../lib/errors';
import { BilingualFields } from '../../../components/inputs';
import { ImageField } from '../../../components/ImageField';
import { CustomerPicker } from '../../desk/customers/CustomerPicker';
import { coachingErrorText } from '../../coaching/lessonLogic';
import {
  obj,
  readPromoted,
  str,
  type AdminCoach,
  type CoachesAdmin as CoachesAdminData,
} from '../../coaching/lessonPayloads';
import { invalidateCoachesAdmin } from '../../coaching/useCoaching';
import type { TypesRefusal } from './CoachEditor';
import {
  COACH_LIMITS,
  coachName,
  newPromoteDraft,
  promoteArgs,
  promoteProblems,
  toggleId,
  type PromoteCustomer,
  type PromoteDraft,
} from './coachesLogic';

const P = 'ws.coaching.coachesAdmin.promote';

export interface PromoteSeed {
  /** `?promote=<customerId>` or a retired coach's account: read, then picked. */
  customerId: string | null;
  /** Already known (Make a coach again): picked straight away. */
  customer: PromoteCustomer | null;
  /** Make a coach again: the retired coach whose names and branches come back. */
  from: AdminCoach | null;
}

/** The customer the record's `customer_record` answer names, for `?promote=`. */
function customerOf(raw: unknown): PromoteCustomer | null {
  const c = obj(obj(raw)?.customer);
  const id = c ? str(c.id) : null;
  return c && id ? { id, name: str(c.full_name) ?? '', phone: str(c.phone) } : null;
}

export function PromoteCoachDialog({
  seed,
  data,
  reachable,
  onClose,
  onOpenCoach,
  onMade,
}: {
  seed: PromoteSeed;
  data: CoachesAdminData;
  reachable: boolean;
  onClose: () => void;
  onOpenCoach: (coachId: string) => void;
  onMade: (coachId: string | null, refusal: TypesRefusal | null) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { branchId, venues } = useVenue();
  const shownIds = venues.map((v) => v.id);
  const [draft, setDraft] = useState<PromoteDraft>(() =>
    newPromoteDraft(branchId, seed.customer, seed.from, shownIds),
  );
  // OP-03: the retired coach's branches this screen can't show are left to their managers.
  const otherBranches = (seed.from?.venue_ids ?? []).some((id) => !shownIds.includes(id));
  // OP-09: the lesson types are this branch's; they apply only while it is ticked.
  const railTicked = !!branchId && draft.venueIds.includes(branchId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (p: Partial<PromoteDraft>) => setDraft((d) => ({ ...d, ...p }));

  // ?promote=<customerId>: the record's customer, read once and picked.
  const lookup = useQuery({
    queryKey: ['customer', seed.customerId ?? ''],
    enabled: !!seed.customerId && !seed.customer,
    queryFn: () => appRpc('customer_record', { p_customer_id: seed.customerId }),
  });
  const looked = customerOf(lookup.data);
  useEffect(() => {
    if (looked && !draft.customer) setDraft((d) => (d.customer ? d : { ...d, customer: looked }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looked?.id]);

  const problems = promoteProblems(draft);
  const existing =
    error instanceof AppRpcError && error.code === 'ALREADY_COACH'
      ? (data.coaches.find((c) => c.profile_id === draft.customer?.id) ?? null)
      : null;

  async function submit() {
    if (problems.length > 0 || !reachable) return;
    setBusy(true);
    setError(null);
    try {
      const out = readPromoted(await appRpc('coach_promote', promoteArgs(draft, shownIds)));
      let refusal: TypesRefusal | null = null;
      if (out.coach_id && railTicked && draft.typeIds.length > 0) {
        try {
          await appRpc('set_coach_lesson_types', {
            p_coach_id: out.coach_id,
            p_venue_id: currentBranchId(),
            p_lesson_type_ids: draft.typeIds,
          });
        } catch (e) {
          // The coach exists: the editor opens on them with this refusal beside the types.
          refusal = { coachId: out.coach_id, error: e, typeIds: draft.typeIds };
        }
      }
      invalidateCoachesAdmin(qc, branchId);
      toast.ok(
        tr(`${P}.made`, {
          name: isolate(locale === 'ar' ? draft.nameAr.trim() : draft.nameEn.trim()),
        }),
      );
      onMade(out.coach_id, refusal);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    // A photo uploaded and never saved is nobody's: remove it (R43; best effort).
    if (draft.photo) void removeMedia(draft.photo);
    onClose();
  }

  const problemLine = (p: string) =>
    p === 'account'
      ? tr(`${P}.needAccount`)
      : p === 'names'
        ? tr(`${P}.needNames`)
        : tr(`${P}.needBranch`);

  const shownNames = (locale === 'ar' ? draft.nameAr : draft.nameEn).trim() || (draft.nameEn || draft.nameAr).trim();
  const pickedBranches = venues.filter((v) => draft.venueIds.includes(v.id));
  const pickedTypes = data.lesson_types.filter((t) => draft.typeIds.includes(t.lesson_type_id));
  const list = (names: string[]) => (names.length ? <bdi>{names.join(locale === 'ar' ? '، ' : ', ')}</bdi> : '—');

  return (
    <StepWizard
      title={tr(`${P}.title`)}
      lead={tr(`${P}.lead`)}
      testId="promote-coach"
      onClose={cancel}
      busy={busy}
      submitLabel={tr(`${P}.submit`)}
      onSubmit={() => void submit()}
      submitBlocked={reachable ? null : tr('ws.coaching.offline.needsConnection')}
      notice={
        error || lookup.isError ? (
          <>
            {error != null && <WizardNote tone={error instanceof AppRpcError && error.code === 'ALREADY_COACH' ? 'refused' : 'error'}>{coachingErrorText(error, tr, {}, { scope: 'admin' })}</WizardNote>}
            {existing && (
              <div>
                <Button size="sm" iconEnd="arrowUpRight" onClick={() => onOpenCoach(existing.coach_id)}>
                  {tr(`${P}.openExisting`, { name: coachName(existing, locale) })}
                </Button>
              </div>
            )}
            {lookup.isError && <WizardNote tone="error">{tr(errorToMessageKey(lookup.error))}</WizardNote>}
          </>
        ) : undefined
      }
      steps={[
        {
          key: 'account',
          label: tr(`${P}.account`),
          note: draft.customer?.name || null,
          problems: problems.includes('account') ? [problemLine('account')] : [],
          // ALREADY_COACH names the account.
          flagged: error instanceof AppRpcError && error.code === 'ALREADY_COACH',
          content: (
            <>
              <CustomerPicker
                label={tr(`${P}.account`)}
                value={draft.customer ? { ...draft.customer, flags: [] } : null}
                onChange={(next) => set({ customer: next ? { id: next.id, name: next.name, phone: next.phone } : null })}
                disabled={busy}
                autoFocus={!draft.customer}
              />
              <WizardNote>{tr(`${P}.accountHint`)}</WizardNote>
            </>
          ),
        },
        {
          key: 'profile',
          label: tr(`${P}.profile`),
          note: shownNames || null,
          problems: problems.includes('names') ? [problemLine('names')] : [],
          content: (
            <>
              <BilingualFields
                labelEn={tr(`${P}.nameEn`)}
                labelAr={tr(`${P}.nameAr`)}
                en={draft.nameEn}
                ar={draft.nameAr}
                onEn={(v) => set({ nameEn: v })}
                onAr={(v) => set({ nameAr: v })}
                maxLength={COACH_LIMITS.name}
                disabled={busy}
              />
              <BilingualFields
                labelEn={tr(`${P}.bioEn`)}
                labelAr={tr(`${P}.bioAr`)}
                en={draft.bioEn}
                ar={draft.bioAr}
                onEn={(v) => set({ bioEn: v })}
                onAr={(v) => set({ bioAr: v })}
                multiline
                maxLength={COACH_LIMITS.bio}
                disabled={busy}
              />
              <ImageField label={tr(`${P}.photo`)} value={draft.photo} onChange={(p) => set({ photo: p })} folder="coaches" aspect="1:1" disabled={busy} />
            </>
          ),
        },
        {
          key: 'teaching',
          label: tr(`${P}.teaching`),
          note: tr(`${P}.teachingNote`, {
            branches: countPhrase(`${P}.branchCount`, pickedBranches.length, locale),
            types: countPhrase(`${P}.typeCount`, pickedTypes.length, locale),
          }),
          problems: problems.includes('branches') ? [problemLine('branches')] : [],
          content: (
            <>
              <WizardChecks
                label={tr(`${P}.branches`)}
                items={venues.map((v) => ({
                  key: v.id,
                  label: <bdi>{pickName(locale, v)}</bdi>,
                  checked: draft.venueIds.includes(v.id),
                  disabled: busy,
                  testId: `promote-coach.branch.${v.id}`,
                  onChange: (on: boolean) =>
                    set(
                      // Unticking this branch clears its lesson types (OP-09).
                      v.id === branchId && !on
                        ? { venueIds: toggleId(draft.venueIds, v.id, false), typeIds: [] }
                        : { venueIds: toggleId(draft.venueIds, v.id, on) },
                    ),
                }))}
                hint={otherBranches ? tr(`${P}.otherBranches`) : undefined}
              />
              <WizardChecks
                label={tr(`${P}.types`)}
                optional
                items={data.lesson_types.map((t) => ({
                  key: t.lesson_type_id,
                  label: <bdi>{pickName(locale, t)}</bdi>,
                  tag: tr(`ws.coaching.common.kindShort.${t.kind}`),
                  checked: draft.typeIds.includes(t.lesson_type_id),
                  disabled: busy || !railTicked,
                  testId: `promote-coach.type.${t.lesson_type_id}`,
                  onChange: (on: boolean) => set({ typeIds: toggleId(draft.typeIds, t.lesson_type_id, on) }),
                }))}
                hint={
                  data.lesson_types.length === 0
                    ? tr(`${P}.noTypes`)
                    : !railTicked
                      ? tr(`${P}.typesNeedBranch`)
                      : undefined
                }
              />
              <WizardNote>{tr(`${P}.acceptNote`)}</WizardNote>
            </>
          ),
        },
      ]}
      review={(goTo) => (
        <ReviewList
          goTo={goTo}
          busy={busy}
          rows={[
            { label: tr(`${P}.reviewAccount`), value: draft.customer ? <bdi>{draft.customer.name}</bdi> : '—', step: 'account' },
            {
              label: tr(`${P}.reviewShownAs`),
              value: <bdi>{[draft.nameEn.trim(), draft.nameAr.trim()].filter(Boolean).join(' · ')}</bdi>,
              step: 'profile',
            },
            { label: tr(`${P}.branches`), value: list(pickedBranches.map((v) => pickName(locale, v))), step: 'teaching' },
            { label: tr(`${P}.reviewTeaches`), value: list(pickedTypes.map((t) => pickName(locale, t))), step: 'teaching' },
          ]}
        />
      )}
    />
  );
}
