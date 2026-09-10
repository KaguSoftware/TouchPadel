/**
 * Cafe tab of VenueSettingsScreen (operator-slice.md §3g): business-day start
 * hour (owner), waiter-call cooldown (`set_waiter_call_cooldown`), analytics
 * excluded items (owner), covers multiplier (per station, localStorage),
 * engagement floor. Every write goes through the RPCs it always did.
 *
 * Laid out as three grouped lists rather than five equal cards (rulebook 2.5):
 * the settings are grouped by the thing they change — the trading day, the
 * floor, the analytics screens — and every explanatory line now hangs off its
 * control through Field's hint slot instead of floating beneath the card.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useAuth, can } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import {
  COVERS_MULTIPLIER_OPTIONS,
  readCoversMultiplier,
  writeCoversMultiplier,
} from '../../../lib/coversMultiplier';
import { useCafeSettings, useSetCafeSetting } from '../../../lib/settings';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Field, Select, Skeleton, inputStyle } from '../../../components/ui';
import { ResultCount, StatusBadge } from '../../../components/kit';
import { SettingsGroup, SettingsRow, settingField } from './SettingsList';

const BUSINESS_DAY_HOURS = [0, 4, 5, 6, 7, 8] as const;
const COOLDOWN_MIN = 30;
const COOLDOWN_MAX = 600;

interface MenuItemLite {
  id: string;
  name_en: string;
  name_ar: string;
}

export function CafeSettingsTab() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { staff } = useAuth();
  // Capability matrix, not an inline role comparison — see lib/auth.tsx.
  const canSetBusinessDay = can(staff?.role, 'setBusinessDayStart');
  const canSetExclusions = can(staff?.role, 'setAnalyticsExclusions');
  const canSetFloor = can(staff?.role, 'setEngagementFloor');
  const { settings, isLoading } = useCafeSettings();
  const setSetting = useSetCafeSetting();

  // --- waiter-call cooldown (venue_settings) ---
  const venueQ = useQuery({
    queryKey: ['venueSettingsCooldown'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_settings')
        .select('waiter_call_cooldown_seconds')
        .single();
      if (error) throw error;
      return data.waiter_call_cooldown_seconds;
    },
  });
  const [cooldown, setCooldown] = useState<string | null>(null);
  useEffect(() => {
    if (venueQ.data !== undefined && cooldown === null) setCooldown(String(venueQ.data));
  }, [venueQ.data, cooldown]);
  const cooldownNum = Number(cooldown);
  const cooldownValid =
    cooldown !== null && /^\d+$/.test(cooldown) && cooldownNum >= COOLDOWN_MIN && cooldownNum <= COOLDOWN_MAX;
  const saveCooldown = useMutation({
    mutationFn: () => appRpc('set_waiter_call_cooldown', { p_seconds: cooldownNum }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void queryClient.invalidateQueries({ queryKey: ['venueSettingsCooldown'] });
    },
    onError: (e) => toast.err(e),
  });

  // --- excluded items (owner) ---
  const itemsQ = useQuery({
    queryKey: ['settingsMenuItems'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('id, name_en, name_ar')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as MenuItemLite[];
    },
    enabled: canSetFloor,
    staleTime: 60_000,
  });
  const [search, setSearch] = useState('');
  const [excluded, setExcluded] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!isLoading && excluded === null) setExcluded(new Set(settings.analytics_excluded_item_ids));
  }, [isLoading, settings.analytics_excluded_item_ids, excluded]);
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = itemsQ.data ?? [];
    if (!q) return all;
    return all.filter((i) => i.name_en.toLowerCase().includes(q) || i.name_ar.includes(q));
  }, [itemsQ.data, search]);
  const excludedDirty =
    excluded !== null &&
    (excluded.size !== settings.analytics_excluded_item_ids.length ||
      settings.analytics_excluded_item_ids.some((id) => !excluded.has(id)));

  // --- covers multiplier (station-local) ---
  // Shared with the analytics control deck via lib/coversMultiplier — the two
  // used to keep separate option lists and separate defaults for the SAME key.
  const [coversMult, setCoversMult] = useState(readCoversMultiplier);
  function changeCoversMult(next: string) {
    const n = Number(next);
    setCoversMult(n);
    writeCoversMultiplier(n);
  }

  // --- engagement floor (owner) ---
  const [floor, setFloor] = useState<string | null>(null);
  useEffect(() => {
    if (!isLoading && floor === null) setFloor(settings.analytics_engagement_floor ?? '');
  }, [isLoading, settings.analytics_engagement_floor, floor]);

  async function write<K extends Parameters<typeof setSetting.mutateAsync>[0]['key']>(
    key: K,
    value: Parameters<typeof setSetting.mutateAsync>[0]['value'],
  ) {
    try {
      await setSetting.mutateAsync({ key, value } as Parameters<typeof setSetting.mutateAsync>[0]);
      toast.ok(tr('op.toast.saved'));
    } catch (e) {
      toast.err(e);
    }
  }

  if (isLoading) return <Skeleton lines={6} />;

  const floorSaved = settings.analytics_engagement_floor ?? '';

  return (
    <div style={{ maxInlineSize: 'var(--tp-measure-form)', display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.settings.cafe.lead')}</p>

      {canSetBusinessDay && (
        <SettingsGroup title={tr('ws.manager.settings.groups.tradingDay')}>
          <SettingsRow>
            <Field label={tr('op.settings.businessDay')} hint={tr('op.settings.businessDayHint')} style={settingField}>
              <Select
                value={String(settings.analytics_business_day_start_hour)}
                style={{ maxInlineSize: '14rem' }}
                options={BUSINESS_DAY_HOURS.map((h) => ({
                  value: String(h),
                  label: h === 0 ? tr('op.settings.calendarDay') : tr('op.settings.hour', { hour: String(h).padStart(2, '0') }),
                }))}
                onChange={(v) => void write('analytics_business_day_start_hour', Number(v))}
              />
            </Field>
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup title={tr('ws.manager.settings.groups.service')}>
        <SettingsRow
          end={
            <Button
              kind="primary"
              disabled={!cooldownValid || cooldownNum === venueQ.data || saveCooldown.isPending}
              disabledReason={
                !cooldownValid ? tr('ws.manager.settings.cooldownInvalid') : tr('ws.manager.settings.noChanges')
              }
              busy={saveCooldown.isPending}
              onClick={() => saveCooldown.mutate()}
            >
              {tr('common.save')}
            </Button>
          }
        >
          <Field
            label={tr('op.settings.cooldown')}
            // The range used to sit in a paragraph under the card that turned red
            // on failure — meaning by colour alone, and never announced. It is the
            // control's own hint now, and its own error when the value is refused.
            hint={`${tr('op.settings.cooldownHint')} ${tr('op.settings.cooldownRange')}`}
            error={cooldown !== null && !cooldownValid ? tr('ws.manager.settings.cooldownInvalid') : undefined}
            style={settingField}
          >
            <input
              // Three digits of expected input, three digits of field (7.5).
              style={{ ...inputStyle, inlineSize: '7rem', fontVariantNumeric: 'tabular-nums' }}
              dir="ltr"
              type="number"
              inputMode="numeric"
              min={COOLDOWN_MIN}
              max={COOLDOWN_MAX}
              value={cooldown ?? ''}
              disabled={venueQ.isLoading}
              onChange={(e) => setCooldown(e.target.value)}
            />
          </Field>
          <ErrorText error={venueQ.error} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={tr('ws.manager.settings.groups.analytics')} description={tr('ws.manager.settings.analyticsLead')}>
        {canSetExclusions && excluded ? (
          <SettingsRow
            end={
              <Button
                kind="primary"
                disabled={!excludedDirty || setSetting.isPending}
                disabledReason={!excludedDirty ? tr('ws.manager.settings.noChanges') : undefined}
                busy={setSetting.isPending}
                onClick={() => void write('analytics_excluded_item_ids', [...excluded])}
              >
                {tr('common.save')}
              </Button>
            }
          >
            <Field label={tr('op.settings.excludedItems')} hint={tr('op.settings.excludedHint')} style={settingField}>
              <input
                style={inputStyle}
                type="search"
                placeholder={tr('op.common.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Field>
            <div
              style={{
                maxBlockSize: '14rem',
                overflowY: 'auto',
                border: '1px solid var(--tp-border)',
                borderRadius: 'var(--tp-radius-ctl)',
                background: 'var(--tp-bg)',
                paddingBlock: 'var(--tp-sp-1)',
                paddingInline: 'var(--tp-sp-2)',
              }}
            >
              {itemsQ.isLoading && <Skeleton lines={3} />}
              {filteredItems.map((i) => (
                <label
                  key={i.id}
                  style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', minBlockSize: 'var(--tp-row-h-dense)' }}
                >
                  <input
                    type="checkbox"
                    checked={excluded.has(i.id)}
                    onChange={(e) => {
                      const next = new Set(excluded);
                      if (e.target.checked) next.add(i.id);
                      else next.delete(i.id);
                      setExcluded(next);
                    }}
                  />
                  <span>{locale === 'ar' ? i.name_ar : i.name_en}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <ResultCount shown={filteredItems.length} total={itemsQ.data?.length ?? 0} />
              <StatusBadge
                size="sm"
                tone={excluded.size > 0 ? 'warn' : 'neutral'}
                label={tr('op.settings.excludedCount', { count: excluded.size })}
              />
            </div>
          </SettingsRow>
        ) : null}

        <SettingsRow end={<StatusBadge size="sm" tone="neutral" label={tr('ws.manager.settings.stationOnly')} />}>
          <Field label={tr('op.settings.coversMult')} hint={tr('op.settings.coversMultHint')} style={settingField}>
            <Select
              value={String(coversMult)}
              style={{ maxInlineSize: '10rem' }}
              options={COVERS_MULTIPLIER_OPTIONS.map((v) => ({ value: String(v), label: `×${v}` }))}
              onChange={changeCoversMult}
            />
          </Field>
        </SettingsRow>

        <SettingsRow
          end={
            canSetFloor ? (
              <>
                <Button
                  kind="primary"
                  disabled={!floor || floor === floorSaved || setSetting.isPending}
                  disabledReason={!floor ? tr('ws.manager.settings.floorPickDate') : tr('ws.manager.settings.noChanges')}
                  busy={setSetting.isPending}
                  onClick={() => void write('analytics_engagement_floor', floor)}
                >
                  {tr('common.save')}
                </Button>
                {settings.analytics_engagement_floor && (
                  <Button
                    kind="ghost"
                    disabled={setSetting.isPending}
                    onClick={() => {
                      setFloor('');
                      void write('analytics_engagement_floor', null);
                    }}
                  >
                    {tr('op.settings.clear')}
                  </Button>
                )}
              </>
            ) : (
              <StatusBadge size="sm" tone="neutral" icon="lock" label={tr('ws.kit.common.readOnly')} />
            )
          }
        >
          <Field label={tr('op.settings.engagementFloor')} hint={tr('op.settings.engagementFloorHint')} style={settingField}>
            {canSetFloor ? (
              <input
                style={{ ...inputStyle, inlineSize: 'auto' }}
                dir="ltr"
                type="date"
                value={floor ?? ''}
                onChange={(e) => setFloor(e.target.value)}
              />
            ) : (
              // Rule 4.2: a role that will never be allowed to set this sees the
              // value, not a greyed-out date picker.
              <span dir="ltr" style={{ fontWeight: 600 }}>
                {settings.analytics_engagement_floor
                  ? formatDate(new Date(`${settings.analytics_engagement_floor}T00:00:00`), locale)
                  : tr('op.settings.notSet')}
              </span>
            )}
          </Field>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
