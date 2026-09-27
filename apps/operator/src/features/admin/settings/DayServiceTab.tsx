/**
 * Day & service tab of VenueSettingsScreen: when the business day turns over
 * (owner, `set_cafe_setting('analytics_business_day_start_hour')`) and how long
 * a table waits between waiter calls (`set_waiter_call_cooldown`).
 *
 * The day start used to save the moment the dropdown changed. It moves which
 * day every after-midnight sale belongs to — on the panel, in analytics and in
 * reports, past days included — so it now waits for Save and asks first, with
 * that consequence in the question. A manager sees the value it is set to
 * instead of nothing at all: the old tab hid the row, so a manager could not
 * tell why "today" started at 04:00.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { useAuth, can } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useCafeSettings, useSetCafeSetting } from '../../../lib/settings';
import { useToast } from '../../../components/toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Button, ErrorText, Field, Select, Skeleton, inputStyle } from '../../../components/ui';
import { StatusBadge } from '../../../components/kit';
import { SettingsGroup, SettingsRow, settingField } from './SettingsList';

const BUSINESS_DAY_HOURS = [0, 4, 5, 6, 7, 8] as const;
const COOLDOWN_MIN = 30;
const COOLDOWN_MAX = 600;
const COOLDOWN_KEY = ['venueSettingsCooldown'] as const;

export function DayServiceTab() {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { staff } = useAuth();
  // Capability matrix, not an inline role comparison — see lib/auth.tsx.
  const canSetBusinessDay = can(staff?.role, 'setBusinessDayStart');
  const { settings, isLoading } = useCafeSettings();
  const setSetting = useSetCafeSetting();

  const hourLabel = (h: number) =>
    h === 0 ? tr('op.settings.calendarDay') : tr('op.settings.hour', { hour: String(h).padStart(2, '0') });

  // --- business day start (owner) ---
  const savedHour = settings.analytics_business_day_start_hour;
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    if (!isLoading && hour === null) setHour(savedHour);
  }, [isLoading, savedHour, hour]);
  const hourDirty = hour !== null && hour !== savedHour;

  async function saveHour() {
    if (hour === null) return;
    const ok = await confirm({
      title: tr('ws.owner.settings.day.confirmTitle', { hour: hourLabel(hour) }),
      body: tr('ws.owner.settings.day.confirmBody', { from: hourLabel(savedHour), to: hourLabel(hour) }),
      confirmLabel: tr('ws.owner.settings.day.confirmAction'),
    });
    if (!ok) return;
    try {
      await setSetting.mutateAsync({ key: 'analytics_business_day_start_hour', value: hour });
      toast.ok(tr('op.toast.saved'));
    } catch (e) {
      toast.err(e);
    }
  }

  // --- waiter-call cooldown (venue_settings) ---
  const venueQ = useQuery({
    queryKey: COOLDOWN_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('venue_settings').select('waiter_call_cooldown_seconds').single();
      if (error) throw error;
      return data.waiter_call_cooldown_seconds;
    },
  });
  const [cooldown, setCooldown] = useState<string | null>(null);
  useEffect(() => {
    if (venueQ.data !== undefined && cooldown === null) setCooldown(String(venueQ.data));
  }, [venueQ.data, cooldown]);
  const cooldownNum = Number(cooldown);
  const cooldownDirty = cooldown !== null && venueQ.data !== undefined && cooldown !== String(venueQ.data);
  const cooldownValid = cooldown !== null && /^\d+$/.test(cooldown) && cooldownNum >= COOLDOWN_MIN && cooldownNum <= COOLDOWN_MAX;
  const saveCooldown = useMutation({
    mutationFn: () => appRpc('set_waiter_call_cooldown', { p_seconds: cooldownNum }),
    onSuccess: () => {
      toast.ok(tr('op.toast.saved'));
      void queryClient.invalidateQueries({ queryKey: COOLDOWN_KEY });
    },
    onError: (e) => toast.err(e),
  });

  if (isLoading || hour === null) return <Skeleton lines={6} />;

  // Seconds are what the server stores; minutes are what a person reads.
  const cooldownReadable =
    cooldownValid && cooldownNum >= 60
      ? tr('ws.owner.settings.day.cooldownMinutes', { minutes: formatNumber(Math.round((cooldownNum / 60) * 10) / 10, locale) })
      : null;

  return (
    <div style={{ maxInlineSize: 'var(--tp-measure-form)', display: 'grid', gap: 'var(--tp-sp-4)', marginBlockStart: 'var(--tp-sp-3)' }}>
      <SettingsGroup title={tr('ws.manager.settings.groups.tradingDay')} description={tr('ws.owner.settings.day.lead')}>
        <SettingsRow
          end={
            canSetBusinessDay ? (
              hourDirty ? (
                <>
                  <Button kind="ghost" disabled={setSetting.isPending} onClick={() => setHour(savedHour)}>
                    {tr('ws.kit.actions.discard')}
                  </Button>
                  <Button kind="primary" busy={setSetting.isPending} onClick={() => void saveHour()}>
                    {tr('common.save')}
                  </Button>
                </>
              ) : null
            ) : (
              <StatusBadge size="sm" tone="neutral" icon="lock" label={tr('ws.owner.settings.ownerOnly')} />
            )
          }
        >
          <Field label={tr('op.settings.businessDay')} hint={tr('op.settings.businessDayHint')} style={settingField}>
            {canSetBusinessDay ? (
              <Select
                value={String(hour)}
                style={{ maxInlineSize: '14rem' }}
                options={BUSINESS_DAY_HOURS.map((h) => ({ value: String(h), label: hourLabel(h) }))}
                onChange={(v) => setHour(Number(v))}
              />
            ) : (
              <span dir="ltr" style={{ fontWeight: 600, textAlign: 'start' }}>
                {hourLabel(savedHour)}
              </span>
            )}
          </Field>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={tr('ws.manager.settings.groups.service')}>
        <SettingsRow
          end={
            // Save appears once there is something to save. A disabled Save that
            // said "This is already the saved value" sat beside the field on
            // every visit and read as an error.
            cooldownDirty ? (
              <>
                <Button kind="ghost" disabled={saveCooldown.isPending} onClick={() => setCooldown(String(venueQ.data))}>
                  {tr('ws.kit.actions.discard')}
                </Button>
                <Button
                  kind="primary"
                  disabled={!cooldownValid}
                  disabledReason={!cooldownValid ? tr('ws.manager.settings.cooldownInvalid') : undefined}
                  busy={saveCooldown.isPending}
                  onClick={() => saveCooldown.mutate()}
                >
                  {tr('common.save')}
                </Button>
              </>
            ) : null
          }
        >
          <Field
            label={tr('op.settings.cooldown')}
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
          {cooldownReadable && <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{cooldownReadable}</p>}
          <ErrorText error={venueQ.error} />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
