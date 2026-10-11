import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase, formatIQD, type MessageKey } from '@touch/i18n';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../../src/theme';
import { Button, ErrorText, Field, Screen } from '../../src/components/ui';
import { EmptyState, ErrorState, SkeletonList } from '../../src/components/states';
import { PlusIcon, TrashIcon } from '../../src/components/icons';
import { useToast } from '../../src/components/overlays';
import { RequireStaff } from '../../src/features/staff/RequireStaff';
import { useStaffStatus } from '../../src/features/staff/StaffStatusProvider';
import { mapStaffError } from '../../src/features/staff/edge';
import { staffKeys } from '../../src/features/staff/keys';
import { Tag } from '../../src/features/staff/checklists/parts';
import {
  endStaffReward,
  fetchRewardsBoard,
  setStaffReward,
  type BoardPerson,
  type BoardReward,
} from '../../src/features/staff/rewards/api';
import { EMPTY_DRAFT, draftArgs, type RewardDraft } from '../../src/features/staff/rewards/logic';
import { usePullRefresh } from '../../src/lib/usePullRefresh';

/**
 * The owner's rewards (0332): for each waiter, cashier and manager at the
 * branch, the rewards set for them and their orders this month. People are
 * listed by name, never by count: this page sets rewards, it does not rank
 * anyone. A bonus reached is added to the person's wage for the month after
 * (0333, the server's sum; the phone never adds money up); the intro says so.
 */

const T = 'staff-rewards-admin';
const PRIZE_MAX = 80;

