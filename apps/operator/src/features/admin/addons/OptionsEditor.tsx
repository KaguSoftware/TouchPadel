/**
 * Options (modifiers) of one group: inline name EN/AR + price delta with a
 * per-row Save, optimistic active Switch, ▲▼ reorder (two `upsert_modifier`
 * calls), and a per-option Reveals panel. Everything writes `upsert_modifier`.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, card, inputStyle } from '../../../components/ui';
import { MoneyInput, SortButtons } from '../../../components/inputs';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { reorderedIds, sortRows } from '../menu/menuLogic';
import { RevealsEditor } from './RevealsEditor';
import { patchCachedModifiers, useAddons, type AddonsData, type GroupRow, type ModifierRow } from './useAddons';

function modifierArgs(m: ModifierRow, overrides: Partial<ModifierRow> = {}) {
  const r = { ...m, ...overrides };
  return {
    p_id: r.id,
    p_group_id: r.group_id,
    p_name_en: r.name_en,
    p_name_ar: r.name_ar,
    p_price_delta_iqd: r.price_delta_iqd,
    p_sort_order: r.sort_order,
    p_is_active: r.is_active,
  };
}

export function OptionsEditor({ group, data }: { group: GroupRow; data: AddonsData }) {
  const { tr } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refresh } = useAddons();
  const [draft, setDraft] = useState<{ nameEn: string; nameAr: string; delta: number } | null>(null);
  const [openReveals, setOpenReveals] = useState<string | null>(null);

  const options = sortRows(data.modifiers.filter((m) => m.group_id === group.id));

  const upsert = useMutation({
    mutationFn: (args: Record<string, unknown>) => appRpc('upsert_modifier', args),
    onSuccess: async () => {
      setDraft(null);
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
    onError: (e) => toast.err(e),
  });

  const reorder = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: 'up' | 'down' }) => {
      const ids = reorderedIds(options, index, direction);
      if (ids.length === 0) return;
      const position = new Map(ids.map((id, i) => [id, i]));
      patchCachedModifiers(queryClient, (mods) =>
        mods.map((m) => {
          const pos = position.get(m.id);
          return pos === undefined ? m : { ...m, sort_order: pos };
        }),
      );
      // The row this used to re-send carried price_delta_iqd, so reordering
      // options could silently revert a colleague's price change from a stale
      // cache. One statement, sort_order only.
      await appRpc('reorder_modifiers', { p_ids: ids });
    },
    onSuccess: () => toast.ok(tr('op.toast.saved')),
    onError: (e) => toast.err(e),
    onSettled: () => refresh(),
  });

  async function setActive(m: ModifierRow, next: boolean) {
    await appRpc('upsert_modifier', modifierArgs(m, { is_active: next }));
    await refresh();
  }

  return (
    <div style={{ ...card, marginBlockStart: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>{tr('op.addons.options')}</h4>
        <Button onClick={() => setDraft({ nameEn: '', nameAr: '', delta: 0 })} disabled={!!draft}>
          {tr('op.addons.newOption')}
        </Button>
      </div>
      {options.length === 0 && !draft && (
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>{tr('op.common.none')}</p>
      )}
      {options.map((m, index) => (
        <div key={m.id}>
          <OptionRow
            option={m}
            busy={upsert.isPending}
            onSave={(next) => upsert.mutate(modifierArgs(next))}
            onActive={(next) => setActive(m, next)}
            revealsOpen={openReveals === m.id}
            revealCount={data.reveals.filter((r) => r.modifier_id === m.id).length}
            onToggleReveals={() => setOpenReveals(openReveals === m.id ? null : m.id)}
            sort={
              <SortButtons
                onUp={() => reorder.mutate({ index, direction: 'up' })}
                onDown={() => reorder.mutate({ index, direction: 'down' })}
                disabledUp={index === 0 || reorder.isPending}
                disabledDown={index === options.length - 1 || reorder.isPending}
              />
            }
          />
          {openReveals === m.id && <RevealsEditor key={m.id} modifier={m} data={data} />}
        </div>
      ))}
      {draft && (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', marginBlockStart: '0.5rem' }}>
          <input
            style={{ ...inputStyle, flex: 1, minInlineSize: '8rem' }}
            dir="ltr"
            placeholder={tr('op.menu.nameEn')}
            aria-label={tr('op.menu.nameEn')}
            value={draft.nameEn}
            onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
          />
          <input
            style={{ ...inputStyle, flex: 1, minInlineSize: '8rem' }}
            dir="rtl"
            lang="ar"
            placeholder={tr('op.menu.nameAr')}
            aria-label={tr('op.menu.nameAr')}
            value={draft.nameAr}
            onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
          />
          <MoneyInput
            value={draft.delta}
            onChange={(n) => setDraft({ ...draft, delta: n ?? 0 })}
            placeholder={tr('op.addons.delta')}
            style={{ inlineSize: '11rem' }}
          />
          <Button onClick={() => setDraft(null)}>{tr('common.cancel')}</Button>
          <Button
            kind="primary"
            disabled={upsert.isPending || !draft.nameEn.trim() || !draft.nameAr.trim()}
            onClick={() =>
              upsert.mutate({
                p_group_id: group.id,
                p_name_en: draft.nameEn.trim(),
                p_name_ar: draft.nameAr.trim(),
                p_price_delta_iqd: draft.delta,
                p_sort_order: options.length,
                p_is_active: true,
              })
            }
          >
            {tr('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

function OptionRow({
  option,
  busy,
  onSave,
  onActive,
  revealsOpen,
  revealCount,
  onToggleReveals,
  sort,
}: {
  option: ModifierRow;
  busy: boolean;
  onSave: (next: ModifierRow) => void;
  onActive: (next: boolean) => Promise<void>;
  revealsOpen: boolean;
  revealCount: number;
  onToggleReveals: () => void;
  sort: React.ReactNode;
}) {
  const { tr, locale } = useLocale();
  const [nameEn, setNameEn] = useState(option.name_en);
  const [nameAr, setNameAr] = useState(option.name_ar);
  const [delta, setDelta] = useState<number>(option.price_delta_iqd);
  const dirty = nameEn !== option.name_en || nameAr !== option.name_ar || delta !== option.price_delta_iqd;

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.4rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBlockStart: '0.4rem',
        opacity: option.is_active ? 1 : 0.6,
      }}
    >
      <input
        style={{ ...inputStyle, flex: 1, minInlineSize: '8rem' }}
        dir="ltr"
        aria-label={tr('op.menu.nameEn')}
        value={nameEn}
        onChange={(e) => setNameEn(e.target.value)}
      />
      <input
        style={{ ...inputStyle, flex: 1, minInlineSize: '8rem' }}
        dir="rtl"
        lang="ar"
        aria-label={tr('op.menu.nameAr')}
        value={nameAr}
        onChange={(e) => setNameAr(e.target.value)}
      />
      <MoneyInput value={delta} onChange={(n) => setDelta(n ?? 0)} style={{ inlineSize: '11rem' }} />
      <Switch
        checked={option.is_active}
        onChange={onActive}
        label={`${tr('op.addons.active')}: ${pickName(locale, option)}`}
        hideLabel
      />
      {sort}
      <Button kind="ghost" onClick={onToggleReveals} aria-expanded={revealsOpen}>
        {revealsOpen ? '▾' : '▸'} {tr('op.addons.reveals')}
        {revealCount > 0 && ` (${revealCount})`}
      </Button>
      <Button
        disabled={!dirty || busy || !nameEn.trim() || !nameAr.trim()}
        onClick={() => onSave({ ...option, name_en: nameEn.trim(), name_ar: nameAr.trim(), price_delta_iqd: delta })}
      >
        {tr('common.save')}
      </Button>
    </div>
  );
}
