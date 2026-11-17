/**
 * Setup › Loyalty › Card privileges (0410): what each card gives besides points. Under each
 * tier, its privileges: the name guests read in both languages, what it does, an On switch,
 * Edit and Remove; and "Add a privilege".
 *
 * The kinds, in the owner's words (0410, four more since 0445; the owner's rule, 2026-11-14:
 * every card privilege is something he can set up, change and remove here):
 *   Free add-ons        paid add-ons on a drink cost nothing: every add-on, or only the add-on
 *                       groups ticked (milk, syrups, extra shot). The till takes them off the
 *                       member's bill by itself (app.loyalty_perks_refresh).
 *   A gift              on the birthday (1..31 days), every calendar month, or once on reaching
 *                       this card (1..90 days, that card only): one unit of the dearest
 *                       matching menu item, or one hour of a plain booking's court fee.
 *   Free size upgrade   matching lines are charged the next size down.
 *   Free with an order  one free unit of the chosen items for each unit of the trigger items.
 *   Faster drink card   the member's drink card fills at this many stamps (2..20).
 *   Photo frame         the card unlocks a ring around the guest's photo in the app.
 *   Something else      a line the staff honour by hand (priority booking, a racket to borrow).
 *
 * A card also holds everything the cards below it give. That is said once, in the panel's
 * lead, where the owner decides which card gets a privilege.
 *
 * Reads loyalty_admin().tiers[].perks (the page's own query), the menu's add-on groups (the
 * Add-ons page's read, useAddons) and the café menu's sections and items (useAdminMenu, the
 * promotion editor's read and its chosen-plus-search picker, ChipPicker). Writes app.upsert_loyalty_tier_perk (also the On
 * switch, which sends the id and `active` alone so nothing else is re-checked) and
 * app.delete_loyalty_tier_perk; both the owner's, online only, like the rest of the page.
 *
 * A group a privilege names that the menu no longer has does not break its row: the row says
 * how many are gone, and the editor refuses to save "only some groups" with none left, because
 * an empty list means every add-on to the server. A menu section or item a gift or free-with
 * privilege names that the menu has lost is counted the same way and left out on the next save.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatNumber, makeT } from '@touch/i18n';
import {
  CARD_FRAME_IDS,
  GIFT_WHENS,
  TIER_SWATCH,
  tierColor,
  type CardFrameId,
  type GiftTarget,
  type LoyaltyAdminPerk,
  type LoyaltyAdminTier,
  type TierPerkKind,
} from '@touch/core/loyalty';
import { useLocale, pickName } from '../../lib/i18n';
import { useStationReach } from '../../lib/stationReach';
import { useToast } from '../../components/toast';
import { Switch } from '../../components/Switch';
import { Button, ErrorText, Field, Modal, Skeleton, inputStyle } from '../../components/ui';
import { Panel, SegmentedControl } from '../../components/kit';
import { Icon } from '../../components/icons';
import { WizardChoice, WizardChoices } from '../../components/StepWizard';
import { ChipPicker } from '../../components/ChipPicker';
import { useAddons } from '../admin/addons/useAddons';
import { useAdminMenu } from '../admin/menu/useAdminMenu';
import { UnitInput } from '../admin/settings/settingsFields';
import {
  GIFT_DAYS_MAX,
  PERK_KINDS,
  PERK_NAME_MAX,
  STAMP_SIZE_MAX,
  frameWord,
  giftDaysMax,
  isBaseTier,
  menuKnown,
  perkDraft,
  perkErrors,
  perkGives,
  perkMissing,
  perkPayload,
  sortedPerks,
  withAutoNames,
  withGiftWhen,
  type AddonGroup,
  type MenuNames,
  type MenuPick,
  type PerkDraft,
  type PerkGives,
} from './loyaltyLogic';
import { deleteTierPerk, invalidateLoyaltyAdmin, upsertTierPerk, useStampCard } from './useLoyalty';
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
  // 0445: the café menu's sections and items, for a gift or free-with privilege. Null until read.
  const menu = useAdminMenu();
  const names: MenuNames | null = useMemo(
    () => (menu.data ? { categories: menu.data.categories, items: menu.data.items } : null),
    [menu.data],
  );
  // The club's drink card size, for the faster drink card's hint (null: unknown or no 0445).
  const stampQ = useStampCard();
  const standard = stampQ.data?.size ?? null;
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
                      menu={names}
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
          menu={names}
          menuItems={menu.data?.items ?? null}
          menuLoading={menu.isLoading}
          menuError={menu.isError ? menu.error : null}
          onRetryMenu={() => void menu.refetch()}
          standard={standard}
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
  menu,
  canEdit,
  reachable,
  onToggle,
  onEdit,
  onRemove,
}: {
  perk: LoyaltyAdminPerk;
  groups: readonly AddonGroup[] | null;
  menu: MenuNames | null;
  canEdit: boolean;
  reachable: boolean;
  onToggle: (active: boolean) => Promise<void>;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { tr, locale } = useLocale();
  const gives = perkGives(perk, groups, menu);
  const missing = perkMissing(gives);
  const line = givesLine(gives, groups !== null, menu !== null, tr, locale);
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
        {gives.kind === 'frame' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
            <FrameRing frameId={gives.frameId} size={20} />
            <span>{line}</span>
          </span>
        ) : (
          line && <span>{line}</span>
        )}
        {missing > 0 && (
          <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 600 }} data-testid="loyalty-perk-missing">
            {missingLine(gives, missing, tr, locale)}
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

type Tr = ReturnType<typeof useLocale>['tr'];
type Locale = ReturnType<typeof useLocale>['locale'];

function joinNames(pick: MenuPick, tr: Tr, locale: Locale): string {
  return pick.named.map((x) => pickName(locale, x)).join(tr(`${P}.defaults.sep`));
}

/**
 * What a privilege gives, in plain words for its row. `groupsRead` / `menuRead` false: the
 * add-on groups or the menu are not read, so only how many were chosen can be said. Empty when
 * every name it would say is gone (the warning line says that instead).
 */
