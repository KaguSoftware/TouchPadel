/**
 * Reveals for one option: an ordered checklist of sub-groups (groups linked
 * to no item, excluding the option's own group and any group that already
 * reveals — depth is one level). Save = `set_modifier_reveals` (replace-all).
 * "New sub-group" creates via `upsert_modifier_group` and appends it.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, inputStyle } from '../../../components/ui';
import { BilingualFields, SortButtons } from '../../../components/inputs';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import {
  eligibleRevealGroups,
  minMaxError,
  moveInList,
  revealedGroupIds,
  sameOrder,
} from './addonsLogic';
import { useAddons, type AddonsData, type ModifierRow } from './useAddons';

export function RevealsEditor({ modifier, data }: { modifier: ModifierRow; data: AddonsData }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const { refresh } = useAddons();

  const saved = revealedGroupIds(modifier.id, data.reveals);
  const [selected, setSelected] = useState<string[]>(saved);
  const [draft, setDraft] = useState<{ nameEn: string; nameAr: string; min: number; max: number } | null>(null);

  const byId = new Map(data.groups.map((g) => [g.id, g]));
  const eligible = eligibleRevealGroups(modifier, data.groups, data.links, data.reveals, data.modifiers);
  const ownGroupIsTarget = data.reveals.some((r) => r.group_id === modifier.group_id);
  const available = eligible.filter((g) => !selected.includes(g.id));
  const dirty = !sameOrder(saved, selected);

  const save = useMutation({
    mutationFn: (ids: string[]) =>
      appRpc('set_modifier_reveals', { p_modifier_id: modifier.id, p_group_ids: ids }),
    onSuccess: async () => {
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
    onError: (e) => toast.err(e),
  });

  const createSub = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('no draft');
      const id = await appRpc<string>('upsert_modifier_group', {
        p_name_en: draft.nameEn.trim(),
        p_name_ar: draft.nameAr.trim(),
        p_min_select: draft.min,
        p_max_select: draft.max,
      });
      const next = [...selected, id];
      await appRpc('set_modifier_reveals', { p_modifier_id: modifier.id, p_group_ids: next });
      return next;
    },
    onSuccess: async (next) => {
      setSelected(next);
      setDraft(null);
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
    onError: (e) => toast.err(e),
  });

  async function clearAll() {
    if (!(await confirm({ title: tr('op.confirm.clearReveals'), kind: 'danger' }))) return;
    setSelected([]);
    save.mutate([]);
  }

  const draftErr = draft ? minMaxError(draft.min, draft.max) : null;
  const numStyle = { ...inputStyle, inlineSize: '4.5rem' };

  return (
    <div
      style={{
        marginInlineStart: 'var(--tp-sp-5)',
        marginBlockStart: 'var(--tp-sp-1-5)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2-5)',
        border: '1px dashed var(--tp-border)',
        borderRadius: 'var(--tp-radius-ctl)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
        <strong style={{ fontSize: 'var(--tp-fs-md)' }}>{tr('op.addons.reveals')}</strong>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.addons.revealsHint')}</span>
      </div>

      {ownGroupIsTarget && (
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlock: 'var(--tp-sp-1)' }}>
          {tr('op.errors.REVEAL_DEPTH')}
        </p>
      )}

      {/* ordered, selected */}
      {selected.map((id, index) => (
        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', marginBlockStart: 'var(--tp-sp-1)' }}>
          <input
            type="checkbox"
            checked
            aria-label={pickName(locale, byId.get(id))}
            onChange={() => setSelected(selected.filter((s) => s !== id))}
          />
          <span style={{ flex: 1 }}>{pickName(locale, byId.get(id)) || id}</span>
          <SortButtons
            onUp={() => setSelected(moveInList(selected, index, 'up'))}
            onDown={() => setSelected(moveInList(selected, index, 'down'))}
            disabledUp={index === 0}
            disabledDown={index === selected.length - 1}
          />
        </div>
      ))}

      {/* available to add */}
      {available.map((g) => (
        <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', marginBlockStart: 'var(--tp-sp-1)' }}>
          <input type="checkbox" checked={false} onChange={() => setSelected([...selected, g.id])} />
          <span style={{ flex: 1, color: 'var(--tp-muted-fg)' }}>
            {pickName(locale, g)}{' '}
            <span dir="ltr" style={{ fontSize: 'var(--tp-fs-sm)' }}>
              ({g.min_select}–{g.max_select})
            </span>
          </span>
        </label>
      ))}
      {!ownGroupIsTarget && selected.length === 0 && available.length === 0 && (
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlock: 'var(--tp-sp-1)' }}>
          {tr('op.addons.noSubGroups')}
        </p>
      )}

      {/* new sub-group inline */}
      {draft ? (
        <div style={{ marginBlockStart: 'var(--tp-sp-2)', paddingBlockStart: 'var(--tp-sp-2)', borderBlockStart: '1px solid var(--tp-border)' }}>
          <BilingualFields
            labelEn={tr('op.menu.nameEn')}
            labelAr={tr('op.menu.nameAr')}
            en={draft.nameEn}
            ar={draft.nameAr}
            onEn={(v) => setDraft({ ...draft, nameEn: v })}
            onAr={(v) => setDraft({ ...draft, nameAr: v })}
            maxLength={80}
          />
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.addons.minMax')}</span>
            <span dir="ltr" style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
              <input
                style={numStyle}
                type="number"
                min={0}
                value={draft.min}
                aria-label={tr('op.menu.minSelect')}
                onChange={(e) => setDraft({ ...draft, min: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              />
              /
              <input
                style={numStyle}
                type="number"
                min={1}
                value={draft.max}
                aria-label={tr('op.menu.maxSelect')}
                onChange={(e) => setDraft({ ...draft, max: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              />
            </span>
            <span style={{ flex: 1 }} />
            <Button onClick={() => setDraft(null)}>{tr('common.cancel')}</Button>
            <Button
              kind="primary"
              disabled={createSub.isPending || !draft.nameEn.trim() || !draft.nameAr.trim() || draftErr !== null}
              onClick={() => createSub.mutate()}
            >
              {tr('common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', marginBlockStart: 'var(--tp-sp-2)', alignItems: 'center' }}>
          <Button
            kind="ghost"
            disabled={ownGroupIsTarget}
            onClick={() => setDraft({ nameEn: '', nameAr: '', min: 0, max: 1 })}
          >
            + {tr('op.addons.newSubGroup')}
          </Button>
          <span style={{ flex: 1 }} />
          {saved.length > 0 && (
            <Button kind="ghost" disabled={save.isPending} onClick={() => void clearAll()}>
              {tr('op.common.remove')}
            </Button>
          )}
          <Button kind="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(selected)}>
            {tr('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}
