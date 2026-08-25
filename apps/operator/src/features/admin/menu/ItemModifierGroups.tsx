/**
 * Link / unlink modifier groups on one item (`link_item_modifier_group`).
 * Group and option EDITING lives in /admin/addons; this is only the join.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, card } from '../../../components/ui';
import { useToast } from '../../../components/toast';
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
  const { refresh } = useAdminMenu();
  const [open, setOpen] = useState<string | null>(null);
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
    onError: (e) => toast.err(e),
  });

  const sorted = [...groups].sort(
    (a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)) || a.name_en.localeCompare(b.name_en),
  );

  return (
    <div style={{ ...card, marginBlockStart: '0.6rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>{tr('op.menu.modifierGroups')}</h4>
        <Link to="/admin/addons" style={{ fontSize: '0.85rem', color: 'var(--tp-accent)' }}>
          {tr('op.adminNav.addons')} →
        </Link>
      </div>
      {sorted.length === 0 && (
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>{tr('op.common.none')}</p>
      )}
      {sorted.map((g) => {
        const isLinked = linked.has(g.id);
        const options = modifiers.filter((m) => m.group_id === g.id);
        return (
          <div key={g.id} style={{ marginBlockStart: '0.35rem' }}>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <Button
                kind="ghost"
                onClick={() => setOpen(open === g.id ? null : g.id)}
                aria-label={pickName(locale, g)}
              >
                {open === g.id ? '▾' : '▸'}
              </Button>
              <span style={{ flex: 1 }}>
                {pickName(locale, g)}{' '}
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }} dir="ltr">
                  ({g.min_select}–{g.max_select})
                </span>
              </span>
              <Button
                kind={isLinked ? 'danger' : 'primary'}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ groupId: g.id, link: !isLinked })}
              >
                {isLinked ? tr('op.menu.unlink') : tr('op.menu.link')}
              </Button>
            </div>
            {open === g.id && (
              <ul
                style={{
                  marginInlineStart: '2rem',
                  marginBlock: '0.2rem',
                  paddingInlineStart: '1rem',
                  fontSize: '0.9rem',
                }}
              >
                {options.length === 0 && (
                  <li style={{ color: 'var(--tp-muted-fg)' }}>{tr('op.common.none')}</li>
                )}
                {options.map((m) => (
                  <li key={m.id} style={{ opacity: m.is_active ? 1 : 0.5 }}>
                    {pickName(locale, m)} · {formatIQD(m.price_delta_iqd, locale)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