export function givesLine(g: PerkGives, groupsRead: boolean, menuRead: boolean, tr: Tr, locale: Locale): string {
  const n = (x: number) => formatNumber(x, locale);
  switch (g.kind) {
    case 'custom':
      return tr(`${P}.gives.custom`);
    case 'all':
      return tr(`${P}.gives.all`);
    case 'groups':
      if (!groupsRead) return tr(`${P}.gives.count`, { n: n(g.count) });
      return g.groups.length > 0
        ? tr(`${P}.gives.groups`, { groups: g.groups.map((x) => pickName(locale, x)).join(tr(`${P}.defaults.sep`)) })
        : '';
    case 'gift': {
      const gift =
        g.target === 'court_hour'
          ? tr(`${P}.gives.giftWhat.court`)
          : !menuRead
            ? tr(`${P}.gives.giftWhat.itemsCount`, { n: n(g.what.count) })
            : g.what.named.length > 0
              ? tr(`${P}.gives.giftWhat.items`, { what: joinNames(g.what, tr, locale) })
              : '';
      return gift ? tr(`${P}.gives.giftWhen.${g.when}`, { gift, days: n(g.days ?? 0) }) : '';
    }
    case 'size_upgrade':
      if (!menuRead) return tr(`${P}.gives.sizeUpgradeCount`, { n: n(g.what.count) });
      return g.what.named.length > 0 ? tr(`${P}.gives.sizeUpgrade`, { what: joinNames(g.what, tr, locale) }) : '';
    case 'free_with':
      if (!menuRead) return tr(`${P}.gives.freeWithCount`, { n: n(g.trigger.count + g.free.count) });
      return g.trigger.named.length > 0 && g.free.named.length > 0
        ? tr(`${P}.gives.freeWith`, { trigger: joinNames(g.trigger, tr, locale), free: joinNames(g.free, tr, locale) })
        : '';
    case 'frame':
      return tr(`${P}.gives.frame`, { card: tr(`${P}.frame.${frameWord(g.frameId)}`) });
    case 'stamp_size':
      return tr(`${P}.gives.stampSize`, { n: n(g.size) });
  }
}

