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
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isolate } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { pickName, useLocale } from '../../../lib/i18n';
import { removeMedia } from '../../../lib/storage';
import { useVenue } from '../../../lib/venue';
import { currentBranchId } from '../../../lib/venueScope';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Modal } from '../../../components/ui';
import { MessagePresenter } from '../../../components/kit';
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
  const [tried, setTried] = useState(false);
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
    setTried(true);
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

  return (
    <Modal
      title={tr(`${P}.title`)}
      onClose={cancel}
      dismissible={!busy}
      size="lg"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="whistle"
            busy={busy}
            disabled={!reachable}
            disabledReason={tr('ws.coaching.offline.needsConnection')}
            onClick={() => void submit()}
          >
            {tr(`${P}.submit`)}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="promote-coach">
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <CustomerPicker
            label={tr(`${P}.account`)}
            value={draft.customer ? { ...draft.customer, flags: [] } : null}
            onChange={(next) =>
              set({ customer: next ? { id: next.id, name: next.name, phone: next.phone } : null })
            }
            disabled={busy}
            autoFocus={!draft.customer}
          />
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr(`${P}.accountHint`)}
          </p>
        </div>
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
        <ImageField
          label={tr(`${P}.photo`)}
          value={draft.photo}
          onChange={(p) => set({ photo: p })}
          folder="coaches"
          aspect="1:1"
          disabled={busy}
        />
        <fieldset
          style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}
        >
          <legend
            style={{
              fontSize: 'var(--tp-fs-sm)',
              fontWeight: 600,
              marginBlockEnd: 'var(--tp-sp-1)',
            }}
          >
            {tr(`${P}.branches`)}
          </legend>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
            {venues.map((v) => (
              <label
                key={v.id}
                style={{
                  display: 'inline-flex',
                  gap: 'var(--tp-sp-1)',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={draft.venueIds.includes(v.id)}
                  disabled={busy}
                  onChange={(e) =>
                    set(
                      // Unticking this branch clears its lesson types (OP-09).
                      v.id === branchId && !e.target.checked
                        ? { venueIds: toggleId(draft.venueIds, v.id, false), typeIds: [] }
                        : { venueIds: toggleId(draft.venueIds, v.id, e.target.checked) },
                    )
                  }
                />
                <bdi>{pickName(locale, v)}</bdi>
              </label>
            ))}
          </div>
          {otherBranches && (
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr(`${P}.otherBranches`)}
            </p>
          )}
        </fieldset>
        <fieldset
          disabled={!railTicked}
          style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}
        >
          <legend
            style={{
              fontSize: 'var(--tp-fs-sm)',
              fontWeight: 600,
              marginBlockEnd: 'var(--tp-sp-1)',
            }}
          >
            {tr(`${P}.types`)}
          </legend>
          {!railTicked && data.lesson_types.length > 0 && (
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr(`${P}.typesNeedBranch`)}
            </p>
          )}
          {data.lesson_types.length === 0 ? (
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              {tr(`${P}.noTypes`)}
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
              {data.lesson_types.map((t) => (
                <label
                  key={t.lesson_type_id}
                  style={{
                    display: 'inline-flex',
                    gap: 'var(--tp-sp-1)',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={draft.typeIds.includes(t.lesson_type_id)}
                    disabled={busy || !railTicked}
                    onChange={(e) =>
                      set({ typeIds: toggleId(draft.typeIds, t.lesson_type_id, e.target.checked) })
                    }
                  />
                  <bdi>{pickName(locale, t)}</bdi>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                    {tr(`ws.coaching.common.kindShort.${t.kind}`)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <MessagePresenter tone="info" message={tr(`${P}.acceptNote`)} />
        {tried && problems.length > 0 && (
          <ul
            role="alert"
            style={{
              margin: 0,
              paddingInlineStart: 'var(--tp-sp-4)',
              color: 'var(--tp-danger-fg)',
              fontSize: 'var(--tp-fs-sm)',
            }}
          >
            {problems.map((p) => (
              <li key={p}>{problemLine(p)}</li>
            ))}
          </ul>
        )}
        <ErrorText
          error={error}
          message={error ? coachingErrorText(error, tr, {}, { scope: 'admin' }) : null}
        />
        {existing && (
          <div>
            <Button size="sm" iconEnd="arrowUpRight" onClick={() => onOpenCoach(existing.coach_id)}>
              {tr(`${P}.openExisting`, { name: coachName(existing, locale) })}
            </Button>
          </div>
        )}
        {lookup.isError && <ErrorText error={lookup.error} />}
      </div>
    </Modal>
  );
}
