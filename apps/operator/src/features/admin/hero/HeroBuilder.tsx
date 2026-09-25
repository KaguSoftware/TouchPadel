/**
 * Guest home-screen hero builder (operator-slice.md §3d). Draft of the hero
 * keys of `cafe_settings`; every panel stays mounted so switching modes never
 * loses a draft value. Save writes ONLY the changed keys through
 * `set_cafe_setting`, sequentially, then toasts.
 *
 * The featured discount is the owner's (#57, build-contracts-2026-09-23
 * §5.5): it is charged on the till and the guest menu while the hero is in
 * Featured mode, so for a manager the percentage is read-only with "Change
 * the discount" (a price or promo change on /protocols), the item picker is
 * off while a discount is stored (the discount follows the item), and so is
 * the Featured tile while that stored discount is not yet on sale. Switching
 * the discount off stays a manager's own. Everything else saves as before.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, isolate } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { can, useAuth } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { isVideoPath, removeMedia } from '../../../lib/storage';
import {
  useCafeSettings,
  useSetCafeSettings,
  type CafeSettings,
  type HeroMode,
  type SetCafeSettingInput,
} from '../../../lib/settings';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Switch } from '../../../components/Switch';
import { ImageField } from '../../../components/ImageField';
import { BilingualFields, PercentInput } from '../../../components/inputs';
import { Button, Field, Select, Skeleton } from '../../../components/ui';
import { PageHeader, Panel } from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { heroLocks, lockedHeroDraft } from '../promotions/priceChange';
import { PriceChangeButton, PriceLockNote } from '../promotions/PriceChangeStart';
import { HeroPreview, type HeroPreviewItem } from './HeroPreview';
import { TickerEditor } from './TickerEditor';
import {
  TICKER_MAX_ROWS,
  normalizeTicker,
  pairTicker,
  sameStringArray,
  splitTicker,
  validateTicker,
  type TickerRow,
} from './ticker';

/** Hero videos are uploaded untouched (no transcoding) — hard input ceiling. */
export const HERO_VIDEO_MAX_MB = 8;
const HERO_IMAGE_MAX_PX = 1600;
const HERO_IMAGE_MAX_BYTES = 800_000;
const LABEL_MAX = 200;
const BADGE_MAX = 60;

interface Draft {
  hero_mode: HeroMode;
  hero_media_path: string | null;
  featured_item_id: string | null;
  featured_label_en: string;
  featured_label_ar: string;
  featured_badge_en: string;
  featured_badge_ar: string;
  featured_discount_pct: number;
  ticker: TickerRow[];
  bell_tutorial_enabled: boolean;
}

interface ItemRow {
  id: string;
  name_en: string;
  name_ar: string;
  category_id: string;
  photo_path: string | null;
  menu_item_variants: { price_iqd: number; is_default: boolean; sort_order: number }[];
}
interface CategoryRow {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
}

function fromSettings(s: CafeSettings): Draft {
  return {
    hero_mode: s.hero_mode,
    hero_media_path: s.hero_media_path,
    featured_item_id: s.featured_item_id,
    featured_label_en: s.featured_label_en,
    featured_label_ar: s.featured_label_ar,
    featured_badge_en: s.featured_badge_en,
    featured_badge_ar: s.featured_badge_ar,
    featured_discount_pct: s.featured_discount_pct,
    ticker: pairTicker(s.ticker_en, s.ticker_ar),
    bell_tutorial_enabled: s.bell_tutorial_enabled,
  };
}

