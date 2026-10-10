/**
 * Work alerts (owner, 2026-10-10): Today's "Work alerts" button opens the
 * work alerts page (app/staff-work.tsx), which holds today's checklists and
 * the work list, and the button carries a badge with how much of it waits on
 * the person. Two hooks both screens share: the push permission, and that
 * count.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocale } from '../../i18n/LocaleProvider';
import { useToast } from '../../components/overlays';
import {
  getPushPermissionState,
  permissionStateAfter,
  registerPushToken,
  type PushPermissionState,
} from '../profile/push';
import { addBreadcrumb } from '../../lib/telemetry';
import { fetchChecklistsToday } from './checklists/api';
import { fetchMyWork } from './protocols/api';
import { staffKeys } from './keys';
import { waitingCount } from './workCount';

/**
 * How much on the work alerts page waits on the person at `venueId`: the same
 * reads the page makes, so opening it shows what the badge counted. Zero
 * while they load or when there is no venue.
 */
export function useWaitingCount(venueId: string | null): number {
  const lists = useQuery({
    queryKey: staffKeys.checklists(venueId ?? ''),
    queryFn: () => fetchChecklistsToday(venueId!),
    enabled: !!venueId,
  });
  const work = useQuery({
    queryKey: staffKeys.work(venueId ?? ''),
    queryFn: () => fetchMyWork(venueId!),
    enabled: !!venueId,
  });
  if (!venueId) return 0;
  return waitingCount(lists.data, work.data);
}

export function useWorkAlerts() {
  const { t } = useLocale();
  const toast = useToast();
  const [state, setState] = useState<PushPermissionState>('undetermined');
  const [busy, setBusy] = useState(false);

  // Re-probed on every foreground, as Settings does: coming back from the
  // system settings with alerts turned on must show it, and must register the
  // token that makes the alerts arrive at all.
  useEffect(() => {
    let cancelled = false;
    const probe = () => {
      void getPushPermissionState().then((next) => {
        if (cancelled) return;
        setState(next);
        if (next === 'granted') {
          void registerPushToken({ prompt: false }).then((result) =>
            addBreadcrumb('push.register', { result, reason: 'staff-foreground' }),
          );
        }
      });
    };
    probe();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') probe();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // The only prompting call in the staff area: the lifecycle never asks, so an
  // account that never turned alerts on has no token and every work push
  // would end as NO_PUSH_TOKEN (plan §6.6).
  const enable = useCallback(async () => {
    setBusy(true);
    const result = await registerPushToken({ prompt: true });
    addBreadcrumb('push.register', { result, reason: 'staff-alerts-row' });
    const observed = result === 'failed' ? await getPushPermissionState() : 'unavailable';
    const next = permissionStateAfter(result, observed);
    setState(next.state);
    if (next.errored) toast(t('errors.generic'), 'error');
    setBusy(false);
  }, [t, toast]);

  return { state, busy, enable };
}

