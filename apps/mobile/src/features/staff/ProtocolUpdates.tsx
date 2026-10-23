/**
 * Follow every step (owner, 2026-10-22): the owner's switch for protocol
 * status pushes, on the Work alerts page. On (the default), app.notify_staff
 * tells the owner whenever a step passes or a protocol goes live, is
 * scheduled, finishes, stops or is withdrawn, even when nothing waits on them
 * (0363 protocol_watch). Approval reminders are work and stay on regardless.
 *
 * Owner only: the page renders it for the owner alone, and both RPCs refuse
 * anyone else.
 */
import { Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { brand, space, useTheme } from '../../theme';
import { Card } from '../../components/ui';
import { useToast } from '../../components/overlays';
import { staffRpc } from './api';
import { staffKeys } from './keys';

export interface PushPrefs {
  protocol_updates: boolean;
}

export function fetchPushPrefs(): Promise<PushPrefs> {
  return staffRpc<PushPrefs>('my_push_prefs');
}

export function setProtocolUpdates(on: boolean): Promise<PushPrefs> {
  return staffRpc<PushPrefs>('set_my_push_prefs', { p_protocol_updates: on });
}

export function ProtocolUpdates({ uid, testID }: { uid: string; testID: string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const key = staffKeys.pushPrefs(uid);
  const prefs = useQuery({ queryKey: key, queryFn: fetchPushPrefs });

  // Optimistic: the switch moves at once and goes back if the write fails.
  const save = useMutation({
    mutationKey: staffKeys.mutation('push_prefs.set'),
    mutationFn: setProtocolUpdates,
    onMutate: async (on: boolean) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<PushPrefs>(key);
      qc.setQueryData<PushPrefs>(key, { protocol_updates: on });
      return { before };
    },
    onError: (_err, _on, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      toast(t('errors.generic'), 'error');
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  // Nothing until the setting is read: a switch that jumps after loading
  // would say the wrong thing for a moment.
  if (!prefs.data) return null;
  const on = prefs.data.protocol_updates;

  return (
    <Card style={{ padding: space.l, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink }}>
          {t('staff.shell.alerts.followTitle')}
        </Text>
        <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut }}>
          {t('staff.shell.alerts.followBody')}
        </Text>
      </View>
      <Switch
        testID={`${testID}.switch`}
        accessibilityLabel={t('staff.shell.alerts.followTitle')}
        value={on}
        onValueChange={(next) => save.mutate(next)}
        disabled={save.isPending}
        trackColor={{ true: brand.blue, false: colors.seg }}
      />
    </Card>
  );
}
