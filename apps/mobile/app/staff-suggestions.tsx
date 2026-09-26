import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate, isolate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { space, useTheme } from '../src/theme';
import { Button, Card, ErrorText, Field, Hint, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import { staffKeys } from '../src/features/staff/keys';
import { mapStaffError } from '../src/features/staff/edge';
import { clearStaffIntentKey, staffIntentKey } from '../src/lib/idempotency';
import {
  addSuggestion,
  fetchMySuggestions,
  fetchSuggestionsPage,
  markSuggestionSeen,
} from '../src/features/staff/suggestions/api';
import {
  BODY_MAX,
  SUGGESTION_FILTERS,
  applySeen,
  readsAllSuggestions,
  suggestionIntent,
  suggestionIssue,
  type SuggestionFilter,
  type SuggestionsPage,
} from '../src/features/staff/suggestions/logic';
import { Lead, MULTILINE_BOX, MULTILINE_TEXT, Tag } from '../src/features/staff/checklists/parts';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * The suggestion box (build-contracts-2026-09-23 §2.24.4, §6.1; plan #63).
 * Every role sends a suggestion here, signed, and follows whether it was read.
 * The manager and the owner also get "From the team": every suggestion at the
 * venue with its author and role, new ones first, and Mark seen. No photo, no
 * reply, and the form asks for no guest names or phone numbers.
 */

function SuggestionsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { status, venueId } = useStaffStatus();
  const staff = status.kind === 'staff' ? status.staff : null;
  const mgmt = staff !== null && readsAllSuggestions(staff.role);
  const venue = venueId ?? '';

  const [body, setBody] = useState('');
  const [issue, setIssue] = useState<'required' | 'tooLong' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SuggestionFilter>('new');

  const mine = useQuery({
    queryKey: staffKeys.mySuggestions(venue),
    queryFn: () => fetchMySuggestions(venue),
    enabled: venue !== '',
  });
  const team = useQuery({
    queryKey: staffKeys.suggestions(venue, filter),
    queryFn: () => fetchSuggestionsPage(venue, filter),
    enabled: venue !== '' && mgmt,
  });
  const pull = usePullRefresh(() => Promise.all([mine.refetch(), mgmt ? team.refetch() : null]));

  const send = useMutation({
    mutationKey: staffKeys.mutation('suggestion'),
    mutationFn: (text: string) =>
      addSuggestion(venue, text, staffIntentKey(suggestionIntent(venue, text), 'suggestion')),
    onSuccess: (_result, text) => {
      clearStaffIntentKey(suggestionIntent(venue, text));
      toast(t('staff.checklists.suggestions.sent'), 'success');
      setBody('');
      setIssue(null);
      void queryClient.invalidateQueries({ queryKey: staffKeys.mySuggestions(venue) });
      if (mgmt) {
        for (const f of SUGGESTION_FILTERS) {
          void queryClient.invalidateQueries({ queryKey: staffKeys.suggestions(venue, f) });
        }
      }
    },
    onError: (err) => setError(t(mapStaffError(err))),
  });

  const seen = useMutation({
    mutationKey: staffKeys.mutation('suggestion.seen'),
    mutationFn: (id: string) => markSuggestionSeen(id),
    onSuccess: (result, id) => {
      queryClient.setQueryData<SuggestionsPage>(staffKeys.suggestions(venue, filter), (page) =>
        page ? applySeen(page, id, filter, result.seen_at, staff?.displayName ?? '') : page,
      );
      for (const other of SUGGESTION_FILTERS) {
        if (other !== filter) void queryClient.invalidateQueries({ queryKey: staffKeys.suggestions(venue, other) });
      }
    },
    onError: (err) => toast(t(mapStaffError(err)), 'error'),
  });

  const onSend = () => {
    setError(null);
    const found = suggestionIssue(body);
    setIssue(found);
    if (!found && venue !== '') send.mutate(body.trim());
  };

  const dateOf = (iso: string) => formatDate(new Date(iso), locale);
  const muted = { fontFamily: fonts.body400, fontSize: 12, color: colors.mut };
  const bodyText = { fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 20, color: colors.ink };

  const fromTeam = () => {
    if (venue === '') return null;
    if (team.isPending) return <SkeletonList rows={2} height={72} />;
    if (team.isError) {
      return (
        <ErrorState
          testID="staff-suggestions.team-error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(team.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void team.refetch()}
        />
      );
    }
    const rows = team.data?.suggestions ?? [];
    if (rows.length === 0) return <Hint>{t('staff.checklists.suggestions.emptyTeam')}</Hint>;
    return rows.map((row) => (
      <Card key={row.id} style={{ padding: space.m, gap: 6 }}>
        <View testID={`staff-suggestions.team.${row.id}`} style={{ gap: 4 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.mut2 }}>
            {/* An author with no role on record reads as the name alone, not "Maha, ". */}
            {row.author_role
              ? t('staff.checklists.suggestions.by', {
                  name: isolate(row.author_name ?? ''),
                  role: t(`op.roles.${row.author_role}`),
                })
              : isolate(row.author_name ?? '')}
          </Text>
          <Text style={bodyText}>{row.body}</Text>
          <Text style={muted}>{dateOf(row.created_at)}</Text>
        </View>
        {row.seen_at ? (
          <Text style={muted}>
            {t('staff.checklists.suggestions.seenBy', {
              name: isolate(row.seen_by_name ?? ''),
              date: dateOf(row.seen_at),
            })}
          </Text>
        ) : (
          <Button
            testID={`staff-suggestions.seen.${row.id}`}
            label={t('staff.checklists.suggestions.markSeen')}
            variant="secondary"
            size="compact"
            busy={seen.isPending && seen.variables === row.id}
            onPress={() => seen.mutate(row.id)}
            style={{ alignSelf: 'flex-start' }}
          />
        )}
      </Card>
    ));
  };

  const yours = () => {
    if (venue === '') return <Hint>{t('staff.shell.venue.none')}</Hint>;
    if (mine.isPending) return <SkeletonList rows={2} height={64} />;
    if (mine.isError) {
      return (
        <ErrorState
          testID="staff-suggestions.error"
          title={t('errors.loadFailedTitle')}
          message={t(mapStaffError(mine.error))}
          retryLabel={t('common.retry')}
          onRetry={() => void mine.refetch()}
        />
      );
    }
    const rows = mine.data ?? [];
    if (rows.length === 0) return <Hint>{t('staff.checklists.suggestions.emptyMine')}</Hint>;
    return rows.map((row) => (
      <Card key={row.id} style={{ padding: space.m, gap: 6 }}>
        <View testID={`staff-suggestions.item.${row.id}`} style={{ gap: 6 }}>
          <Text style={bodyText}>{row.body}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s }}>
            <Text style={muted}>{dateOf(row.created_at)}</Text>
            <Tag
              tone={row.seen ? 'good' : 'plain'}
              label={
                row.seen && row.seen_at
                  ? t('staff.checklists.suggestions.seenOn', { date: dateOf(row.seen_at) })
                  : t('staff.checklists.suggestions.notSeen')
              }
            />
          </View>
        </View>
      </Card>
    ));
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.checklists.suggestions.title') }} />
      <ScrollView
        contentContainerStyle={{ paddingTop: space.m, paddingBottom: 40 + insets.bottom, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
      >
        <Lead>{t('staff.checklists.suggestions.lead')}</Lead>

        <Card style={{ padding: space.m, gap: space.s }}>
          <Field
            testID="staff-suggestions.body"
            label={t('staff.checklists.suggestions.field')}
            value={body}
            onChangeText={(text) => {
              setBody(text);
              setIssue(null);
              setError(null);
            }}
            multiline
            boxStyle={MULTILINE_BOX}
            style={MULTILINE_TEXT}
            maxLength={BODY_MAX + 200}
            error={
              issue === 'required'
                ? t('staff.checklists.suggestions.errors.required')
                : issue === 'tooLong'
                  ? t('staff.checklists.suggestions.errors.tooLong')
                  : null
            }
          />
          <Hint style={{ marginTop: 0 }}>{t('staff.checklists.noGuestData')}</Hint>
          <ErrorText>{error}</ErrorText>
          <Button
            testID="staff-suggestions.submit"
            label={t('staff.checklists.suggestions.submit')}
            variant="primary"
            busy={send.isPending}
            disabled={venue === ''}
            onPress={onSend}
          />
        </Card>

        {mgmt ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingStart: 4, paddingEnd: 4, marginTop: space.s }}>
              <MicroLabel>{t('staff.checklists.suggestions.teamTitle')}</MicroLabel>
              {team.data && team.data.new_count > 0 ? (
                <Tag tone="info" label={t('staff.checklists.suggestions.newCount', { count: team.data.new_count })} />
              ) : null}
            </View>
            <SegmentedControl<SuggestionFilter>
              testID="staff-suggestions.filter"
              options={SUGGESTION_FILTERS.map((f) => ({ value: f, label: t(`staff.checklists.suggestions.filter.${f}`) }))}
              value={filter}
              onChange={setFilter}
            />
            {fromTeam()}
          </>
        ) : null}

        <MicroLabel style={{ paddingStart: 4, marginTop: space.s }}>
          {t('staff.checklists.suggestions.mine')}
        </MicroLabel>
        {yours()}
      </ScrollView>
    </Screen>
  );
}

export default function StaffSuggestionsRoute() {
  return (
    <RequireStaff>
      <SuggestionsScreen />
    </RequireStaff>
  );
}