/** The warning under a row whose groups, sections or items the menu has lost. */
function missingLine(g: PerkGives, missing: number, tr: Tr, locale: Locale): string {
  const n = formatNumber(missing, locale);
  if (g.kind === 'groups') return g.groups.length > 0 ? tr(`${P}.gives.missing`, { n }) : tr(`${P}.gives.none`);
  const nothingLeft =
    g.kind === 'gift' || g.kind === 'size_upgrade' ? g.what.named.length === 0 : g.kind === 'free_with' ? g.trigger.named.length === 0 || g.free.named.length === 0 : false;
  return nothingLeft ? tr(`${P}.gives.menuNone`) : tr(`${P}.gives.menuMissing`, { n });
}

/**
 * The ring a frame privilege unlocks, drawn small: a photo's circle inside a ring of the card's
 * own colour (the phone draws the real one). The black card's ring carries a light inner line so
 * it reads on a dark page too.
 */
export function FrameRing({ frameId, size = 32 }: { frameId: CardFrameId; size?: number }) {
  const word = frameWord(frameId);
  const ring = TIER_SWATCH[word];
  const width = Math.max(2, Math.round(size / 9));
  return (
    <span
      aria-hidden="true"
      data-frame={frameId}
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        inlineSize: size,
        blockSize: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: 'var(--tp-surface-2)',
        color: 'var(--tp-muted-fg)',
        boxShadow: `0 0 0 ${width}px ${ring}${word === 'black' ? `, inset 0 0 0 1px ${TIER_SWATCH.silver}` : ''}`,
        marginInline: width,
      }}
    >
      <Icon name="user" size={Math.round(size * 0.55)} />
    </span>
  );
}

/** A menu sections + items pick (the promotion editor's chosen-plus-search picker), as one field. */
function MenuPickField({
  label,
  hint,
  error,
  categoryIds,
  itemIds,
  onCategories,
  onItems,
  menu,
  menuItems,
  disabled,
  testId,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  categoryIds: string[];
  itemIds: string[];
  onCategories: (ids: string[]) => void;
  onItems: (ids: string[]) => void;
  menu: MenuNames;
  menuItems: readonly { id: string; name_en: string; name_ar: string; is_active: boolean }[];
  disabled: boolean;
  testId: string;
}) {
  const { tr, locale } = useLocale();
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const known = menuKnown(menu);
  const lost =
    categoryIds.filter((id) => !known?.categories.has(id)).length + itemIds.filter((id) => !known?.items.has(id)).length;
  return (
    <Field label={label} hint={hint} error={error} group style={{ marginBlockEnd: 0 }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }} data-testid={testId}>
        <ChipPicker
          label={tr(`${P}.menuSections`)}
          options={menu.categories.map((c) => ({ id: c.id, label: pickName(locale, c) }))}
          selected={categoryIds}
          disabled={disabled}
          flush
          onToggle={(id) => onCategories(toggle(categoryIds, id))}
        />
        <ChipPicker
          label={tr(`${P}.menuItems`)}
          options={menuItems.filter((i) => i.is_active || itemIds.includes(i.id)).map((i) => ({ id: i.id, label: pickName(locale, i) }))}
          selected={itemIds}
          disabled={disabled}
          flush
          onToggle={(id) => onItems(toggle(itemIds, id))}
        />
        {lost > 0 && (
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-warn-fg)', fontWeight: 600 }}>
            {tr(`${P}.gives.menuMissing`, { n: formatNumber(lost, locale) })}
          </span>
        )}
      </div>
    </Field>
  );
}

/** Each kind's title and one-line body in the "What it gives" choice. */
const KIND_WORDS: Record<TierPerkKind, { title: string; body: string }> = {
  free_addons: { title: 'kindAddons', body: 'kindAddonsBody' },
  gift: { title: 'kindGift', body: 'kindGiftBody' },
  free_with: { title: 'kindFreeWith', body: 'kindFreeWithBody' },
  size_upgrade: { title: 'kindSizeUpgrade', body: 'kindSizeUpgradeBody' },
  stamp_size: { title: 'kindStampSize', body: 'kindStampSizeBody' },
  frame: { title: 'kindFrame', body: 'kindFrameBody' },
  custom: { title: 'kindCustom', body: 'kindCustomBody' },
};

