/**
 * One modifier group: name EN/AR, min/max (0 ≤ min ≤ max, max ≥ 1) and the
 * searchable "linked items" checklist. Save = `upsert_modifier_group` + one
 * `link_item_modifier_group` per changed item (diff of old vs new set).
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Field, card, inputStyle } from '../../../components/ui';
import { BilingualFields } from '../../../components/inputs';
import { useToast } from '../../../components/toast';
import { diffLinks, minMaxError } from './addonsLogic';
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
  const { refresh } = useAddons();
  const initialLinked = new Set(links.filter((l) => l.group_id === group?.id).map((l) => l.item_id));

  const [nameEn, setNameEn] = useState(group?.name_en ?? '');
  const [nameAr, setNameAr] = useState(group?.name_ar ?? '');
  const [min, setMin] = useState(group?.min_select ?? 0);
  const [max, setMax] = useState(group?.max_select ?? 1);
  const [linked, setLinked] = useState<Set<string>>(initialLinked);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<unknown>(null);

  const mmErr = minMaxError(min, max);
  const diff = diffLinks(initialLinked, linked);
  const dirty =
    nameEn !== (group?.name_en ?? '') ||
    nameAr !== (group?.name_ar ?? '') ||
    min !== (group?.min_select ?? 0) ||
    max !== (group?.max_select ?? 1) ||
    diff.link.length > 0 ||
    diff.unlink.length > 0;
  const valid = nameEn.trim() !== '' && nameAr.trim() !== '' && mmErr === null;

  const save = useMutation({
    mutationFn: async () => {
      const id = await appRpc<string>('upsert_modifier_group', {
        p_id: group?.id ?? null,
        p_name_en: nameEn.trim(),
        p_name_ar: nameAr.trim(),
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
      toast.err(e);
    },
  });

  const q = query.trim().toLowerCase();
  const visibleItems = items.filter(
    (i) =>
      q === '' || i.name_en.toLowerCase().includes(q) || i.name_ar.toLowerCase().includes(q),
  );

  function toggleItem(id: string, on: boolean) {
    setLinked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const numStyle = { ...inputStyle, inlineSize: '5rem' };

  return (
    <div style={card}>
      <h3 style={{ marginBlockStart: 0 }}>
        {group ? pickName(locale, group) : subGroup ? tr('op.addons.newSubGroup') : tr('op.addons.newGroup')}
      </h3>
      <BilingualFields
        labelEn={tr('op.menu.nameEn')}
        labelAr={tr('op.menu.nameAr')}
        en={nameEn}
        ar={nameAr}
        onEn={setNameEn}
        onAr={setNameAr}
        maxLength={80}
      />
      <Field label={tr('op.addons.minMax')}>
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }} dir="ltr">
          <input
            style={numStyle}
            type="number"
            min={0}
            value={min}
            aria-label={tr('op.menu.minSelect')}
            onChange={(e) => setMin(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          <span>/</span>
          <input
            style={numStyle}
            type="number"
            min={1}
            value={max}
            aria-label={tr('op.menu.maxSelect')}
            onChange={(e) => setMax(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
          {min > 0 && (
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.addons.required')}</span>
          )}
        </span>
        {mmErr && (
          <span role="alert" style={{ display: 'block', color: 'var(--tp-danger)', fontSize: 'var(--tp-fs-sm)' }}>
            {tr('op.menu.minSelect')} ≤ {tr('op.menu.maxSelect')} · {tr('op.menu.maxSelect')} ≥ 1
          </span>
        )}
      </Field>

      {!subGroup && (
        <Field label={`${tr('op.addons.linkedItems')} (${linked.size})`}>
          <input
            type="search"
            style={{ ...inputStyle, marginBlockEnd: 'var(--tp-sp-1)' }}
            placeholder={tr('op.menu.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
            {visibleItems.length === 0 && (
              <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-md)' }}>{tr('op.common.none')}</span>
            )}
            {visibleItems.map((i) => (
              <label
                key={i.id}
                style={{
                  display: 'flex',
                  gap: 'var(--tp-sp-1-5)',
                  alignItems: 'center',
                  paddingBlock: 'var(--tp-sp-0)',
                  opacity: i.is_active ? 1 : 0.55,
                }}
              >
                <input
                  type="checkbox"
                  checked={linked.has(i.id)}
                  onChange={(e) => toggleItem(i.id, e.target.checked)}
                />
                {pickName(locale, i)}
              </label>
            ))}
          </div>
        </Field>
      )}

      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', justifyContent: 'flex-end' }}>
        {onCancel && <Button onClick={onCancel}>{tr('common.cancel')}</Button>}
        <Button kind="primary" disabled={save.isPending || !valid || !dirty} onClick={() => save.mutate()}>
          {tr('common.save')}
        </Button>
      </div>
    </div>
  );
}
