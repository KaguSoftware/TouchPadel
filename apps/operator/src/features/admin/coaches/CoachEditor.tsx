/**
 * The coach editor beside the Coaches list (docs/design/coaching/operator.md
 * §5.13.1). Each part saves on its own, through its own RPC, so one refusal
 * never holds the others:
 *
 * - Account (read-only): the account name and phone (staff only, never
 *   public), Open customer; a deleted account says what was cleared (R63).
 * - While the coach has not accepted a public profile: who sees what (C-22, R61).
 * - Public profile: display names, bios, photo (a fresh random folder, R43),
 *   order → `coach_update` with the changed keys; a replaced photo's old
 *   object is removed after the save.
 * - Branches → `set_coach_branches` (BRANCH_HAS_BOOKINGS names the branch).
 * - Lesson types here → `set_coach_lesson_types`; unticking a type the coach
 *   has an own price for asks first (R46: the price goes with it).
 * - Prices: the owner sets an own price (`set_coach_price`, empty removes);
 *   a manager reads them and proposes one through the protocol (C-17).
 * - Status: Pause / Resume, and Retire (C-25, R45: a danger confirm with a
 *   required note, naming what it cancels; never refused).
 * - A retired coach's editor is read-only, with Make a coach again.
 *
 * Every write is online only (CD-6).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatIQD, formatNumber, isolate, isolateLtr } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { pickName, useLocale } from '../../../lib/i18n';
import { publicUrl, removeMedia } from '../../../lib/storage';
import { useVenue } from '../../../lib/venue';
import { currentBranchId } from '../../../lib/venueScope';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../../components/ui';
import { MessagePresenter, Panel, StatusBadge, type Tone } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { BilingualFields, MoneyInput, SortButtons } from '../../../components/inputs';
import { ImageField } from '../../../components/ImageField';
import { PriceChangeButton, PriceLockNote } from '../promotions/PriceChangeStart';
import { coachStatusKey, coachingErrorText, countOf } from '../../coaching/lessonLogic';
import {
  readCoachStatusSet,
  type AdminCoach,
  type AdminLessonType,
  type CoachesAdmin as CoachesAdminData,
} from '../../coaching/lessonPayloads';
import { invalidateCoachesAdmin, useCoachingCaps } from '../../coaching/useCoaching';
import {
  COACH_LIMITS,
  STATUS_NOTE_MAX,
  acceptanceOf,
  branchSet,
  coachName,
  coachPatch,
  orderAfterMove,
  ownPriceOf,
  profileDraftOf,
  profileProblems,
  refusedBranchIds,
  replacedPhoto,
  retireFacts,
  retireNoteOk,
  sameSet,
  sortCoaches,
  toggleId,
  typeChange,
  type CoachProfileDraft,
} from './coachesLogic';

const K = 'ws.coaching.coachesAdmin';
const E = 'ws.coaching.coachesAdmin.editor';

/** A promote whose lesson types were refused: the editor opens on the coach with the refusal by the types. */
export interface TypesRefusal {
  coachId: string;
  error: unknown;
  typeIds: string[];
}

const STATUS_TONE: Record<string, Tone> = { active: 'success', paused: 'warn', retired: 'neutral' };

/** The coach's square photo, or the whistle on the lesson tint when there is none. */
export function CoachPhoto({
  path,
  name,
  size = '2.5rem',
}: {
  path: string | null;
  name: string;
  size?: string;
}) {
  const { tr } = useLocale();
  const box = {
    inlineSize: size,
    blockSize: size,
    borderRadius: 'var(--tp-radius-ctl)',
    flex: '0 0 auto',
  } as const;
  if (!path) {
    return (
      <span
        aria-label={tr(`${K}.noPhoto`)}
        role="img"
        style={{
          ...box,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--tp-lesson-soft)',
          color: 'var(--tp-lesson)',
        }}
      >
        <Icon name="whistle" size={16} />
      </span>
    );
  }
  return (
    <img
      src={publicUrl(path)}
      alt={tr(`${K}.photoAlt`, { name })}
      style={{ ...box, objectFit: 'cover' }}
    />
  );
}

