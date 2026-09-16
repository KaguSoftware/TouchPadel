/**
 * Promotion editor (spec 06.27) — one configurable promotion. `$id` is `new`
 * for a fresh one. Saves through `app.upsert_promotion`; the public code is
 * minted server-side by `app.generate_promo_code`. No stacking configuration:
 * the server applies the single best eligible promotion.
 *
 * WHAT CHANGED, AND WHY
 *
 *  - The header carries one line saying what the promotion does, rebuilt from
 *    the draft on every change ("10% off everything from the cafe · Fri, Sat ·
 *    16:00–19:00 · No code needed"), so a manager can check the result in
 *    words instead of reading five panels back.
 *  - A field's error shows once the manager has left that field, not on
 *    arrival: a new promotion used to open with "Both names are required" in
 *    red before anything was typed. Save says, under itself, the one thing
 *    that stops it.
 *  - The "best one only" rule is said once, where it is decided (how a
 *    promotion is applied), not as a banner above the form.
 *  - "How it is applied" is a choice between two plain options. The server
 *    applies a promotion that is not automatic ONLY with its code (0067), so
 *    code-only without a code is called out: it would never apply.
 *  - Long pickers (menu items) start from what is chosen plus a search, rather
 *    than ~190 chips in a clipped scroll box.
 */
import { useEffect, useState, type FocusEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate, useParams } from '@tanstack/react-router';
import { formatDate, formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../../lib/auth';
import { QK, fetchActiveCourts } from '../../../lib/queries';
import { Button, ErrorText, Field, inputStyle } from '../../../components/ui';
import {
  AsyncStateWrapper,
  BilingualFieldPair,
  MessagePresenter,
  PageHeader,
  Panel,
  PermissionRefusedNotice,
  SearchField,
  SegmentedControl,
  StatusBadge,
  asyncStatus,
  type Tone,
} from '../../../components/kit';
import { MoneyInput, PercentInput } from '../../../components/inputs';
import { Icon } from '../../../components/icons';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useAdminMenu } from '../menu/useAdminMenu';
import {
  EMPTY_DRAFT,
  describePromotion,
  fromRow,
  isDirty,
  lifecycle,
  saveBlocker,
  statusText,
  toRpcArgs,
  toggleId,
  toggleWeekday,
  validateDraft,
  type PromotionDraft,
  type PromotionLifecycle,
} from './promotionLogic';
import { PROMOTIONS_KEY, fetchPromotion, promotionKey, type PromotionRow } from './promotionsApi';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const LIFECYCLE_TONE: Record<PromotionLifecycle, Tone> = { live: 'success', scheduled: 'info', disabled: 'neutral', expired: 'neutral' };

/** The fields whose errors wait until the manager has been there. */
type TouchKey = 'name' | 'value' | 'dates' | 'hours';

const hintStyle = { fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-1)' } as const;

export function PromotionEditorScreen() {
  const { tr } = useLocale();
  const params = useParams({ strict: false }) as { id?: string };
  const id = params.id && params.id !== 'new' ? params.id : null;

  const promoQ = useQuery({
    queryKey: promotionKey(id ?? 'new'),
    queryFn: () => fetchPromotion(id ?? ''),
    enabled: id !== null,
  });

  if (id === null) return <Editor id={null} row={null} />;

  const status = asyncStatus(promoQ, (row) => row === null);
  return (
    <AsyncStateWrapper
      status={status}
      error={promoQ.error}
      onRetry={() => void promoQ.refetch()}
      emptyContent={<MessagePresenter tone="error" message={tr('ws.manager.promotions.editor.notFound')} />}
    >
      {promoQ.data && <Editor key={promoQ.data.id} id={id} row={promoQ.data} />}
    </AsyncStateWrapper>
  );
}

