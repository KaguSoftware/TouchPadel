import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDate } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useMyMatchBlocks, useUnblockPlayer } from '../src/features/matches/hooks';
import { displayName, type MatchBlock } from '../src/features/matches/logic';
import { matchErrorText } from '../src/features/matches/errors';
import { usePullRefresh } from '../src/lib/usePullRefresh';
import { radius, space, useTheme } from '../src/theme';
import { Button, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ConfirmAlert, useToast } from '../src/components/overlays';

/**
 * The players the guest blocked (docs/design/open-matches/guest.md §4.17),
 * from Profile. A block hides each side's open matches from the other and
 * is never told to the blocked player. Unblock asks first; block and unblock
 * are state-idempotent and take no key.
 */
function BlockedPlayersScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const blocks = useMyMatchBlocks();
  const unblock = useUnblockPlayer();
  const pull = usePullRefresh(blocks.refetch);
  const [asking, setAsking] = useState<{ blockId: string; name: string } | null>(null);

  const onUnblock = () => {
    const target = asking;
    setAsking(null);
    if (!target) return;
    unblock.mutate(target.blockId, {
      onSuccess: () => toast(t('matches.blocks.unblocked'), 'info'),
      onError: (err) => toast(matchErrorText(err, t, { locale }), 'error'),
    });
  };

  const row = (b: MatchBlock) => {
    const name = displayName(b, 'open', t);
    return (
      <View
        testID={`blocked-players.row.${b.blockId}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.button,
          paddingStart: space.m,
          paddingEnd: space.sm,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.body800, fontSize: 14, color: colors.ink }}>{name}</Text>
          {b.createdAt ? (
            <Text
              style={{
                fontFamily: fonts.body400,
                fontSize: 12.5,
                color: colors.mut2,
                marginTop: 2,
              }}
            >
              {t('matches.blocks.row', { date: formatDate(new Date(b.createdAt), locale) })}
            </Text>
          ) : null}
        </View>
        <Button
          testID={`blocked-players.row.${b.blockId}.unblock`}
          label={t('matches.blocks.unblock')}
          variant="secondary"
          size="compact"
          busy={unblock.isPending && unblock.variables === b.blockId}
          disabled={unblock.isPending}
          onPress={() => setAsking({ blockId: b.blockId, name })}
        />
      </View>
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('matches.blocks.title') }} />
      {!blocks.data ? (
        blocks.isError ? (
          <ErrorState
            testID="blocked-players.error"
            title={t('errors.loadFailedTitle')}
            message={matchErrorText(blocks.error, t, { locale })}
            retryLabel={t('common.retry')}
            onRetry={() => void blocks.refetch()}
            busy={blocks.isRefetching}
          />
        ) : (
          <SkeletonList rows={3} height={72} />
        )
      ) : (
        <FlatList
          testID="blocked-players.list"
          data={blocks.data}
          keyExtractor={(b) => b.blockId}
          renderItem={({ item }) => row(item)}
          ItemSeparatorComponent={() => <View style={{ height: space.s }} />}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: space.sm,
            paddingBottom: 40 + insets.bottom,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={pull.refreshing}
              onRefresh={pull.onRefresh}
              tintColor={colors.blue}
            />
          }
          ListEmptyComponent={
            <EmptyState
              testID="blocked-players.empty"
              fill
              title={t('matches.blocks.emptyTitle')}
              message={t('matches.blocks.empty')}
            />
          }
        />
      )}

      <ConfirmAlert
        visible={asking !== null}
        title={t('matches.blocks.unblockTitle', { name: asking?.name ?? '' })}
        body={t('matches.blocks.unblockBody')}
        confirmLabel={t('matches.blocks.unblock')}
        cancelLabel={t('common.keepIt')}
        onConfirm={onUnblock}
        onDismiss={() => setAsking(null)}
      />
    </Screen>
  );
}

export default function GuardedBlockedPlayersScreen() {
  return (
    <RequireSession>
      <BlockedPlayersScreen />
    </RequireSession>
  );
}
