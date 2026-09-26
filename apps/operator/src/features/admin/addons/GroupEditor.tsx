/**
 * One modifier group: name EN/AR, how many a guest may choose (0 ≤ min ≤ max,
 * max ≥ 1, said as a sentence) and the searchable "offered on these items"
 * checklist. Save = `upsert_modifier_group` + one `link_item_modifier_group`
 * per changed item (diff of old vs new set). A manager's save that would make
 * guests pay more (a paid choice made compulsory) is refused by the server
 * and said as the owner's to make.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/auth';
import { Button, ErrorText } from '../../../components/ui';
import { BilingualFieldPair, Panel, SearchField, StatusBadge } from '../../../components/kit';
import { useToast } from '../../../components/toast';
import { PriceLockNote } from '../promotions/PriceChangeStart';
import { ChoiceLimits } from './ChoiceLimits';
import { diffLinks, isRequiredAddonRefusal, minMaxError } from './addonsLogic';
import { useAddons, type GroupRow, type ItemNameRow, type LinkRow } from './useAddons';

export function GroupEditor({
  group,
  links,
  items,
  /** Sub-group mode hides the linked-items list (a sub-group is reveal-only). */
  subGroup,
  onSaved,
  onCancel,
}: {
  group: GroupRow | null;
  links: LinkRow[];
  items: ItemNameRow[];
  subGroup?: boolean;
  onSaved: (id: string) => void;
  onCancel?: () => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const can = usePermissions();
  const readOnly = !can.editMenu;
  const { refresh } = useAddons();
  const initialLinked = new Set(links.filter((l) => l.group_id === group?.id).map((l) => l.item_id));

  const [name, setName] = useState({ en: group?.name_en ?? '', ar: group?.name_ar ?? '' });
  const [min, setMin] = useState(group?.min_select ?? 0);
  const [max, setMax] = useState(group?.max_select ?? 1);
  const [linked, setLinked] = useState<Set<string>>(initialLinked);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<unknown>(null);

  const mmErr = minMaxError(min, max);
  const diff = diffLinks(initialLinked, linked);
  const dirty =
    name.en !== (group?.name_en ?? '') ||
    name.ar !== (group?.name_ar ?? '') ||
    min !== (group?.min_select ?? 0) ||
    max !== (group?.max_select ?? 1) ||
    diff.link.length > 0 ||
    diff.unlink.length > 0;
  const namesMissing = name.en.trim() === '' || name.ar.trim() === '';
  const valid = !namesMissing && mmErr === null;

  const save = useMutation({
    mutationFn: async () => {
      const id = await appRpc<string>('upsert_modifier_group', {
        p_id: group?.id ?? null,
        p_name_en: name.en.trim(),
        p_name_ar: name.ar.trim(),
        p_min_select: min,
        p_max_select: max,
      });
      for (const itemId of diff.link) {
        await appRpc('link_item_modifier_group', { p_item_id: itemId, p_group_id: id, p_linked: true });
      }
      for (const itemId of diff.unlink) {
        await appRpc('link_item_modifier_group', { p_item_id: itemId, p_group_id: id, p_linked: false });
      }
      return id;
    },
    onSuccess: async (id) => {
      setError(null);
      toast.ok(tr('op.toast.saved'));
      await refresh();
      onSaved(id);
    },
    onError: (e) => {
      setError(e);
      toast.err(isRequiredAddonRefusal(e) ? tr('ws.pricing.addons.requiredAddon') : e);
    },
  });

  function discard() {
    setName({ en: group?.name_en ?? '', ar: group?.name_ar ?? '' });
    setMin(group?.min_select ?? 0);
    setMax(group?.max_select ?? 1);
    setLinked(initialLinked);
    setError(null);
  }

  const q = query.trim().toLowerCase();
  // Items already offering the group lead, so the list answers "where is this
  // offered?" before it becomes a picker.
  const visibleItems = items
    .filter((i) => q === '' || i.name_en.toLowerCase().includes(q) || i.name_ar.toLowerCase().includes(q))
    .sort((a, b) => Number(initialLinked.has(b.id)) - Number(initialLinked.has(a.id)));

  function toggleItem(id: string, on: boolean) {
    setLinked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const title = group ? pickName(locale, group) : subGroup ? tr('op.addons.newSubGroup') : tr('op.addons.newGroup');

  return (
    <Panel
      title={<bdi>{title}</bdi>}
      actions={dirty ? <StatusBadge size="sm" tone="warn" label={tr('ws.kit.actions.unsaved')} /> : undefined}
    >
      <BilingualFieldPair label={tr('ws.manager.menu.form.name')} value={name} onChange={setName} required maxLength={80} disabled={readOnly} />
      <ChoiceLimits min={min} max={max} onMin={setMin} onMax={setMax} disabled={readOnly} />

      {!subGroup && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', marginBlockEnd: 'var(--tp-sp-2)' }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('op.addons.itemsLabel')}</span>
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.addons.selectedCount', { count: formatNumber(linked.size, locale) })}</span>
          </span>
          <SearchField value={query} onChange={setQuery} placeholder={tr('op.menu.search')} aria-label={tr('op.addons.itemsLabel')} />
          <div
            style={{
              maxBlockSize: '14rem',
              overflowY: 'auto',
              border: '1px solid var(--tp-border)',
              borderRadius: 'var(--tp-radius-ctl)',
              paddingBlock: 'var(--tp-sp-1)',
              paddingInline: 'var(--tp-sp-2)',
            }}
          >
            {visibleItems.length === 0 && <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('op.addons.noItemsMatch')}</span>}
            {visibleItems.map((i) => (
              <label
                key={i.id}
                style={{
                  display: 'flex',
                  gap: 'var(--tp-sp-1-5)',
                  alignItems: 'center',
                  paddingBlock: 'var(--tp-sp-0)',
                  color: i.is_active ? 'inherit' : 'var(--tp-muted-fg)',
                }}
              >
                <input type="checkbox" checked={linked.has(i.id)} disabled={readOnly} onChange={(e) => toggleItem(i.id, e.target.checked)} />
                <bdi>{pickName(locale, i)}</bdi>
                {!i.is_active && <StatusBadge size="sm" tone="neutral" label={tr('ws.manager.menu.inactive')} />}
              </label>
            ))}
          </div>
        </div>
      )}

      {isRequiredAddonRefusal(error) ? (
        <PriceLockNote message={tr('ws.pricing.addons.requiredAddon')} style={{ marginBlock: 'var(--tp-sp-2)' }} />
      ) : (
        <ErrorText error={error} />
      )}
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'flex-end', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {onCancel && (
          <Button kind="ghost" onClick={onCancel}>
            {tr('common.cancel')}
          </Button>
        )}
        {group && dirty && (
          <Button kind="ghost" onClick={discard} disabled={save.isPending}>
            {tr('ws.kit.actions.discard')}
          </Button>
        )}
        <Button
          kind="primary"
          icon="check"
          busy={save.isPending}
          disabled={readOnly || !valid || !dirty}
          disabledReason={dirty && namesMissing ? tr('ws.manager.disabled.namesRequired') : undefined}
          onClick={() => save.mutate()}
        >
          {tr('ws.kit.actions.save')}
        </Button>
      </div>
    </Panel>
  );
}