function Editor({ id, row }: { id: string | null; row: PromotionRow | null }) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const can = usePermissions();

  const initial = row ? fromRow(row) : EMPTY_DRAFT;
  const [draft, setDraft] = useState<PromotionDraft>(initial);
  const [saved, setSaved] = useState<PromotionDraft>(initial);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState<ReadonlySet<TouchKey>>(new Set());
  const dirty = isDirty(draft, saved);
  const errors = validateDraft(draft);
  const blocker = saveBlocker(errors);
  const readOnly = !can.editPromotions;

  useEffect(() => {
    if (row) {
      const next = fromRow(row);
      setSaved(next);
      setDraft((d) => (isDirty(d, saved) ? d : next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  useBlocker({
    shouldBlockFn: async () => {
      if (!dirty) return false;
      const leave = await confirm({ title: tr('ws.kit.actions.dirtyLeave'), kind: 'danger' });
      return !leave;
    },
    enableBeforeUnload: dirty,
  });

  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });
  const menu = useAdminMenu();

  const patch = (part: Partial<PromotionDraft>) => setDraft((d) => ({ ...d, ...part }));

  /** Mark a field group as visited once focus leaves it (not while moving inside it). */
  const leave = (key: TouchKey) => (e: FocusEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));
  };
  const shown = (key: TouchKey, ...codes: typeof errors) => touched.has(key) && codes.some((c) => errors.includes(c));

  const save = useMutation({
    mutationFn: async () => {
      const result = await appRpc<string | { id: string } | null>('upsert_promotion', toRpcArgs(draft, id));
      const newId = typeof result === 'string' ? result : result && typeof result === 'object' ? result.id : id;
      return newId ?? id;
    },
    onSuccess: async (newId) => {
      setError(null);
      setSaved(draft);
      toast.ok(tr('ws.manager.promotions.editor.saved'));
      await queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY });
      if (id === null && newId) void navigate({ to: '/admin/promotions/$id', params: { id: newId }, replace: true });
    },
    onError: (e) => setError(e),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const code = await appRpc<string | { code: string }>('generate_promo_code', { p_id: id });
      return typeof code === 'string' ? code : code.code;
    },
    onSuccess: async (code) => {
      // The server stored the code against the row; mirror it locally so the
      // form shows it without a round trip, then refetch for the truth.
      setDraft((d) => ({ ...d, publicCode: code }));
      setSaved((s) => ({ ...s, publicCode: code }));
      await queryClient.invalidateQueries({ queryKey: PROMOTIONS_KEY });
    },
    onError: (e) => setError(e),
  });

  const lc = row ? lifecycle(row) : null;
  const endedLabel = lc === 'expired' && !dirty && row?.ends_at ? formatDate(new Date(row.ends_at), locale) : null;
  const saveDisabled = readOnly || !dirty || blocker !== null;
  const codeOnly = !draft.auto;

  return (
    <div style={{ maxInlineSize: '64rem' }}>
      <PageHeader
        title={row ? pickName(locale, row) : tr('ws.manager.promotions.editor.newTitle')}
        eyebrow={tr('ws.manager.promotions.title')}
        actions={
          // Top-aligned: Save can carry a line of reason text beneath it, and
          // centring would drop Back and Discard half a line below Save.
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {dirty && <StatusBadge tone="warn" label={tr('ws.manager.promotions.editor.dirty')} style={{ marginBlockStart: 'var(--tp-sp-2)' }} />}
            {row && lc && !dirty && <StatusBadge tone={LIFECYCLE_TONE[lc]} label={statusText(row, tr, locale)} style={{ marginBlockStart: 'var(--tp-sp-2)' }} />}
            <Button onClick={() => void navigate({ to: '/admin/promotions' })}>{tr('ws.kit.actions.back')}</Button>
            <Button kind="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(saved)}>
              {tr('ws.kit.actions.discard')}
            </Button>
            <Button
              kind="primary"
              icon="check"
              busy={save.isPending}
              disabled={saveDisabled}
              // One reason, and only the one a manager can act on here: the
              // permission notice below covers read-only, and "nothing changed"
              // needs no sentence.
              disabledReason={!readOnly && blocker ? tr(`ws.manager.promotions.editor.saveNeeds.${blocker}`) : undefined}
              onClick={() => save.mutate()}
            >
              {tr('ws.kit.actions.save')}
            </Button>
          </div>
        }
      >
        <p
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--tp-sp-2)',
            margin: 0,
            paddingBlock: 'var(--tp-sp-2)',
            paddingInline: 'var(--tp-sp-3)',
            borderRadius: 'var(--tp-radius-ctl)',
            background: 'var(--tp-surface)',
            border: '1px solid var(--tp-border)',
            borderInlineStart: '3px solid var(--tp-accent)',
            fontWeight: 600,
          }}
        >
          <Icon name="tag" size={16} style={{ color: 'var(--tp-muted-fg)', flex: '0 0 auto', marginBlockStart: '0.15rem' }} />
          <bdi>{describePromotion(draft, tr, locale)}</bdi>
        </p>
        {readOnly && <PermissionRefusedNotice action={tr('ws.kit.actions.save')} requiredRole={requiredRoleFor('editPromotions')} />}
      </PageHeader>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))', alignItems: 'start' }}>
        {/* Basics */}
        <Panel title={tr('ws.manager.promotions.editor.basics')}>
          <div onBlur={leave('name')}>
            <BilingualFieldPair
              label={tr('ws.manager.promotions.name')}
              value={draft.name}
              onChange={(name) => patch({ name })}
              required
              disabled={readOnly}
              error={shown('name', 'name') ? tr('ws.manager.promotions.editor.errors.name') : undefined}
            />
          </div>
          <Field label={tr('ws.manager.promotions.editor.type')}>
            <SegmentedControl
              value={draft.type}
              onChange={(type) => patch({ type, value: type === 'percent' ? Math.min(99, Math.max(1, draft.value)) : draft.value })}
              options={[
                { value: 'percent', label: tr('ws.manager.promotions.editor.percent'), disabled: readOnly },
                { value: 'amount', label: tr('ws.manager.promotions.editor.amount'), disabled: readOnly },
              ]}
            />
          </Field>
          <div onBlur={leave('value')}>
            {draft.type === 'percent' ? (
              <Field
                label={tr('ws.manager.promotions.editor.percentValue')}
                error={shown('value', 'percent', 'value') ? tr('ws.manager.promotions.editor.errors.percent') : undefined}
              >
                <PercentInput value={draft.value} onChange={(value) => patch({ value })} min={1} max={99} disabled={readOnly} />
              </Field>
            ) : (
              <Field label={tr('ws.manager.promotions.editor.amountValue')} error={shown('value', 'value') ? tr('ws.manager.promotions.editor.errors.value') : undefined}>
                <MoneyInput value={draft.value} onChange={(v) => patch({ value: v ?? 0 })} disabled={readOnly} />
              </Field>
            )}
          </div>
        </Panel>

        {/* When */}
        <Panel title={tr('ws.manager.promotions.editor.whenTitle')}>
          <div onBlur={leave('dates')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
            <Field label={tr('ws.manager.promotions.editor.starts')}>
              <input style={inputStyle} type="date" dir="ltr" value={draft.startsOn} disabled={readOnly} onChange={(e) => patch({ startsOn: e.target.value })} />
            </Field>
            <Field
              label={tr('ws.manager.promotions.editor.ends')}
              hint={tr('ws.manager.promotions.editor.endsHint')}
              error={shown('dates', 'dates') ? tr('ws.manager.promotions.editor.errors.dates') : undefined}
            >
              <input style={inputStyle} type="date" dir="ltr" value={draft.endsOn} disabled={readOnly} onChange={(e) => patch({ endsOn: e.target.value })} />
            </Field>
          </div>
          {endedLabel && (
            <MessagePresenter
              tone="refused"
              icon="clock"
              style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
              message={tr('ws.manager.promotions.editor.expiredOn', { date: endedLabel })}
            />
          )}
          <Field label={tr('ws.manager.promotions.editor.weekdays')} hint={tr('ws.manager.promotions.editor.weekdaysHint')} group>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
              {DAY_KEYS.map((key, i) => (
                <Button
                  key={key}
                  size="sm"
                  kind={draft.weekdays.includes(i) ? 'primary' : 'default'}
                  aria-pressed={draft.weekdays.includes(i)}
                  disabled={readOnly}
                  onClick={() => patch({ weekdays: toggleWeekday(draft.weekdays, i) })}
                >
                  {tr(`op.days.${key}`)}
                </Button>
              ))}
            </div>
          </Field>
          <div onBlur={leave('hours')}>
            <Field
              label={tr('ws.manager.promotions.editor.hours')}
              hint={tr('ws.manager.promotions.editor.hoursHint')}
              error={shown('hours', 'hours') ? tr('ws.manager.promotions.editor.errors.hours') : undefined}
              group
            >
              <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
                <input
                  style={{ ...inputStyle, inlineSize: 'auto' }}
                  type="time"
                  dir="ltr"
                  aria-label={tr('ws.manager.promotions.editor.hourFrom')}
                  value={draft.hourFrom}
                  disabled={readOnly}
                  onChange={(e) => patch({ hourFrom: e.target.value })}
                />
                <span style={{ color: 'var(--tp-muted-fg)' }}>–</span>
                <input
                  style={{ ...inputStyle, inlineSize: 'auto' }}
                  type="time"
                  dir="ltr"
                  aria-label={tr('ws.manager.promotions.editor.hourTo')}
                  value={draft.hourTo}
                  disabled={readOnly}
                  onChange={(e) => patch({ hourTo: e.target.value })}
                />
              </div>
            </Field>
          </div>
        </Panel>

        {/* Scope */}
        <Panel title={tr('ws.manager.promotions.editor.scopeTitle')}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.manager.promotions.editor.scopeHint')}</p>
          <ChipPicker
            label={tr('ws.manager.promotions.editor.courts')}
            hint={tr('ws.manager.promotions.editor.courtsHint')}
            options={(courtsQ.data ?? []).map((c) => ({ id: c.id, label: pickName(locale, c) }))}
            selected={draft.scope.courtIds}
            disabled={readOnly}
            onToggle={(cid) => patch({ scope: { ...draft.scope, courtIds: toggleId(draft.scope.courtIds, cid) } })}
          />
          <ChipPicker
            label={tr('ws.manager.promotions.editor.categories')}
            options={(menu.data?.categories ?? []).map((c) => ({ id: c.id, label: pickName(locale, c) }))}
            selected={draft.scope.categoryIds}
            disabled={readOnly}
            onToggle={(cid) => patch({ scope: { ...draft.scope, categoryIds: toggleId(draft.scope.categoryIds, cid) } })}
          />
          <ChipPicker
            label={tr('ws.manager.promotions.editor.items')}
            options={(menu.data?.items ?? []).filter((i) => i.is_active || draft.scope.itemIds.includes(i.id)).map((i) => ({ id: i.id, label: pickName(locale, i) }))}
            selected={draft.scope.itemIds}
            disabled={readOnly}
            onToggle={(iid) => patch({ scope: { ...draft.scope, itemIds: toggleId(draft.scope.itemIds, iid) } })}
          />
        </Panel>

        {/* Limits */}
        <Panel title={tr('ws.manager.promotions.editor.limitsTitle')}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.manager.promotions.editor.limitHint')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
            <Field label={tr('ws.manager.promotions.editor.limitTotal')}>
              <CountInput value={draft.limits.total} disabled={readOnly} onChange={(total) => patch({ limits: { ...draft.limits, total } })} />
            </Field>
            <Field label={tr('ws.manager.promotions.editor.limitPerCustomer')}>
              <CountInput value={draft.limits.perCustomer} disabled={readOnly} onChange={(perCustomer) => patch({ limits: { ...draft.limits, perCustomer } })} />
            </Field>
          </div>
          <Field label={tr('ws.manager.promotions.editor.minSpend')}>
            <MoneyInput value={draft.limits.minSpendIqd} allowEmpty disabled={readOnly} onChange={(minSpendIqd) => patch({ limits: { ...draft.limits, minSpendIqd } })} />
          </Field>
        </Panel>

        {/* How */}
        <Panel title={tr('ws.manager.promotions.editor.howTitle')} style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-5)', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
              <SegmentedControl
                aria-label={tr('ws.manager.promotions.editor.howTitle')}
                value={codeOnly ? 'code' : 'auto'}
                onChange={(v) => patch({ auto: v === 'auto' })}
                options={[
                  { value: 'auto', label: tr('ws.manager.promotions.editor.howAuto'), disabled: readOnly },
                  { value: 'code', label: tr('ws.manager.promotions.editor.howCode'), icon: 'tag', disabled: readOnly },
                ]}
              />
              <p style={{ ...hintStyle, marginBlockStart: 0 }}>
                {tr(codeOnly ? 'ws.manager.promotions.editor.codeHint' : 'ws.manager.promotions.editor.autoHint')}
              </p>

              {(codeOnly || draft.publicCode) && (
                <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start', marginBlockStart: 'var(--tp-sp-1)' }}>
                  <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.manager.promotions.editor.publicCode')}</span>
                  <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {draft.publicCode ? (
                      <StatusBadge tone="accent" icon="tag" label={draft.publicCode} style={{ fontFamily: 'var(--tp-font-numeric)', letterSpacing: '0.04em' }} />
                    ) : (
                      <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', paddingBlock: 'var(--tp-sp-1)' }}>
                        {tr('ws.manager.promotions.editor.noCode')}
                      </span>
                    )}
                    <Button
                      size="sm"
                      icon="refresh"
                      busy={generate.isPending}
                      disabled={readOnly || id === null || dirty}
                      disabledReason={!readOnly && (id === null || dirty) ? tr('ws.manager.promotions.editor.generateHint') : undefined}
                      onClick={() => generate.mutate()}
                    >
                      {tr('ws.manager.promotions.editor.generate')}
                    </Button>
                  </div>
                  {codeOnly && !draft.publicCode && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-warn-fg)', fontWeight: 600 }}>
                      <Icon name="alert" size={14} />
                      {tr('ws.manager.promotions.editor.codeMissing')}
                    </span>
                  )}
                  <Switch
                    checked={draft.codeSingleUse}
                    disabled={readOnly}
                    onChange={(codeSingleUse) => patch({ codeSingleUse })}
                    label={tr('ws.manager.promotions.editor.codeSingleUse')}
                  />
                </div>
              )}
            </div>
            <div>
              <Switch checked={draft.enabled} disabled={readOnly} onChange={(enabled) => patch({ enabled })} label={tr('ws.manager.promotions.editor.enabledLabel')} />
              <p style={hintStyle}>{tr('ws.manager.promotions.editor.enabledHint')}</p>
            </div>
          </div>
          <p style={{ ...hintStyle, display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', marginBlockStart: 'var(--tp-sp-4)' }}>
            <Icon name="info" size={13} />
            {tr('ws.manager.promotions.editor.bestOnly')}
          </p>
          <ErrorText error={error} />
        </Panel>
      </div>
    </div>
  );
}

