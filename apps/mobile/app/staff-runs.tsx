import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { startableKinds, type RunRow } from '@touch/core';
import { formatDateTime } from '@touch/i18n';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, Hint, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { FilterChip } from '../src/components/booking';
import { BellIcon, CheckIcon, ChevronIcon, ClockIcon, PencilIcon } from '../src/components/icons';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../src/features/staff/edge';
import { staffKeys } from '../src/features/staff/keys';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { fetchRuns } from '../src/features/staff/protocols/api';
import { RUN_FILTERS, bilingual, parseRunFilter, runTitle, type RunFilter } from '../src/features/staff/protocols/logic';
import { Muted, StatusPill, Strong, runStatusTone, useRefreshProtocols } from '../src/features/staff/protocols/parts';

/**
 * The protocols a person is part of (build-contracts-2026-09-23 §6.1
 * `staff-runs.tsx?filter=`): waiting on them, in progress, finished, or the
 * ones they started ("My runs", which covers the head roles' proposals).
 * Management sees every run at the venue; everyone else only the runs they
 * are involved in (the server decides, `protocol_runs_page`).
 */

const FILTER_ICONS = { waiting: BellIcon, active: ClockIcon, finished: CheckIcon, mine: PencilIcon } as const;

function RunCard({ run, onPress }: { run: RunRow; onPress: () => void }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const typed = runTitle(run, locale);
  const title = typed ?? t(`work.protocol.kind.${run.kind}`);
  const now = run.current_steps.map((s) => bilingual(locale, s.name_en, s.name_ar)).filter(Boolean);
  return (
    <Pressable
      testID={`staff-runs.run.${run.id}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        padding: space.m,
        borderRadius: radius.card,
        borderWidth: run.waiting_on_me ? 1.5 : 1,
        borderColor: run.waiting_on_me ? colors.blue : colors.line,
        backgroundColor: pressed ? colors.sub : colors.card,
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Strong>{title}</Strong>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <StatusPill label={t(`work.protocol.runStatus.${run.status}`)} tone={runStatusTone(run.status)} />
          {/* An untitled run is already headed by its kind; saying it twice is noise. */}
          {typed ? <Muted>{t(`work.protocol.kind.${run.kind}`)}</Muted> : null}
          {run.waiting_on_me ? <Muted style={{ color: colors.blue }}>{t('staff.protocols.runs.waitingOnYou')}</Muted> : null}
        </View>
        {now.length > 0 ? <Muted>{t('staff.protocols.runs.now', { steps: now.join(locale === 'ar' ? '، ' : ', ') })}</Muted> : null}
        <Muted>
          {t('staff.protocols.runs.startedBy', {
            name: run.started_by_name ?? '',
            when: formatDateTime(new Date(run.started_at), locale),
          })}
        </Muted>
      </View>
      <ChevronIcon size={16} color={colors.fnt2} />
    </Pressable>
  );
}

function RunsScreen() {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const refresh = useRefreshProtocols();
  const pull = usePullRefresh(refresh);
  const { status, venueId } = useStaffStatus();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<RunFilter>(() => parseRunFilter(params.filter));
  const role = status.kind === 'staff' ? status.staff.role : null;
  const venue = venueId ?? '';
  const runs = useQuery({
    queryKey: staffKeys.runs(venue, filter),
    queryFn: () => fetchRuns(venue, filter),
    enabled: venue !== '',
  });
  const canStart = startableKinds(role).length > 0;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.protocols.runs.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {RUN_FILTERS.map((f) => (
            <FilterChip
              key={f}
              testID={`staff-runs.filter.${f}`}
              icon={FILTER_ICONS[f]}
              label={t(`staff.protocols.runs.filter.${f}`)}
              selected={filter === f}
              onPress={() => setFilter(f)}
            />
          ))}
        </View>
        {canStart ? (
          <Button
            testID="staff-runs.start"
            label={t('staff.protocols.runs.start')}
            variant="secondary"
            size="compact"
            onPress={() => router.push('/staff-start')}
          />
        ) : null}
        {runs.isPending ? (
          <SkeletonList rows={3} height={96} />
        ) : runs.isError ? (
          <ErrorState
            testID="staff-runs.error"
            title={t('errors.loadFailedTitle')}
            message={t(mapStaffError(runs.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void runs.refetch()}
          />
        ) : runs.data.runs.length === 0 ? (
          <Hint>{t(`staff.protocols.runs.empty.${filter}`)}</Hint>
        ) : (
          <>
            {runs.data.runs.map((run) => (
              <RunCard key={run.id} run={run} onPress={() => router.push({ pathname: '/staff-run', params: { id: run.id } })} />
            ))}
            {runs.data.total > runs.data.runs.length ? (
              <Hint>{t('staff.protocols.runs.more', { shown: runs.data.runs.length, total: runs.data.total })}</Hint>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

export default function StaffRunsRoute() {
  return (
    <RequireStaff>
      <RunsScreen />
    </RequireStaff>
  );
}
