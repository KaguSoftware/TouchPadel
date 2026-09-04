/**
 * Guest home-screen hero builder (operator-slice.md §3d). Draft of the hero
 * keys of `cafe_settings`; every panel stays mounted so switching modes never
 * loses a draft value. Save writes ONLY the changed keys through
 * `set_cafe_setting`, sequentially, then toasts.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
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
import { Switch } from '../../../components/Switch';
import { ImageField } from '../../../components/ImageField';
import { BilingualFields, PercentInput } from '../../../components/inputs';
import { Button, Field, Skeleton, card, inputStyle } from '../../../components/ui';
import { HeroPreview, type HeroPreviewItem } from './HeroPreview';
import { TickerEditor } from './TickerEditor';
import {
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
  const { settings, isLoading } = useCafeSettings();
  const setSettings = useSetCafeSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

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

  const featuredItem: HeroPreviewItem | null = useMemo(() => {
    const row = menuQ.data?.items.find((i) => i.id === draft?.featured_item_id);
    if (!row) return null;
    const variants = [...row.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);
    const price = (variants.find((v) => v.is_default) ?? variants[0])?.price_iqd ?? null;
    return { name_en: row.name_en, name_ar: row.name_ar, photo_path: row.photo_path, price_iqd: price };
  }, [menuQ.data, draft?.featured_item_id]);

  if (!draft) return <Skeleton lines={6} />;

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const tickerProblem = validateTicker(normalizeTicker(draft.ticker));
  const modeProblem =
    draft.hero_mode === 'media' && !draft.hero_media_path
      ? tr('op.hero.mediaRequired')
      : draft.hero_mode === 'featured' && !draft.featured_item_id
        ? tr('op.hero.itemRequired')
        : null;
  const writes = diffHero(settings, draft);
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

  const modes: { id: HeroMode; label: string; hint: string }[] = [
    { id: 'none', label: tr('op.hero.modeNone'), hint: tr('op.hero.modeNoneHint') },
    { id: 'media', label: tr('op.hero.modeMedia'), hint: tr('op.hero.modeMediaHint') },
    { id: 'featured', label: tr('op.hero.modeFeatured'), hint: tr('op.hero.modeFeaturedHint') },
  ];

  return (
    <div style={{ display: 'flex', gap: 'var(--tp-sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 26rem', minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
        <h2 style={{ margin: 0 }}>{tr('op.hero.title')}</h2>

        <section style={card}>
          <Field label={tr('op.hero.mode')}>
            <div role="radiogroup" style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
              {modes.map((m) => (
                <Button
                  key={m.id}
                  kind={draft.hero_mode === m.id ? 'primary' : 'default'}
                  onClick={() => patch({ hero_mode: m.id })}
                  title={m.hint}
                  aria-label={m.label}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </Field>
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {modes.find((m) => m.id === draft.hero_mode)?.hint}
          </p>
        </section>

        {/* Media panel — mounted always, hidden unless active (keeps the draft). */}
        <section style={{ ...card, display: draft.hero_mode === 'media' ? 'block' : 'none' }}>
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
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('op.hero.mediaHint', { mb: HERO_VIDEO_MAX_MB })}
          </p>
        </section>

        <section style={{ ...card, display: draft.hero_mode === 'featured' ? 'block' : 'none' }}>
          <Field label={tr('op.hero.featuredItem')}>
            <select
              style={inputStyle}
              value={draft.featured_item_id ?? ''}
              onChange={(e) => patch({ featured_item_id: e.target.value || null })}
            >
              <option value="">{tr('op.hero.pickItem')}</option>
              {grouped.map((g) => (
                <optgroup
                  key={g.category.id}
                  label={locale === 'ar' ? g.category.name_ar : g.category.name_en}
                >
                  {g.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {locale === 'ar' ? i.name_ar : i.name_en}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {menuQ.isSuccess && grouped.length === 0 && (
            <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('op.hero.noItems')}</p>
          )}
          <BilingualFields
            labelEn={`${tr('op.hero.label')} (EN)`}
            labelAr={`${tr('op.hero.label')} (AR)`}
            en={draft.featured_label_en}
            ar={draft.featured_label_ar}
            onEn={(v) => patch({ featured_label_en: v })}
            onAr={(v) => patch({ featured_label_ar: v })}
            maxLength={LABEL_MAX}
          />
          <BilingualFields
            labelEn={`${tr('op.hero.badge')} (EN)`}
            labelAr={`${tr('op.hero.badge')} (AR)`}
            en={draft.featured_badge_en}
            ar={draft.featured_badge_ar}
            onEn={(v) => patch({ featured_badge_en: v })}
            onAr={(v) => patch({ featured_badge_ar: v })}
            maxLength={BADGE_MAX}
          />
          <Field label={tr('op.hero.discount')}>
            <PercentInput
              value={draft.featured_discount_pct}
              onChange={(v) => patch({ featured_discount_pct: v })}
            />
          </Field>
        </section>

        <section style={card}>
          <Field label={tr('op.hero.ticker')}>
            <span style={{ display: 'block', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-1-5)' }}>
              {tr('op.hero.tickerHint')}
            </span>
          </Field>
          <TickerEditor rows={draft.ticker} onChange={(ticker) => patch({ ticker })} />
          {tickerProblem === 'incomplete' && (
            <p role="alert" style={{ color: 'var(--tp-danger)', fontSize: 'var(--tp-fs-sm)' }}>
              {tr('op.hero.rowIncomplete')}
            </p>
          )}
        </section>

        <section style={card}>
          <Switch
            checked={draft.bell_tutorial_enabled}
            onChange={(next) => patch({ bell_tutorial_enabled: next })}
            label={tr('op.hero.bellTutorial')}
          />
          <p style={{ margin: 0, marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {tr('op.hero.bellTutorialHint')}
          </p>
        </section>

        <div style={{ display: 'flex', gap: 'var(--tp-sp-2-5)', alignItems: 'center' }}>
          <Button kind="primary" disabled={!canSave} onClick={() => void save()}>
            {tr('common.save')}
          </Button>
          {modeProblem && <span style={{ color: 'var(--tp-danger)', fontSize: 'var(--tp-fs-sm)' }}>{modeProblem}</span>}
        </div>
      </div>

      <aside data-no-print style={{ flex: '0 0 auto', position: 'sticky', insetBlockStart: 'var(--tp-sp-4)' }}>
        <p style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('op.hero.preview')}
        </p>
        <HeroPreview
          mode={draft.hero_mode}
          mediaPath={draft.hero_media_path}
          mediaIsVideo={isVideoPath(draft.hero_media_path)}
          item={featuredItem}
          labelEn={draft.featured_label_en}
          labelAr={draft.featured_label_ar}
          badgeEn={draft.featured_badge_en}
          badgeAr={draft.featured_badge_ar}
          discountPct={draft.featured_discount_pct}
          ticker={draft.ticker}
          bellTutorial={draft.bell_tutorial_enabled}
        />
      </aside>
    </div>
  );
}
