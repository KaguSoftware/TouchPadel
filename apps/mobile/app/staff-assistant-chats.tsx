import { RefreshControl, ScrollView, View, Pressable } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateTime } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button, Screen } from '../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../src/components/states';
import { ChevronIcon } from '../src/components/icons';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { assistantKeys, fetchConversations } from '../src/features/assistant/api';
import { normaliseScopes } from '../src/features/assistant/chat';
import { usePullRefresh } from '../src/lib/usePullRefresh';

/**
 * The owner's earlier assistant chats, newest first. A row opens that chat on
 * the assistant screen (`dismissTo` brings the existing screen forward with the
 * id rather than stacking a second one). Archiving stays on the desktop.
 */

const T = 'staff-assistant-chats';

function ChatsScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const list = useQuery({ queryKey: assistantKeys.conversations, queryFn: fetchConversations });
  const pull = usePullRefresh(async () => {
    await list.refetch();
  });
  const rows = list.data ?? [];

  const open = (id: string | null) =>
    router.dismissTo({ pathname: '/staff-assistant', params: { id: id ?? '' } });

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.assistant.chats.title') }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
      >
        <Button
          testID={`${T}.new`}
          label={t('staff.assistant.chats.new')}
          variant="primary"
          size="medium"
          onPress={() => open(null)}
        />

        {list.isPending ? <SkeletonList rows={4} height={64} /> : null}
        {list.isError ? (
          <ErrorState
            testID={`${T}.error`}
            title={t('errors.loadFailedTitle')}
            message={t('staff.assistant.chats.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => void list.refetch()}
          />
        ) : null}
        {list.isSuccess && rows.length === 0 ? (
          <EmptyState testID={`${T}.empty`} title={t('staff.assistant.chats.empty')} />
        ) : null}

        {rows.length > 0 ? (
          <View
            testID={`${T}.list`}
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card,
              overflow: 'hidden',
            }}
          >
            {rows.map((c, i) => {
              const reads = normaliseScopes(c.scopes)
                .map((s) => t(`staff.assistant.scopes.${s}`))
                .join(', ');
              return (
                <Pressable
                  key={c.id}
                  testID={`${T}.chat.${c.id}`}
                  accessibilityRole="button"
                  onPress={() => open(c.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.s,
                    paddingVertical: 12,
                    paddingHorizontal: space.l,
                    borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                    borderBottomColor: colors.sub,
                    backgroundColor: pressed ? colors.sub : 'transparent',
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      numberOfLines={2}
                      style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink }}
                    >
                      {c.title?.trim() || t('staff.assistant.chats.untitled')}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut }}
                    >
                      {formatDateTime(new Date(c.updated_at ?? c.created_at), locale)}
                      {reads ? ` · ${t('staff.assistant.chats.reads', { scopes: reads })}` : ''}
                    </Text>
                  </View>
                  <ChevronIcon size={16} color={colors.fnt2} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function StaffAssistantChatsRoute() {
  return (
    <RequireStaff roles={['owner']}>
      <ChatsScreen />
    </RequireStaff>
  );
}