/** Ordered list of `set_cafe_setting` writes needed to move `saved` to `draft`. */
export function diffHero(saved: CafeSettings, draft: Draft): SetCafeSettingInput[] {
  const out: SetCafeSettingInput[] = [];
  const rows = normalizeTicker(draft.ticker);
  const { ticker_en, ticker_ar } = splitTicker(rows);
  const mediaKind = isVideoPath(draft.hero_media_path) ? 'video' : 'image';

  // Media path + kind first so the guest never sees a video path flagged as image.
  if (draft.hero_media_path !== saved.hero_media_path) {
    out.push({ key: 'hero_media_path', value: draft.hero_media_path });
  }
  if (mediaKind !== saved.hero_media_kind) out.push({ key: 'hero_media_kind', value: mediaKind });
  if (draft.featured_item_id !== saved.featured_item_id) {
    out.push({ key: 'featured_item_id', value: draft.featured_item_id });
  }
  for (const key of [
    'featured_label_en',
    'featured_label_ar',
    'featured_badge_en',
    'featured_badge_ar',
  ] as const) {
    if (draft[key] !== saved[key]) out.push({ key, value: draft[key] });
  }
  if (draft.featured_discount_pct !== saved.featured_discount_pct) {
    out.push({ key: 'featured_discount_pct', value: draft.featured_discount_pct });
  }
  if (!sameStringArray(ticker_en, saved.ticker_en)) out.push({ key: 'ticker_en', value: ticker_en });
  if (!sameStringArray(ticker_ar, saved.ticker_ar)) out.push({ key: 'ticker_ar', value: ticker_ar });
  if (draft.bell_tutorial_enabled !== saved.bell_tutorial_enabled) {
    out.push({ key: 'bell_tutorial_enabled', value: draft.bell_tutorial_enabled });
  }
  // Mode last: the content it points at is already in place.
  if (draft.hero_mode !== saved.hero_mode) out.push({ key: 'hero_mode', value: draft.hero_mode });
  return out;
}

