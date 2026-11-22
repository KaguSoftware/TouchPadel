/**
 * Options (modifiers) of one group, as the page shows them under the group's summary: drag handle, name
 * in the screen's language, what it costs, the active switch and Edit. Names,
 * prices and reveals are changed in the group's wizard (GroupWizard); this
 * list only reorders (`reorder_modifiers`) and switches an option on or off
 * (`upsert_modifier`, one statement that re-sends the stored values).
 *
 * A manager's option prices go to the owner (#51, #53, build-contracts-2026-09-23
 * §5.5): a paid option never on sale has its switch off until the owner
 * approves its price (the wizard offers "Put on sale"); the lock note says so.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { useLocale, pickName } from '../../../lib/i18n';
import { can, useAuth, usePermissions } from '../../../lib/auth';
import { Button } from '../../../components/ui';
import { DragHandle, useDragReorder } from '../../../components/DragReorder';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { movedIds, reorderedIds, sortRows } from '../menu/menuLogic';
import { PriceLockNote } from '../promotions/PriceChangeStart';
import { addonLock, isRequiredAddonRefusal } from './addonsLogic';
import {
  patchCachedModifiers,
  useAddons,
  type AddonsData,
  type GroupRow,
  type ModifierRow,
} from './useAddons';

/** The arguments `upsert_modifier` takes for a row, with any field overridden. */
export function modifierArgs(m: ModifierRow, overrides: Partial<ModifierRow> = {}) {
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

export function OptionsList({
  group,
  data,
  onEdit,
}: {
  group: GroupRow;
  data: AddonsData;
  /** Opens the wizard at this option, ready to edit. */
  onEdit: (optionId: string) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refresh } = useAddons();
  const { staff } = useAuth();
  const caps = {
    editLaunchedPrices: can(staff, 'editLaunchedPrices'),
    launchDirectly: can(staff, 'launchDirectly'),
  };
  const canEdit = usePermissions().editMenu;

  const options = sortRows(data.modifiers.filter((m) => m.group_id === group.id));

  const reorder = useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      if (ids.length === 0) return;
      const position = new Map(ids.map((id, i) => [id, i]));
      patchCachedModifiers(queryClient, (mods) =>
        mods.map((m) => {
          const pos = position.get(m.id);
          return pos === undefined ? m : { ...m, sort_order: pos };
        }),
      );
      // One statement, sort_order only: re-sending a row from a stale cache
      // could revert a colleague's price change.
      await appRpc('reorder_modifiers', { p_ids: ids });
    },
    onSuccess: () => toast.ok(tr('op.toast.saved')),
    onError: (e) => toast.err(e),
    onSettled: () => refresh(),
  });
  const rowProps = useDragReorder(
    options.map((o) => o.id),
    (from, to) => reorder.mutate({ ids: movedIds(options, from, to) }),
    !reorder.isPending,
  );

  async function setActive(m: ModifierRow, next: boolean) {
    try {
      await appRpc('upsert_modifier', modifierArgs(m, { is_active: next }));
    } catch (e) {
      // The Switch toasts what it catches; a string is shown as it is.
      throw isRequiredAddonRefusal(e) ? tr('ws.pricing.addons.requiredAddon') : e;
    }
    await refresh();
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-3)' }}>
      <h4 style={{ margin: 0 }}>{tr('op.addons.options')}</h4>
      {!caps.editLaunchedPrices && <PriceLockNote message={tr('ws.pricing.addons.note')} />}
      {options.length === 0 ? (
        <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)', margin: 0 }}>
          {tr('op.addons.emptyOptions')}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          {options.map((m, index) => {
            const lock = addonLock(m, caps);
            const label = pickName(locale, m);
            return (
              <div
                key={m.id}
                {...rowProps(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-3)',
                  flexWrap: 'wrap',
                  border: '1px solid var(--tp-border)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  padding: 'var(--tp-sp-2) var(--tp-sp-3)',
                }}
              >
                <DragHandle
                  label={`${tr('op.common.moveUp')} / ${tr('op.common.moveDown')}`}
                  disabled={reorder.isPending || !canEdit}
                  onMove={(direction) =>
                    reorder.mutate({ ids: reorderedIds(options, index, direction) })
                  }
                />
                <bdi
                  dir={locale === 'ar' ? 'rtl' : 'ltr'}
                  style={{
                    flex: '1 1 8rem',
                    minInlineSize: 0,
                    fontWeight: 600,
                    fontSize: 'var(--tp-fs-md)',
                  }}
                >
                  {label}
                </bdi>
                <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                  {m.price_delta_iqd > 0
                    ? `+${formatIQD(m.price_delta_iqd, locale)}`
                    : tr('op.addons.free')}
                </span>
                <Switch
                  checked={m.is_active}
                  disabled={lock.needsLaunch || !canEdit}
                  onChange={(next) => setActive(m, next)}
                  label={`${tr('op.addons.active')}: ${label}`}
                  hideLabel
                />
                <Button
                  size="sm"
                  kind="ghost"
                  disabled={!canEdit}
                  onClick={() => onEdit(m.id)}
                  aria-label={`${tr('op.common.edit')}: ${label}`}
                >
                  {tr('op.common.edit')}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