function CountInput({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <input
      style={inputStyle}
      dir="ltr"
      inputMode="numeric"
      value={value === null ? '' : String(value)}
      disabled={disabled}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '');
        onChange(digits === '' ? null : Number(digits));
      }}
    />
  );
}

/** Above this many options a picker starts from a search instead of every chip. */
const SEARCH_ABOVE = 16;
/** Search results drawn at once; the rest wait for a narrower search. */
const RESULTS_SHOWN = 24;

/**
 * Pick ids by name. A short list (a venue's courts) shows every chip in a
 * bordered box that grows to fit — nothing clipped. A long list (menu items)
 * shows what is chosen, then a search; results appear only once something is
 * typed. The old picker cut chips in half at the bottom of a borderless
 * 9rem scroll area and drew ~190 of them for items.
 */
function ChipPicker({
  label,
  hint,
  options,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  hint?: string;
  options: { id: string; label: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const { tr, locale } = useLocale();
  const [q, setQ] = useState('');
  const searchable = options.length > SEARCH_ABOVE;
  const chosen = options.filter((o) => selected.includes(o.id));
  const needle = q.trim().toLowerCase();
  const matches = needle ? options.filter((o) => !selected.includes(o.id) && o.label.toLowerCase().includes(needle)) : [];

  const chip = (o: { id: string; label: string }) => {
    const on = selected.includes(o.id);
    return (
      <Button key={o.id} size="sm" kind={on ? 'primary' : 'default'} icon={on ? 'check' : undefined} aria-pressed={on} disabled={disabled} onClick={() => onToggle(o.id)}>
        <bdi>{o.label}</bdi>
      </Button>
    );
  };

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, marginBlockEnd: 'var(--tp-sp-4)', minInlineSize: 0 }}>
      <legend style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>
        {label}
        {selected.length > 0 && (
          <span style={{ color: 'var(--tp-muted-fg)', fontWeight: 400 }}>
            {' · '}
            {tr('ws.manager.promotions.editor.chosen', { n: formatNumber(selected.length, locale) })}
          </span>
        )}
      </legend>
      {hint && <p style={{ ...hintStyle, marginBlockStart: 0, marginBlockEnd: 'var(--tp-sp-1-5)' }}>{hint}</p>}

      {!searchable ? (
        <ChipBox>{options.length === 0 ? <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.kit.common.none')}</span> : options.map(chip)}</ChipBox>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          {chosen.length > 0 && <div style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>{chosen.map(chip)}</div>}
          {!disabled && <SearchField value={q} onChange={setQ} aria-label={`${label}: ${tr('ws.kit.search.placeholder')}`} />}
          {!disabled &&
            (needle === '' ? (
              <span style={{ ...hintStyle, marginBlockStart: 0 }}>{tr('ws.manager.promotions.editor.searchToAdd')}</span>
            ) : (
              <ChipBox>
                {matches.length === 0 ? (
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.promotions.editor.noResults')}</span>
                ) : (
                  matches.slice(0, RESULTS_SHOWN).map(chip)
                )}
                {matches.length > RESULTS_SHOWN && (
                  <span style={{ ...hintStyle, flexBasis: '100%' }}>
                    {tr('ws.manager.promotions.editor.moreResults', { shown: formatNumber(RESULTS_SHOWN, locale) })}
                  </span>
                )}
              </ChipBox>
            ))}
        </div>
      )}
    </fieldset>
  );
}

function ChipBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--tp-sp-1)',
        flexWrap: 'wrap',
        padding: 'var(--tp-sp-2)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
      }}
    >
      {children}
    </div>
  );
}
