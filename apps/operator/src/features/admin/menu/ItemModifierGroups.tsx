/**
 * Which add-on groups are offered on one item (`link_item_modifier_group`).
 * Group and option EDITING lives in /admin/addons; this is only the join.
 *
 * Offering a group is a harmless on/off, so it is a switch per group. It was a
 * big red "Unlink" danger button on every linked group and a blue "Link" on
 * the rest, behind ▸/▾ text glyphs, with the group's rule printed as "(0–1)".
 * Now each group says its rule in words and lists its options plainly; groups
 * not on the item fold away under one button so the ones that matter lead.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/auth';
import { Button } from '../../../components/ui';
import { EmptyState } from '../../../components/kit';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { useChoiceRuleText } from '../addons/ChoiceLimits';
import { isRequiredAddonRefusal } from '../addons/addonsLogic';
import { useAdminMenu, type GroupRow, type ItemRow, type ModifierRow } from './useAdminMenu';

export function ItemModifierGroups({
  item,
  groups,
  modifiers,
}: {
  item: ItemRow;
  groups: GroupRow[];
  modifiers: ModifierRow[];
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const can = usePermissions();
  const navigate = useNavigate();
  const { refresh } = useAdminMenu();
  const [showOthers, setShowOthers] = useState(false);
  const linked = new Set(item.menu_item_modifier_groups.map((l) => l.group_id));

  const toggle = useMutation({
    mutationFn: ({ groupId, link }: { groupId: string; link: boolean }) =>
      appRpc('link_item_modifier_group', {
        p_item_id: item.id,
        p_group_id: groupId,
        p_linked: link,
      }),
    onSuccess: async () => {
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
  });

  const byName = (a: GroupRow, b: GroupRow) => pickName(locale, a).localeCompare(pickName(locale, b));
  const offered = groups.filter((g) => linked.has(g.id)).sort(byName);
  const others = groups.filter((g) => !linked.has(g.id)).sort(byName);

  const row = (g: GroupRow) => (
    <GroupRowView
      key={g.id}
      group={g}
      // What a guest is offered: the group's active options, in their order.
      options={modifiers.filter((m) => m.group_id === g.id && m.is_active).sort((a, b) => a.sort_order - b.sort_order)}
      offered={linked.has(g.id)}
      disabled={!can.editMenu}
      // Switch reverts and toasts on its own when this throws; a string is
      // shown as it is. A manager's link that would make guests pay more (a
      // paid choice made compulsory) is the owner's to make (price_promo).
      onChange={(next) =>
        toggle
          .mutateAsync({ groupId: g.id, link: next })
          .then(() => undefined)
          .catch((e: unknown) => {
            throw isRequiredAddonRefusal(e) ? tr('ws.pricing.addons.requiredAddon') : e;
          })
      }
    />
  );

  // Nothing to switch on yet: say so once, and put the one way forward where the eye is.
  if (groups.length === 0) {
    return (
      <EmptyState
        icon="sliders"
        title={tr('ws.manager.menu.form.groups.noneTitle')}
        body={tr('ws.manager.menu.form.groups.noneBody')}
        action={
          <Button kind="primary" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/admin/addons' })}>
            {tr('ws.manager.menu.form.groups.create')}
          </Button>
        }
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/admin/addons' })}>
          {tr('ws.manager.menu.form.groups.manage')}
        </Button>
      </div>
      {(
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {offered.length === 0 ? (
            <p style={{ fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.menu.form.groups.noneOffered')}</p>
          ) : (
            <ul style={listStyle}>{offered.map(row)}</ul>
          )}
          {others.length > 0 && (
            <>
              <div>
                <Button size="sm" kind="ghost" iconEnd="chevronDown" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}>
                  {showOthers ? tr('ws.manager.menu.form.groups.hideOthers') : tr('ws.manager.menu.form.groups.showOthers')}
                </Button>
              </div>
              {showOthers && <ul style={listStyle}>{others.map(row)}</ul>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const listStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' } as const;

function GroupRowView({
  group,
  options,
  offered,
  disabled,
  onChange,
}: {
  group: GroupRow;
  options: ModifierRow[];
  offered: boolean;
  disabled: boolean;
  onChange: (next: boolean) => Promise<void>;
}) {
  const { tr, locale } = useLocale();
  const ruleText = useChoiceRuleText();
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        columnGap: 'var(--tp-sp-4)',
        alignItems: 'center',
        padding: 'var(--tp-sp-3) var(--tp-sp-4)',
        borderRadius: 'var(--tp-radius-panel)',
        border: `2px solid ${offered ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
        background: offered ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
      }}
    >
      <Switch checked={offered} disabled={disabled} onChange={onChange} label={`${tr('ws.manager.menu.form.groups.offered')}: ${pickName(locale, group)}`} hideLabel style={{ marginBlockStart: '0.1rem' }} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <span style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <bdi style={{ fontWeight: 600 }}>{pickName(locale, group)}</bdi>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{ruleText(group.min_select, group.max_select)}</span>
        </span>
        {options.length === 0 ? (
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.menu.form.groups.noOptions')}</span>
        ) : (
          <span style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-1-5)' }}>
            {options.map((m) => (
              <bdi
                key={m.id}
                style={{ paddingBlock: 'var(--tp-sp-0)', paddingInline: 'var(--tp-sp-2-5)', borderRadius: 'var(--tp-radius-pill)', background: 'var(--tp-surface)', border: '1px solid var(--tp-border)', fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}
              >
                {m.price_delta_iqd > 0 ? `${pickName(locale, m)} (+${formatIQD(m.price_delta_iqd, locale)})` : pickName(locale, m)}
              </bdi>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}
