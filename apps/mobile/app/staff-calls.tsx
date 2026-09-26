import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNumber, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, ErrorText, Hint, MicroLabel, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { ListCard } from '../src/features/staff/protocols/parts';
import { Lead } from '../src/features/staff/checklists/parts';
import { ackCall, fetchOpenCalls, resolveCall } from '../src/features/staff/calls/api';
import { useFloorLive } from '../src/features/staff/calls/useFloorLive';
import {
  CALL_ROLES,
  actionKey,
  answeredBy,
  callRefusal,
  callUrgency,
  elapsedSince,
  orderCalls,
  reasonKey,
  type CallAction,
  type Urgency,
  type WaiterCall,
} from '../src/features/staff/calls/logic';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * Guest calls (wave5-addendum-2026-09-25 §2.1.8, §8 Q3 answered): the
 * waiter's phone lists the venue's open "call a waiter" calls, newest first,
 * live on the `floor` topic, with "On my way" (ack_waiter_call) and "Done"
 * (resolve_waiter_call). The till shows the same calls; whoever acts first
 * wins, and a tap on a call someone else already closed says so and refreshes.
 *
 * One card, a row per call (no card per call): the table is the largest thing
 * in the row, the age sits at its end and turns amber, then red, the longer an
 * unanswered call waits (always with the words, never colour alone). Calls
 * older than two hours follow under their own caption, quietly.
 *
 * Both answers are state-idempotent (a repeat is `duplicate: true`), so they
 * take no idempotency key; each button's busy state is keyed per call and
 * action, and every write carries its `staffKeys.mutation` key so it never
 * pauses offline.
 */

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function CallsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { status, venueId } = useStaffStatus();
  const me = status.kind === 'staff' ? status.staff.id : null;
  const venue = venueId ?? '';
  const live = useFloorLive(venue !== '');
  const now = useNow(15_000);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});

  const calls = useQuery({
    queryKey: staffKeys.calls(venue),
    queryFn: () => fetchOpenCalls(venue),
    enabled: venue !== '',
    // The safety net while the floor channel is down (the till's 60 s, halved:
    // a waiter has no other screen to look at).
    refetchInterval: 30_000,
  });
  const pull = usePullRefresh(() => calls.refetch());

  const mark = (key: string, on: boolean) =>
    setPending((cur) => {
      const next = new Set(cur);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const note = (callId: string, text: string | null) =>
    setNotes((cur) => {
      const next = { ...cur };
      if (text === null) delete next[callId];
      else next[callId] = text;
      return next;
    });

  const onRefused = (callId: string, err: unknown) => {
    if (callRefusal(err) === 'answered') {
      // Closed on the till, or gone: the list is re-read and the row leaves.
      toast(t('staff.calls.answered'), 'info');
      note(callId, null);
    } else {
      note(callId, t(mapStaffError(err)));
    }
    void queryClient.invalidateQueries({ queryKey: staffKeys.calls(venue) });
  };

  const ack = useMutation({
    mutationKey: staffKeys.mutation('waiter_call.ack'),
    mutationFn: (callId: string) => ackCall(callId),
    onMutate: (callId) => {
      mark(actionKey(callId, 'ack'), true);
      note(callId, null);
    },
    onSuccess: async (r, callId) => {
      if (r.duplicate) {
        // Acknowledged before this tap: never claim it. Read who did, and say
        // so when it was not this waiter (a lost answer of their own was).
        await queryClient.invalidateQueries({ queryKey: staffKeys.calls(venue) });
        const after = queryClient
          .getQueryData<WaiterCall[]>(staffKeys.calls(venue))
          ?.find((c) => c.id === callId);
        if (!after || answeredBy(after, me) !== 'me') toast(t('staff.calls.answered'), 'info');
        return;
      }
      queryClient.setQueryData<WaiterCall[]>(staffKeys.calls(venue), (list) =>
        list?.map((c) =>
          c.id === callId ? { ...c, status: 'acknowledged', acknowledged_by: me } : c,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: staffKeys.calls(venue) });
    },
    onError: (err, callId) => onRefused(callId, err),
    onSettled: (_r, _e, callId) => mark(actionKey(callId, 'ack'), false),
  });

  const resolve = useMutation({
    mutationKey: staffKeys.mutation('waiter_call.resolve'),
    mutationFn: (callId: string) => resolveCall(callId),
    onMutate: (callId) => {
      mark(actionKey(callId, 'resolve'), true);
      note(callId, null);
    },
    onSuccess: (_r, callId) => {
      queryClient.setQueryData<WaiterCall[]>(staffKeys.calls(venue), (list) =>
        list?.filter((c) => c.id !== callId),
      );
      void queryClient.invalidateQueries({ queryKey: staffKeys.calls(venue) });
    },
    onError: (err, callId) => onRefused(callId, err),
    onSettled: (_r, _e, callId) => mark(actionKey(callId, 'resolve'), false),
  });

  const act = (callId: string, action: CallAction) =>
    action === 'ack' ? ack.mutate(callId) : resolve.mutate(callId);

  const ageText = (call: WaiterCall): string => {
    const e = elapsedSince(call.raised_at, now);
    if (e.unit === 'now') return t('op.floor.ageNow');
    const age =
      e.unit === 'minutes'
        ? t('staff.calls.age.minutes', { minutes: formatNumber(e.minutes, locale) })
        : e.unit === 'hours'
          ? t('staff.calls.age.hours', {
              hours: formatNumber(e.hours, locale),
              minutes: formatNumber(e.minutes, locale),
            })
          : t('staff.calls.age.days', {
              days: formatNumber(e.days, locale),
              hours: formatNumber(e.hours, locale),
            });
    return t(call.status === 'raised' ? 'op.floor.overdue' : 'op.floor.ageMinutes', { age });
  };

  const inkOf = (u: Urgency) =>
    u === 'late' ? colors.redtext : u === 'warn' ? colors.ambtext : colors.mut;

  const row = (call: WaiterCall, last: boolean, quiet: boolean) => {
    const urgency = quiet ? 'calm' : callUrgency(call, now);
    const who = answeredBy(call, me);
    const raised = call.status === 'raised';
    const busyAck = pending.has(actionKey(call.id, 'ack'));
    const busyDone = pending.has(actionKey(call.id, 'resolve'));
    const table = call.table ? isolate(call.table.table_number) : '…';
    const detail = [
      t(reasonKey(call.reason)),
      who === 'me' ? t('staff.calls.mine') : who === 'other' ? t('staff.calls.other') : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <View
        key={call.id}
        testID={`staff-calls.item.${call.id}`}
        style={{
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: space.sm,
          paddingBottom: space.m,
          gap: space.xs,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.sub,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: space.s,
          }}
        >
          <Text
            style={{
              flexShrink: 1,
              fontFamily: fonts.display800,
              fontSize: 19,
              lineHeight: 25,
              color: colors.ink,
            }}
          >
            {t('op.floor.table', { table })}
          </Text>
          <Text
            style={{
              fontFamily: urgency === 'calm' ? fonts.body600 : fonts.body700,
              fontSize: 12.5,
              color: inkOf(urgency),
            }}
          >
            {ageText(call)}
          </Text>
        </View>
        <Text
          style={{ fontFamily: fonts.body600, fontSize: 13.5, lineHeight: 19, color: colors.mut2 }}
        >
          {detail}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xs }}>
          {raised ? (
            <View style={{ flex: 1 }}>
              <Button
                testID={`staff-calls.ack.${call.id}`}
                label={t('op.floor.ack')}
                variant="secondary"
                size="compact"
                busy={busyAck}
                disabled={busyDone}
                onPress={() => act(call.id, 'ack')}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Button
              testID={`staff-calls.done.${call.id}`}
              label={t('op.floor.resolve')}
              variant="primary"
              size="compact"
              busy={busyDone}
              disabled={busyAck}
              onPress={() => act(call.id, 'resolve')}
            />
          </View>
        </View>
        <ErrorText>{notes[call.id] ?? null}</ErrorText>
      </View>
    );
  };

  const list = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (calls.isPending) return <SkeletonList rows={3} height={112} />;
    if (calls.isError) {
      return (
        <ErrorState
          testID="staff-calls.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(calls.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void calls.refetch()}
        />
      );
    }
    const { recent, old } = orderCalls(calls.data, now);
    if (recent.length === 0 && old.length === 0) {
      return (
        <EmptyState
          testID="staff-calls.empty"
          title={t('staff.calls.emptyTitle')}
          message={t('staff.calls.emptyBody')}
        />
      );
    }
    return (
      <View style={{ gap: space.sm }}>
        {recent.length > 0 ? (
          <ListCard>{recent.map((c, i) => row(c, i === recent.length - 1, false))}</ListCard>
        ) : null}
        {old.length > 0 ? (
          <View style={{ gap: space.xs }}>
            <MicroLabel
              style={{ paddingStart: 4 }}
            >{`${t('staff.calls.old')} · ${formatNumber(old.length, locale)}`}</MicroLabel>
            <ListCard>{old.map((c, i) => row(c, i === old.length - 1, true))}</ListCard>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.calls.title') }} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t('staff.calls.lead')}</Lead>
        {/* Said only when it matters: "live" is the normal state and earns no line. */}
        {live === 'down' ? (
          <Text
            style={{
              fontFamily: fonts.body600,
              fontSize: 12.5,
              lineHeight: 18,
              color: colors.ambtext,
            }}
          >
            {t('staff.calls.notLive')}
          </Text>
        ) : null}
        <View testID="staff-calls.list" style={{ gap: space.xs }}>
          <MicroLabel style={{ paddingStart: 4 }}>{t('staff.calls.listTitle')}</MicroLabel>
          {list()}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default function StaffCallsRoute() {
  return (
    <RequireStaff roles={CALL_ROLES}>
      <CallsScreen />
    </RequireStaff>
  );
}