/** The status, acceptance (C-22, R61) and account (R63) badges a coach carries in the list and the editor. */
export function CoachBadges({ coach: c }: { coach: AdminCoach }) {
  const { tr } = useLocale();
  const statusKey = coachStatusKey(c.status);
  const acceptance = acceptanceOf(c);
  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 'var(--tp-sp-1)',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <StatusBadge
        size="sm"
        tone={STATUS_TONE[c.status] ?? 'neutral'}
        label={statusKey ? tr(statusKey) : c.status}
      />
      {acceptance === 'deleted' && (
        <StatusBadge size="sm" tone="neutral" label={tr(`${K}.accountDeleted`)} />
      )}
      {acceptance === 'waiting' && c.status !== 'retired' && (
        <StatusBadge size="sm" tone="info" label={tr(`${K}.waitingAccept`)} />
      )}
    </span>
  );
}

export function CoachEditor({
  coach: c,
  data,
  reachable,
  typesRefusal,
  onClose,
  onMakeAgain,
}: {
  coach: AdminCoach;
  data: CoachesAdminData;
  reachable: boolean;
  typesRefusal: TypesRefusal | null;
  onClose: () => void;
  onMakeAgain: () => void;
}) {
  const { tr, locale } = useLocale();
  const caps = useCoachingCaps();
  const name = coachName(c, locale);
  const retired = c.status === 'retired';
  const acceptance = acceptanceOf(c);

  return (
    <Panel
      title={
        <span
          style={{
            display: 'inline-flex',
            gap: 'var(--tp-sp-2)',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <CoachPhoto path={c.photo_path} name={name} size="2rem" />
          <bdi>{name}</bdi>
          <CoachBadges coach={c} />
        </span>
      }
      actions={
        <Button kind="ghost" size="sm" icon="x" aria-label={tr(`${E}.close`)} onClick={onClose} />
      }
      style={{ position: 'sticky', insetBlockStart: 'var(--tp-sp-2)' }}
      data-testid="coach-editor"
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <AccountSection coach={c} />
        {retired ? (
          <section style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
            <MessagePresenter tone="info" icon="lock" message={tr(`${E}.retiredLine`)} />
            {caps.manageCoaches && !c.account_deleted && c.profile_id && (
              <Button icon="userPlus" onClick={onMakeAgain}>
                {tr(`${E}.makeAgain`)}
              </Button>
            )}
          </section>
        ) : (
          <>
            {acceptance === 'waiting' && (
              <MessagePresenter
                tone="info"
                message={tr(`${E}.notAccepted`, { name: isolate(name) })}
              />
            )}
            <ProfileSection coach={c} coaches={data.coaches} reachable={reachable} />
            <BranchesSection coach={c} reachable={reachable} />
            <TypesSection
              coach={c}
              types={data.lesson_types}
              reachable={reachable}
              refusal={typesRefusal}
            />
            <PricesSection coach={c} types={data.lesson_types} reachable={reachable} />
            <StatusSection coach={c} reachable={reachable} />
          </>
        )}
      </div>
    </Panel>
  );
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section
      aria-label={title}
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-2)',
        paddingBlockStart: 'var(--tp-sp-3)',
        borderBlockStart: '1px solid var(--tp-border)',
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{title}</h3>
        {hint && (
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {hint}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function useOffline(): string {
  const { tr } = useLocale();
  return tr('ws.coaching.offline.needsConnection');
}

// ---------------------------------------------------------------------------
// Account (read-only)
// ---------------------------------------------------------------------------

function AccountSection({ coach: c }: { coach: AdminCoach }) {
  const { tr } = useLocale();
  const navigate = useNavigate();
  if (c.account_deleted) {
    return (
      <section aria-label={tr(`${E}.account`)}>
        <MessagePresenter tone="info" message={tr(`${E}.deletedLine`)} />
      </section>
    );
  }
  return (
    <section aria-label={tr(`${E}.account`)} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>
        {tr(`${E}.account`)}
      </span>
      <div
        style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <bdi style={{ fontWeight: 600 }}>{c.full_name ?? '—'}</bdi>
        {c.phone ? (
          <span
            dir="ltr"
            style={{ color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}
          >
            {c.phone}
          </span>
        ) : (
          <span style={{ color: 'var(--tp-muted-fg)' }}>{tr(`${E}.noPhone`)}</span>
        )}
        {c.profile_id && (
          <Button
            size="sm"
            kind="ghost"
            icon="user"
            iconEnd="arrowUpRight"
            style={{ marginInlineStart: 'auto' }}
            onClick={() =>
              void navigate({ to: '/desk/customers/$id', params: { id: c.profile_id! } })
            }
          >
            {tr(`${E}.openCustomer`)}
          </Button>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Public profile (coach_update)
// ---------------------------------------------------------------------------

function ProfileSection({
  coach: c,
  coaches,
  reachable,
}: {
  coach: AdminCoach;
  coaches: AdminCoach[];
  reachable: boolean;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { branchId } = useVenue();
  const offline = useOffline();
  const saved = profileDraftOf(c);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<CoachProfileDraft>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // A save (this one's answer, or another manager's) resets the form to what is stored.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(profileDraftOf(c)), [savedKey]);

  const patch = coachPatch(c, draft);
  const dirty = Object.keys(patch).length > 0;
  const problems = profileProblems(draft);
  const set = (p: Partial<CoachProfileDraft>) => setDraft((d) => ({ ...d, ...p }));

  // The order arrows move this coach past a neighbour among the coaches still teaching.
  const listed = sortCoaches(coaches.filter((x) => x.status !== 'retired')).map((x) =>
    x.coach_id === c.coach_id ? { ...x, sort_order: draft.sortOrder } : x,
  );
  const up = orderAfterMove(listed, c.coach_id, -1);
  const down = orderAfterMove(listed, c.coach_id, 1);
  const position = sortCoaches(listed).findIndex((x) => x.coach_id === c.coach_id) + 1;

  async function save() {
    setBusy(true);
    setError(null);
    const old = replacedPhoto(c, draft);
    try {
      await appRpc('coach_update', { p_coach_id: c.coach_id, p_patch: patch });
      toast.ok(tr(`${E}.saved`));
      invalidateCoachesAdmin(qc, branchId);
      // R43: the old object goes once nothing points at it (removeMedia asks the server).
      if (old) void removeMedia(old);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    // A photo uploaded and never saved is nobody's: remove it.
    if (draft.photo && draft.photo !== c.photo_path) void removeMedia(draft.photo);
    setDraft(profileDraftOf(c));
    setError(null);
  }

  return (
    <Section title={tr(`${E}.profile`)}>
      <BilingualFields
        labelEn={tr(`${K}.promote.nameEn`)}
        labelAr={tr(`${K}.promote.nameAr`)}
        en={draft.nameEn}
        ar={draft.nameAr}
        onEn={(v) => set({ nameEn: v })}
        onAr={(v) => set({ nameAr: v })}
        maxLength={COACH_LIMITS.name}
        disabled={busy}
      />
      <BilingualFields
        labelEn={tr(`${K}.promote.bioEn`)}
        labelAr={tr(`${K}.promote.bioAr`)}
        en={draft.bioEn}
        ar={draft.bioAr}
        onEn={(v) => set({ bioEn: v })}
        onAr={(v) => set({ bioAr: v })}
        multiline
        maxLength={COACH_LIMITS.bio}
        disabled={busy}
      />
      <ImageField
        label={tr(`${K}.promote.photo`)}
        value={draft.photo}
        onChange={(p) => set({ photo: p })}
        folder="coaches"
        aspect="1:1"
        disabled={busy}
      />
      <div
        style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 12rem' }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
            {tr(`${E}.order`)}{' '}
            <span style={{ color: 'var(--tp-muted-fg)' }}>
              {isolateLtr(formatNumber(position, locale))}
            </span>
          </span>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr(`${E}.orderHint`)}
          </span>
        </span>
        <SortButtons
          onUp={() => up !== null && set({ sortOrder: up })}
          onDown={() => down !== null && set({ sortOrder: down })}
          disabledUp={up === null || busy}
          disabledDown={down === null || busy}
        />
      </div>
      <ErrorText
        error={error}
        message={error ? coachingErrorText(error, tr, {}, { scope: 'admin' }) : null}
      />
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
          <StatusBadge
            tone="warn"
            size="sm"
            label={tr(`${E}.unsaved`)}
            style={{ marginInlineEnd: 'auto' }}
          />
          <Button kind="ghost" disabled={busy} onClick={discard}>
            {tr(`${E}.discard`)}
          </Button>
          <Button
            kind="primary"
            icon="check"
            busy={busy}
            disabled={!reachable || problems.length > 0}
            disabledReason={!reachable ? offline : tr(`${K}.promote.needNames`)}
            onClick={() => void save()}
          >
            {tr(`${E}.save`)}
          </Button>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Branches (set_coach_branches)
// ---------------------------------------------------------------------------

function BranchesSection({ coach: c, reachable }: { coach: AdminCoach; reachable: boolean }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { venues, branchId } = useVenue();
  const offline = useOffline();
  const savedKey = c.venue_ids.join(',');
  const [ticked, setTicked] = useState<string[]>(c.venue_ids);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sentRemoved, setSentRemoved] = useState<string[]>([]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setTicked(c.venue_ids), [savedKey]);

  const shown = venues.map((v) => v.id);
  const next = branchSet(c.venue_ids, ticked, shown);
  const dirty = !sameSet(next, c.venue_ids);
  const branchName = (id: string) => {
    const v = venues.find((x) => x.id === id);
    return v ? pickName(locale, v) : '—';
  };

  async function save() {
    setBusy(true);
    setError(null);
    const removed = c.venue_ids.filter((id) => !next.includes(id));
    setSentRemoved(removed);
    try {
      await appRpc('set_coach_branches', { p_coach_id: c.coach_id, p_venue_ids: next });
      toast.ok(tr(`${E}.branchesSaved`));
      invalidateCoachesAdmin(qc, branchId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const refusalText = (() => {
    if (!error) return null;
    const detail = error instanceof AppRpcError ? (error.details ?? error.hint) : null;
    const names = refusedBranchIds(detail, sentRemoved)
      .map(branchName)
      .join(locale === 'ar' ? '، ' : ', ');
    return coachingErrorText(error, tr, { branch: isolate(names) }, { scope: 'admin' });
  })();

  return (
    <Section title={tr(`${E}.branches`)} hint={tr(`${E}.branchesHint`)}>
      <div
        role="group"
        aria-label={tr(`${E}.branches`)}
        style={{ display: 'flex', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}
      >
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
              checked={ticked.includes(v.id)}
              disabled={busy}
              onChange={(e) => setTicked((t) => toggleId(t, v.id, e.target.checked))}
            />
            <bdi>{pickName(locale, v)}</bdi>
          </label>
        ))}
      </div>
      <ErrorText error={error} message={refusalText} />
      {dirty && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            kind="primary"
            size="sm"
            icon="check"
            busy={busy}
            disabled={!reachable || next.length === 0}
            disabledReason={!reachable ? offline : tr(`${K}.promote.needBranch`)}
            onClick={() => void save()}
          >
            {tr(`${E}.saveBranches`)}
          </Button>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Lesson types here (set_coach_lesson_types)
// ---------------------------------------------------------------------------

function TypesSection({
  coach: c,
  types,
  reachable,
  refusal,
}: {
  coach: AdminCoach;
  types: AdminLessonType[];
  reachable: boolean;
  refusal: TypesRefusal | null;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { branchId } = useVenue();
  const offline = useOffline();
  const savedKey = c.lesson_type_ids.join(',');
  const [ticked, setTicked] = useState<string[]>(refusal?.typeIds ?? c.lesson_type_ids);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(refusal?.error ?? null);
  const [fromPromote, setFromPromote] = useState(refusal !== null);
  const name = coachName(c, locale);
  const typeName = (id: string) => {
    const t = types.find((x) => x.lesson_type_id === id);
    return t ? pickName(locale, t) : '—';
  };

  // A save resets the ticks to what is stored, unless a refused promote's ticks are still on screen.
  useEffect(() => {
    if (!fromPromote) setTicked(c.lesson_type_ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const change = typeChange(c, ticked);
  const dirty = change.added.length > 0 || change.removed.length > 0;

  async function save() {
    if (change.priceLosses.length > 0) {
      const ok = await confirm({
        title: tr(`${E}.untickTitle`, { coach: isolate(name) }),
        body: (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {change.priceLosses.map((id) => (
              <p key={id} style={{ margin: 0 }}>
                {tr(`${E}.untickBody`, { type: isolate(typeName(id)), coach: isolate(name) })}
              </p>
            ))}
          </div>
        ),
        kind: 'danger',
        confirmLabel: tr(`${E}.untickConfirm`),
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      await appRpc('set_coach_lesson_types', {
        p_coach_id: c.coach_id,
        p_venue_id: currentBranchId(),
        p_lesson_type_ids: ticked,
      });
      setFromPromote(false);
      toast.ok(tr(`${E}.typesSaved`));
      invalidateCoachesAdmin(qc, branchId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={tr(`${E}.types`)}>
      {types.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr(`${E}.noTypesHere`)}
        </p>
      ) : (
        <div
          role="group"
          aria-label={tr(`${E}.types`)}
          style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}
        >
          {types.map((t) => (
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
                checked={ticked.includes(t.lesson_type_id)}
                disabled={busy}
                onChange={(e) => setTicked((x) => toggleId(x, t.lesson_type_id, e.target.checked))}
              />
              <bdi>{pickName(locale, t)}</bdi>
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                {tr(`ws.coaching.common.kindShort.${t.kind}`)}
              </span>
            </label>
          ))}
        </div>
      )}
      {error != null && fromPromote && (
        <MessagePresenter
          tone="refused"
          message={tr(`${K}.promote.typesFailed`, { name: isolate(name) })}
        />
      )}
      <ErrorText
        error={error}
        message={error ? coachingErrorText(error, tr, {}, { scope: 'admin' }) : null}
      />
      {(dirty || (fromPromote && error != null)) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            kind="primary"
            size="sm"
            icon="check"
            busy={busy}
            disabled={!reachable}
            disabledReason={offline}
            onClick={() => void save()}
          >
            {tr(`${E}.saveTypes`)}
          </Button>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Prices for this coach (set_coach_price, owner; Propose a price, manager)
// ---------------------------------------------------------------------------

function PricesSection({
  coach: c,
  types,
  reachable,
}: {
  coach: AdminCoach;
  types: AdminLessonType[];
  reachable: boolean;
}) {
  const { tr, locale } = useLocale();
  const caps = useCoachingCaps();
  const taught = types.filter((t) => c.lesson_type_ids.includes(t.lesson_type_id));
  const name = coachName(c, locale);
  return (
    <Section
      title={tr(`${E}.prices`)}
      hint={caps.editLaunchedPrices ? tr(`${E}.priceHint`) : undefined}
    >
      {taught.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr(`${E}.noTypesTaught`)}
        </p>
      ) : (
        <>
          {!caps.editLaunchedPrices && <PriceLockNote message={tr(`${E}.priceLock`)} />}
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 'var(--tp-sp-2)',
            }}
          >
            {taught.map((t) => (
              <PriceRow
                key={t.lesson_type_id}
                coach={c}
                coachLabel={name}
                type={t}
                reachable={reachable}
                canSet={caps.editLaunchedPrices}
              />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function PriceRow({
  coach: c,
  coachLabel,
  type: t,
  reachable,
  canSet,
}: {
  coach: AdminCoach;
  coachLabel: string;
  type: AdminLessonType;
  reachable: boolean;
  canSet: boolean;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { branchId } = useVenue();
  const offline = useOffline();
  const own = ownPriceOf(c, t.lesson_type_id);
  const [value, setValue] = useState<number | null>(own);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => setValue(own), [own]);

  const typeLabel = pickName(locale, t);
  const typePrice =
    t.price_iqd == null
      ? tr(`${E}.noTypePrice`)
      : tr(`${E}.typePrice`, { price: formatIQD(t.price_iqd, locale) });

  async function set() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('set_coach_price', {
        p_coach_id: c.coach_id,
        p_lesson_type_id: t.lesson_type_id,
        p_price_iqd: value,
      });
      toast.ok(
        value === null
          ? tr(`${E}.priceRemoved`, { coach: isolate(coachLabel) })
          : tr(`${E}.priceSaved`),
      );
      invalidateCoachesAdmin(qc, branchId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li style={{ display: 'grid', gap: 'var(--tp-sp-1)', paddingBlock: 'var(--tp-sp-1)' }}>
      <div
        style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'baseline', flexWrap: 'wrap' }}
      >
        <bdi style={{ fontWeight: 600 }}>{typeLabel}</bdi>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {typePrice}
        </span>
        {!canSet && own !== null && (
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
            {tr(`${E}.ownPrice`, { coach: isolate(coachLabel), price: formatIQD(own, locale) })}
          </span>
        )}
      </div>
      {canSet ? (
        <div
          style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <MoneyInput
            value={value}
            onChange={setValue}
            allowEmpty
            disabled={busy}
            aria-label={tr(`${E}.priceAria`, { coach: coachLabel, type: typeLabel })}
            style={{ flex: '1 1 10rem' }}
          />
          <Button
            size="sm"
            busy={busy}
            disabled={!reachable || value === own}
            disabledReason={!reachable ? offline : undefined}
            onClick={() => void set()}
          >
            {tr(`${E}.setPrice`)}
          </Button>
        </div>
      ) : (
        <div>
          <PriceChangeButton
            target={{ change: 'coach_price', coach: c.coach_id, lessonType: t.lesson_type_id }}
            label={tr(`${E}.proposePrice`, { coach: coachLabel })}
            ariaLabel={`${tr(`${E}.proposePrice`, { coach: coachLabel })}: ${typeLabel}`}
            size="sm"
          />
        </div>
      )}
      <ErrorText
        error={error}
        message={error ? coachingErrorText(error, tr, {}, { scope: 'admin' }) : null}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Status (set_coach_status): Pause, Resume, Retire
// ---------------------------------------------------------------------------

function StatusSection({ coach: c, reachable }: { coach: AdminCoach; reachable: boolean }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const { branchId } = useVenue();
  const offline = useOffline();
  const [dialog, setDialog] = useState<'pause' | 'retire' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const name = coachName(c, locale);

  async function setStatus(
    status: 'active' | 'paused' | 'retired',
    note: string | null,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const out = readCoachStatusSet(
        await appRpc('set_coach_status', {
          p_coach_id: c.coach_id,
          p_status: status,
          p_reason: note,
        }),
      );
      if (status === 'retired') {
        toast.ok(
          tr(`${E}.retired`, {
            name: isolate(name),
            lessons: countOf('lessons', out.lessons_cancelled ?? 0, locale),
          }),
        );
      } else {
        toast.ok(tr(status === 'paused' ? `${E}.paused` : `${E}.resumed`, { name: isolate(name) }));
      }
      // A retire cancels lessons and courses (C-25): every coaching read and the court lists.
      invalidateCoachesAdmin(qc, branchId, status === 'retired');
      setDialog(null);
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title={tr(`${E}.status`)}
      hint={c.status === 'active' ? tr(`${E}.pauseHint`) : undefined}
    >
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
        {c.status === 'active' && (
          <Button
            icon="hourglass"
            disabled={!reachable || busy}
            disabledReason={offline}
            onClick={() => {
              setError(null);
              setDialog('pause');
            }}
          >
            {tr(`${E}.pause`)}
          </Button>
        )}
        {c.status === 'paused' && (
          <Button
            icon="play"
            busy={busy && dialog === null}
            disabled={!reachable}
            disabledReason={offline}
            onClick={() => void setStatus('active', null)}
          >
            {tr(`${E}.resume`)}
          </Button>
        )}
        <Button
          kind="danger"
          icon="ban"
          disabled={!reachable || busy}
          disabledReason={offline}
          style={{ marginInlineStart: 'auto' }}
          onClick={() => {
            setError(null);
            setDialog('retire');
          }}
        >
          {tr(`${E}.retire`)}
        </Button>
      </div>
      {dialog === null && (
        <ErrorText
          error={error}
          message={error ? coachingErrorText(error, tr, {}, { scope: 'admin' }) : null}
        />
      )}
      {dialog === 'pause' && (
        <PauseDialog
          name={name}
          busy={busy}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={(note) => void setStatus('paused', note)}
        />
      )}
      {dialog === 'retire' && (
        <RetireDialog
          coach={c}
          name={name}
          busy={busy}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={(note) => void setStatus('retired', note)}
        />
      )}
    </Section>
  );
}

function PauseDialog({
  name,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (note: string | null) => void;
}) {
  const { tr } = useLocale();
  const [note, setNote] = useState('');
  return (
    <Modal
      title={`${tr(`${E}.pause`)}: ${name}`}
      onClose={onCancel}
      dismissible={!busy}
      closeButton={false}
      size="sm"
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            busy={busy}
            onClick={() => onConfirm(note.trim() ? note.trim() : null)}
          >
            {tr(`${E}.pause`)}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>{tr(`${E}.pauseHint`)}</p>
      <Field label={tr(`${E}.pauseNote`)}>
        <input
          style={inputStyle}
          value={note}
          maxLength={STATUS_NOTE_MAX}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <ErrorText
        error={error}
        message={error ? coachingErrorText(error, tr, {}, { scope: 'admin' }) : null}
      />
    </Modal>
  );
}

/**
 * C-25, R45: a danger confirm that names what retiring cancels (the lessons to
 * come; the course clause when a course is open or running) and needs a note.
 * The server never refuses it; a failure here is a lost connection.
 */
function RetireDialog({
  coach: c,
  name,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  coach: AdminCoach;
  name: string;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const { tr, locale } = useLocale();
  const [note, setNote] = useState('');
  const facts = retireFacts(c);
  const ok = retireNoteOk(note);
  return (
    <Modal
      title={tr(`${E}.retireTitle`, { name: isolate(name) })}
      onClose={onCancel}
      dismissible={!busy}
      requireChoice
      closeButton={false}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy} autoFocus>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="danger"
            busy={busy}
            disabled={!ok}
            disabledReason={tr(`${E}.retireNoteHint`)}
            style={{ marginInlineStart: 'auto' }}
            onClick={() => onConfirm(note.trim())}
          >
            {tr(`${E}.retireConfirm`)}
          </Button>
        </>
      )}
    >
      <p style={{ marginBlockEnd: 'var(--tp-sp-3)', lineHeight: 1.5 }} data-testid="retire-body">
        {tr(facts.courses ? `${E}.retireBodyCourses` : `${E}.retireBody`, {
          lessons: countOf('lessons', facts.lessons, locale),
        })}
      </p>
      <Field label={tr(`${E}.retireNote`)} hint={tr(`${E}.retireNoteHint`)} required>
        <textarea
          style={{ ...inputStyle, minBlockSize: '4rem', resize: 'vertical', fontFamily: 'inherit' }}
          value={note}
          maxLength={STATUS_NOTE_MAX}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <ErrorText
        error={error}
        message={error ? coachingErrorText(error, tr, {}, { scope: 'admin' }) : null}
      />
    </Modal>
  );
}
