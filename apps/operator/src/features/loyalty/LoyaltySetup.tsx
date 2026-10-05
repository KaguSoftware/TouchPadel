/**
 * Setup › Loyalty (docs/design/loyalty/build-contracts-2026-10-05.md §1.3, plan §5.3): the
 * owner's points settings, tiers and rewards. Business-wide (L-7: points are shared across
 * branches), so the page does not follow the rail's branch except where a reward is limited to
 * one.
 *
 * Reads app.loyalty_admin; writes app.set_loyalty_settings (the whole settings as the patch),
 * app.upsert_loyalty_tier, app.delete_loyalty_tier (the base tier, sort 0, is refused and never
 * offered) and app.upsert_loyalty_reward (also the On offer switch; there is no reward delete).
 * Every write is online only and re-reads the page and the till's copy of the terms.
 *
 * Loyalty ships switched off (L-1) until the client gives the point value, tier names and
 * thresholds; this is where the owner switches it on.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber } from '@touch/i18n';
import type { LoyaltyAdminReward, LoyaltyAdminTier } from '@touch/core/loyalty';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { can, useAuth } from '../../lib/auth';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Switch } from '../../components/Switch';
import { Button, ErrorText, Field, Modal, Select, Skeleton, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, MessagePresenter, PageHeader, Panel } from '../../components/kit';
import { NumberField } from '../admin/settings/settingsFields';
import { TILL_MENU_QUERY } from '../till/tillData';
import {
  isBaseTier,
  rewardDraft,
  rewardErrors,
  rewardPayload,
  settingsDraft,
  settingsErrors,
  settingsPatch,
  tierDraft,
  tierErrors,
  tierPayload,
  type RewardDraft,
  type SettingsDraft,
  type TierDraft,
} from './loyaltyLogic';
import { invalidateLoyaltyAdmin, useLoyaltyAdmin } from './useLoyalty';

const K = 'ws.loyalty.setup';

export function LoyaltySetupScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const canEdit = can(staff?.role, 'editLoyalty');
  const q = useLoyaltyAdmin();
  const status = q.isError && !q.data ? 'error' : q.data ? 'ready' : 'loading';

  return (
    <div
      style={{ display: 'grid', gap: 'var(--tp-sp-4)', maxInlineSize: 'var(--tp-measure-wide)' }}
    >
      <PageHeader title={tr(`${K}.title`)} subtitle={tr(`${K}.lead`)} />
      {!canEdit && <MessagePresenter tone="info" icon="lock" message={tr(`${K}.ownerOnly`)} />}
      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<Skeleton lines={8} />}
      >
        {q.data && (
          <>
            <SettingsPanel
              key={JSON.stringify(q.data.settings)}
              canEdit={canEdit}
              draft0={settingsDraft(q.data.settings)}
            />
            <TiersPanel canEdit={canEdit} tiers={q.data.tiers} />
            <RewardsPanel canEdit={canEdit} rewards={q.data.rewards} />
          </>
        )}
      </AsyncStateWrapper>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

function SettingsPanel({ canEdit, draft0 }: { canEdit: boolean; draft0: SettingsDraft }) {
  const { tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const [draft, setDraft] = useState(draft0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const errors = touched ? settingsErrors(draft) : {};
  const S = `${K}.settings` as const;
  const set = <F extends keyof SettingsDraft>(f: F, v: SettingsDraft[F]) =>
    setDraft((d) => ({ ...d, [f]: v }));
  const err = (f: keyof SettingsDraft) => {
    const e = errors[f];
    return e ? tr(`${S}.errors.${e}`) : undefined;
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(draft0);

  async function save() {
    setTouched(true);
    if (Object.keys(settingsErrors(draft)).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('set_loyalty_settings', { p_patch: settingsPatch(draft) });
      invalidateLoyaltyAdmin(qc);
      toast.ok(tr(`${K}.saved`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const earn: {
    f: 'earn_cafe' | 'earn_shop' | 'earn_court' | 'earn_lesson' | 'earn_tournament';
    label: string;
  }[] = [
    { f: 'earn_cafe', label: tr(`${S}.earnCafe`) },
    { f: 'earn_shop', label: tr(`${S}.earnShop`) },
    { f: 'earn_court', label: tr(`${S}.earnCourt`) },
    { f: 'earn_lesson', label: tr(`${S}.earnLesson`) },
    { f: 'earn_tournament', label: tr(`${S}.earnTournament`) },
  ];

  return (
    <Panel title={tr(`${S}.title`)} data-testid="loyalty-settings">
      <fieldset
        disabled={!canEdit || busy}
        style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <Switch
            checked={draft.enabled}
            onChange={(v) => set('enabled', v)}
            label={tr(`${S}.enabled`)}
            disabled={!canEdit}
          />
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr(`${S}.enabledHint`)}
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gap: 'var(--tp-sp-3)',
            gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
          }}
        >
          <NumberField
            label={tr(`${S}.iqdPerPoint`)}
            hint={tr(`${S}.iqdPerPointHint`)}
            unit={tr(`${S}.unitIqd`)}
            value={draft.iqd_per_point}
            onChange={(v) => set('iqd_per_point', v)}
            error={err('iqd_per_point')}
          />
          <NumberField
            label={tr(`${S}.pointValue`)}
            hint={tr(`${S}.pointValueHint`)}
            unit={tr(`${S}.unitIqd`)}
            value={draft.point_value_iqd}
            onChange={(v) => set('point_value_iqd', v)}
            error={err('point_value_iqd')}
          />
          <NumberField
            label={tr(`${S}.minRedeem`)}
            hint={tr(`${S}.minRedeemHint`)}
            unit={tr(`${S}.unitPoints`)}
            value={draft.min_redeem_points}
            onChange={(v) => set('min_redeem_points', v)}
            error={err('min_redeem_points')}
          />
          <NumberField
            label={tr(`${S}.inactivity`)}
            hint={tr(`${S}.inactivityHint`)}
            unit={tr(`${S}.unitMonths`)}
            optional
            value={draft.inactivity_expiry_months}
            onChange={(v) => set('inactivity_expiry_months', v)}
            error={err('inactivity_expiry_months')}
          />
          <NumberField
            label={tr(`${S}.totpStep`)}
            hint={tr(`${S}.totpStepHint`)}
            unit={tr(`${S}.unitSeconds`)}
            value={draft.totp_step_seconds}
            onChange={(v) => set('totp_step_seconds', v)}
            error={err('totp_step_seconds')}
          />
        </div>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--tp-fs-sm)' }}>
            {tr(`${S}.earnTitle`)}
          </span>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', flexWrap: 'wrap' }}>
            {earn.map((e) => (
              <Switch
                key={e.f}
                checked={draft[e.f]}
                onChange={(v) => set(e.f, v)}
                label={e.label}
                disabled={!canEdit}
              />
            ))}
          </div>
        </div>
      </fieldset>
      <ErrorText error={error} />
      {canEdit && (
        <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
          <Button
            kind="primary"
            busy={busy}
            disabled={!dirty || !reachable}
            onClick={() => void save()}
            data-testid="loyalty-settings-save"
          >
            {tr(`${S}.save`)}
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

function TiersPanel({ canEdit, tiers }: { canEdit: boolean; tiers: LoyaltyAdminTier[] }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const [editing, setEditing] = useState<TierDraft | null>(null);
  const [removing, setRemoving] = useState<LoyaltyAdminTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const T = `${K}.tiers` as const;
  const sorted = useMemo(() => [...tiers].sort((a, b) => a.sort - b.sort), [tiers]);

  async function remove(t: LoyaltyAdminTier) {
    setBusy(true);
    setError(null);
    try {
      await appRpc('delete_loyalty_tier', { p_tier_id: t.id });
      invalidateLoyaltyAdmin(qc);
      setRemoving(null);
      toast.ok(tr(`${K}.saved`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={tr(`${T}.title`)}
      data-testid="loyalty-tiers"
      actions={
        canEdit ? (
          <Button
            size="sm"
            icon="plus"
            disabled={!reachable}
            onClick={() => setEditing(tierDraft(null, tiers))}
          >
            {tr(`${T}.add`)}
          </Button>
        ) : undefined
      }
    >
      <p style={{ marginBlockStart: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr(`${T}.lead`)}
      </p>
      {sorted.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr(`${T}.empty`)}</p>
      ) : (
        <table className="tp-table" data-dense="true">
          <thead>
            <tr>
              <th>{tr(`${T}.columns.name`)}</th>
              <th style={{ textAlign: 'end' }}>{tr(`${T}.columns.minPoints`)}</th>
              <th style={{ textAlign: 'end' }}>{tr(`${T}.columns.multiplier`)}</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id}>
                <td>
                  <bdi>{pickName(locale, t)}</bdi>
                  {isBaseTier(t) && (
                    <span
                      style={{
                        marginInlineStart: 'var(--tp-sp-2)',
                        fontSize: 'var(--tp-fs-xs)',
                        color: 'var(--tp-muted-fg)',
                      }}
                    >
                      {tr(`${T}.base`)}
                    </span>
                  )}
                </td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                  {formatNumber(t.min_points_12m, locale)}
                </td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                  {tr(`${T}.multiplierValue`, {
                    value: formatNumber(Number(t.earn_multiplier), locale),
                  })}
                </td>
                {canEdit && (
                  <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
                    <Button
                      size="sm"
                      kind="ghost"
                      icon="settings"
                      disabled={!reachable}
                      onClick={() => setEditing(tierDraft(t, tiers))}
                    >
                      {tr(`${T}.edit`)}
                    </Button>
                    {!isBaseTier(t) && (
                      <Button
                        size="sm"
                        kind="ghost"
                        icon="trash"
                        disabled={!reachable}
                        onClick={() => setRemoving(t)}
                      >
                        {tr(`${T}.remove`)}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <TierEditor draft0={editing} onClose={() => setEditing(null)} />}
      {removing && (
        <Modal
          title={tr(`${T}.removeTitle`, { name: pickName(locale, removing) })}
          size="sm"
          dismissible={!busy}
          onClose={() => setRemoving(null)}
          footer={(close) => (
            <>
              <Button onClick={close} disabled={busy}>
                {tr(`${K}.cancel`)}
              </Button>
              <Button kind="danger" busy={busy} onClick={() => void remove(removing)}>
                {tr(`${T}.remove`)}
              </Button>
            </>
          )}
        >
          <p style={{ margin: 0 }}>{tr(`${T}.removeBody`)}</p>
          <ErrorText error={error} />
        </Modal>
      )}
    </Panel>
  );
}

function TierEditor({ draft0, onClose }: { draft0: TierDraft; onClose: () => void }) {
  const { tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState(draft0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const T = `${K}.tiers` as const;
  const errors = touched ? tierErrors(d) : {};

  async function save() {
    setTouched(true);
    if (Object.keys(tierErrors(d)).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('upsert_loyalty_tier', { p_tier: tierPayload(d) });
      invalidateLoyaltyAdmin(qc);
      toast.ok(tr(`${K}.saved`));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr(d.id ? `${T}.edit` : `${T}.add`)}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr(`${K}.cancel`)}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => void save()} data-testid="tier-save">
            {tr(`${K}.save`)}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: '1fr 1fr' }}>
        <Field
          label={tr(`${T}.nameEn`)}
          error={errors.names ? tr(`${T}.errors.names`) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <input
            style={inputStyle}
            dir="ltr"
            value={d.name_en}
            maxLength={40}
            onChange={(e) => setD({ ...d, name_en: e.target.value })}
          />
        </Field>
        <Field label={tr(`${T}.nameAr`)} style={{ marginBlockEnd: 0 }}>
          <input
            style={inputStyle}
            dir="rtl"
            lang="ar"
            value={d.name_ar}
            maxLength={40}
            onChange={(e) => setD({ ...d, name_ar: e.target.value })}
          />
        </Field>
        <Field
          label={tr(`${T}.minPoints`)}
          error={errors.min_points_12m ? tr(`${T}.errors.minPoints`) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <input
            style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
            dir="ltr"
            inputMode="numeric"
            value={d.min_points_12m}
            disabled={draft0.id !== null && draft0.sort === 0}
            onChange={(e) => setD({ ...d, min_points_12m: e.target.value.replace(/[^\d]/g, '') })}
          />
        </Field>
        <Field
          label={tr(`${T}.multiplier`)}
          hint={tr(`${T}.multiplierHint`)}
          error={errors.earn_multiplier ? tr(`${T}.errors.multiplier`) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <input
            style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
            dir="ltr"
            inputMode="decimal"
            value={d.earn_multiplier}
            onChange={(e) =>
              setD({ ...d, earn_multiplier: e.target.value.replace(/[^\d.٫]/g, '') })
            }
          />
        </Field>
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

function RewardsPanel({ canEdit, rewards }: { canEdit: boolean; rewards: LoyaltyAdminReward[] }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const { reachable } = useStationReach();
  const [editing, setEditing] = useState<RewardDraft | null>(null);
  const R = `${K}.rewards` as const;

  async function toggle(r: LoyaltyAdminReward, active: boolean) {
    // A refusal throws: Switch reverts and toasts the catalogue's line.
    await appRpc('upsert_loyalty_reward', {
      p_reward: rewardPayload({ ...rewardDraft(r), active }),
    });
    invalidateLoyaltyAdmin(qc);
  }

  return (
    <Panel
      title={tr(`${R}.title`)}
      data-testid="loyalty-rewards"
      actions={
        canEdit ? (
          <Button
            size="sm"
            icon="plus"
            disabled={!reachable}
            onClick={() => setEditing(rewardDraft(null))}
          >
            {tr(`${R}.add`)}
          </Button>
        ) : undefined
      }
    >
      <p style={{ marginBlockStart: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
        {tr(`${R}.lead`)}
      </p>
      {rewards.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr(`${R}.empty`)}</p>
      ) : (
        <table className="tp-table" data-dense="true">
          <thead>
            <tr>
              <th>{tr(`${R}.columns.name`)}</th>
              <th style={{ textAlign: 'end' }}>{tr(`${R}.columns.cost`)}</th>
              <th>{tr(`${R}.columns.gives`)}</th>
              <th>{tr(`${R}.columns.active`)}</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rewards.map((r) => (
              <tr key={r.id}>
                <td>
                  <bdi>{pickName(locale, r)}</bdi>
                </td>
                <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
                  {tr('ws.loyalty.rewards.cost', { points: formatNumber(r.cost_points, locale) })}
                </td>
                <td>
                  {r.kind === 'iqd_off' && r.iqd_off != null
                    ? tr('ws.loyalty.rewards.iqdOff', { amount: formatIQD(r.iqd_off, locale) })
                    : tr('ws.loyalty.rewards.item')}
                </td>
                <td>
                  <Switch
                    checked={r.active}
                    onChange={(v) => toggle(r, v)}
                    label={tr(`${R}.active`)}
                    hideLabel
                    disabled={!canEdit || !reachable}
                  />
                </td>
                {canEdit && (
                  <td style={{ textAlign: 'end' }}>
                    <Button
                      size="sm"
                      kind="ghost"
                      icon="settings"
                      disabled={!reachable}
                      onClick={() => setEditing(rewardDraft(r))}
                    >
                      {tr(`${R}.edit`)}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && <RewardEditor draft0={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function RewardEditor({ draft0, onClose }: { draft0: RewardDraft; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const menuQ = useQuery(TILL_MENU_QUERY);
  const [d, setD] = useState(draft0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const R = `${K}.rewards` as const;
  const errors = touched ? rewardErrors(d) : {};

  // Every size of every active item, named "Item · Size" where an item has more than one.
  const variants = useMemo(
    () =>
      (menuQ.data?.items ?? [])
        .filter((i) => i.is_active)
        .flatMap((i) =>
          i.menu_item_variants.map((v) => ({
            value: v.id,
            label:
              i.menu_item_variants.length > 1
                ? `${pickName(locale, i)} · ${pickName(locale, v)}`
                : pickName(locale, i),
          })),
        ),
    [menuQ.data, locale],
  );
  useEffect(() => {
    if (d.kind === 'iqd_off' && d.menu_variant_id) setD((x) => ({ ...x, menu_variant_id: null }));
  }, [d.kind, d.menu_variant_id]);

  async function save() {
    setTouched(true);
    if (Object.keys(rewardErrors(d)).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('upsert_loyalty_reward', { p_reward: rewardPayload(d) });
      invalidateLoyaltyAdmin(qc);
      toast.ok(tr(`${K}.saved`));
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr(d.id ? `${R}.edit` : `${R}.add`)}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr(`${K}.cancel`)}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => void save()} data-testid="reward-save">
            {tr(`${K}.save`)}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: '1fr 1fr' }}>
        <Field
          label={tr(`${R}.nameEn`)}
          error={errors.names ? tr(`${R}.errors.names`) : undefined}
          style={{ marginBlockEnd: 0 }}
        >
          <input
            style={inputStyle}
            dir="ltr"
            value={d.name_en}
            maxLength={60}
            onChange={(e) => setD({ ...d, name_en: e.target.value })}
          />
        </Field>
        <Field label={tr(`${R}.nameAr`)} style={{ marginBlockEnd: 0 }}>
          <input
            style={inputStyle}
            dir="rtl"
            lang="ar"
            value={d.name_ar}
            maxLength={60}
            onChange={(e) => setD({ ...d, name_ar: e.target.value })}
          />
        </Field>
        <NumberField
          label={tr(`${R}.cost`)}
          hint=""
          unit={tr(`${K}.settings.unitPoints`)}
          value={d.cost_points}
          onChange={(v) => setD({ ...d, cost_points: v })}
          error={errors.cost ? tr(`${R}.errors.cost`) : undefined}
        />
        <Field label={tr(`${R}.kind`)} style={{ marginBlockEnd: 0 }}>
          <Select<'iqd_off' | 'item'>
            value={d.kind}
            onChange={(kind) => setD({ ...d, kind })}
            options={[
              { value: 'iqd_off', label: tr(`${R}.kindIqdOff`) },
              { value: 'item', label: tr(`${R}.kindItem`) },
            ]}
          />
        </Field>
        {d.kind === 'iqd_off' ? (
          <NumberField
            label={tr(`${R}.iqdOff`)}
            hint=""
            unit={tr(`${K}.settings.unitIqd`)}
            value={d.iqd_off}
            onChange={(v) => setD({ ...d, iqd_off: v })}
            error={errors.iqdOff ? tr(`${R}.errors.iqdOff`) : undefined}
          />
        ) : (
          <Field
            label={tr(`${R}.variant`)}
            error={errors.variant ? tr(`${R}.errors.variant`) : undefined}
            style={{ marginBlockEnd: 0 }}
          >
            <Select<string>
              value={d.menu_variant_id ?? ''}
              placeholder={tr(`${R}.variantPlaceholder`)}
              onChange={(id) => setD({ ...d, menu_variant_id: id })}
              options={variants}
            />
          </Field>
        )}
        <div style={{ alignSelf: 'end' }}>
          <Switch
            checked={d.active}
            onChange={(v) => setD({ ...d, active: v })}
            label={tr(`${R}.active`)}
          />
        </div>
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}