export function HeroBuilder() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const { staff } = useAuth();
  const { settings, isLoading } = useCafeSettings();
  const setSettings = useSetCafeSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [switchingOff, setSwitchingOff] = useState(false);
  // Read from what is saved: see heroLocks.
  const locks = heroLocks(settings, can(staff?.role, 'editLaunchedPrices'));

  useEffect(() => {
    if (!isLoading && !draft) setDraft(fromSettings(settings));
  }, [isLoading, settings, draft]);

  const menuQ = useQuery({
    queryKey: ['heroMenuItems'],
    queryFn: async () => {
      const [items, cats] = await Promise.all([
        supabase
          .from('menu_items')
          .select(
            'id, name_en, name_ar, category_id, photo_path, menu_item_variants(price_iqd, is_default, sort_order)',
          )
          .eq('is_active', true)
          .order('sort_order'),
        supabase.from('menu_categories').select('id, name_en, name_ar, sort_order').order('sort_order'),
      ]);
      if (items.error) throw items.error;
      if (cats.error) throw cats.error;
      return {
        items: (items.data ?? []) as unknown as ItemRow[],
        categories: (cats.data ?? []) as unknown as CategoryRow[],
      };
    },
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const cats = menuQ.data?.categories ?? [];
    const items = menuQ.data?.items ?? [];
    return cats
      .map((c) => ({ category: c, items: items.filter((i) => i.category_id === c.id) }))
      .filter((g) => g.items.length > 0);
  }, [menuQ.data]);

  // What is shown and saved: a locked value follows what is stored.
  const shown = draft ? lockedHeroDraft(draft, settings, locks) : null;

  const featuredItem: HeroPreviewItem | null = useMemo(() => {
    const row = menuQ.data?.items.find((i) => i.id === shown?.featured_item_id);
    if (!row) return null;
    const variants = [...row.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);
    const price = (variants.find((v) => v.is_default) ?? variants[0])?.price_iqd ?? null;
    return { name_en: row.name_en, name_ar: row.name_ar, photo_path: row.photo_path, price_iqd: price };
  }, [menuQ.data, shown?.featured_item_id]);

  if (!draft || !shown) return <Skeleton lines={6} />;

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const tickerProblem = validateTicker(normalizeTicker(shown.ticker));
  const modeProblem =
    shown.hero_mode === 'media' && !shown.hero_media_path
      ? tr('op.hero.mediaRequired')
      : shown.hero_mode === 'featured' && !shown.featured_item_id
        ? tr('op.hero.itemRequired')
        : null;
  const writes = diffHero(settings, shown);
  const canSave = writes.length > 0 && !modeProblem && !tickerProblem && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const previousMedia = settings.hero_media_path;
    try {
      // One transaction. This was a `for … await` loop with no rollback, so a
      // failure part-way left the guest hero half-configured.
      await setSettings.mutateAsync(writes);
      if (previousMedia && previousMedia !== draft!.hero_media_path) void removeMedia(previousMedia);
      toast.ok(tr('op.toast.saved'));
    } catch (e) {
      toast.err(e);
    } finally {
      setSaving(false);
    }
  }

  /** A manager's one direct discount write: 0 passes set_cafe_setting (#57). */
  async function switchDiscountOff() {
    const ok = await confirm({
      title: tr('ws.pricing.hero.switchOffConfirm.title'),
      body: tr('ws.pricing.hero.switchOffConfirm.body'),
      confirmLabel: tr('ws.pricing.hero.switchOffConfirm.confirm'),
      cancelLabel: tr('ws.pricing.hero.switchOffConfirm.cancel'),
      pairActions: true,
    });
    if (!ok) return;
    setSwitchingOff(true);
    try {
      await setSettings.mutateAsync([{ key: 'featured_discount_pct', value: 0 }]);
      toast.ok(tr('ws.pricing.hero.switchedOff'));
    } catch (e) {
      toast.err(e);
    } finally {
      setSwitchingOff(false);
    }
  }

  const switchOffButton = locks.switchOff && (
    <Button size="sm" busy={switchingOff} disabled={saving} onClick={() => void switchDiscountOff()}>
      {tr('ws.pricing.hero.switchOff')}
    </Button>
  );
  const changeDiscountButton = locks.discount && (
    <PriceChangeButton size="sm" target={{ change: 'featured_discount' }} label={tr('ws.pricing.hero.changeDiscount')} />
  );
  const storedItemName = (() => {
    const row = menuQ.data?.items.find((i) => i.id === settings.featured_item_id);
    return row ? (locale === 'ar' ? row.name_ar : row.name_en) : '';
  })();

  const modes: { id: HeroMode; label: string; hint: string }[] = [
    { id: 'none', label: tr('op.hero.modeNone'), hint: tr('op.hero.modeNoneHint') },
    { id: 'media', label: tr('op.hero.modeMedia'), hint: tr('op.hero.modeMediaHint') },
    { id: 'featured', label: tr('op.hero.modeFeatured'), hint: tr('op.hero.modeFeaturedHint') },
  ];
  const dirty = writes.length > 0;
  const blocked = modeProblem ?? (tickerProblem === 'incomplete' ? tr('op.hero.rowIncomplete') : tickerProblem ? tr('op.hero.tickerTooLong') : null);

  return (
    <div>
      <PageHeader title={tr('op.hero.title')} subtitle={tr('op.hero.lead')} />
      <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 26rem', minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
          <Panel title={tr('op.hero.mode')}>
            <div role="group" aria-label={tr('op.hero.mode')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: 'var(--tp-sp-2)' }}>
              {modes.map((m) => {
                const on = shown.hero_mode === m.id;
                const locked = m.id === 'featured' && locks.featuredMode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="tp-tile"
                    aria-pressed={on}
                    aria-label={m.label}
                    aria-describedby={locked ? 'hero-featured-locked' : undefined}
                    disabled={locked}
                    onClick={() => patch({ hero_mode: m.id })}
                    style={{
                      display: 'grid',
                      gap: 'var(--tp-sp-1)',
                      textAlign: 'start',
                      paddingBlock: 'var(--tp-sp-2-5)',
                      paddingInline: 'var(--tp-sp-3)',
                      borderRadius: 'var(--tp-radius-ctl)',
                      border: on ? '2px solid var(--tp-accent)' : '1px solid var(--tp-border)',
                      background: on ? 'var(--tp-info-soft)' : 'var(--tp-surface)',
                      color: 'var(--tp-fg)',
                      font: 'inherit',
                      cursor: locked ? 'not-allowed' : 'pointer',
                      // DESIGN.md: disabled is opacity .5, the same as every control.
                      opacity: locked ? 0.5 : 1,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontWeight: 700 }}>
                      <Icon name={on ? 'checkCircle' : 'minus'} size={14} style={{ color: on ? 'var(--tp-accent)' : 'var(--tp-muted-fg)' }} />
                      {m.label}
                    </span>
                    <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{m.hint}</span>
                  </button>
                );
              })}
            </div>
            {locks.featuredMode && (
              <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start', marginBlockStart: 'var(--tp-sp-3)' }}>
                {/* The owner's lock, said the way every other price lock is. */}
                <div id="hero-featured-locked" style={{ justifySelf: 'stretch' }}>
                  <PriceLockNote
                    message={
                      <>
                        {storedItemName && (
                          <>
                            {tr('ws.pricing.hero.storedDiscount', { pct: formatNumber(settings.featured_discount_pct, locale), item: isolate(storedItemName) })}{' '}
                          </>
                        )}
                        {tr('ws.pricing.hero.featuredLocked')}
                      </>
                    }
                  />
                </div>
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                  {switchOffButton}
                  {changeDiscountButton}
                </div>
              </div>
            )}
          </Panel>

          {/* Media panel — mounted always, hidden unless active (keeps the draft). */}
          <div style={{ display: shown.hero_mode === 'media' ? 'block' : 'none' }}>
            <Panel title={tr('op.hero.media')}>
              <ImageField
                label={tr('op.hero.media')}
                value={draft.hero_media_path}
                onChange={(path) => patch({ hero_media_path: path })}
                folder="hero"
                accept="image+video"
                aspect="16:9"
                maxPx={HERO_IMAGE_MAX_PX}
                maxBytes={HERO_IMAGE_MAX_BYTES}
                maxVideoMb={HERO_VIDEO_MAX_MB}
              />
              <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.hero.mediaHint', { mb: HERO_VIDEO_MAX_MB })}</p>
            </Panel>
          </div>

          <div style={{ display: shown.hero_mode === 'featured' ? 'block' : 'none' }}>
            <Panel title={tr('op.hero.featuredTitle')}>
              <Field label={tr('op.hero.featuredItem')} hint={tr(locks.item ? 'ws.pricing.hero.itemLocked' : 'op.hero.featuredItemHint')}>
                <Select
                  value={shown.featured_item_id ?? ''}
                  disabled={locks.item}
                  onChange={(id) => patch({ featured_item_id: id || null })}
                  options={[
                    { value: '', label: tr('op.hero.pickItem') },
                    // The <optgroup> per category became a category-prefixed
                    // flat list: SelectMenu draws its own panel and has no
                    // group row, and two categories may hold the same dish.
                    ...grouped.flatMap((g) =>
                      g.items.map((i2) => ({
                        value: i2.id,
                        label: `${locale === 'ar' ? g.category.name_ar : g.category.name_en} · ${locale === 'ar' ? i2.name_ar : i2.name_en}`,
                      })),
                    ),
                  ]}
                />
              </Field>
              {menuQ.isSuccess && grouped.length === 0 && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.hero.noItems')}</p>}
              <BilingualFields
                labelEn={`${tr('op.hero.label')} (EN)`}
                labelAr={`${tr('op.hero.label')} (AR)`}
                en={draft.featured_label_en}
                ar={draft.featured_label_ar}
                onEn={(v) => patch({ featured_label_en: v })}
                onAr={(v) => patch({ featured_label_ar: v })}
                maxLength={LABEL_MAX}
              />
              <Hint>{tr('op.hero.labelHint')}</Hint>
              <BilingualFields
                labelEn={`${tr('op.hero.badge')} (EN)`}
                labelAr={`${tr('op.hero.badge')} (AR)`}
                en={draft.featured_badge_en}
                ar={draft.featured_badge_ar}
                onEn={(v) => patch({ featured_badge_en: v })}
                onAr={(v) => patch({ featured_badge_ar: v })}
                maxLength={BADGE_MAX}
              />
              <Hint>{tr('op.hero.badgeHint')}</Hint>
              {/* The discount is charged, not decorative: app.add_order_items
                  prices the featured item with it while this mode is on (0030). */}
              <Field
                label={tr('op.hero.discount')}
                hint={tr(locks.discount ? 'ws.pricing.hero.discountLocked' : 'op.hero.discountHint')}
                style={{ marginBlockEnd: 0 }}
              >
                <PercentInput value={shown.featured_discount_pct} disabled={locks.discount} onChange={(v) => patch({ featured_discount_pct: v })} />
              </Field>
              {locks.discount && (
                <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-2)' }}>
                  {changeDiscountButton}
                  {switchOffButton}
                </div>
              )}
            </Panel>
          </div>

          <Panel title={tr('op.hero.ticker')}>
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('op.hero.tickerHint', { max: TICKER_MAX_ROWS })}</p>
            <TickerEditor rows={draft.ticker} onChange={(ticker) => patch({ ticker })} />
            {tickerProblem === 'incomplete' && (
              <p role="alert" style={{ color: 'var(--tp-danger-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                {tr('op.hero.rowIncomplete')}
              </p>
            )}
          </Panel>

          <Panel title={tr('op.hero.bellTitle')}>
            <Switch checked={draft.bell_tutorial_enabled} onChange={(next) => patch({ bell_tutorial_enabled: next })} label={tr('op.hero.bellTutorial')} />
            <p style={{ margin: 0, marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.hero.bellTutorialHint')}</p>
          </Panel>

          {/* One Save, kept in reach at the foot of the column however far the
              form has scrolled, and it says whether there is anything to keep. */}
          <div
            style={{
              position: 'sticky',
              insetBlockEnd: 0,
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
              paddingBlock: 'var(--tp-sp-2)',
              paddingInline: 'var(--tp-sp-3)',
              background: 'var(--tp-surface)',
              border: '1px solid var(--tp-border)',
              borderRadius: 'var(--tp-radius-panel)',
              boxShadow: dirty ? 'var(--tp-shadow-raised)' : undefined,
            }}
          >
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: dirty ? 'var(--tp-fg)' : 'var(--tp-muted-fg)', fontWeight: dirty ? 600 : 400, marginInlineEnd: 'auto' }}>
              {dirty ? tr('op.hero.unsaved') : tr('op.hero.upToDate')}
            </span>
            {dirty && (
              <Button kind="ghost" disabled={saving} onClick={() => setDraft(fromSettings(settings))}>
                {tr('op.hero.discard')}
              </Button>
            )}
            <Button kind="primary" icon="check" busy={saving} disabled={!canSave} disabledReason={dirty && blocked ? blocked : undefined} onClick={() => void save()}>
              {tr('common.save')}
            </Button>
          </div>
        </div>

        <aside data-no-print style={{ flex: '0 0 auto', position: 'sticky', insetBlockStart: 'var(--tp-sp-4)', display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('op.hero.preview')}</p>
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', maxInlineSize: '24rem' }}>{tr('op.hero.previewHint')}</p>
          <HeroPreview
            mode={shown.hero_mode}
            mediaPath={shown.hero_media_path}
            mediaIsVideo={isVideoPath(shown.hero_media_path)}
            item={featuredItem}
            labelEn={shown.featured_label_en}
            labelAr={shown.featured_label_ar}
            badgeEn={shown.featured_badge_en}
            badgeAr={shown.featured_badge_ar}
            discountPct={shown.featured_discount_pct}
            ticker={shown.ticker}
            bellTutorial={shown.bell_tutorial_enabled}
          />
        </aside>
      </div>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlock: 'calc(-1 * var(--tp-sp-2)) var(--tp-sp-3)' }}>{children}</p>;
}
