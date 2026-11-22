/**
 * One extra (a modifier group) in the stepped dialog every "add new" form
 * uses (StepWizard, the tournament start's frame): Name, Choices, Options,
 * Items, then Review. A sub-group has no Items step (it is reveal-only).
 *
 * Nothing is written until Review's Save. Save = `upsert_modifier_group`, one
 * `link_item_modifier_group` per changed item, then per option `upsert_modifier`
 * (new, or changed) and `set_modifier_reveals` (changed). A manager's price
 * rules (price_promo, #51, #53, #9) are kept: an option on sale keeps its
 * stored price and names (re-sent as they are), its price read-only here (a price
 * is changed from the menu item); a paid option never on sale offers "Put on sale"; a new paid option is saved
 * hidden. A save the server refuses is said in a sentence under the step.
 */
import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { can, useAuth, usePermissions } from '../../../lib/auth';
import { Button, ErrorText, Field, inputStyle } from '../../../components/ui';
import { Icon } from '../../../components/icons';
import { MoneyInput } from '../../../components/inputs';
import {
  BilingualFieldPair,
  MessagePresenter,
  SearchField,
  StatusBadge,
} from '../../../components/kit';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/toast';
import {
  ReviewList,
  StepWizard,
  WizardChips,
  WizardChoice,
  WizardChoices,
  WizardNote,
  type WizardStep,
} from '../../../components/StepWizard';
import { PriceChangeButton, PriceLockNote } from '../promotions/PriceChangeStart';
import { sortRows } from '../menu/menuLogic';
import { useChoiceRuleText } from './ChoiceLimits';
import {
  addonLock,
  diffLinks,
  eligibleRevealGroups,
  isRenameRefusal,
  isRequiredAddonRefusal,
  minMaxError,
  newOptionActive,
  revealedGroupIds,
  sameOrder,
} from './addonsLogic';
import { modifierArgs } from './OptionsList';
import {
  ADMIN_ADDONS_KEY,
  type AddonsData,
  type GroupRow,
  type ItemNameRow,
  type ModifierRow,
} from './useAddons';

/** One option as the wizard holds it; `source` is the saved row, null for a new one. */
interface OptionDraft {
  key: string;
  source: ModifierRow | null;
  en: string;
  ar: string;
  delta: number;
  reveals: string[];
}

/**
 * The item picker as two levels: a card per menu category (how many of its
 * items are picked), and one category's items under a breadcrumb
 * ("Items › Frappuccino"). Typing in the search lists matches from every
 * category at once, each under its category's name.
 */
