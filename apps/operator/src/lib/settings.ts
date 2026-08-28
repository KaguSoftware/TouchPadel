/**
 * `cafe_settings` key/value table (db-slice.md §0029) folded into ONE typed
 * object with the migration's defaults. Reads: `supabase.from('cafe_settings')`
 * (RLS: manager|owner). Writes: `app.set_cafe_setting(p_key, p_value jsonb)`
 * — validated + audited server-side; owner-only keys return FORBIDDEN.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from './supabase';
import { appRpc } from './appRpc';

export type HeroMode = 'none' | 'media' | 'featured';
export type HeroMediaKind = 'image' | 'video';
export type TelegramLang = 'ar' | 'en';

export interface CafeSettings {
  hero_mode: HeroMode;
  hero_media_path: string | null;
  hero_media_kind: HeroMediaKind;
  featured_item_id: string | null;
  featured_label_en: string;
  featured_label_ar: string;
  featured_badge_en: string;
  featured_badge_ar: string;
  featured_discount_pct: number;
  ticker_en: string[];
  ticker_ar: string[];
  bell_tutorial_enabled: boolean;
  telegram_enabled: boolean;
  telegram_chat_id: string | null;
  telegram_lang: TelegramLang;
  telegram_last_callback_at: string | null;
  analytics_business_day_start_hour: number;
  analytics_excluded_item_ids: string[];
  analytics_engagement_floor: string | null;
}
export type CafeSettingKey = keyof CafeSettings;

/** Defaults exactly as seeded by migration 0029 (`app.cafe_setting_specs()`). */
export const CAFE_SETTING_DEFAULTS: Readonly<CafeSettings> = {
  hero_mode: 'none',
  hero_media_path: null,
  hero_media_kind: 'image',
  featured_item_id: null,
  featured_label_en: '',
  featured_label_ar: '',
  featured_badge_en: '',
  featured_badge_ar: '',
  featured_discount_pct: 0,
  ticker_en: [],
  ticker_ar: [],
  bell_tutorial_enabled: true,
  telegram_enabled: false,
  telegram_chat_id: null,
  telegram_lang: 'ar',
  telegram_last_callback_at: null,
  analytics_business_day_start_hour: 4,
  analytics_excluded_item_ids: [],
  analytics_engagement_floor: null,
};

export const CAFE_SETTING_KEYS = Object.keys(CAFE_SETTING_DEFAULTS) as readonly CafeSettingKey[];

/** Keys whose `min_role` is owner — a manager gets FORBIDDEN from the RPC. */
export const OWNER_ONLY_SETTING_KEYS: readonly CafeSettingKey[] = [
  'telegram_enabled',
  'telegram_chat_id',
  'telegram_lang',
  'telegram_last_callback_at',
  'analytics_business_day_start_hour',
  'analytics_excluded_item_ids',
  'analytics_engagement_floor',
];

/** Keys guests can read through `cafe_settings_public` (the rest never leave staff). */
export const PUBLIC_SETTING_KEYS: readonly CafeSettingKey[] = [
  'hero_mode',
  'hero_media_path',
  'hero_media_kind',
  'featured_item_id',
  'featured_label_en',
  'featured_label_ar',
  'featured_badge_en',
  'featured_badge_ar',
  'featured_discount_pct',
  'ticker_en',
  'ticker_ar',
  'bell_tutorial_enabled',
];

const NULLABLE_KEYS: ReadonlySet<CafeSettingKey> = new Set<CafeSettingKey>([
  'hero_media_path',
  'featured_item_id',
  'telegram_chat_id',
  'telegram_last_callback_at',
  'analytics_engagement_floor',
]);

export const CAFE_SETTINGS_QUERY_KEY: QueryKey = ['cafeSettings'];

export interface CafeSettingRow {
  key: string;
  value: unknown;
  updated_at?: string | null;
}

/** Does a stored jsonb value fit the shape of the key's default? (garbage → default) */
function accepts(key: CafeSettingKey, value: unknown): boolean {
  const fallback = CAFE_SETTING_DEFAULTS[key];
  if (value === null) return NULLABLE_KEYS.has(key);
  if (Array.isArray(fallback)) {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
  }
  if (fallback === null) return typeof value === 'string';
  return typeof value === typeof fallback;
}

function freshDefaults(): CafeSettings {
  return {
    ...CAFE_SETTING_DEFAULTS,
    ticker_en: [],
    ticker_ar: [],
    analytics_excluded_item_ids: [],
  };
}

/** Fold `[{key, value}]` rows into a typed object; unknown keys and wrong shapes fall to defaults. */
export function foldCafeSettings(rows: readonly CafeSettingRow[]): CafeSettings {
  const out = freshDefaults();
  const bag = out as unknown as Record<string, unknown>;
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(CAFE_SETTING_DEFAULTS, row.key)) continue;
    const key = row.key as CafeSettingKey;
    if (!accepts(key, row.value)) continue;
    bag[key] = Array.isArray(row.value) ? [...(row.value as string[])] : row.value;
  }
  return out;
}

async function fetchCafeSettings(): Promise<CafeSettings> {
  // `cafe_settings` has been in the generated types since 0029 was regenerated.
  // The `as never` cast that used to sit here outlived its reason and was
  // suppressing real type checking on this read.
  const { data, error } = await supabase.from('cafe_settings').select('key, value, updated_at');
  if (error) throw new Error(error.message);
  return foldCafeSettings((data ?? []) as CafeSettingRow[]);
}

/** All cafe settings as one object (defaults until loaded / for non-manager roles). */
export function useCafeSettings() {
  const query = useQuery({
    queryKey: CAFE_SETTINGS_QUERY_KEY,
    queryFn: fetchCafeSettings,
    staleTime: 30_000,
  });
  return { ...query, settings: query.data ?? CAFE_SETTING_DEFAULTS };
}

export interface SetCafeSettingInput<K extends CafeSettingKey = CafeSettingKey> {
  key: K;
  value: CafeSettings[K];
}

/**
 * `set_cafe_setting(p_key, p_value)` with an optimistic cache patch that rolls
 * back on error (server codes: UNKNOWN_SETTING / FORBIDDEN / INVALID_SETTING_VALUE).
 */
export function useSetCafeSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: SetCafeSettingInput) =>
      appRpc<unknown>('set_cafe_setting', { p_key: key, p_value: value }),
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: CAFE_SETTINGS_QUERY_KEY });
      const previous = queryClient.getQueryData<CafeSettings>(CAFE_SETTINGS_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<CafeSettings>(CAFE_SETTINGS_QUERY_KEY, {
          ...previous,
          [key]: value,
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(CAFE_SETTINGS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CAFE_SETTINGS_QUERY_KEY }),
  });
}