function PersonBlock({
  person,
  venueId,
  open,
  onOpen,
  onClose,
}: {
  person: BoardPerson;
  venueId: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RewardDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const id = `${T}.person.${person.staff_id}`;
  const orders = (n: number) => countPhrase('staff.rewards.orders', n, locale);
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: staffKeys.rewardsBoard(venueId) });

  const save = useMutation({
    mutationKey: staffKeys.mutation('reward.set'),
    mutationFn: setStaffReward,
    onSuccess: () => {
      toast(t('staff.rewards.admin.saved'), 'success');
      setDraft(EMPTY_DRAFT);
      setError(null);
      onClose();
      refresh();
    },
    // A retried save whose first try landed is refused (REWARD_TARGET_TAKEN):
    // refresh, so the list shows the reward the message is about.
    onError: (err) => {
      setError(t(mapStaffError(err)));
      refresh();
    },
  });
  const end = useMutation({
    mutationKey: staffKeys.mutation('reward.end'),
    mutationFn: endStaffReward,
    onSuccess: () => {
      toast(t('staff.rewards.admin.removed'), 'success');
      refresh();
    },
    // A retried remove whose first try landed is refused (REF_NOT_FOUND):
    // refresh, so the removed row goes.
    onError: (err) => {
      toast(t(mapStaffError(err)), 'error');
      refresh();
    },
  });

  const onSave = () => {
    if (save.isPending) return;
    const out = draftArgs(draft, venueId, person.staff_id);
    if ('error' in out) {
      setError(t(out.error));
      return;
    }
    setError(null);
    save.mutate(out.args);
  };

  const confirmRemove = (r: BoardReward) => {
    if (end.isPending) return;
    Alert.alert(
      t('staff.rewards.admin.removeTitle'),
      t('staff.rewards.admin.removeBody', { name: person.name, orders: orders(r.target) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('staff.rewards.admin.remove'),
          style: 'destructive',
          onPress: () => end.mutate(r.id),
        },
      ],
    );
  };

  const role = t(`op.roles.${person.role}` as MessageKey);
  const rewards = [...person.rewards].sort((a, b) => a.target - b.target);

  return (
    <View
      testID={id}
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        overflow: 'hidden',
      }}
    >
      {/* Who, and their month so far. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingTop: space.m,
          paddingBottom: space.sm,
          paddingHorizontal: space.l,
        }}
      >
        <View style={{ flex: 1, gap: 1 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.display800, fontSize: 15.5, color: colors.ink }}
          >
            {person.name}
          </Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 12.5, color: colors.mut }}>
            {role}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 1 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
            {t('staff.rewards.admin.thisMonth', { orders: orders(person.count) })}
          </Text>
          <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.fnt }}>
            {t('staff.rewards.admin.lastMonth', { orders: orders(person.last_month_count) })}
          </Text>
        </View>
      </View>

      {/* Their rewards, lowest target first. */}
      {rewards.length === 0 && !open ? (
        <Text
          style={{
            paddingHorizontal: space.l,
            paddingBottom: space.s,
            fontFamily: fonts.body400,
            fontSize: 13,
            color: colors.fnt,
          }}
        >
          {t('staff.rewards.admin.none')}
        </Text>
      ) : null}
      {rewards.map((r) => {
        const reached = person.count >= r.target;
        const what = [r.reward_iqd > 0 ? formatIQD(r.reward_iqd, locale) : null, r.prize]
          .filter(Boolean)
          .join(' · ');
        return (
          <View
            key={r.id}
            testID={`${id}.reward.${r.id}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingVertical: 10,
              paddingStart: space.l,
              paddingEnd: space.s,
              borderTopWidth: 1,
              borderTopColor: colors.sub,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.ink }}>
                {t('staff.rewards.admin.at', { orders: orders(r.target) })}
              </Text>
              <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.gtext }}>
                {what}
              </Text>
            </View>
            {reached ? <Tag label={t('staff.rewards.admin.reached')} tone="good" /> : null}
            <Pressable
              testID={`${id}.reward.${r.id}.remove`}
              accessibilityRole="button"
              accessibilityLabel={t('staff.rewards.admin.remove')}
              hitSlop={8}
              onPress={() => confirmRemove(r)}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: radius.cell,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? colors.sub : 'transparent',
              })}
            >
              <TrashIcon size={16} color={colors.mut} />
            </Pressable>
          </View>
        );
      })}

      {/* Add a reward: the form opens in place, one person at a time. */}
      {open ? (
        <View
          style={{
            gap: space.sm,
            padding: space.l,
            borderTopWidth: 1,
            borderTopColor: colors.sub,
            backgroundColor: colors.bg,
          }}
        >
          <Field
            testID={`${id}.target`}
            label={t('staff.rewards.admin.target')}
            keyboardType="number-pad"
            value={draft.target}
            onChangeText={(v) => setDraft((d) => ({ ...d, target: v }))}
            dense
          />
          <Field
            testID={`${id}.bonus`}
            label={t('staff.rewards.admin.bonus')}
            keyboardType="number-pad"
            value={draft.bonus}
            onChangeText={(v) => setDraft((d) => ({ ...d, bonus: v }))}
            dense
          />
          <Field
            testID={`${id}.prize`}
            label={t('staff.rewards.admin.prize')}
            placeholder={t('staff.rewards.admin.prizePlaceholder')}
            maxLength={PRIZE_MAX}
            value={draft.prize}
            onChangeText={(v) => setDraft((d) => ({ ...d, prize: v }))}
            dense
          />
          <ErrorText>{error}</ErrorText>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              testID={`${id}.cancel`}
              label={t('staff.rewards.admin.cancel')}
              variant="secondary"
              size="compact"
              style={{ flex: 1 }}
              onPress={() => {
                setDraft(EMPTY_DRAFT);
                setError(null);
                onClose();
              }}
            />
            <Button
              testID={`${id}.save`}
              label={t('staff.rewards.admin.save')}
              size="compact"
              style={{ flex: 1 }}
              busy={save.isPending}
              onPress={onSave}
            />
          </View>
        </View>
      ) : (
        <Pressable
          testID={`${id}.add`}
          accessibilityRole="button"
          onPress={() => {
            // Every opening starts empty: another person's form closing this one
            // keeps no stale values or message.
            setDraft(EMPTY_DRAFT);
            setError(null);
            onOpen();
          }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minHeight: 44,
            paddingHorizontal: space.l,
            borderTopWidth: 1,
            borderTopColor: colors.sub,
            backgroundColor: pressed ? colors.sub : 'transparent',
          })}
        >
          <PlusIcon size={15} color={colors.blue} />
          <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.blue }}>
            {t('staff.rewards.admin.add')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function RewardsAdminScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { venueId } = useStaffStatus();
  const venue = venueId ?? '';
  const board = useQuery({
    queryKey: staffKeys.rewardsBoard(venue),
    queryFn: () => fetchRewardsBoard(venue),
    enabled: venueId !== null,
  });
  const pull = usePullRefresh(async () => {
    await board.refetch();
  });
  const [openFor, setOpenFor] = useState<string | null>(null);
  const people = board.data?.people ?? [];

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('staff.rewards.admin.title') }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.sm,
        }}
      >
        <Text
          testID={`${T}.intro`}
          style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 19, color: colors.mut }}
        >
          {t('staff.rewards.admin.intro')}
        </Text>

        {board.isPending && venueId !== null ? <SkeletonList rows={3} height={120} /> : null}
        {board.isError ? (
          <ErrorState
            testID={`${T}.error`}
            title={t('errors.loadFailedTitle')}
            message={t('staff.rewards.admin.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => void board.refetch()}
          />
        ) : null}
        {board.isSuccess && people.length === 0 ? (
          <EmptyState testID={`${T}.empty`} title={t('staff.rewards.admin.empty')} />
        ) : null}

        {people.map((p) => (
          <PersonBlock
            key={p.staff_id}
            person={p}
            venueId={venue}
            open={openFor === p.staff_id}
            onOpen={() => setOpenFor(p.staff_id)}
            onClose={() => setOpenFor((cur) => (cur === p.staff_id ? null : cur))}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

export default function StaffRewardsAdminRoute() {
  return (
    <RequireStaff roles={['owner']}>
      <RewardsAdminScreen />
    </RequireStaff>
  );
}
