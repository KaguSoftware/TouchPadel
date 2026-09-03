/**
 * Promotion editor (spec 06.27) — one configurable promotion. `$id` is `new`
 * for a fresh one. Saves through `app.upsert_promotion`; the public code is
 * minted server-side by `app.generate_promo_code`. No stacking configuration:
 * the server applies the single best eligible promotion.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate, useParams } from '@tanstack/react-router';
import { formatDate } from '@touch/i18n';
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
  SegmentedControl,
  StatusBadge,
  asyncStatus,
} from '../../../components/kit';
import { MoneyInput, PercentInput } from '../../../components/inputs';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useAdminMenu } from '../menu/useAdminMenu';
import {
  EMPTY_DRAFT,
  fromRow,
  isDirty,
  lifecycle,
  toRpcArgs,
  toggleId,
  toggleWeekday,
  validateDraft,
  type PromotionDraft,
} from './promotionLogic';
import { PROMOTIONS_KEY, fetchPromotion, promotionKey, type PromotionRow } from './promotionsApi';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

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
  const dirty = isDirty(draft, saved);
  const errors = validateDraft(draft);
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
  const endsLabel = draft.endsOn ? formatDate(new Date(`${draft.endsOn}T00:00:00`), locale) : null;

  return (
    <div style={{ maxInlineSize: '64rem' }}>
      <PageHeader
        title={row ? pickName(locale, row) : tr('ws.manager.promotions.editor.newTitle')}
        eyebrow={tr('ws.manager.promotions.title')}
        actions={
          <>
            {dirty && <StatusBadge tone="warn" label={tr('ws.manager.promotions.editor.dirty')} />}
            {lc && !dirty && <StatusBadge tone={lc === 'live' ? 'success' : lc === 'scheduled' ? 'info' : 'neutral'} label={tr(`ws.manager.promotions.${lc}`)} />}
            <Button onClick={() => void navigate({ to: '/admin/promotions' })}>{tr('ws.kit.actions.back')}</Button>
            <Button kind="ghost" disabled={!dirty || save.isPending} onClick={() => setDraft(saved)}>
              {tr('ws.kit.actions.discard')}
            </Button>
            <Button kind="primary" icon="check" busy={save.isPending} disabled={readOnly || !dirty || errors.length > 0} onClick={() => save.mutate()}>
              {tr('ws.kit.actions.save')}
            </Button>
          </>
        }
      >
        <MessagePresenter tone="info" message={tr('ws.manager.promotions.bestOnly')} />
        {readOnly && <PermissionRefusedNotice action={tr('ws.kit.actions.save')} requiredRole={requiredRoleFor('editPromotions')} />}
      </PageHeader>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))', alignItems: 'start' }}>
        {/* Basics */}
        <Panel title={tr('ws.manager.promotions.editor.basics')}>
          <BilingualFieldPair
            label={tr('ws.manager.promotions.name')}
            value={draft.name}
            onChange={(name) => patch({ name })}
            required
            disabled={readOnly}
            error={errors.includes('name') ? tr('ws.manager.promotions.editor.errors.name') : undefined}
          />
          <Field label={tr('ws.manager.promotions.editor.type')}>
            <SegmentedControl
              value={draft.type}
              onChange={(type) => patch({ type, value: type === 'percent' ? Math.min(99, Math.max(1, draft.value)) : draft.value })}
              options={[
                { value: 'percent', label: tr('ws.manager.promotions.editor.percent') },
                { value: 'amount', label: tr('ws.manager.promotions.editor.amount') },
              ]}
            />
          </Field>
          {draft.type === 'percent' ? (
            <Field
              label={tr('ws.manager.promotions.editor.percentValue')}
              error={errors.includes('percent') || errors.includes('value') ? tr('ws.manager.promotions.editor.errors.percent') : undefined}
            >
              <PercentInput value={draft.value} onChange={(value) => patch({ value })} min={1} max={99} disabled={readOnly} />
            </Field>
          ) : (
            <Field label={tr('ws.manager.promotions.editor.amountValue')} error={errors.includes('value') ? tr('ws.manager.promotions.editor.errors.value') : undefined}>
              <MoneyInput value={draft.value} onChange={(v) => patch({ value: v ?? 0 })} disabled={readOnly} />
            </Field>
          )}
        </Panel>

        {/* When */}
        <Panel title={tr('ws.manager.promotions.editor.whenTitle')}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            <Field label={tr('ws.manager.promotions.editor.starts')}>
              <input style={inputStyle} type="date" dir="ltr" value={draft.startsOn} disabled={readOnly} onChange={(e) => patch({ startsOn: e.target.value })} />
            </Field>
            <Field
              label={tr('ws.manager.promotions.editor.ends')}
              hint={tr('ws.manager.promotions.editor.endsHint')}
              error={errors.includes('dates') ? tr('ws.manager.promotions.editor.errors.dates') : undefined}
            >
              <input style={inputStyle} type="date" dir="ltr" value={draft.endsOn} disabled={readOnly} onChange={(e) => patch({ endsOn: e.target.value })} />
            </Field>
          </div>
          {endsLabel && (
            <MessagePresenter
              tone={lc === 'expired' && !dirty ? 'refused' : 'info'}
              icon="clock"
              style={{ marginBlockEnd: '0.75rem' }}
              message={
                lc === 'expired' && !dirty
                  ? tr('ws.manager.promotions.editor.expiredOn', { date: endsLabel })
                  : tr('ws.manager.promotions.editor.expiresIn', { date: endsLabel })
              }
            />
          )}
          <Field label={tr('ws.manager.promotions.editor.weekdays')} hint={tr('ws.manager.promotions.editor.weekdaysHint')}>
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
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
          <Field
            label={tr('ws.manager.promotions.editor.hours')}
            hint={tr('ws.manager.promotions.editor.hoursHint')}
            error={errors.includes('hours') ? tr('ws.manager.promotions.editor.errors.hours') : undefined}
          >
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
        </Panel>

        {/* Scope */}
        <Panel title={tr('ws.manager.promotions.editor.scopeTitle')}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.75rem' }}>{tr('ws.manager.promotions.editor.scopeHint')}</p>
          <ChipPicker
            label={tr('ws.manager.promotions.editor.courts')}
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
            options={(menu.data?.items ?? []).filter((i) => i.is_active).map((i) => ({ id: i.id, label: pickName(locale, i) }))}
            selected={draft.scope.itemIds}
            disabled={readOnly}
            searchable
            onToggle={(iid) => patch({ scope: { ...draft.scope, itemIds: toggleId(draft.scope.itemIds, iid) } })}
          />
        </Panel>

        {/* Limits */}
        <Panel title={tr('ws.manager.promotions.editor.limitsTitle')}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.75rem' }}>{tr('ws.manager.promotions.editor.limitHint')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
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
          <div style={{ display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', alignItems: 'start' }}>
            <div>
              <Switch checked={draft.auto} disabled={readOnly} onChange={(auto) => patch({ auto })} label={tr('ws.manager.promotions.editor.autoLabel')} />
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: '0.3rem' }}>{tr('ws.manager.promotions.editor.autoHint')}</p>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: '0.3rem' }}>{tr('ws.manager.promotions.editor.publicCode')}</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {draft.publicCode ? (
                  <StatusBadge tone="accent" icon="tag" label={draft.publicCode} />
                ) : (
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.promotions.editor.noCode')}</span>
                )}
                <Button
                  size="sm"
                  icon="refresh"
                  busy={generate.isPending}
                  disabled={readOnly || id === null || dirty}
                  title={id === null || dirty ? tr('ws.manager.promotions.editor.generateHint') : undefined}
                  onClick={() => generate.mutate()}
                >
                  {tr('ws.manager.promotions.editor.generate')}
                </Button>
              </div>
              {(id === null || dirty) && (
                <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: '0.3rem' }}>{tr('ws.manager.promotions.editor.generateHint')}</p>
              )}
              <div style={{ marginBlockStart: '0.6rem' }}>
                <Switch checked={draft.codeSingleUse} disabled={readOnly} onChange={(codeSingleUse) => patch({ codeSingleUse })} label={tr('ws.manager.promotions.editor.codeSingleUse')} />
              </div>
            </div>
            <div>
              <Switch checked={draft.enabled} disabled={readOnly} onChange={(enabled) => patch({ enabled })} label={tr('ws.manager.promotions.editor.enabledLabel')} />
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: '0.3rem' }}>{tr('ws.manager.promotions.lead')}</p>
            </div>
          </div>
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

function ChipPicker({
  label,
  options,
  selected,
  onToggle,
  disabled,
  searchable,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const { tr } = useLocale();
  const [q, setQ] = useState('');
  const shown = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()) || selected.includes(o.id)) : options;
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, marginBlockEnd: '0.85rem' }}>
      <legend style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: '0.3rem' }}>
        {label}
        {selected.length > 0 && <span style={{ color: 'var(--tp-muted-fg)', fontWeight: 400 }}> · {selected.length}</span>}
      </legend>
      {searchable && (
        <input
          type="search"
          style={{ ...inputStyle, marginBlockEnd: '0.4rem' }}
          placeholder={tr('ws.kit.search.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', maxBlockSize: '9rem', overflowY: 'auto' }}>
        {shown.length === 0 && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.kit.common.none')}</span>}
        {shown.map((o) => {
          const on = selected.includes(o.id);
          return (
            <Button key={o.id} size="sm" kind={on ? 'primary' : 'default'} aria-pressed={on} disabled={disabled} onClick={() => onToggle(o.id)}>
              <bdi>{o.label}</bdi>
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}
