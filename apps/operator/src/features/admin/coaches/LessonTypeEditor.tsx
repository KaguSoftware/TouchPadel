/**
 * The lesson type editor beside the Lesson types list
 * (docs/design/coaching/operator.md §5.13.2; C-5, C-17, R26, R46).
 *
 * Writes `upsert_lesson_type(p_venue_id, p_id, p_patch)` with the changed keys
 * only (every key for a new type). Who edits what is `priceLock(type, caps)`:
 *
 * - a draft (never launched): every field, price included, for a manager too
 *   (C-17); **Put on sale** is a direct `is_active: true` for the owner
 *   (`launchDirectly`) and a `lesson_launch` proposal for a manager, disabled
 *   until a price is set;
 * - saved (draft or launched): the kind is fixed (OP-05), with **Make a new
 *   lesson type…** beside it;
 * - launched: for a manager the price and court share are
 *   read-only with **Propose a price** (`lesson_price`), and the length,
 *   sessions and a private type's party size with **Make a new lesson
 *   type…** (a new draft prefilled from this one). The owner edits all of it;
 * - the Active switch of a launched type is a direct write for both (R46);
 * - the order arrows save on their own (OP-01): `sort_order` alone, for each
 *   type of the kind whose place changed.
 *
 * A stale screen's refusal shows its way out, never the item wording of
 * `op.errors.PRICE_VIA_PROTOCOL`: `PRICE_VIA_PROTOCOL` `price` and
 * `LAUNCH_VIA_PROTOCOL` with the matching start button, `shape` with Make a new
 * lesson type…. Every write is online only (CD-6).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber, isolate, type MessageKey } from '@touch/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { pickName, useLocale } from '../../../lib/i18n';
import { useVenue } from '../../../lib/venue';
import { currentBranchId } from '../../../lib/venueScope';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Button, ErrorText, Field, Select, inputStyle } from '../../../components/ui';
import { MessagePresenter, Panel, SegmentedControl, StatusBadge } from '../../../components/kit';
import { BilingualFields, MoneyInput, SortButtons } from '../../../components/inputs';
import {
  PriceChangeButton,
  PriceLockNote,
  usePriceChangeStart,
} from '../promotions/PriceChangeStart';
import { coachingErrorText } from '../../coaching/lessonLogic';
import {
  LESSON_KINDS,
  obj,
  str,
  type AdminLessonType,
  type CoachesAdmin as CoachesAdminData,
  type LessonKind,
} from '../../coaching/lessonPayloads';
import { invalidateCoachesAdmin, useCoachingCaps } from '../../coaching/useCoaching';
import { coachName } from './coachesLogic';
import {
  DURATIONS,
  LESSON_TYPE_LIMITS,
  draftCopyOf,
  draftFromType,
  launchBlock,
  lessonTypeDraftErrors,
  lessonTypeFieldOf,
  lessonTypePatch,
  maxPlacesLocked,
  newLessonTypeDraft,
  priceLock,
  rangeOf,
  typeOrderAfterMove,
  typeState,
  withKind,
  type LessonTypeDraft,
  type LessonTypeField,
} from './lessonTypeLogic';
import type { OrderWrite } from './coachesLogic';

const T = 'ws.coaching.lessonTypes';
const ED = 'ws.coaching.lessonTypes.editor';

export function LessonTypeEditor({
  type,
  seed,
  data,
  reachable,
  onClose,
  onCreated,
  onMakeNew,
}: {
  /** The saved type, or null for a new one. */
  type: AdminLessonType | null;
  /** A new type's starting draft (blank, or Make a new lesson type… prefilled). */
  seed: LessonTypeDraft | null;
  data: CoachesAdminData;
  reachable: boolean;
  onClose: () => void;
  onCreated: (id: string | null) => void;
  onMakeNew: (draft: LessonTypeDraft) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const caps = useCoachingCaps();
  const { branchId } = useVenue();
  const startChange = usePriceChangeStart();
  const offline = tr('ws.coaching.offline.needsConnection');

  const initial = () => (type ? draftFromType(type) : (seed ?? newLessonTypeDraft()));
  const [draft, setDraft] = useState<LessonTypeDraft>(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [serverField, setServerField] = useState<LessonTypeField | null>(null);

  // A save (this one's, or another manager's) resets the form to what is stored.
  const savedKey = type ? JSON.stringify(draftFromType(type)) : 'new';
  useEffect(() => {
    if (type) setDraft(draftFromType(type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  // A new seed (New lesson type pressed again, or another copy) starts over.
  useEffect(() => {
    if (!type && seed) setDraft(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const lock = priceLock(type, caps);
  const errors = lessonTypeDraftErrors(draft);
  const invalid = Object.keys(errors).length > 0;
  const patch = invalid ? null : lessonTypePatch(type, draft, lock);
  const dirty = type
    ? invalid
      ? JSON.stringify(draft) !== JSON.stringify(draftFromType(type))
      : Object.keys(patch ?? {}).length > 0
    : true;
  const set = (p: Partial<LessonTypeDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setServerField(null);
  };
  const name = type ? pickName(locale, type) : '';

  async function write(p: Record<string, unknown>, done: string): Promise<void> {
    setBusy(true);
    setError(null);
    setServerField(null);
    try {
      const out = await appRpc('upsert_lesson_type', {
        p_venue_id: currentBranchId(),
        p_id: type?.lesson_type_id ?? null,
        p_patch: p,
      });
      const row = obj(out);
      const id =
        (row ? (str(row.lesson_type_id) ?? str(row.id)) : null) ?? type?.lesson_type_id ?? null;
      toast.ok(done);
      setTried(false);
      invalidateCoachesAdmin(qc, branchId);
      if (!type) onCreated(id);
    } catch (e) {
      setError(e);
      if (e instanceof AppRpcError && e.code === 'INVALID_ARGUMENT')
        setServerField(lessonTypeFieldOf(e.details));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    setTried(true);
    if (invalid || !reachable || !patch || Object.keys(patch).length === 0) return;
    const label = locale === 'ar' ? draft.nameAr.trim() : draft.nameEn.trim();
    void write(patch, type ? tr(`${ED}.saved`) : tr(`${ED}.created`, { name: isolate(label) }));
  }

  /** The order arrows (OP-01): each changed type's `sort_order` alone, apart from the form's save. */
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<unknown>(null);
  async function move(writes: OrderWrite[] | null) {
    if (!writes || writes.length === 0) return;
    setOrdering(true);
    setOrderError(null);
    try {
      for (const w of writes) {
        await appRpc('upsert_lesson_type', {
          p_venue_id: currentBranchId(),
          p_id: w.id,
          p_patch: { sort_order: w.sort_order },
        });
      }
    } catch (e) {
      setOrderError(e);
    } finally {
      setOrdering(false);
      invalidateCoachesAdmin(qc, branchId);
    }
  }

  /** The Active switch: a direct write for both roles (R46). Thrown back so the switch reverts. */
  async function setActive(next: boolean) {
    if (!type) return;
    setError(null);
    try {
      await appRpc('upsert_lesson_type', {
        p_venue_id: currentBranchId(),
        p_id: type.lesson_type_id,
        p_patch: { is_active: next },
      });
      toast.ok(tr(next ? `${ED}.switchedOn` : `${ED}.switchedOff`, { name: isolate(name) }));
      invalidateCoachesAdmin(qc, branchId);
    } catch (e) {
      setError(e);
      throw e;
    }
  }

  /** The way out of a stale screen's refusal (§5.13.2). */
  const code = error instanceof AppRpcError ? error.code : null;
  const detail = error instanceof AppRpcError ? (error.details ?? error.hint ?? '').trim() : '';
  const shapeRefused = code === 'PRICE_VIA_PROTOCOL' && detail === 'shape';
  const priceRefused =
    (code === 'PRICE_VIA_PROTOCOL' && !shapeRefused) || code === 'LAUNCH_VIA_PROTOCOL';

  function errorFor(field: LessonTypeField): string | undefined {
    if (serverField === field) return tr(`${T}.errors.refused`);
    const e = tried ? errors[field] : undefined;
    if (!e) return undefined;
    if (e === 'range') {
      const r = rangeOf(field, draft.kind);
      return r
        ? tr(`${T}.errors.range`, {
            min: formatNumber(r.min, locale),
            max: formatNumber(r.max, locale),
          })
        : tr(`${T}.errors.refused`);
    }
    return tr(`${T}.errors.${e}` as MessageKey);
  }

  const lockedPrice = type !== null && lock.price;
  const lockedShape = type !== null && lock.shape;
  const lockedParty = type !== null && maxPlacesLocked(draft.kind, lock);
  const launch = type ? lock.launch : null;
  const block = launchBlock(type, dirty);
  const coachesHere = data.coaches.filter((c) => type?.coach_ids.includes(c.coach_id));
  // The order arrows, among this kind's types (a direct edit for a manager too, R46).
  const orderUp = type
    ? typeOrderAfterMove(data.lesson_types, type.lesson_type_id, type.kind, -1)
    : null;
  const orderDown = type
    ? typeOrderAfterMove(data.lesson_types, type.lesson_type_id, type.kind, 1)
    : null;
  const orderRefused =
    orderError instanceof AppRpcError &&
    orderError.code === 'INVALID_ARGUMENT' &&
    lessonTypeFieldOf(orderError.details) === 'order';
  const minutes = (m: number) =>
    tr('ws.coaching.common.minutes', { minutes: formatNumber(m, locale) });

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
          {type ? <bdi>{name}</bdi> : tr(`${ED}.newTitle`)}
          {type && (
            <StatusBadge
              size="sm"
              tone={typeState(type) === 'onSale' ? 'success' : 'neutral'}
              label={tr(`${T}.state.${typeState(type)}`)}
            />
          )}
          {type && dirty && <StatusBadge tone="warn" size="sm" label={tr(`${ED}.unsaved`)} />}
        </span>
      }
      actions={
        <Button
          kind="ghost"
          size="sm"
          icon="x"
          aria-label={tr(`${ED}.close`)}
          disabled={busy}
          onClick={onClose}
        />
      }
      style={{ position: 'sticky', insetBlockStart: 'var(--tp-sp-2)' }}
      data-testid="lesson-type-editor"
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <Field
          label={tr(`${ED}.kind`)}
          hint={lock.kind ? tr(`${ED}.kindLocked`) : undefined}
          error={errorFor('kind')}
          group
        >
          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <SegmentedControl<LessonKind>
              value={draft.kind}
              onChange={(k) => setDraft((d) => withKind(d, k))}
              options={LESSON_KINDS.map((k) => ({
                value: k,
                label: tr(`ws.coaching.common.kind.${k}`),
                disabled: busy || lock.kind,
              }))}
            />
            {lock.kind && type && !lockedShape && (
              <Button size="sm" icon="plus" onClick={() => onMakeNew(draftCopyOf(type))}>
                {tr(`${ED}.makeNew`)}
              </Button>
            )}
          </div>
        </Field>
        <BilingualFields
          labelEn={tr(`${ED}.nameEn`)}
          labelAr={tr(`${ED}.nameAr`)}
          en={draft.nameEn}
          ar={draft.nameAr}
          onEn={(v) => set({ nameEn: v })}
          onAr={(v) => set({ nameAr: v })}
          maxLength={LESSON_TYPE_LIMITS.name}
          disabled={busy}
        />
        {errorFor('names') && <FieldLine text={errorFor('names')!} />}
        <BilingualFields
          labelEn={tr(`${ED}.descEn`)}
          labelAr={tr(`${ED}.descAr`)}
          en={draft.descEn}
          ar={draft.descAr}
          onEn={(v) => set({ descEn: v })}
          onAr={(v) => set({ descAr: v })}
          multiline
          maxLength={LESSON_TYPE_LIMITS.description}
          disabled={busy}
        />
        {errorFor('descriptions') && <FieldLine text={errorFor('descriptions')!} />}

        <div
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-3)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
          }}
        >
          {lockedShape ? (
            <ReadOnly label={tr(`${ED}.duration`)} value={minutes(draft.durationMin)} />
          ) : (
            <Field label={tr(`${ED}.duration`)} error={errorFor('durationMin')}>
              <Select<string>
                value={String(draft.durationMin)}
                onChange={(v) => set({ durationMin: Number(v) })}
                options={DURATIONS.map((d) => ({ value: String(d), label: minutes(d) }))}
                disabled={busy}
              />
            </Field>
          )}
          {draft.kind === 'private' ? (
            lockedParty ? (
              <ReadOnly
                label={tr(`${ED}.partySize`)}
                value={formatNumber(Number(draft.maxPlaces) || 0, locale)}
              />
            ) : (
              <Field
                label={tr(`${ED}.partySize`)}
                hint={tr(`${ED}.partyHint`)}
                error={errorFor('maxPlaces')}
              >
                <Select<string>
                  value={draft.maxPlaces}
                  onChange={(v) => set({ maxPlaces: v })}
                  options={[1, 2, 3, 4].map((n) => ({
                    value: String(n),
                    label: formatNumber(n, locale),
                  }))}
                  disabled={busy}
                />
              </Field>
            )
          ) : (
            <>
              <NumField
                label={tr(`${ED}.maxPlaces`)}
                value={draft.maxPlaces}
                onChange={(v) => set({ maxPlaces: v })}
                error={errorFor('maxPlaces')}
                disabled={busy}
              />
              <NumField
                label={tr(`${ED}.minPlaces`)}
                hint={tr(`${ED}.minHint`)}
                value={draft.minPlaces}
                onChange={(v) => set({ minPlaces: v })}
                error={errorFor('minPlaces')}
                disabled={busy}
              />
            </>
          )}
          {draft.kind === 'course' &&
            (lockedShape ? (
              <ReadOnly
                label={tr(`${ED}.sessions`)}
                value={formatNumber(Number(draft.sessions) || 0, locale)}
              />
            ) : (
              <NumField
                label={tr(`${ED}.sessions`)}
                value={draft.sessions}
                onChange={(v) => set({ sessions: v })}
                error={errorFor('sessions')}
                disabled={busy}
              />
            ))}
        </div>
        {draft.kind !== 'private' && (
          <NumField
            label={tr(`${ED}.cutoff`)}
            unit={tr(`${ED}.cutoffUnit`)}
            hint={tr(`${ED}.cutoffHint`)}
            value={draft.cutoffHours}
            onChange={(v) => set({ cutoffHours: v })}
            error={errorFor('cutoffHours')}
            disabled={busy}
          />
        )}
        {lockedShape && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBlockEnd: 'var(--tp-sp-3)',
            }}
          >
            <span
              style={{
                fontSize: 'var(--tp-fs-sm)',
                color: 'var(--tp-muted-fg)',
                flex: '1 1 14rem',
              }}
            >
              {tr(`${ED}.shapeLock`)}
            </span>
            {type && (
              <Button size="sm" icon="plus" onClick={() => onMakeNew(draftCopyOf(type))}>
                {tr(`${ED}.makeNew`)}
              </Button>
            )}
          </div>
        )}

        {lockedPrice && type ? (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-3)' }}>
            <PriceLockNote message={tr(`${ED}.priceLock`)} />
            <div
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-3)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
              }}
            >
              <ReadOnly
                label={tr(`${ED}.price`)}
                value={
                  type.price_iqd == null ? tr(`${T}.noPrice`) : formatIQD(type.price_iqd, locale)
                }
              />
              <ReadOnly
                label={tr(`${ED}.courtShare`)}
                value={type.court_share_iqd == null ? '—' : formatIQD(type.court_share_iqd, locale)}
              />
            </div>
            <div>
              <PriceChangeButton
                target={{ change: 'lesson_price', lessonType: type.lesson_type_id }}
                label={tr(`${ED}.proposePrice`)}
                size="sm"
              />
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gap: 'var(--tp-sp-3)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
            }}
          >
            <Field
              label={tr(`${ED}.price`)}
              hint={tr(`${ED}.priceHint.${draft.kind}`)}
              error={errorFor('price')}
            >
              <MoneyInput
                value={draft.price}
                onChange={(v) => set({ price: v })}
                allowEmpty
                disabled={busy}
              />
            </Field>
            <Field
              label={tr(`${ED}.courtShare`)}
              hint={tr(`${ED}.courtShareHint`)}
              error={errorFor('courtShare')}
            >
              <MoneyInput
                value={draft.courtShare}
                onChange={(v) => set({ courtShare: v })}
                disabled={busy}
              />
            </Field>
          </div>
        )}

        {type && (
          <Field label={tr(`${ED}.coaches`)} hint={tr(`${ED}.coachesHint`)} group>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
              {coachesHere.length === 0 ? (
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  {tr(`${ED}.noCoaches`)}
                </span>
              ) : (
                coachesHere.map((c) => (
                  <StatusBadge
                    key={c.coach_id}
                    size="sm"
                    tone="neutral"
                    dot={false}
                    icon="whistle"
                    label={coachName(c, locale)}
                  />
                ))
              )}
            </div>
          </Field>
        )}

        {type && (
          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBlockEnd: 'var(--tp-sp-3)',
            }}
          >
            <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, flex: '1 1 10rem' }}>
              {tr(`${ED}.order`)}
            </span>
            <SortButtons
              onUp={() => void move(orderUp)}
              onDown={() => void move(orderDown)}
              disabledUp={orderUp === null || busy || ordering || !reachable}
              disabledDown={orderDown === null || busy || ordering || !reachable}
            />
          </div>
        )}
        {type && (
          <ErrorText
            error={orderError}
            message={
              orderRefused
                ? tr(`${T}.errors.refused`)
                : orderError
                  ? coachingErrorText(orderError, tr, {}, { scope: 'admin' })
                  : null
            }
          />
        )}

        {type && lock.activeSwitch && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockEnd: 'var(--tp-sp-3)' }}>
            <Switch
              checked={type.is_active}
              onChange={setActive}
              label={tr(`${ED}.active`)}
              disabled={!reachable || busy}
            />
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr(type.is_active ? `${ED}.activeOnHint` : `${ED}.activeOffHint`)}
            </p>
          </div>
        )}

        {priceRefused && type ? (
          <MessagePresenter
            tone="refused"
            rise
            message={
              <span style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
                <span>{coachingErrorText(error, tr, {}, { scope: 'admin' })}</span>
                <PriceChangeButton
                  target={{
                    change: code === 'LAUNCH_VIA_PROTOCOL' ? 'lesson_launch' : 'lesson_price',
                    lessonType: type.lesson_type_id,
                  }}
                  label={tr(
                    code === 'LAUNCH_VIA_PROTOCOL' ? `${ED}.putOnSale` : `${ED}.proposePrice`,
                  )}
                  size="sm"
                />
              </span>
            }
          />
        ) : shapeRefused && type ? (
          <MessagePresenter
            tone="refused"
            rise
            message={
              <span style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
                <span>{coachingErrorText(error, tr, {}, { scope: 'admin' })}</span>
                <Button size="sm" icon="plus" onClick={() => onMakeNew(draftCopyOf(type))}>
                  {tr(`${ED}.makeNew`)}
                </Button>
              </span>
            }
          />
        ) : (
          serverField === null && (
            <ErrorText
              error={error}
              message={error ? coachingErrorText(error, tr, {}, { scope: 'admin' }) : null}
            />
          )
        )}

        <div
          style={{
            display: 'flex',
            gap: 'var(--tp-sp-2)',
            justifyContent: 'flex-end',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          {launch === 'direct' && type && (
            <Button
              icon="check"
              busy={busy}
              disabled={!reachable || block !== null}
              disabledReason={!reachable ? offline : block ? tr(`${ED}.${block}`) : undefined}
              style={{ marginInlineEnd: 'auto' }}
              onClick={() =>
                void write({ is_active: true }, tr(`${ED}.launched`, { name: isolate(name) }))
              }
            >
              {tr(`${ED}.putOnSale`)}
            </Button>
          )}
          {launch === 'protocol' && type && startChange && (
            <Button
              iconEnd="arrowUpRight"
              disabled={block !== null}
              disabledReason={block ? tr(`${ED}.${block}`) : undefined}
              style={{ marginInlineEnd: 'auto' }}
              onClick={() =>
                startChange({ change: 'lesson_launch', lessonType: type.lesson_type_id })
              }
            >
              {tr(`${ED}.putOnSale`)}
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            {dirty && type ? tr(`${ED}.discard`) : tr(`${ED}.close`)}
          </Button>
          {dirty && (
            <Button
              kind="primary"
              icon="check"
              busy={busy}
              disabled={!reachable}
              disabledReason={offline}
              onClick={save}
            >
              {type ? tr(`${ED}.save`) : tr(`${ED}.create`)}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

/** A whole number with its label (and unit), the house field shape. */
function NumField({
  label,
  value,
  onChange,
  error,
  hint,
  unit,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        style={{ ...inputStyle, inlineSize: '6rem', fontVariantNumeric: 'tabular-nums' }}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        disabled={disabled}
        aria-label={unit ? `${label} (${unit})` : undefined}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
      />
    </Field>
  );
}

/** A value a manager reads but cannot change here. */
function ReadOnly({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{ display: 'grid', gap: 'var(--tp-sp-1)', marginBlockEnd: 'var(--tp-sp-4)' }}
      data-readonly="true"
    >
      <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function FieldLine({ text }: { text: string }) {
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        marginBlockEnd: 'var(--tp-sp-2)',
        color: 'var(--tp-danger-fg)',
        fontSize: 'var(--tp-fs-sm)',
      }}
    >
      {text}
    </p>
  );
}