function PerkEditor({
  draft0,
  tierName,
  groups,
  groupsLoading,
  groupsError,
  onRetryGroups,
  menu,
  menuItems,
  menuLoading,
  menuError,
  onRetryMenu,
  standard,
  onClose,
}: {
  draft0: PerkDraft;
  tierName: string;
  groups: readonly AddonGroup[] | null;
  groupsLoading: boolean;
  groupsError: unknown;
  onRetryGroups: () => void;
  menu: MenuNames | null;
  menuItems: readonly { id: string; name_en: string; name_ar: string; is_active: boolean }[] | null;
  menuLoading: boolean;
  menuError: unknown;
  onRetryMenu: () => void;
  /** The club's drink card size (app.stamp_card_settings), for the faster drink card's hint. */
  standard: number | null;
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
  const mk = useMemo(() => menuKnown(menu), [menu]);
  const errors = touched ? perkErrors(d, known, mk) : {};
  // Every change to what it gives carries the default names along, until one is typed.
  const change = (part: Partial<PerkDraft>) => setD((x) => withAutoNames({ ...x, ...part }, groups ?? [], menu));
  const gone = known ? d.modifier_group_ids.filter((id) => !known.has(id)) : [];
  const toggleGroup = (id: string) =>
    change({
      modifier_group_ids: d.modifier_group_ids.includes(id) ? d.modifier_group_ids.filter((x) => x !== id) : [...d.modifier_group_ids, id],
    });

  async function save() {
    setTouched(true);
    if (Object.keys(perkErrors(d, known, mk)).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await upsertTierPerk(perkPayload(d, known, mk));
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
      size="lg"
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
          {PERK_KINDS.map((k) => (
            <WizardChoice
              key={k}
              on={d.kind === k}
              title={tr(`${P}.${KIND_WORDS[k].title}` as `${typeof P}.kindAddons`)}
              body={tr(`${P}.${KIND_WORDS[k].body}` as `${typeof P}.kindAddonsBody`)}
              disabled={busy}
              onPick={() => change({ kind: k })}
              testId={`perk-kind-${k}`}
            />
          ))}
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

        {d.kind === 'gift' && (
          <>
            <WizardChoices small label={tr(`${P}.gift.when`)}>
              {GIFT_WHENS.map((w) => (
                <WizardChoice
                  key={w}
                  on={d.giftWhen === w}
                  title={tr(`${P}.gift.whens.${w}`)}
                  body={tr(`${P}.gift.whenBodies.${w}`)}
                  disabled={busy}
                  onPick={() => change(withGiftWhen(d, w))}
                  testId={`perk-gift-when-${w}`}
                />
              ))}
            </WizardChoices>
            <Field label={tr(`${P}.gift.target`)} hint={d.giftTarget === 'court_hour' ? tr(`${P}.gift.courtHint`) : undefined} group style={{ marginBlockEnd: 0 }}>
              <SegmentedControl<GiftTarget>
                aria-label={tr(`${P}.gift.target`)}
                value={d.giftTarget}
                onChange={(giftTarget) => change({ giftTarget })}
                options={[
                  { value: 'items', label: tr(`${P}.gift.targetItems`), disabled: busy, testId: 'perk-gift-target-items' },
                  { value: 'court_hour', label: tr(`${P}.gift.targetCourt`), disabled: busy, testId: 'perk-gift-target-court_hour' },
                ]}
              />
            </Field>
          </>
        )}

        {((d.kind === 'gift' && d.giftTarget === 'items') || d.kind === 'free_with' || d.kind === 'size_upgrade') &&
          (menu === null || menuItems === null ? (
            menuLoading ? (
              <Skeleton lines={3} />
            ) : (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start' }}>
                <ErrorText error={menuError} style={{ marginBlock: 0 }} />
                <Button size="sm" icon="refresh" onClick={onRetryMenu}>
                  {tr('ws.kit.async.retry')}
                </Button>
              </div>
            )
          ) : d.kind === 'gift' ? (
            <MenuPickField
              label={tr(`${P}.gift.what`)}
              hint={tr(`${P}.gift.whatHint`)}
              error={errors.giftItems ? tr(`${P}.errors.giftItems`) : undefined}
              categoryIds={d.giftCategoryIds}
              itemIds={d.giftItemIds}
              onCategories={(giftCategoryIds) => change({ giftCategoryIds })}
              onItems={(giftItemIds) => change({ giftItemIds })}
              menu={menu}
              menuItems={menuItems}
              disabled={busy}
              testId="perk-gift-what"
            />
          ) : d.kind === 'size_upgrade' ? (
            <MenuPickField
              label={tr(`${P}.sizeUpgrade.what`)}
              hint={tr(`${P}.sizeUpgrade.hint`)}
              error={errors.sizeItems ? tr(`${P}.errors.sizeItems`) : undefined}
              categoryIds={d.sizeCategoryIds}
              itemIds={d.sizeItemIds}
              onCategories={(sizeCategoryIds) => change({ sizeCategoryIds })}
              onItems={(sizeItemIds) => change({ sizeItemIds })}
              menu={menu}
              menuItems={menuItems}
              disabled={busy}
              testId="perk-size-upgrade-what"
            />
          ) : (
            <>
              <MenuPickField
                label={tr(`${P}.freeWith.trigger`)}
                error={errors.trigger ? tr(`${P}.errors.trigger`) : undefined}
                categoryIds={d.triggerCategoryIds}
                itemIds={d.triggerItemIds}
                onCategories={(triggerCategoryIds) => change({ triggerCategoryIds })}
                onItems={(triggerItemIds) => change({ triggerItemIds })}
                menu={menu}
                menuItems={menuItems}
                disabled={busy}
                testId="perk-free-with-trigger"
              />
              <MenuPickField
                label={tr(`${P}.freeWith.free`)}
                hint={tr(`${P}.freeWith.freeHint`)}
                error={errors.free ? tr(`${P}.errors.free`) : undefined}
                categoryIds={d.freeCategoryIds}
                itemIds={d.freeItemIds}
                onCategories={(freeCategoryIds) => change({ freeCategoryIds })}
                onItems={(freeItemIds) => change({ freeItemIds })}
                menu={menu}
                menuItems={menuItems}
                disabled={busy}
                testId="perk-free-with-free"
              />
            </>
          ))}

        {d.kind === 'gift' && d.giftWhen !== 'monthly' && (
          <Field
            label={tr(`${P}.gift.days`)}
            hint={tr(`${P}.gift.daysHint.${d.giftWhen}`)}
            error={errors.days ? tr(d.giftWhen === 'card_up' ? `${P}.errors.daysCardUp` : `${P}.errors.days`) : undefined}
            style={{ marginBlockEnd: 0, maxInlineSize: '22rem' }}
          >
            <UnitInput
              unit={tr(`${P}.gift.unitDays`)}
              value={d.giftDays}
              onChange={(giftDays) => change({ giftDays })}
              maxLength={String(giftDaysMax(d.giftWhen) ?? GIFT_DAYS_MAX).length}
              disabled={busy}
              data-testid="perk-gift-days"
            />
          </Field>
        )}

        {d.kind === 'stamp_size' && (
          <Field
            label={tr(`${P}.stampSize.label`)}
            hint={standard !== null ? tr(`${P}.stampSize.hint`, { n: formatNumber(standard, locale) }) : tr(`${P}.stampSize.hintPlain`)}
            error={errors.size ? tr(`${P}.errors.size`) : undefined}
            style={{ marginBlockEnd: 0, maxInlineSize: '22rem' }}
          >
            <UnitInput
              unit={tr(`${P}.stampSize.unit`)}
              value={d.stampSize}
              onChange={(stampSize) => change({ stampSize })}
              maxLength={String(STAMP_SIZE_MAX).length}
              disabled={busy}
              data-testid="perk-stamp-size"
            />
          </Field>
        )}

        {d.kind === 'frame' && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
            <WizardChoices small label={tr(`${P}.frame.label`)}>
              {CARD_FRAME_IDS.map((f) => (
                <WizardChoice
                  key={f}
                  on={d.frameId === f}
                  title={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                      <FrameRing frameId={f} size={28} />
                      {tr(`${P}.frame.${frameWord(f)}`)}
                    </span>
                  }
                  disabled={busy}
                  onPick={() => change({ frameId: f })}
                  testId={`perk-frame-${f}`}
                />
              ))}
            </WizardChoices>
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr(`${P}.frame.hint`)}</span>
          </div>
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
