/**
 * Setup › Loyalty › Card privileges (0410): what each card gives besides points. Under each
 * tier, its privileges: the name guests read in both languages, what it does, an On switch,
 * Edit and Remove; and "Add a privilege".
 *
 * Two kinds, in the owner's words:
 *   Free add-ons    paid add-ons on a drink cost nothing: every add-on, or only the add-on
 *                   groups ticked (milk, syrups, extra shot). The till takes them off the
 *                   member's bill by itself (app.loyalty_perks_refresh).
 *   Something else  a line the staff honour by hand (priority booking, a racket to borrow).
 *
 * A card also holds everything the cards below it give. That is said once, in the panel's
 * lead, where the owner decides which card gets a privilege.
 *
 * Reads loyalty_admin().tiers[].perks (the page's own query) and the menu's add-on groups
 * (the Add-ons page's read, useAddons). Writes app.upsert_loyalty_tier_perk (also the On
 * switch, which sends the id and `active` alone so nothing else is re-checked) and
 * app.delete_loyalty_tier_perk; both the owner's, online only, like the rest of the page.
 *
 * A group a privilege names that the menu no longer has does not break its row: the row says
 * how many are gone, and the editor refuses to save "only some groups" with none left, because
 * an empty list means every add-on to the server.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber, makeT } from '@touch/i18n';
import { tierColor, type LoyaltyAdminPerk, type LoyaltyAdminTier } from '@touch/core/loyalty';
import { useLocale, pickName } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Switch } from '../../components/Switch';
import { Button, ErrorText, Field, Modal, Skeleton, inputStyle } from '../../components/ui';
import { Panel, SegmentedControl } from '../../components/kit';
import { WizardChoice, WizardChoices } from '../../components/StepWizard';
import { useAddons } from '../admin/addons/useAddons';
import {
  PERK_NAME_MAX,
  isBaseTier,
  perkDraft,
  perkErrors,
  perkGives,
  perkPayload,
  sortedPerks,
  withAutoNames,
  type AddonGroup,
  type PerkDraft,
} from './loyaltyLogic';
import { deleteTierPerk, invalidateLoyaltyAdmin, upsertTierPerk } from './useLoyalty';
import { TierCardChip } from './TierColorPicker';

const K = 'ws.loyalty.setup';
const P = `${K}.perks` as const;

const mutedSm = { fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' } as const;

export function PerksPanel({ canEdit, tiers }: { canEdit: boolean; tiers: LoyaltyAdminTier[] }) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const addons = useAddons();
  // Null until the menu's add-on groups are read: a row then says how many, not which.
  const groups: AddonGroup[] | null = addons.data?.groups ?? null;
  const [editing, setEditing] = useState<{ draft: PerkDraft; tier: LoyaltyAdminTier } | null>(null);
  const [removing, setRemoving] = useState<LoyaltyAdminPerk | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sorted = useMemo(() => [...tiers].sort((a, b) => a.sort - b.sort), [tiers]);

  async function toggle(p: LoyaltyAdminPerk, active: boolean) {
    // The id and the switch alone: the server keeps every key that is not sent, so a group
    // the menu has since lost is not re-checked. A refusal throws: Switch reverts and toasts.
    await upsertTierPerk({ id: p.id, active });
    invalidateLoyaltyAdmin(qc);
  }

  async function remove(p: LoyaltyAdminPerk) {
    setBusy(true);
    setError(null);
    try {
      await deleteTierPerk(p.id);
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
    <Panel title={tr(`${P}.title`)} data-testid="loyalty-perks">
      <p style={{ ...mutedSm, marginBlockStart: 0, maxInlineSize: '70ch' }}>{tr(`${P}.lead`)}</p>
      <div style={{ display: 'grid' }}>
        {sorted.map((t, i) => {
          const perks = sortedPerks(t.perks);
          const name = pickName(locale, t);
          return (
            <section
              key={t.id}
              aria-label={name}
              data-testid={`loyalty-perks-tier-${t.id}`}
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-2)',
                paddingBlock: 'var(--tp-sp-3)',
                borderBlockStart: i === 0 ? undefined : '1px solid var(--tp-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 600 }}>
                  <TierCardChip color={tierColor(t.color)} width={32} />
                  <bdi>{name}</bdi>
                  {isBaseTier(t) && <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 400, color: 'var(--tp-muted-fg)' }}>{tr(`${K}.tiers.base`)}</span>}
                </span>
                {canEdit && (
                  <Button
                    size="sm"
                    icon="plus"
                    disabled={!reachable}
                    aria-label={tr(`${P}.addFor`, { tier: name })}
                    onClick={() => setEditing({ draft: perkDraft(null, t.id), tier: t })}
                  >
                    {tr(`${P}.add`)}
                  </Button>
                )}
              </div>
              {perks.length === 0 ? (
                <p style={{ ...mutedSm, margin: 0 }}>{tr(`${P}.empty`)}</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
                  {perks.map((p) => (
                    <PerkRow
                      key={p.id}
                      perk={p}
                      groups={groups}
                      canEdit={canEdit}
                      reachable={reachable}
                      onToggle={(v) => toggle(p, v)}
                      onEdit={() => setEditing({ draft: perkDraft(p, t.id), tier: t })}
                      onRemove={() => {
                        setError(null);
                        setRemoving(p);
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {editing && (
        <PerkEditor
          draft0={editing.draft}
          tierName={pickName(locale, editing.tier)}
          groups={groups}
          groupsLoading={addons.isLoading}
          groupsError={addons.isError ? addons.error : null}
          onRetryGroups={() => void addons.refetch()}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <Modal
          title={tr(`${P}.removeTitle`, { name: pickName(locale, removing) })}
          size="sm"
          dismissible={!busy}
          onClose={() => setRemoving(null)}
          footer={(close) => (
            <>
              <Button onClick={close} disabled={busy}>
                {tr(`${K}.cancel`)}
              </Button>
              <Button kind="danger" busy={busy} onClick={() => void remove(removing)} data-testid="perk-remove-confirm">
                {tr(`${P}.remove`)}
              </Button>
            </>
          )}
        >
          <p style={{ margin: 0 }}>{tr(`${P}.removeBody`)}</p>
          <ErrorText error={error} />
        </Modal>
      )}
    </Panel>
  );
}

function PerkRow({
  perk,
  groups,
  canEdit,
  reachable,
  onToggle,
  onEdit,
  onRemove,
}: {
  perk: LoyaltyAdminPerk;
  groups: readonly AddonGroup[] | null;
  canEdit: boolean;
  reachable: boolean;
  onToggle: (active: boolean) => Promise<void>;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { tr, locale } = useLocale();
  const gives = perkGives(perk, groups);
  const name = pickName(locale, perk);
  const other = locale === 'ar' ? perk.name_en : perk.name_ar;
  return (
    <li
      data-testid="loyalty-perk"
      style={{
        display: 'grid',
        // The same template on every row of every tier, so the columns line up down the panel.
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr) auto',
        gap: 'var(--tp-sp-1) var(--tp-sp-3)',
        alignItems: 'center',
      }}
    >
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        {/* Each name in a line of the page's own direction, so the other language's name starts where this one does. */}
        <span style={{ fontWeight: 600 }}>
          <bdi>{name}</bdi>
        </span>
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          <bdi lang={locale === 'ar' ? 'en' : 'ar'}>{other}</bdi>
        </span>
      </span>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0, fontSize: 'var(--tp-fs-sm)' }}>
        {gives.kind === 'custom' ? (
          <span>{tr(`${P}.gives.custom`)}</span>
        ) : gives.kind === 'all' ? (
          <span>{tr(`${P}.gives.all`)}</span>
        ) : groups === null ? (
          <span>{tr(`${P}.gives.count`, { n: formatNumber(gives.count, locale) })}</span>
        ) : gives.groups.length > 0 ? (
          <span>
            {tr(`${P}.gives.groups`, { groups: gives.groups.map((g) => pickName(locale, g)).join(tr(`${P}.defaults.sep`)) })}
          </span>
        ) : null}
        {gives.kind === 'groups' && gives.missing > 0 && (
          <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 600 }} data-testid="loyalty-perk-missing">
            {gives.groups.length > 0 ? tr(`${P}.gives.missing`, { n: formatNumber(gives.missing, locale) }) : tr(`${P}.gives.none`)}
          </span>
        )}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', justifySelf: 'end', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Switch checked={perk.active} onChange={onToggle} label={tr(`${P}.active`)} disabled={!canEdit || !reachable} />
        {canEdit && (
          <>
            <Button size="sm" kind="ghost" icon="settings" disabled={!reachable} aria-label={tr(`${P}.editFor`, { name })} onClick={onEdit}>
              {tr(`${P}.edit`)}
            </Button>
            <Button size="sm" kind="ghost" icon="trash" disabled={!reachable} aria-label={tr(`${P}.removeFor`, { name })} onClick={onRemove}>
              {tr(`${P}.remove`)}
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

function PerkEditor({
  draft0,
  tierName,
  groups,
  groupsLoading,
  groupsError,
  onRetryGroups,
  onClose,
}: {
  draft0: PerkDraft;
  tierName: string;
  groups: readonly AddonGroup[] | null;
  groupsLoading: boolean;
  groupsError: unknown;
  onRetryGroups: () => void;
  onClose: () => void;
}) {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState(draft0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const known = useMemo(() => (groups ? new Set(groups.map((g) => g.id)) : null), [groups]);
  const errors = touched ? perkErrors(d, known) : {};
  // Every change to the choice of add-ons carries the default names along, until one is typed.
  const change = (part: Partial<PerkDraft>) => setD((x) => withAutoNames({ ...x, ...part }, groups ?? []));
  const gone = known ? d.modifier_group_ids.filter((id) => !known.has(id)) : [];
  const toggleGroup = (id: string) =>
    change({
      modifier_group_ids: d.modifier_group_ids.includes(id) ? d.modifier_group_ids.filter((x) => x !== id) : [...d.modifier_group_ids, id],
    });

  async function save() {
    setTouched(true);
    if (Object.keys(perkErrors(d, known)).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await upsertTierPerk(perkPayload(d, known));
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
      title={d.id ? tr(`${P}.editTitle`) : tr(`${P}.addFor`, { tier: tierName })}
      dismissible={!busy}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={close} disabled={busy}>
            {tr(`${K}.cancel`)}
          </Button>
          <Button kind="primary" busy={busy} onClick={() => void save()} data-testid="perk-save">
            {tr(`${K}.save`)}
          </Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="perk-editor">
        <WizardChoices label={tr(`${P}.kind`)}>
          <WizardChoice
            on={d.kind === 'free_addons'}
            title={tr(`${P}.kindAddons`)}
            body={tr(`${P}.kindAddonsBody`)}
            disabled={busy}
            onPick={() => change({ kind: 'free_addons' })}
            testId="perk-kind-free_addons"
          />
          <WizardChoice
            on={d.kind === 'custom'}
            title={tr(`${P}.kindCustom`)}
            body={tr(`${P}.kindCustomBody`)}
            disabled={busy}
            onPick={() => change({ kind: 'custom' })}
            testId="perk-kind-custom"
          />
        </WizardChoices>

        {d.kind === 'free_addons' && (
          <Field
            label={tr(`${P}.scope`)}
            error={errors.groups ? tr(`${P}.errors.groups`) : undefined}
            group
            style={{ marginBlockEnd: 0 }}
          >
            <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
              <SegmentedControl<PerkDraft['scope']>
                aria-label={tr(`${P}.scope`)}
                value={d.scope}
                onChange={(scope) => change({ scope })}
                options={[
                  { value: 'all', label: tr(`${P}.scopeAll`), disabled: busy, testId: 'perk-scope-all' },
                  { value: 'groups', label: tr(`${P}.scopeGroups`), disabled: busy, testId: 'perk-scope-groups' },
                ]}
              />
              {d.scope === 'groups' &&
                (groups === null ? (
                  groupsLoading ? (
                    <Skeleton lines={2} />
                  ) : (
                    <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start' }}>
                      <ErrorText error={groupsError} style={{ marginBlock: 0 }} />
                      <Button size="sm" icon="refresh" onClick={onRetryGroups}>
                        {tr('ws.kit.async.retry')}
                      </Button>
                    </div>
                  )
                ) : (
                  <>
                    <div
                      role="group"
                      aria-label={tr(`${P}.groups`)}
                      style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}
                    >
                      {groups.length === 0 && gone.length === 0 && <span style={mutedSm}>{tr(`${P}.groupsEmpty`)}</span>}
                      {groups.map((g) => {
                        const on = d.modifier_group_ids.includes(g.id);
                        return (
                          <Button key={g.id} size="sm" kind={on ? 'primary' : 'default'} icon={on ? 'check' : undefined} aria-pressed={on} disabled={busy} onClick={() => toggleGroup(g.id)}>
                            <bdi>{pickName(locale, g)}</bdi>
                          </Button>
                        );
                      })}
                      {/* A group the menu has lost: named as such, and one press takes it off. */}
                      {gone.map((id) => (
                        <Button key={id} size="sm" icon="x" aria-pressed disabled={busy} onClick={() => toggleGroup(id)} data-testid="perk-group-gone">
                          {tr(`${P}.groupGone`)}
                        </Button>
                      ))}
                    </div>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(`${P}.groupsHint`)}</span>
                  </>
                ))}
            </div>
          </Field>
        )}

        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: '1fr 1fr' }}>
            <Field label={tr(`${P}.nameEn`)} error={errors.names ? tr(`${P}.errors.names`) : undefined} style={{ marginBlockEnd: 0 }}>
              <input
                style={inputStyle}
                dir="ltr"
                value={d.name_en}
                maxLength={PERK_NAME_MAX}
                disabled={busy}
                placeholder={d.kind === 'custom' ? makeT('en')(`${P}.example`) : undefined}
                onChange={(e) => setD({ ...d, name_en: e.target.value, autoName: false })}
              />
            </Field>
            <Field label={tr(`${P}.nameAr`)} style={{ marginBlockEnd: 0 }}>
              <input
                style={inputStyle}
                dir="rtl"
                lang="ar"
                value={d.name_ar}
                maxLength={PERK_NAME_MAX}
                disabled={busy}
                placeholder={d.kind === 'custom' ? makeT('ar')(`${P}.example`) : undefined}
                onChange={(e) => setD({ ...d, name_ar: e.target.value, autoName: false })}
              />
            </Field>
          </div>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr(d.kind === 'custom' ? `${P}.customHint` : d.autoName ? `${P}.nameAutoHint` : `${P}.nameHint`)}
          </span>
        </div>

        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label={tr(`${P}.active`)} disabled={busy} />
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
            {tr(d.active ? `${P}.activeOnHint` : `${P}.activeOffHint`)}
          </span>
        </div>
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}