function ItemsPicker({
  data,
  linked,
  readOnly,
  query,
  onQuery,
  onToggle,
}: {
  data: AddonsData;
  linked: ReadonlySet<string>;
  readOnly: boolean;
  query: string;
  onQuery: (q: string) => void;
  onToggle: (ids: string[], on: boolean) => void;
}) {
  const { tr, locale } = useLocale();
  const [current, setCurrent] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const n = (v: number) => formatNumber(v, locale);
  const byName = (
    a: { name_en: string; name_ar: string },
    b: { name_en: string; name_ar: string },
  ) => pickName(locale, a).localeCompare(pickName(locale, b));
  const matches = (i: { name_en: string; name_ar: string }) =>
    q === '' || i.name_en.toLowerCase().includes(q) || i.name_ar.toLowerCase().includes(q);

  const known = new Set(data.categories.map((c) => c.id));
  const sections = [
    ...data.categories.map((c) => ({
      id: c.id,
      name: pickName(locale, c),
      items: data.items.filter((i) => i.category_id === c.id),
    })),
    {
      id: '',
      name: tr('op.addons.otherCategory'),
      items: data.items.filter((i) => !known.has(i.category_id)),
    },
  ]
    .map((sec) => ({ ...sec, items: [...sec.items].sort(byName) }))
    .filter((sec) => sec.items.length > 0);
  const open = sections.find((sec) => sec.id === current) ?? null;

  const itemRow = (i: ItemNameRow) => {
    const on = linked.has(i.id);
    return (
      <label
        key={i.id}
        style={{
          display: 'flex',
          gap: 'var(--tp-sp-2)',
          alignItems: 'center',
          minBlockSize: '2.75rem',
          paddingInline: 'var(--tp-sp-3)',
          borderRadius: 'var(--tp-radius-ctl)',
          border: `1px solid ${on ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
          background: on ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
          color: i.is_active ? 'inherit' : 'var(--tp-muted-fg)',
          cursor: readOnly ? 'not-allowed' : 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={on}
          disabled={readOnly}
          onChange={(e) => onToggle([i.id], e.target.checked)}
        />
        <bdi
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          style={{ flex: 1, minInlineSize: 0, fontWeight: 700, fontSize: 'var(--tp-fs-md)' }}
        >
          {pickName(locale, i)}
        </bdi>
        {!i.is_active && (
          <span style={{ fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.manager.menu.inactive')}</span>
        )}
      </label>
    );
  };
  const listBox = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))',
    gap: 'var(--tp-sp-2)',
  } as const;
  const sep = locale === 'ar' ? '‹' : '›';

  let body: ReactNode;
  if (q !== '') {
    // Search: matches from every category, each group under its category's name.
    const found = sections
      .map((sec) => ({ ...sec, shown: sec.items.filter(matches) }))
      .filter((sec) => sec.shown.length > 0);
    body =
      found.length === 0 ? (
        <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
          {tr('op.addons.noItemsMatch')}
        </span>
      ) : (
        found.map((sec) => (
          <div key={sec.id || 'other'} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <bdi
              style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-muted-fg)' }}
            >
              {sec.name}
            </bdi>
            <div style={listBox}>{sec.shown.map(itemRow)}</div>
          </div>
        ))
      );
  } else if (open) {
    const ids = open.items.map((i) => i.id);
    const all = ids.every((id) => linked.has(id));
    const picked = ids.filter((id) => linked.has(id)).length;
    body = (
      <>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}
        >
          <Button size="sm" icon="arrowStart" onClick={() => setCurrent(null)}>
            {tr('op.common.back')}
          </Button>
          <nav
            aria-label={tr('op.addons.stepItems')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--tp-sp-2)',
              flex: 1,
              minInlineSize: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setCurrent(null)}
              style={{
                border: 0,
                background: 'none',
                padding: 0,
                font: 'inherit',
                fontWeight: 700,
                color: 'var(--tp-accent)',
                cursor: 'pointer',
              }}
            >
              {tr('op.addons.stepItems')}
            </button>
            <span aria-hidden="true">{sep}</span>
            <bdi style={{ fontWeight: 700 }}>{open.name}</bdi>
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr('op.addons.categorySelected', { selected: n(picked), total: n(ids.length) })}
            </span>
          </nav>
          <Button
            size="sm"
            disabled={readOnly}
            aria-label={`${all ? tr('op.addons.clearItems') : tr('op.addons.selectAllItems')}: ${open.name}`}
            onClick={() => onToggle(ids, !all)}
          >
            {all ? tr('op.addons.clearItems') : tr('op.addons.selectAllItems')}
          </Button>
        </div>
        <div style={listBox}>{open.items.map(itemRow)}</div>
      </>
    );
  } else {
    body = (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))',
          gap: 'var(--tp-sp-3)',
        }}
      >
        {sections.map((sec) => {
          const picked = sec.items.filter((i) => linked.has(i.id)).length;
          return (
            <button
              key={sec.id || 'other'}
              type="button"
              onClick={() => setCurrent(sec.id)}
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-1)',
                textAlign: 'start',
                font: 'inherit',
                color: 'inherit',
                cursor: 'pointer',
                padding: 'var(--tp-sp-3) var(--tp-sp-4)',
                borderRadius: 'var(--tp-radius-panel)',
                border: `2px solid ${picked > 0 ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                background: picked > 0 ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
              }}
            >
              <bdi
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                style={{ fontWeight: 700, fontSize: 'var(--tp-fs-md)' }}
              >
                {sec.name}
              </bdi>
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {tr('op.addons.categorySelected', {
                  selected: n(picked),
                  total: n(sec.items.length),
                })}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--tp-sp-3)',
          flexWrap: 'wrap',
        }}
      >
        <SearchField
          value={query}
          onChange={onQuery}
          placeholder={tr('op.menu.search')}
          aria-label={tr('op.addons.itemsLabel')}
          style={{ inlineSize: '16rem', maxInlineSize: '100%' }}
        />
        <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>
          {tr('op.addons.selectedCount', { count: n(linked.size) })}
        </span>
      </div>
      {body}
    </>
  );
}

