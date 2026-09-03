/**
 * One menu item (spec 06.24): name / description / flavour line (bilingual
 * pairs), photo, highlight, cost + margin, sort order, active; then the three
 * availability states — sold out (a switch, stays until switched back), off
 * for today (temporary, restores next day), blocked by stock (READ-ONLY, the
 * server's decision, names the ingredient). Form fields save through
 * `upsert_menu_item`; photo / sold-out / cost have dedicated setters that fire
 * immediately for saved items (deferred to the first save for a new one).
 * Unsaved edits block navigation (TanStack `useBlocker`).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { formatDate } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { removeMedia } from '../../../lib/storage';
import { useLocale, pickName } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/auth';
import { Button, ErrorText, Field, inputStyle } from '../../../components/ui';
import { BilingualFieldPair, MessagePresenter, Money, Panel, StatusBadge } from '../../../components/kit';
import { MoneyInput } from '../../../components/inputs';
import { ImageField } from '../../../components/ImageField';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { HIGHLIGHT_COLOR, MarginChip } from './chips';
import { DESCRIPTION_MAX, HOOK_MAX, NAME_MAX, defaultPrice, hookError, nextDayIso } from './menuLogic';
import { savePhoto } from './photo';
import { VariantsEditor } from './VariantsEditor';
import { ItemModifierGroups } from './ItemModifierGroups';
import type { StockBlock } from './availability';
import { useAdminMenu, type GroupRow, type Highlight, type ItemRow, type ModifierRow } from './useAdminMenu';

const HIGHLIGHTS: readonly Highlight[] = ['none', 'blue', 'brown'];
const NO_BLOCK: StockBlock = { blocked: false, ingredients: [] };

export function ItemForm({
  item,
  categoryId,
  groups,
  modifiers,
  cost,
  stockBlock = NO_BLOCK,
  onSaved,
  onDirtyChange,
}: {
  item: ItemRow | null;
  categoryId: string;
  groups: GroupRow[];
  modifiers: ModifierRow[];
  /** Known cost from `menu_item_costs`, or null. */
  cost: number | null;
  /** The server's stock decision for this item (read-only state). */
  stockBlock?: StockBlock;
  onSaved: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const can = usePermissions();
  const { refresh } = useAdminMenu();
  const readOnly = !can.editMenu;

  const [name, setName] = useState({ en: item?.name_en ?? '', ar: item?.name_ar ?? '' });
  const [desc, setDesc] = useState({ en: item?.description_en ?? '', ar: item?.description_ar ?? '' });
  const [hook, setHook] = useState({ en: item?.hook_en ?? '', ar: item?.hook_ar ?? '' });
  const [highlight, setHighlight] = useState<Highlight>(item?.highlight ?? 'none');
  const [sortOrder, setSortOrder] = useState(item?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(item?.is_active ?? true);
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
    sortOrder !== (item?.sort_order ?? 0) ||
    isActive !== (item?.is_active ?? true) ||
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
  const valid = name.en.trim() !== '' && name.ar.trim() !== '' && hookErr === null;

  function discard() {
    setName({ en: item?.name_en ?? '', ar: item?.name_ar ?? '' });
    setDesc({ en: item?.description_en ?? '', ar: item?.description_ar ?? '' });
    setHook({ en: item?.hook_en ?? '', ar: item?.hook_ar ?? '' });
    setHighlight(item?.highlight ?? 'none');
    setSortOrder(item?.sort_order ?? 0);
    setIsActive(item?.is_active ?? true);
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
        p_sort_order: sortOrder,
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
  const offUntil = item?.unavailable_on ? formatDate(new Date(`${nextDayIso(item.unavailable_on)}T00:00:00`), locale) : null;
  const busy = save.isPending;

  return (
    <div style={{ minInlineSize: 0, display: 'grid', gap: '0.75rem' }}>
      {/* Title + save bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ minInlineSize: 0 }}>
          <h2 style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>
            <bdi>{item ? pickName(locale, item) : tr('ws.manager.menu.newItem')}</bdi>
          </h2>
          {item && (
            <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              {price !== null && (
                <span>
                  {tr('op.menu.defaultPrice')}: <Money amount={price} />
                </span>
              )}
              <MarginChip price={price} cost={cost} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {dirty && <StatusBadge tone="warn" label={tr('ws.kit.actions.unsaved')} />}
          <Button kind="ghost" size="sm" disabled={!dirty || busy} onClick={discard}>
            {tr('ws.kit.actions.discard')}
          </Button>
          <Button kind="primary" icon="check" busy={busy} disabled={readOnly || !valid || !dirty} onClick={() => save.mutate()}>
            {tr('ws.kit.actions.save')}
          </Button>
        </div>
      </div>
      <ErrorText error={error} style={{ marginBlock: 0 }} />

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

      {/* Photo + highlight + cost / sort / active */}
      <Panel title={tr('ws.manager.menu.form.presentation')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
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
          <div style={{ minInlineSize: 0 }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0, marginBlockEnd: '0.85rem' }}>
              <legend style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: '0.3rem' }}>{tr('op.menu.highlight')}</legend>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {HIGHLIGHTS.map((h) => {
                  const selected = highlight === h;
                  const label = h === 'none' ? tr('op.menu.highlightNone') : h === 'blue' ? tr('op.menu.highlightBlue') : tr('op.menu.highlightBrown');
                  return (
                    <label
                      key={h}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        paddingBlock: '0.3rem',
                        paddingInline: '0.6rem',
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

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label={tr('op.menu.cost')} hint={tr('op.menu.costHint')} style={{ marginBlockEnd: 0 }}>
                <span onBlur={commitCost} style={{ display: 'inline-block' }}>
                  <MoneyInput value={costDraft} onChange={setCostDraft} allowEmpty disabled={readOnly || costMutation.isPending} style={{ inlineSize: '13rem' }} />
                </span>
              </Field>
              <Field label={tr('op.menu.sortOrder')} style={{ marginBlockEnd: 0 }}>
                <input
                  style={{ ...inputStyle, inlineSize: '5rem' }}
                  dir="ltr"
                  type="number"
                  value={sortOrder}
                  disabled={readOnly}
                  onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                />
              </Field>
              <div style={{ paddingBlockEnd: '0.35rem' }}>
                <Switch checked={isActive} disabled={readOnly} onChange={setIsActive} label={tr('op.menu.isActive')} />
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* Availability — three distinct states */}
      <Panel title={tr('ws.manager.menu.form.availability')}>
        {item ? (
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            <div>
              <Switch checked={item.sold_out} disabled={readOnly} onChange={setSoldOut} label={tr('op.menu.soldOut')} tone="danger" />
              <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockStart: '0.3rem' }}>{tr('ws.manager.menu.form.soldOutHint')}</p>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge tone={offUntil ? 'warn' : 'neutral'} icon="clock" label={`${tr('ws.manager.menu.form.offTodayTitle')} · ${tr('ws.kit.common.temporary')}`} />
              {offUntil ? (
                <>
                  <span style={{ fontSize: 'var(--tp-fs-sm)' }}>
                    <bdi>{tr('ws.manager.menu.form.offTodayUntil', { date: offUntil })}</bdi>
                  </span>
                  <Button size="sm" busy={availability.isPending} disabled={readOnly} onClick={() => availability.mutate(true)}>
                    {tr('ws.manager.menu.form.restore')}
                  </Button>
                </>
              ) : (
                <Button size="sm" busy={availability.isPending} disabled={readOnly} onClick={() => availability.mutate(false)}>
                  {tr('ws.manager.menu.form.markOff')}
                </Button>
              )}
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', flexBasis: '100%' }}>{tr('ws.manager.menu.form.offTodayHint')}</span>
            </div>

            {stockBlock.blocked && (
              <div role="status" aria-label={tr('ws.manager.menu.form.blockedTitle')}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBlockEnd: '0.4rem' }}>
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
          <VariantsEditor item={item} />
          <ItemModifierGroups item={item} groups={groups} modifiers={modifiers} />
        </>
      )}
    </div>
  );
}
