/**
 * One menu item: name / description / hook (EN+AR), photo, highlight,
 * sold-out, 86, cost + margin, sort order, active. Form fields save through
 * `upsert_menu_item`; photo / sold-out / cost have dedicated setters that fire
 * immediately for saved items (deferred to the first save for a new one).
 * Unsaved edits block navigation (TanStack `useBlocker`).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { formatDate, formatIQD } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { removeMedia } from '../../../lib/storage';
import { useLocale, pickName } from '../../../lib/i18n';
import { Button, ErrorText, Field, card, inputStyle } from '../../../components/ui';
import { BilingualFields, MoneyInput } from '../../../components/inputs';
import { ImageField } from '../../../components/ImageField';
import { Switch } from '../../../components/Switch';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Chip, HIGHLIGHT_COLOR, MarginChip } from './chips';
import {
  DESCRIPTION_MAX,
  HOOK_MAX,
  NAME_MAX,
  defaultPrice,
  hookError,
  nextDayIso,
} from './menuLogic';
import { savePhoto } from './photo';
import { VariantsEditor } from './VariantsEditor';
import { ItemModifierGroups } from './ItemModifierGroups';
import {
  useAdminMenu,
  type GroupRow,
  type Highlight,
  type ItemRow,
  type ModifierRow,
} from './useAdminMenu';

const HIGHLIGHTS: readonly Highlight[] = ['none', 'blue', 'brown'];

export function ItemForm({
  item,
  categoryId,
  groups,
  modifiers,
  cost,
  onSaved,
  onDirtyChange,
}: {
  item: ItemRow | null;
  categoryId: string;
  groups: GroupRow[];
  modifiers: ModifierRow[];
  /** Known cost from `menu_item_costs`, or null. */
  cost: number | null;
  onSaved: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const { refresh } = useAdminMenu();

  const [nameEn, setNameEn] = useState(item?.name_en ?? '');
  const [nameAr, setNameAr] = useState(item?.name_ar ?? '');
  const [descEn, setDescEn] = useState(item?.description_en ?? '');
  const [descAr, setDescAr] = useState(item?.description_ar ?? '');
  const [hookEn, setHookEn] = useState(item?.hook_en ?? '');
  const [hookAr, setHookAr] = useState(item?.hook_ar ?? '');
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
    nameEn !== (item?.name_en ?? '') ||
    nameAr !== (item?.name_ar ?? '') ||
    descEn !== (item?.description_en ?? '') ||
    descAr !== (item?.description_ar ?? '') ||
    hookEn !== (item?.hook_en ?? '') ||
    hookAr !== (item?.hook_ar ?? '') ||
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

  const hookErr = hookError(hookEn, hookAr);
  const valid = nameEn.trim() !== '' && nameAr.trim() !== '' && hookErr === null;

  /* ---------- immediate setters (saved items only) ---------- */

  const photoMutation = useMutation({
    mutationFn: ({ next, previous }: { next: string | null; previous: string | null }) =>
      savePhoto('item', item!.id, next, previous),
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
      if (pendingPhoto.current && pendingPhoto.current !== next)
        void removeMedia(pendingPhoto.current);
      pendingPhoto.current = next;
    }
  }

  const costMutation = useMutation({
    mutationFn: (next: number | null) =>
      appRpc('set_item_cost', { p_item_id: item!.id, p_cost_iqd: next }),
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
    mutationFn: (available: boolean) =>
      appRpc('set_item_availability', { p_item_id: item!.id, p_available: available }),
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
        p_name_en: nameEn.trim(),
        p_name_ar: nameAr.trim(),
        p_description_en: descEn.trim() || null,
        p_description_ar: descAr.trim() || null,
        p_sort_order: sortOrder,
        p_is_active: isActive,
        p_hook_en: hookEn.trim(),
        p_hook_ar: hookAr.trim(),
        p_highlight: highlight,
      });
      if (!item) {
        if (pendingPhoto.current) {
          await savePhoto('item', id, pendingPhoto.current, null);
          pendingPhoto.current = null;
        }
        if (costDraft !== null)
          await appRpc('set_item_cost', { p_item_id: id, p_cost_iqd: costDraft });
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
  const offUntil = item?.unavailable_on
    ? formatDate(new Date(`${nextDayIso(item.unavailable_on)}T00:00:00`), locale)
    : null;

  return (
    <div style={{ minInlineSize: 0 }}>
      <div style={card}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
            marginBlockEnd: '0.6rem',
          }}
        >
          <h3 style={{ margin: 0 }}>{item ? pickName(locale, item) : tr('op.menu.newItem')}</h3>
          {item && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span dir="ltr" style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>
                {price !== null && `${tr('op.menu.defaultPrice')}: ${formatIQD(price, locale)}`}
              </span>
              <MarginChip price={price} cost={cost} />
            </div>
          )}
        </div>

        <div style={{ minInlineSize: 0 }}>
          <BilingualFields
            labelEn={tr('op.menu.nameEn')}
            labelAr={tr('op.menu.nameAr')}
            en={nameEn}
            ar={nameAr}
            onEn={setNameEn}
            onAr={setNameAr}
            maxLength={NAME_MAX}
          />
          <BilingualFields
            labelEn={tr('op.menu.descriptionEn')}
            labelAr={tr('op.menu.descriptionAr')}
            en={descEn}
            ar={descAr}
            onEn={setDescEn}
            onAr={setDescAr}
            multiline
            maxLength={DESCRIPTION_MAX}
          />
          <BilingualFields
            labelEn={tr('op.menu.hookEn')}
            labelAr={tr('op.menu.hookAr')}
            en={hookEn}
            ar={hookAr}
            onEn={setHookEn}
            onAr={setHookAr}
            maxLength={HOOK_MAX}
            placeholderEn={tr('op.menu.hookPlaceholder')}
            placeholderAr={tr('op.menu.hookPlaceholder')}
          />
          {hookErr === 'pair' && (
            <p
              role="alert"
              style={{ color: 'var(--tp-danger)', fontSize: '0.85rem', marginBlock: '0 0.6rem' }}
            >
              {tr('op.errors.HOOK_PAIR_MISMATCH')}
            </p>
          )}
        </div>

        {/* photo beside highlight / cost / sort / active */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            gap: '1rem',
            alignItems: 'start',
          }}
        >
          <div style={{ inlineSize: '11rem' }}>
            <ImageField
              label={tr('op.menu.photo')}
              value={photo}
              onChange={onPhotoChange}
              folder="items"
              ownerId={item?.id ?? draftId.current}
              aspect="1:1"
              disabled={photoMutation.isPending}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--tp-muted-fg)', margin: 0 }}>
              {tr('op.menu.photoHint')}
            </p>
          </div>
          <div style={{ minInlineSize: 0 }}>
            {/* highlight */}
            <fieldset style={{ border: 'none', padding: 0, margin: 0, marginBlockEnd: '0.6rem' }}>
              <legend
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--tp-muted-fg)',
                  marginBlockEnd: '0.2rem',
                }}
              >
                {tr('op.menu.highlight')}
              </legend>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {HIGHLIGHTS.map((h) => {
                  const selected = highlight === h;
                  const label =
                    h === 'none'
                      ? tr('op.menu.highlightNone')
                      : h === 'blue'
                        ? tr('op.menu.highlightBlue')
                        : tr('op.menu.highlightBrown');
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
                        borderRadius: '999px',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                      }}
                    >
                      <input
                        type="radio"
                        name="highlight"
                        value={h}
                        checked={selected}
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

            {/* cost / sort / active */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label={tr('op.menu.cost')} style={{ marginBlockEnd: 0 }}>
                <span onBlur={commitCost} style={{ display: 'inline-block' }}>
                  <MoneyInput
                    value={costDraft}
                    onChange={setCostDraft}
                    allowEmpty
                    disabled={costMutation.isPending}
                    style={{ inlineSize: '13rem' }}
                  />
                </span>
                <span
                  style={{ display: 'block', fontSize: '0.75rem', color: 'var(--tp-muted-fg)' }}
                >
                  {tr('op.menu.costHint')}
                </span>
              </Field>
              <Field label={tr('op.menu.sortOrder')} style={{ marginBlockEnd: 0 }}>
                <input
                  style={{ ...inputStyle, inlineSize: '5rem' }}
                  dir="ltr"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                />
              </Field>
              <label
                style={{
                  display: 'flex',
                  gap: '0.4rem',
                  alignItems: 'center',
                  paddingBlockEnd: '0.5rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                {tr('op.menu.isActive')}
              </label>
            </div>
          </div>
        </div>

        {/* availability */}
        {item && (
          <div
            style={{
              display: 'flex',
              gap: '1rem',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBlockStart: '0.8rem',
              paddingBlockStart: '0.6rem',
              borderBlockStart: '1px solid var(--tp-border)',
            }}
          >
            <Switch
              checked={item.sold_out}
              onChange={setSoldOut}
              label={tr('op.menu.soldOut')}
              tone="danger"
            />
            {offUntil ? (
              <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                <Chip tone="ok">{tr('op.menu.offToday', { date: offUntil })}</Chip>
                <Button disabled={availability.isPending} onClick={() => availability.mutate(true)}>
                  {tr('op.menu.markAvailable')}
                </Button>
              </span>
            ) : (
              <Button disabled={availability.isPending} onClick={() => availability.mutate(false)}>
                {tr('op.menu.markUnavailable')}
              </Button>
            )}
          </div>
        )}

        <ErrorText error={error} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlockStart: '0.8rem' }}>
          <Button
            kind="primary"
            disabled={save.isPending || !valid || !dirty}
            onClick={() => save.mutate()}
          >
            {tr('common.save')}
          </Button>
        </div>
      </div>

      {item && (
        <>
          <VariantsEditor item={item} />
          <ItemModifierGroups item={item} groups={groups} modifiers={modifiers} />
        </>
      )}
    </div>
  );
}
