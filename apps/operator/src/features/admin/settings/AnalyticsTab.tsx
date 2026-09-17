/**
 * Analytics tab of VenueSettingsScreen (owner): menu items left out of the
 * analytics screens, and the date guest-app data starts counting from. Writes
 * through `set_cafe_setting`, as before.
 *
 * The excluded-items control was a search box over a boxed list of every menu
 * item with a "0 excluded" chip under it: to see WHAT was excluded, the owner
 * scrolled the whole menu looking for ticks. The excluded items now lead, as
 * a line of names each with its own remove, and the full list is where more
 * are added. Save and Discard appear once there is a change to keep.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { useLocale, pickName } from '../../../lib/i18n';
import { useCafeSettings, useSetCafeSetting } from '../../../lib/settings';
import { useToast } from '../../../components/toast';
import { Button, Field, Skeleton, inputStyle } from '../../../components/ui';
import { ResultCount, SearchField } from '../../../components/kit';
import { SettingsGroup, SettingsRow, settingField } from './SettingsList';

interface MenuItemLite {
  id: string;
  name_en: string;
  name_ar: string;
}

export function AnalyticsTab() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const { settings, isLoading } = useCafeSettings();
  const setSetting = useSetCafeSetting();

  const itemsQ = useQuery({
    queryKey: ['settingsMenuItems'],
    queryFn: async () => {
      const { data, error } = await supabase.from('menu_items').select('id, name_en, name_ar').order('sort_order');
      if (error) throw error;
      return (data ?? []) as MenuItemLite[];
    },
    staleTime: 60_000,
  });

  const saved = settings.analytics_excluded_item_ids;
  const [search, setSearch] = useState('');
  const [excluded, setExcluded] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!isLoading && excluded === null) setExcluded(new Set(saved));
  }, [isLoading, saved, excluded]);
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = itemsQ.data ?? [];
    if (!q) return all;
    return all.filter((i) => i.name_en.toLowerCase().includes(q) || i.name_ar.includes(q));
  }, [itemsQ.data, search]);
  const excludedDirty = excluded !== null && (excluded.size !== saved.length || saved.some((id) => !excluded.has(id)));

  const [floor, setFloor] = useState<string | null>(null);
  useEffect(() => {
    if (!isLoading && floor === null) setFloor(settings.analytics_engagement_floor ?? '');
  }, [isLoading, settings.analytics_engagement_floor, floor]);
  const floorSaved = settings.analytics_engagement_floor ?? '';

  async function write<K extends Parameters<typeof setSetting.mutateAsync>[0]['key']>(key: K, value: Parameters<typeof setSetting.mutateAsync>[0]['value']) {
    try {
      await setSetting.mutateAsync({ key, value } as Parameters<typeof setSetting.mutateAsync>[0]);
      toast.ok(tr('op.toast.saved'));
    } catch (e) {
      toast.err(e);
    }
  }

  if (isLoading || excluded === null || floor === null) return <Skeleton lines={6} />;

  const byId = new Map((itemsQ.data ?? []).map((i) => [i.id, i]));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(excluded);
    if (on) next.add(id);
    else next.delete(id);
    setExcluded(next);
  };

  return (
    <div style={{ maxInlineSize: 'var(--tp-measure-form)', display: 'grid', gap: 'var(--tp-sp-4)', marginBlockStart: 'var(--tp-sp-3)' }}>
      <SettingsGroup title={tr('ws.owner.settings.analytics.excludedTitle')} description={tr('ws.manager.settings.analyticsLead')}>
        <SettingsRow
          end={
            excludedDirty ? (
              <>
                <Button kind="ghost" disabled={setSetting.isPending} onClick={() => setExcluded(new Set(saved))}>
                  {tr('ws.kit.actions.discard')}
                </Button>
                <Button kind="primary" busy={setSetting.isPending} onClick={() => void write('analytics_excluded_item_ids', [...excluded])}>
                  {tr('common.save')}
                </Button>
              </>
            ) : null
          }
        >
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
            <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.owner.settings.analytics.excludedNow')}</span>
            {excluded.size === 0 ? (
              <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.settings.analytics.excludedNone')}</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
                {[...excluded].map((id) => (
                  <li key={id}>
                    <Button size="sm" kind="soft" iconEnd="x" aria-label={tr('ws.owner.settings.analytics.includeAgain', { item: pickName(locale, byId.get(id)) || id })} onClick={() => toggle(id, false)}>
                      <bdi>{pickName(locale, byId.get(id)) || tr('ws.owner.settings.analytics.unknownItem')}</bdi>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Field label={tr('ws.owner.settings.analytics.addLabel')} hint={tr('op.settings.excludedHint')} style={{ ...settingField, marginBlockStart: 'var(--tp-sp-2)' }}>
            <SearchField value={search} onChange={setSearch} placeholder={tr('op.common.search')} />
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
              <label key={i.id} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', minBlockSize: 'var(--tp-row-h-dense)' }}>
                <input type="checkbox" checked={excluded.has(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} />
                <bdi>{pickName(locale, i)}</bdi>
              </label>
            ))}
          </div>
          {search.trim() !== '' && <ResultCount shown={filteredItems.length} total={itemsQ.data?.length ?? 0} />}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={tr('ws.owner.settings.analytics.floorTitle')}>
        <SettingsRow
          end={
            <>
              {floor !== floorSaved && floor !== '' && (
                <Button kind="primary" busy={setSetting.isPending} onClick={() => void write('analytics_engagement_floor', floor)}>
                  {tr('common.save')}
                </Button>
              )}
              {settings.analytics_engagement_floor && floor === floorSaved && (
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
          }
        >
          <Field label={tr('op.settings.engagementFloor')} hint={tr('op.settings.engagementFloorHint')} style={settingField}>
            <input style={{ ...inputStyle, inlineSize: 'auto' }} dir="ltr" type="date" value={floor} onChange={(e) => setFloor(e.target.value)} />
          </Field>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            {floorSaved
              ? tr('ws.owner.settings.analytics.floorNow', { date: formatDate(new Date(`${floorSaved}T00:00:00`), locale) })
              : tr('ws.owner.settings.analytics.floorNone')}
          </p>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
