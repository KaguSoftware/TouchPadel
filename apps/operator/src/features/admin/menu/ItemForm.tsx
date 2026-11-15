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
import { Button, ErrorText } from '../../../components/ui';
import { MessagePresenter, Money } from '../../../components/kit';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { SectionDialog, type DialogSection } from '../../../components/SectionDialog';
import { AvailabilitySection, CostSection, DetailsSection, PhotoSection } from './ItemSections';
import {
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
import { isRenameRefusal } from '../addons/addonsLogic';
import { ItemModifierGroups } from './ItemModifierGroups';
import { todayIso, type StockBlock } from './availability';
import { useAdminMenu, type GroupRow, type Highlight, type ItemRow, type ModifierRow } from './useAdminMenu';

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
  onClose,
  canClose,
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
  onClose: () => void;
  canClose?: () => boolean | Promise<boolean>;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const can = usePermissions();
  const { staff } = useAuth();
  const { refresh } = useAdminMenu();
  const readOnly = !can.editMenu;
  const locks = itemLocks(item, categoryKind, {
    editLaunchedPrices: hasCapability(staff, 'editLaunchedPrices'),
    launchDirectly: hasCapability(staff, 'launchDirectly'),
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
  // Sizes: edited prices and a newly chosen default wait for the form's Save.
  const [sizePrices, setSizePrices] = useState<Record<string, number>>({});
  const [sizeDefault, setSizeDefault] = useState<string | null>(null);
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
  const variants = item?.menu_item_variants ?? [];
  const savedDefaultId = variants.find((v) => v.is_default)?.id ?? null;
  const defaultId = sizeDefault ?? savedDefaultId;
  const pricesLocked = locks.prices !== null;
  // What the sizes need written: a price that changed, and the size that becomes the default.
  const sizeChanges = variants.filter(
    (v) => (!pricesLocked && sizePrices[v.id] !== undefined && sizePrices[v.id] !== v.price_iqd) || (sizeDefault === v.id && sizeDefault !== savedDefaultId),
  );
  const dirty = formDirty || (item !== null && costDraft !== cost) || sizeChanges.length > 0;

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
    setSizePrices({});
    setSizeDefault(null);
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
      // Sizes last, the new default after the rest: the server clears the old default itself.
      for (const v of [...sizeChanges].sort((a, b) => Number(sizeDefault === a.id) - Number(sizeDefault === b.id))) {
        await appRpc('upsert_variant', {
          p_id: v.id,
          p_item_id: v.item_id,
          p_name_en: v.name_en,
          p_name_ar: v.name_ar,
          p_price_iqd: pricesLocked ? v.price_iqd : (sizePrices[v.id] ?? v.price_iqd),
          p_is_default: sizeDefault === v.id ? true : v.is_default,
          p_sort_order: v.sort_order,
        });
      }
      return id;
    },
    onSuccess: async (id) => {
      setError(null);
      setSizePrices({});
      setSizeDefault(null);
      toast.ok(tr('op.toast.saved'));
      await refresh();
      onSaved(id);
    },
    onError: (e) => {
      setError(e);
      toast.err(isRenameRefusal(e) ? tr('ws.pricing.renameViaProtocol') : e);
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

  const sections: DialogSection[] = [
    {
      key: 'details',
      label: tr('ws.manager.menu.form.details'),
      icon: 'note',
      flagged: namesMissing || hookErr === 'pair',
      content: (
        <DetailsSection
          name={name}
          desc={desc}
          hook={hook}
          onName={setName}
          onDesc={setDesc}
          onHook={setHook}
          hookError={hookErr === 'pair' ? tr('op.errors.HOOK_PAIR_MISMATCH') : undefined}
          readOnly={readOnly}
        />
      ),
    },
    {
      key: 'presentation',
      label: tr('ws.manager.menu.form.presentation'),
      icon: 'image',
      center: true,
      content: (
        <PhotoSection
          photo={photo}
          onPhoto={onPhotoChange}
          photoBusy={photoMutation.isPending}
          ownerId={item?.id ?? draftId.current}
          highlight={highlight}
          onHighlight={setHighlight}
          itemName={name.en.trim() || name.ar.trim() || tr('ws.manager.menu.newItem')}
          price={price}
          readOnly={readOnly}
        />
      ),
    },
    {
      key: 'pricing',
      label: tr('ws.manager.menu.form.pricing'),
      icon: 'tag',
      content: (
        <CostSection
          price={price}
          cost={costDraft}
          onCost={setCostDraft}
          onCostBlur={commitCost}
          costBusy={costMutation.isPending}
          isActive={isActive}
          onActive={setIsActive}
          activeDisabled={locks.switchOn !== null}
          activeHint={locks.switchOn ? tr(`ws.release.menu.switch.${locks.switchOn}`) : tr('ws.manager.menu.form.activeHint')}
          // The shared start, with the ↗ every other one wears.
          activeAction={
            locks.switchOn === 'putOnSale' && item ? (
              <PriceChangeButton size="sm" target={{ change: 'shop_launch', item: item.id }} label={tr('ws.release.menu.putOnSale')} />
            ) : undefined
          }
          readOnly={readOnly}
          showFigures={item !== null}
        />
      ),
    },
    {
      key: 'availability',
      label: tr('ws.manager.menu.form.availability'),
      icon: 'clock',
      content: (
        <AvailabilitySection
          saved={item !== null}
          state={item ? orderableState(item, today, stockBlock.blocked) : 'orderable'}
          soldOut={item?.sold_out ?? false}
          onSoldOut={setSoldOut}
          offToday={!!offToday}
          backOn={backOn}
          onOffToday={(available) => availability.mutate(available)}
          offBusy={availability.isPending}
          stockBlock={stockBlock}
          readOnly={readOnly}
          ingredientNames={stockBlock.ingredients.map((i) => pickName(locale, i))}
        />
      ),
    },
    ...(item
      ? ([
          { key: 'sizes', label: tr('ws.manager.menu.form.sizes.title'), icon: 'layers', tip: tr('ws.manager.menu.form.sizes.defaultHint'), content: (
            <VariantsEditor
              item={item}
              pricesLock={locks.prices}
              prices={sizePrices}
              onPrice={(id, n) => setSizePrices((p) => ({ ...p, [id]: n }))}
              defaultId={defaultId}
              onDefault={(id) => setSizeDefault(id === savedDefaultId ? null : id)}
            />
          ) },
          { key: 'groups', label: tr('ws.manager.menu.form.groups.title'), icon: 'sliders', tip: tr('ws.manager.menu.form.groups.lead'), content: <ItemModifierGroups item={item} groups={groups} modifiers={modifiers} /> },
        ] satisfies DialogSection[])
      : []),
  ];

  return (
    <SectionDialog
      title={item ? pickName(locale, item) : tr('ws.manager.menu.newItem')}
      meta={categoryName ? <bdi>{categoryName}</bdi> : undefined}
      sideNote={
        price !== null ? (
          <>
            {tr('op.menu.defaultPrice')}:{' '}
            <strong style={{ color: 'var(--tp-success-fg)', fontWeight: 800 }}>
              <Money amount={price} />
            </strong>
          </>
        ) : undefined
      }
      sections={sections}
      notice={
        <>
          <ErrorText error={error} style={{ marginBlock: 0 }} />
          {item && inRelease(item) && <ReleaseNotice item={item} />}
        </>
      }
      dirty={dirty}
      busy={busy}
      onClose={onClose}
      canClose={canClose}
      actions={
        <>
          {dirty && (
            <Button
              size="lg"
              disabled={busy}
              onClick={discard}
              // Solid red: a destructive choice, set apart from Save.
              style={{ background: 'var(--tp-danger)', color: 'var(--tp-danger-contrast)', borderColor: 'transparent' }}
            >
              {tr('ws.kit.actions.discard')}
            </Button>
          )}
          <Button size="lg" kind="primary" icon="check" busy={busy} disabled={readOnly || !valid || !dirty} disabledReason={saveReason} onClick={() => save.mutate()}>
            {tr('ws.kit.actions.save')}
          </Button>
        </>
      }
    />
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