/** A number with − and + buttons beside its label, for a limit that is a small count. */
function LimitStepper({
  label,
  value,
  floor,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  floor: number;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  const { locale } = useLocale();
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}
    >
      <span style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 600 }}>{label}</span>
      <Button
        icon="minus"
        aria-label={`${label} −`}
        disabled={disabled || value <= floor}
        onClick={() => onChange(Math.max(floor, value - 1))}
      />
      <output
        aria-label={label}
        style={{
          minInlineSize: '2.5rem',
          textAlign: 'center',
          fontWeight: 700,
          fontSize: 'var(--tp-fs-lg)',
        }}
      >
        {formatNumber(value, locale)}
      </output>
      <Button
        icon="plus"
        aria-label={`${label} +`}
        disabled={disabled}
        onClick={() => onChange(value + 1)}
      />
    </div>
  );
}

export type GroupWizardStep = 'name' | 'options' | 'items';

let draftSeq = 0;

export function GroupWizard({
  group,
  subGroup,
  data,
  startAt,
  startOption,
  onClose,
  onSaved,
}: {
  group: GroupRow | null;
  subGroup?: boolean;
  data: AddonsData;
  startAt?: GroupWizardStep;
  /** The saved option (its id) to open for editing, when the wizard is opened from its row. */
  startOption?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const ruleText = useChoiceRuleText();
  const { staff } = useAuth();
  const readOnly = !usePermissions().editMenu;
  const caps = {
    editLaunchedPrices: can(staff, 'editLaunchedPrices'),
    launchDirectly: can(staff, 'launchDirectly'),
  };
  // Only a NEW sub-group skips Items: an existing group may always be linked to items.
  const isSub = !group && (subGroup ?? false);

  const savedOptions = group ? sortRows(data.modifiers.filter((m) => m.group_id === group.id)) : [];
  const initialLinked = new Set(
    data.links.filter((l) => l.group_id === group?.id).map((l) => l.item_id),
  );
  const initialDrafts = (): OptionDraft[] =>
    savedOptions.map((m) => ({
      key: m.id,
      source: m,
      en: m.name_en,
      ar: m.name_ar,
      delta: m.price_delta_iqd,
      reveals: revealedGroupIds(m.id, data.reveals),
    }));

  const [name, setName] = useState({ en: group?.name_en ?? '', ar: group?.name_ar ?? '' });
  const [min, setMin] = useState(group?.min_select ?? 0);
  const [max, setMax] = useState(group?.max_select ?? 1);
  const [drafts, setDrafts] = useState<OptionDraft[]>(initialDrafts);
  const [linked, setLinked] = useState<Set<string>>(initialLinked);
  // "Pick several" shows the two limits; Optional and Required are the one-pick cases.
  const [many, setMany] = useState((group?.max_select ?? 1) > 1);
  const [reason, setReason] = useState('');
  const [effect, setEffect] = useState('');
  // Minted when the wizard opens and reused on a retry, so a second press never starts a second request.
  const idemKey = useRef(`protocol.start:${crypto.randomUUID()}`);
  const [query, setQuery] = useState('');
  const [openReveals, setOpenReveals] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [at, setAt] = useState<number | 'review'>(() => {
    const keys: GroupWizardStep[] = isSub ? ['name', 'options'] : ['name', 'options', 'items'];
    const i = startAt ? keys.indexOf(startAt) : 0;
    return i >= 0 ? i : 0;
  });

  // A saved option is a plain row until Edit opens its fields, so nothing is changed by accident.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(startOption ? [startOption] : []),
  );
  const setOpenKey = (key: string, on: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const patch = (key: string, next: Partial<OptionDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...next } : d)));

  const mmErr = minMaxError(min, max);
  const mmText =
    mmErr === 'min'
      ? tr('op.addons.errMin')
      : mmErr === 'max'
        ? tr('op.addons.errMax')
        : mmErr === 'order'
          ? tr('op.addons.errOrder')
          : null;
  const namesMissing = name.en.trim() === '' || name.ar.trim() === '';
  const optionNamesMissing = drafts.some((d) => d.en.trim() === '' || d.ar.trim() === '');

  const dirty =
    name.en !== (group?.name_en ?? '') ||
    name.ar !== (group?.name_ar ?? '') ||
    min !== (group?.min_select ?? 0) ||
    max !== (group?.max_select ?? 1) ||
    diffLinks(initialLinked, linked).link.length > 0 ||
    diffLinks(initialLinked, linked).unlink.length > 0 ||
    drafts.length !== savedOptions.length ||
    drafts.some(
      (d) =>
        !d.source ||
        d.en !== d.source.name_en ||
        d.ar !== d.source.name_ar ||
        d.delta !== d.source.price_delta_iqd ||
        !sameOrder(d.reveals, revealedGroupIds(d.source.id, data.reveals)),
    );

  // A manager's change to an option on sale is not written here: it goes to the
  // owner as one add-on price change (start_protocol, the "Change the price" flow).
  const proposals = drafts.flatMap((d) => {
    if (!d.source) return [];
    const lock = addonLock(d.source, caps);
    const priceChange = lock.priceLocked && d.delta !== d.source.price_delta_iqd;
    const nameChange =
      lock.nameLocked && (d.en.trim() !== d.source.name_en || d.ar.trim() !== d.source.name_ar);
    return priceChange || nameChange ? [{ d, source: d.source, priceChange, nameChange }] : [];
  });
  const needsReason = proposals.length > 0 && (reason.trim() === '' || effect.trim() === '');

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const id = await appRpc<string>('upsert_modifier_group', {
        p_id: group?.id ?? null,
        p_name_en: name.en.trim(),
        p_name_ar: name.ar.trim(),
        p_min_select: min,
        p_max_select: max,
      });
      if (!isSub) {
        const diff = diffLinks(initialLinked, linked);
        for (const itemId of diff.link)
          await appRpc('link_item_modifier_group', {
            p_item_id: itemId,
            p_group_id: id,
            p_linked: true,
          });
        for (const itemId of diff.unlink)
          await appRpc('link_item_modifier_group', {
            p_item_id: itemId,
            p_group_id: id,
            p_linked: false,
          });
      }
      for (const [i, d] of drafts.entries()) {
        const en = d.en.trim();
        const ar = d.ar.trim();
        let modifierId: string;
        if (!d.source) {
          modifierId = await appRpc<string>('upsert_modifier', {
            p_group_id: id,
            p_name_en: en,
            p_name_ar: ar,
            p_price_delta_iqd: d.delta,
            p_sort_order: savedOptions.length + i,
            p_is_active: newOptionActive(d.delta, caps.launchDirectly),
          });
        } else {
          modifierId = d.source.id;
          const lock = addonLock(d.source, caps);
          // What the lock lets through is written now; the rest waits for the owner.
          const nameChanged = en !== d.source.name_en || ar !== d.source.name_ar;
          const priceChanged = d.delta !== d.source.price_delta_iqd;
          if ((!lock.nameLocked && nameChanged) || (!lock.priceLocked && priceChanged)) {
            await appRpc(
              'upsert_modifier',
              modifierArgs(d.source, {
                name_en: lock.nameLocked ? d.source.name_en : en,
                name_ar: lock.nameLocked ? d.source.name_ar : ar,
                price_delta_iqd: lock.priceLocked ? d.source.price_delta_iqd : d.delta,
              }),
            );
          }
        }
        const before = d.source ? revealedGroupIds(d.source.id, data.reveals) : [];
        if (!sameOrder(before, d.reveals)) {
          await appRpc('set_modifier_reveals', {
            p_modifier_id: modifierId,
            p_group_ids: d.reveals,
          });
        }
      }
      if (proposals.length > 0) {
        await appRpc('start_protocol', {
          p_kind: 'price_promo',
          p_variant: null,
          p_title_en: null,
          p_title_ar: null,
          p_data: {},
          p_first_record: {
            change: 'addon_price',
            reason: reason.trim(),
            expected_effect: effect.trim(),
            addons: proposals
              .filter((x) => x.priceChange)
              .map((x) => ({ modifier_id: x.source.id, price_delta_iqd: x.d.delta })),
            renames: proposals
              .filter((x) => x.nameChange)
              .map((x) => ({
                modifier_id: x.source.id,
                name_en: x.d.en.trim(),
                name_ar: x.d.ar.trim(),
              })),
          },
          p_photos: [],
          p_venue_id: null,
          p_idempotency_key: idemKey.current,
        });
      }
      toast.ok(proposals.length > 0 ? tr('op.addons.sentForApproval') : tr('op.toast.saved'));
      await queryClient.invalidateQueries({ queryKey: ADMIN_ADDONS_KEY });
      onSaved(id);
      onClose();
    } catch (e) {
      setError(e);
      toast.err(
        isRequiredAddonRefusal(e)
          ? tr('ws.pricing.addons.requiredAddon')
          : isRenameRefusal(e)
            ? tr('ws.pricing.renameViaProtocol')
            : e,
      );
      // A save that got part-way has still changed rows: show them.
      void queryClient.invalidateQueries({ queryKey: ADMIN_ADDONS_KEY });
    } finally {
      setBusy(false);
    }
  }

  const optionLabel = (d: OptionDraft) =>
    (locale === 'ar' ? d.ar : d.en).trim() || (locale === 'ar' ? d.en : d.ar).trim();
  const price = (d: OptionDraft) =>
    d.delta > 0 ? `+${formatIQD(d.delta, locale)}` : tr('op.addons.free');
  const preset = (a: number, b: number) => min === a && max === b;

  // Every option names its own boxes, so each reads on its own.
  const fieldBox = { ...inputStyle, inlineSize: '100%', minInlineSize: 0 } as const;

  const optionRow = (d: OptionDraft) => {
    const lock = d.source ? addonLock(d.source, caps) : null;
    const approval = !!lock && (lock.nameLocked || lock.priceLocked);
    const collapsed = !!d.source && !expanded.has(d.key);
    const edited =
      !!d.source &&
      (d.en !== d.source.name_en ||
        d.ar !== d.source.name_ar ||
        d.delta !== d.source.price_delta_iqd);
    const label = optionLabel(d) || tr('op.addons.newOption');
    if (collapsed && d.source) {
      return (
        <div
          key={d.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-3)',
            flexWrap: 'wrap',
            border: '1px solid var(--tp-border)',
            borderRadius: 'var(--tp-radius-ctl)',
            padding: 'var(--tp-sp-2) var(--tp-sp-3)',
            background: 'var(--tp-surface)',
          }}
        >
          <bdi
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            style={{
              flex: '1 1 8rem',
              minInlineSize: 0,
              fontWeight: 700,
              fontSize: 'var(--tp-fs-md)',
            }}
          >
            {label}
          </bdi>
          {approval && (
            <Icon
              name="info"
              size={16}
              aria-label={
                lock?.nameLocked
                  ? tr('op.addons.approvalNameAndPrice')
                  : tr('op.addons.approvalPrice')
              }
              style={{ color: 'var(--tp-accent)' }}
            />
          )}
          {edited && <StatusBadge size="sm" tone="warn" label={tr('ws.kit.actions.unsaved')} />}
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
            {price(d)}
          </span>
          <Button
            size="sm"
            kind="ghost"
            disabled={readOnly}
            aria-label={`${tr('op.common.edit')}: ${label}`}
            onClick={() => setOpenKey(d.key, true)}
          >
            {tr('op.common.edit')}
          </Button>
        </div>
      );
    }
    const eligible = d.source
      ? eligibleRevealGroups(d.source, data.groups, data.links, data.reveals, data.modifiers)
      : [];
    const revealOptions = [
      ...eligible,
      ...d.reveals
        .filter((id) => !eligible.some((g) => g.id === id))
        .flatMap((id) => data.groups.filter((g) => g.id === id)),
    ];
    const revealsOpen = openReveals.has(d.key);
    const hiddenNote = !d.source && !newOptionActive(d.delta, caps.launchDirectly);
    return (
      <div
        key={d.key}
        style={{
          display: 'grid',
          gap: 'var(--tp-sp-1-5)',
          border: '1px solid var(--tp-border)',
          borderRadius: 'var(--tp-radius-ctl)',
          padding: 'var(--tp-sp-2) var(--tp-sp-3)',
          background: 'var(--tp-surface)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
            gap: 'var(--tp-sp-3)',
            alignItems: 'end',
          }}
        >
          <Field label={tr('op.menu.nameEn')}>
            <input
              style={fieldBox}
              dir="ltr"
              autoFocus={d.key.startsWith('new-')}
              aria-label={`${tr('op.menu.nameEn')}: ${label}`}
              value={d.en}
              maxLength={80}
              onChange={(e) => patch(d.key, { en: e.target.value })}
            />
          </Field>
          <Field label={tr('op.menu.nameAr')}>
            <input
              style={fieldBox}
              dir="rtl"
              lang="ar"
              aria-label={`${tr('op.menu.nameAr')}: ${label}`}
              value={d.ar}
              maxLength={80}
              onChange={(e) => patch(d.key, { ar: e.target.value })}
            />
          </Field>
          <Field label={tr('op.addons.delta')}>
            <MoneyInput
              value={d.delta}
              onChange={(n) => patch(d.key, { delta: n ?? 0 })}
              aria-label={`${tr('op.addons.delta')}: ${label}`}
              bare
              style={{ inlineSize: '100%' }}
            />
          </Field>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--tp-sp-3)',
            flexWrap: 'wrap',
            paddingBlockStart: 'var(--tp-sp-2)',
          }}
        >
          <div
            style={{ display: 'grid', gap: 'var(--tp-sp-1)', flex: '1 1 14rem', minInlineSize: 0 }}
          >
            {approval && (
              <MessagePresenter
                tone="info"
                style={{ background: 'transparent', paddingInline: 0 }}
                message={
                  lock?.nameLocked
                    ? tr('op.addons.approvalNameAndPrice')
                    : tr('op.addons.approvalPrice')
                }
              />
            )}
            {hiddenNote && (
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                {tr('ws.pricing.savedHidden')}
              </span>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            {revealOptions.length > 0 && (
              <Button
                size="sm"
                kind="ghost"
                iconEnd={revealsOpen ? 'chevronUp' : 'chevronDown'}
                aria-expanded={revealsOpen}
                aria-label={`${tr('op.addons.reveals')}: ${label}`}
                onClick={() =>
                  setOpenReveals((prev) => {
                    const next = new Set(prev);
                    if (next.has(d.key)) next.delete(d.key);
                    else next.add(d.key);
                    return next;
                  })
                }
              >
                {tr('op.addons.reveals')}
                {d.reveals.length > 0 && ` (${formatNumber(d.reveals.length, locale)})`}
              </Button>
            )}
            {d.source && lock?.needsLaunch && (
              <PriceChangeButton
                size="sm"
                target={{ change: 'addon_price', addon: d.source.id }}
                label={tr('ws.pricing.putOnSale')}
                ariaLabel={tr('ws.pricing.putOnSaleFor', { name: label })}
              />
            )}
            {!d.source && (
              <Button
                size="sm"
                kind="ghost"
                aria-label={`${tr('op.common.remove')}: ${label}`}
                onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
              >
                {tr('op.common.remove')}
              </Button>
            )}
            {d.source && approval && (
              <Button
                size="sm"
                kind="ghost"
                aria-label={`${tr('common.cancel')}: ${label}`}
                onClick={() => {
                  // Back to what is stored, and a plain row again.
                  patch(d.key, {
                    en: d.source!.name_en,
                    ar: d.source!.name_ar,
                    delta: d.source!.price_delta_iqd,
                  });
                  setOpenKey(d.key, false);
                }}
              >
                {tr('common.cancel')}
              </Button>
            )}
            {d.source && (
              <Button
                size="sm"
                kind="primary"
                aria-label={`${tr('op.addons.done')}: ${label}`}
                onClick={() => setOpenKey(d.key, false)}
              >
                {tr('op.addons.done')}
              </Button>
            )}
          </div>
        </div>
        {revealsOpen && revealOptions.length > 0 && (
          <div
            style={{
              display: 'grid',
              gap: 'var(--tp-sp-1)',
              paddingBlockStart: 'var(--tp-sp-1-5)',
              borderBlockStart: '1px dashed var(--tp-border)',
            }}
          >
            <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
              {tr('op.addons.revealsTitle', { option: label })}
            </span>
            <WizardChips
              label={tr('op.addons.reveals')}
              options={revealOptions.map((g) => ({ value: g.id, label: pickName(locale, g) }))}
              value={d.reveals}
              onChange={(id) =>
                patch(d.key, {
                  reveals: d.reveals.includes(id)
                    ? d.reveals.filter((x) => x !== id)
                    : [...d.reveals, id],
                })
              }
            />
          </div>
        )}
      </div>
    );
  };

  const steps: WizardStep[] = [
    {
      key: 'name',
      label: tr('op.addons.stepBasics'),
      note: (locale === 'ar' ? name.ar : name.en).trim() || null,
      problems: [
        ...(namesMissing ? [tr('op.addons.namesRequired')] : []),
        ...(mmText ? [mmText] : []),
      ],
      content: (
        <>
          <BilingualFieldPair
            label={tr('ws.manager.menu.form.name')}
            value={name}
            onChange={setName}
            required
            maxLength={80}
            disabled={readOnly}
          />

          <section
            style={{
              display: 'grid',
              gap: 'var(--tp-sp-3)',
              paddingBlockStart: 'var(--tp-sp-4)',
              borderBlockStart: '1px solid var(--tp-border)',
            }}
          >
            <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
              <h4 style={{ margin: 0, fontSize: 'var(--tp-fs-lg)' }}>{tr('op.addons.limits')}</h4>
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {tr('op.addons.limitsHint')}
              </span>
            </div>
            <WizardChoices small label={tr('op.addons.limits')}>
              <WizardChoice
                on={!many && preset(0, 1)}
                title={tr('op.addons.presetOptional')}
                body={tr('op.addons.presetOptionalBody')}
                disabled={readOnly}
                onPick={() => {
                  setMany(false);
                  setMin(0);
                  setMax(1);
                }}
              />
              <WizardChoice
                on={!many && preset(1, 1)}
                title={tr('op.addons.presetRequired')}
                body={tr('op.addons.presetRequiredBody')}
                disabled={readOnly}
                onPick={() => {
                  setMany(false);
                  setMin(1);
                  setMax(1);
                }}
              />
              <WizardChoice
                on={many}
                title={tr('op.addons.presetMany')}
                body={tr('op.addons.presetManyBody')}
                disabled={readOnly}
                onPick={() => {
                  setMany(true);
                  setMin(0);
                  setMax(Math.max(max, 3));
                }}
              />
            </WizardChoices>
            {many ? (
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--tp-sp-6)',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <LimitStepper
                  label={tr('op.addons.atLeast')}
                  value={min}
                  floor={0}
                  disabled={readOnly}
                  onChange={setMin}
                />
                <LimitStepper
                  label={tr('op.addons.atMost')}
                  value={max}
                  floor={1}
                  disabled={readOnly}
                  onChange={setMax}
                />
              </div>
            ) : null}
            <WizardNote tone={mmText ? 'error' : 'info'}>{mmText ?? ruleText(min, max)}</WizardNote>
          </section>
        </>
      ),
    },
    {
      key: 'options',
      label: tr('op.addons.stepOptions'),
      note: tr('op.addons.optionCount', { count: formatNumber(drafts.length, locale) }),
      problems: optionNamesMissing ? [tr('op.addons.namesRequired')] : [],
      content: (
        <>
          {!caps.editLaunchedPrices && <PriceLockNote message={tr('ws.pricing.addons.note')} />}
          {drafts.length === 0 ? (
            <WizardNote>{tr('op.addons.emptyOptions')}</WizardNote>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>{drafts.map(optionRow)}</div>
          )}
          <div>
            <Button
              icon="plus"
              disabled={readOnly}
              onClick={() =>
                setDrafts((ds) => [
                  ...ds,
                  { key: `new-${++draftSeq}`, source: null, en: '', ar: '', delta: 0, reveals: [] },
                ])
              }
            >
              {tr('op.addons.newOption')}
            </Button>
          </div>
        </>
      ),
    },
  ];
  if (!isSub) {
    steps.push({
      key: 'items',
      label: tr('op.addons.stepItems'),
      note: tr('op.addons.selectedCount', { count: formatNumber(linked.size, locale) }),
      content: (
        <ItemsPicker
          data={data}
          linked={linked}
          readOnly={readOnly}
          query={query}
          onQuery={setQuery}
          onToggle={(ids, on) =>
            setLinked((prev) => {
              const next = new Set(prev);
              for (const id of ids) {
                if (on) next.add(id);
                else next.delete(id);
              }
              return next;
            })
          }
        />
      ),
    });
  }

  const title = group
    ? pickName(locale, group)
    : isSub
      ? tr('op.addons.newSubGroup')
      : tr('op.addons.newGroup');

  return (
    <StepWizard
      title={title}
      lead={tr('op.addons.wizardLead')}
      steps={steps}
      at={at}
      onAtChange={setAt}
      review={(goTo) => (
        <>
          <ReviewList
            goTo={goTo}
            busy={busy}
            rows={[
              {
                label: tr('op.addons.stepName'),
                value: (
                  <>
                    <bdi dir="ltr">{name.en.trim()}</bdi> · <bdi dir="rtl">{name.ar.trim()}</bdi>
                  </>
                ),
                step: 'name',
              },
              { label: tr('op.addons.stepChoices'), value: ruleText(min, max), step: 'name' },
              {
                label: tr('op.addons.stepOptions'),
                value:
                  drafts.length === 0
                    ? '—'
                    : drafts.map((d) => `${optionLabel(d)} (${price(d)})`).join(', '),
                step: 'options',
              },
              ...(isSub
                ? []
                : [
                    {
                      label: tr('op.addons.stepItems'),
                      value:
                        linked.size === 0
                          ? '—'
                          : data.items
                              .filter((i) => linked.has(i.id))
                              .map((i) => pickName(locale, i))
                              .join(', '),
                      step: 'items',
                    },
                  ]),
            ]}
          />
          {proposals.length > 0 && (
            <div
              style={{
                display: 'grid',
                gap: 'var(--tp-sp-2)',
                padding: 'var(--tp-sp-3)',
                borderRadius: 'var(--tp-radius-panel)',
                border: '1px solid var(--tp-border)',
                background: 'var(--tp-surface)',
              }}
            >
              <h4 style={{ margin: 0 }}>{tr('op.addons.approvalTitle')}</h4>
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {tr('op.addons.approvalLead')}
              </span>
              <ul style={{ margin: 0, paddingInlineStart: 'var(--tp-sp-5)' }}>
                {proposals.map((x) => (
                  <li key={x.d.key}>
                    <bdi>{pickName(locale, x.source)}</bdi>
                    {x.nameChange && (
                      <>
                        {' '}
                        → <bdi>{optionLabel(x.d)}</bdi>
                      </>
                    )}
                    {x.priceChange && (
                      <>
                        {' '}
                        · {price({ ...x.d, delta: x.source.price_delta_iqd })} → {price(x.d)}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <Field label={tr('op.addons.approvalReason')} required>
                <textarea
                  style={{
                    ...inputStyle,
                    inlineSize: '100%',
                    minBlockSize: '4rem',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                  }}
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Field label={tr('op.addons.approvalEffect')} required>
                <textarea
                  style={{
                    ...inputStyle,
                    inlineSize: '100%',
                    minBlockSize: '4rem',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                  }}
                  value={effect}
                  maxLength={500}
                  onChange={(e) => setEffect(e.target.value)}
                />
              </Field>
            </div>
          )}
        </>
      )}
      submitLabel={tr('ws.kit.actions.save')}
      onSubmit={() => void save()}
      submitBlocked={
        readOnly
          ? tr('op.addons.readOnly')
          : !dirty
            ? tr('op.addons.nothingChanged')
            : needsReason
              ? tr('op.addons.approvalNeedsReason')
              : null
      }
      busy={busy}
      notice={
        error ? (
          isRequiredAddonRefusal(error) ? (
            <PriceLockNote message={tr('ws.pricing.addons.requiredAddon')} />
          ) : (
            <ErrorText error={error} />
          )
        ) : undefined
      }
      onClose={onClose}
      canClose={() =>
        dirty && !busy ? confirm({ title: tr('op.addons.discard'), kind: 'danger' }) : true
      }
      testId="group-wizard"
    />
  );
}
