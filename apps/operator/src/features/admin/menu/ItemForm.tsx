/**
 * One menu item (spec 06.24): name / description / flavour line (bilingual
 * pairs), photo, highlight, cost + margin, active; then the three availability
 * states — sold out (a switch, stays until switched back), off for today
 * (temporary, restores next day), blocked by stock (READ-ONLY, the server's
 * decision, names the ingredient). Form fields save through
 * `upsert_menu_item`; photo / sold-out / cost have dedicated setters that fire
 * immediately for saved items (deferred to the first save for a new one).
 * Unsaved edits block navigation (TanStack `useBlocker`).
 *
 * The form had a "Sort order" number field. It did what the list's up/down
 * arrows do, less safely (a typed number could tie with another item), so it is
 * gone; the item's own sort_order is sent back unchanged, and a new item goes
 * to the end of its category.
 *
 * Product release and the manager locks (build-contracts-2026-09-23 §5.5,
 * `itemLocks`): an item in release says so and links its run, and neither its
 * switch nor its prices can be changed here by anyone; a price on sale is the
 * owner's unless it goes through "Change the price"; a draft goes on sale when
 * the owner launches it, or, for a shop product, through "Put on sale". The
 * server refuses the same things, so this only saves a refusal after typing.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { formatDate, isolate } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { removeMedia } from '../../../lib/storage';
import { useLocale, pickName } from '../../../lib/i18n';
import { can as hasCapability, useAuth, usePermissions } from '../../../lib/auth';
import { Button, ErrorText, Field } from '../../../components/ui';
import { BilingualFieldPair, MessagePresenter, Money, Panel, StatusBadge } from '../../../components/kit';
import { MoneyInput } from '../../../components/inputs';
import { ImageField } from '../../../components/ImageField';
import { Switch } from '../../../components/Switch';
import { Icon } from '../../../components/icons';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { MARK, MARK_FG } from '../../ops/OpsVisuals';
import { HIGHLIGHT_COLOR, MarginChip } from './chips';
import { FormBar } from './FormBar';
import {
  DESCRIPTION_MAX,
  HOOK_MAX,
  NAME_MAX,
  defaultPrice,
  hookError,
  inRelease,
  itemLocks,
  nextDayIso,
  orderableState,
  runTitle,
  type CategoryKind,
} from './menuLogic';
import { savePhoto } from './photo';
import { PriceChangeButton } from '../promotions/PriceChangeStart';
import { VariantsEditor } from './VariantsEditor';
import { ItemModifierGroups } from './ItemModifierGroups';
import { todayIso, type StockBlock } from './availability';
import { useAdminMenu, type GroupRow, type Highlight, type ItemRow, type ModifierRow } from './useAdminMenu';

const HIGHLIGHTS: readonly Highlight[] = ['none', 'blue', 'brown'];
const NO_BLOCK: StockBlock = { blocked: false, ingredients: [] };

export function ItemForm({
  item,
  categoryId,
  categoryName,
  categoryKind,
  newSortOrder = 0,
  groups,
  modifiers,
  cost,
  stockBlock = NO_BLOCK,
  today = todayIso(),
  onSaved,
  onDirtyChange,
}: {
  item: ItemRow | null;
  categoryId: string;
  /** The item's category, shown under the title. */
  categoryName?: string;
  /** Its kind: what a draft needs to go on sale differs for café and shop. */
  categoryKind: CategoryKind;
  /** sort_order for a NEW item: the end of its category. */
  newSortOrder?: number;
  groups: GroupRow[];
  modifiers: ModifierRow[];
  /** Known cost from `menu_item_costs`, or null. */
  cost: number | null;
  /** The server's stock decision for this item (read-only state). */
  stockBlock?: StockBlock;
  /** Station date, the same one the item list reads "off today" against. */
  today?: string;
  onSaved: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const can = usePermissions();
  const { staff } = useAuth();
  const { refresh } = useAdminMenu();
  const readOnly = !can.editMenu;
  const locks = itemLocks(item, categoryKind, {
    editLaunchedPrices: hasCapability(staff?.role, 'editLaunchedPrices'),
    launchDirectly: hasCapability(staff?.role, 'launchDirectly'),
  });
  // A new item that cannot go on sale from here starts switched off, and that
  // is its resting state, not an unsaved change.
  const activeAtRest = item?.is_active ?? locks.switchOn === null;

  const [name, setName] = useState({ en: item?.name_en ?? '', ar: item?.name_ar ?? '' });
  const [desc, setDesc] = useState({ en: item?.description_en ?? '', ar: item?.description_ar ?? '' });
  const [hook, setHook] = useState({ en: item?.hook_en ?? '', ar: item?.hook_ar ?? '' });
  const [highlight, setHighlight] = useState<Highlight>(item?.highlight ?? 'none');
  const [isActive, setIsActive] = useState(activeAtRest);
  const [photo, setPhoto] = useState<string | null>(item?.photo_path ?? null);
  const [costDraft, setCostDraft] = useState<number | null>(cost);
  const [error, setError] = useState<unknown>(null);
  const draftId = useRef(crypto.randomUUID());
  const pendingPhoto = useRef<string | null>(null);

  // Keep immediate-save fields in step with the cache after a refetch.
  useEffect(() => {
    if (item) setPhoto(item.photo_path);
  }, [item?.photo_path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setCostDraft(cost);
  }, [cost]);

  const formDirty =
    name.en !== (item?.name_en ?? '') ||
    name.ar !== (item?.name_ar ?? '') ||
    desc.en !== (item?.description_en ?? '') ||
    desc.ar !== (item?.description_ar ?? '') ||
    hook.en !== (item?.hook_en ?? '') ||
    hook.ar !== (item?.hook_ar ?? '') ||
    highlight !== (item?.highlight ?? 'none') ||
    isActive !== activeAtRest ||
    (!item && (pendingPhoto.current !== null || costDraft !== null));
  const dirty = formDirty || (item !== null && costDraft !== cost);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useBlocker({
    shouldBlockFn: async () => {
      if (!dirty) return false;
      const leave = await confirm({ title: tr('op.common.unsavedPrompt'), kind: 'danger' });
      return !leave;
    },
    enableBeforeUnload: dirty,
  });

  const hookErr = hookError(hook.en, hook.ar);
  const namesMissing = name.en.trim() === '' || name.ar.trim() === '';
  const valid = !namesMissing && hookErr === null;

  function discard() {
    setName({ en: item?.name_en ?? '', ar: item?.name_ar ?? '' });
    setDesc({ en: item?.description_en ?? '', ar: item?.description_ar ?? '' });
    setHook({ en: item?.hook_en ?? '', ar: item?.hook_ar ?? '' });
    setHighlight(item?.highlight ?? 'none');
    setIsActive(activeAtRest);
    setCostDraft(cost);
    setError(null);
  }

  /* ---------- immediate setters (saved items only) ---------- */

  const photoMutation = useMutation({
    mutationFn: ({ next, previous }: { next: string | null; previous: string | null }) => savePhoto('item', item!.id, next, previous),
    onSuccess: async () => {
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
    onError: (e, { previous }) => {
      setPhoto(previous);
      toast.err(e);
    },
  });

  function onPhotoChange(next: string | null) {
    const previous = photo;
    setPhoto(next);
    if (item) {
      photoMutation.mutate({ next, previous });
    } else {
      if (pendingPhoto.current && pendingPhoto.current !== next) void removeMedia(pendingPhoto.current);
      pendingPhoto.current = next;
    }
  }

  const costMutation = useMutation({
    mutationFn: (next: number | null) => appRpc('set_item_cost', { p_item_id: item!.id, p_cost_iqd: next }),
    onSuccess: async () => {
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
    onError: (e) => {
      setCostDraft(cost);
      toast.err(e);
    },
  });

  function commitCost() {
    if (item && costDraft !== cost && !costMutation.isPending) costMutation.mutate(costDraft);
  }

  const availability = useMutation({
    mutationFn: (available: boolean) => appRpc('set_item_availability', { p_item_id: item!.id, p_available: available }),
    onSuccess: async () => {
      toast.ok(tr('op.toast.saved'));
      await refresh();
    },
    onError: (e) => toast.err(e),
  });

  async function setSoldOut(next: boolean) {
    await appRpc('set_item_sold_out', { p_item_id: item!.id, p_sold_out: next });
    await refresh();
  }

  /* ---------- form save ---------- */

  const save = useMutation({
    mutationFn: async () => {
      const id = await appRpc<string>('upsert_menu_item', {
        p_id: item?.id ?? null,
        p_category_id: item?.category_id ?? categoryId,
        p_name_en: name.en.trim(),
        p_name_ar: name.ar.trim(),
        p_description_en: desc.en.trim() || null,
        p_description_ar: desc.ar.trim() || null,
        // Order is the list arrows' job (reorder_menu_items); this only keeps it.
        p_sort_order: item?.sort_order ?? newSortOrder,
        p_is_active: isActive,
        p_hook_en: hook.en.trim(),
        p_hook_ar: hook.ar.trim(),
        p_highlight: highlight,
      });
      if (!item) {
        if (pendingPhoto.current) {
          await savePhoto('item', id, pendingPhoto.current, null);
          pendingPhoto.current = null;
        }
        if (costDraft !== null) await appRpc('set_item_cost', { p_item_id: id, p_cost_iqd: costDraft });
      } else if (costDraft !== cost) {
        await appRpc('set_item_cost', { p_item_id: id, p_cost_iqd: costDraft });
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

  // Orphaned upload for a never-saved item: drop it on unmount.
  useEffect(
    () => () => {
      if (!item && pendingPhoto.current) void removeMedia(pendingPhoto.current);
    },
    [item],
  );

  const price = item ? defaultPrice(item.menu_item_variants) : null;
  const offToday = item?.unavailable_on === today;
  const backOn = item?.unavailable_on ? formatDate(new Date(`${nextDayIso(item.unavailable_on)}T00:00:00`), locale) : null;
  const busy = save.isPending;

  // The one reason worth printing under Save is the one that sends the manager
  // to a field. "Nothing has changed yet" used to sit under BOTH Discard and
  // Save; the badge already says whether anything has.
  const saveReason = !dirty
    ? undefined
    : namesMissing
      ? tr('ws.manager.disabled.namesRequired')
      : hookErr === 'pair'
        ? tr('op.errors.HOOK_PAIR_MISMATCH')
        : undefined;

  return (
    <div style={{ minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <FormBar
        title={<bdi>{item ? pickName(locale, item) : tr('ws.manager.menu.newItem')}</bdi>}
        meta={
          <>
            {categoryName && <bdi>{categoryName}</bdi>}
            {price !== null && (
              <span>
                · {tr('op.menu.defaultPrice')}: <Money amount={price} />
              </span>
            )}
            {item && <MarginChip price={price} cost={cost} />}
          </>
        }
        dirty={dirty}
        actions={
          <>
            {dirty && (
              <Button kind="ghost" disabled={busy} onClick={discard}>
                {tr('ws.kit.actions.discard')}
              </Button>
            )}
            <Button kind="primary" icon="check" busy={busy} disabled={readOnly || !valid || !dirty} disabledReason={saveReason} onClick={() => save.mutate()}>
              {tr('ws.kit.actions.save')}
            </Button>
          </>
        }
      />
      <ErrorText error={error} style={{ marginBlock: 0 }} />
      {item && inRelease(item) && <ReleaseNotice item={item} />}

      {/* Details */}
      <Panel title={tr('ws.manager.menu.form.details')}>
        <BilingualFieldPair label={tr('ws.manager.menu.form.name')} value={name} onChange={setName} required maxLength={NAME_MAX} disabled={readOnly} />
        <BilingualFieldPair label={tr('ws.manager.menu.form.description')} value={desc} onChange={setDesc} multiline maxLength={DESCRIPTION_MAX} disabled={readOnly} />
        <BilingualFieldPair
          label={tr('ws.manager.menu.form.hook')}
          value={hook}
          onChange={setHook}
          maxLength={HOOK_MAX}
          disabled={readOnly}
          error={hookErr === 'pair' ? tr('op.errors.HOOK_PAIR_MISMATCH') : undefined}
        />
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.menu.form.hookHint', { max: HOOK_MAX })}</p>
      </Panel>

      {/* Photo + highlight */}
      <Panel title={tr('ws.manager.menu.form.presentation')}>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ inlineSize: '11rem' }}>
            <ImageField
              label={tr('op.menu.photo')}
              value={photo}
              onChange={onPhotoChange}
              folder="items"
              ownerId={item?.id ?? draftId.current}
              aspect="1:1"
              disabled={readOnly || photoMutation.isPending}
            />
            <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('op.menu.photoHint')}</p>
          </div>
          <fieldset style={{ border: 'none', padding: 0, margin: 0, minInlineSize: 0 }}>
            <legend style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('op.menu.highlight')}</legend>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
              {HIGHLIGHTS.map((h) => {
                const selected = highlight === h;
                // 'brown' is a stored value; the guest menu paints it green, so
                // the label names the colour the guest sees (see chips.tsx).
                const label = h === 'none' ? tr('op.menu.highlightNone') : h === 'blue' ? tr('op.menu.highlightBlue') : tr('op.menu.highlightBrown');
                return (
                  <label
                    key={h}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--tp-sp-1-5)',
                      paddingBlock: 'var(--tp-sp-1)',
                      paddingInline: 'var(--tp-sp-2-5)',
                      border: `2px solid ${selected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                      borderRadius: 'var(--tp-radius-pill)',
                      cursor: readOnly ? 'not-allowed' : 'pointer',
                      fontSize: 'var(--tp-fs-sm)',
                      background: selected ? 'var(--tp-accent-soft)' : undefined,
                    }}
                  >
                    <input
                      type="radio"
                      name="highlight"
                      value={h}
                      checked={selected}
                      disabled={readOnly}
                      onChange={() => setHighlight(h)}
                      style={{ position: 'absolute', opacity: 0, inlineSize: 0, blockSize: 0 }}
                    />
                    <span
                      aria-hidden="true"
                      style={{
                        inlineSize: '0.9rem',
                        blockSize: '0.9rem',
                        borderRadius: '50%',
                        background: HIGHLIGHT_COLOR[h],
                        border: h === 'none' ? '1px dashed var(--tp-muted-fg)' : 'none',
                      }}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </Panel>

      {/* Cost + active */}
      <Panel title={tr('ws.manager.menu.form.pricing')}>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Field label={tr('op.menu.cost')} hint={tr('op.menu.costHint')} style={{ marginBlockEnd: 0, maxInlineSize: '20rem' }}>
            <span onBlur={commitCost} style={{ display: 'inline-block' }}>
              <MoneyInput value={costDraft} onChange={setCostDraft} allowEmpty disabled={readOnly || costMutation.isPending} style={{ inlineSize: '13rem' }} />
            </span>
          </Field>
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)', maxInlineSize: '20rem', paddingBlockStart: 'var(--tp-sp-5)' }}>
            <Switch checked={isActive} disabled={readOnly || locks.switchOn !== null} onChange={setIsActive} label={tr('op.menu.isActive')} />
            <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {locks.switchOn ? tr(`ws.release.menu.switch.${locks.switchOn}`) : tr('ws.manager.menu.form.activeHint')}
            </p>
            {/* The shared start, with the ↗ every other one wears. */}
            {locks.switchOn === 'putOnSale' && item && (
              <div>
                <PriceChangeButton size="sm" target={{ change: 'shop_launch', item: item.id }} label={tr('ws.release.menu.putOnSale')} />
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* Availability — can a guest order it now, then the two switches that change that */}
      <Panel title={tr('ws.manager.menu.form.availability')}>
        {item ? (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            <NowLine state={orderableState(item, today, stockBlock.blocked)} />

            <div>
              <Switch checked={item.sold_out} disabled={readOnly} onChange={setSoldOut} label={tr('op.menu.soldOutShort')} tone="danger" />
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: 'var(--tp-sp-1)' }}>{tr('ws.manager.menu.form.soldOutHint')}</p>
            </div>

            <div style={{ display: 'flex', gap: 'var(--tp-sp-2-5)', alignItems: 'center', flexWrap: 'wrap' }}>
              {offToday ? (
                <>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: MARK_FG.warn }}>
                    <Icon name="clock" size={15} style={{ color: MARK.warn }} />
                    <bdi>{tr('ws.manager.menu.form.offTodayUntil', { date: backOn ?? '' })}</bdi>
                  </span>
                  <Button size="sm" busy={availability.isPending} disabled={readOnly} onClick={() => availability.mutate(true)}>
                    {tr('ws.manager.menu.form.restore')}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" icon="clock" busy={availability.isPending} disabled={readOnly} onClick={() => availability.mutate(false)}>
                    {tr('ws.manager.menu.form.markOff')}
                  </Button>
                  <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', flex: '1 1 12rem' }}>{tr('ws.manager.menu.form.offTodayHint')}</span>
                </>
              )}
            </div>

            {stockBlock.blocked && (
              <div role="status" aria-label={tr('ws.manager.menu.form.blockedTitle')}>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', marginBlockEnd: 'var(--tp-sp-1-5)' }}>
                  <StatusBadge tone="warn" icon="box" label={tr('ws.manager.menu.form.blockedTitle')} />
                  <StatusBadge tone="neutral" icon="lock" label={tr('ws.kit.common.readOnlyStock')} size="sm" />
                </div>
                <MessagePresenter
                  tone="refused"
                  icon="box"
                  message={
                    <>
                      {tr('ws.manager.menu.form.blockedBody')}{' '}
                      <strong>
                        {stockBlock.ingredients.length > 0
                          ? tr('ws.manager.menu.form.blockedIngredients', {
                              names: stockBlock.ingredients.map((i) => pickName(locale, i)).join(locale === 'ar' ? '، ' : ', '),
                            })
                          : tr('ws.manager.menu.form.blockedUnknown')}
                      </strong>
                    </>
                  }
                />
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.manager.menu.form.saveFirst')}</p>
        )}
      </Panel>

      {item && (
        <>
          <VariantsEditor item={item} pricesLock={locks.prices} />
          <ItemModifierGroups item={item} groups={groups} modifiers={modifiers} />
        </>
      )}
    </div>
  );
}

/**
 * "In release: <run>": the draft a product release made, which its price step
 * prices and the owner's Launch puts on sale. The run title is as its starter
 * typed it, in either language.
 */
function ReleaseNotice({ item }: { item: ItemRow }) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const title = runTitle(locale, item.release_run) ?? tr('work.protocol.kind.product_release');
  const runId = item.release_run_id;
  return (
    <MessagePresenter
      tone="info"
      icon="split"
      message={
        <span style={{ display: 'grid', gap: 'var(--tp-sp-1)', justifyItems: 'start' }}>
          <strong>{tr('ws.release.menu.inRelease', { run: isolate(title) })}</strong>
          <span>{tr('ws.release.menu.inReleaseBody')}</span>
          {runId && (
            <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/protocols', search: { run: runId } })}>
              {tr('ws.release.menu.openRun')}
            </Button>
          )}
        </span>
      }
    />
  );
}

/**
 * The answer the availability panel exists for: can a guest order this right
 * now, and if not, the first reason. The old panel showed a neutral "Off for
 * today · Temporary" badge whether or not the item was off, so it read as off.
 */
function NowLine({ state }: { state: ReturnType<typeof orderableState> }) {
  const { tr } = useLocale();
  const ok = state === 'orderable';
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 600, color: ok ? MARK_FG.success : MARK_FG.warn }}>
      <Icon name={ok ? 'checkCircle' : 'ban'} size={18} style={{ color: ok ? MARK.success : MARK.warn, flex: '0 0 auto' }} />
      {tr(`ws.manager.menu.form.now.${state}`)}
    </p>
  );
}
