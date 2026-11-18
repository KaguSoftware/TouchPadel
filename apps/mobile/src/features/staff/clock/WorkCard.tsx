/**
 * Today's work card (0442): at the top of the staff phone's Today, for
 * everyone but the owner. Whether the person has started, the shift running
 * now (or today's shifts), and ONE button: Start work when out, Finish work
 * when in. It opens the clock page; nothing here asks for location.
 *
 * Read on every visit to Today (focus) and after a scan (the clock page
 * invalidates `staffKeys.myClock`). A branch where logging is not set up
 * says so and offers no button.
 */
import { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useRouter } from '../../../navigation/useRouter';
import { useQuery } from '@tanstack/react-query';
import { formatTime, formatTimeRangeShort, type MessageKey } from '@touch/i18n';
import type { StaffRole } from '@touch/core';
import { Text } from '../../../i18n/text';
import { useLocale } from '../../../i18n/LocaleProvider';
import { space, useTheme } from '../../../theme';
import { Button, Card, LinkText } from '../../../components/ui';
import { Skeleton } from '../../../components/states';
import { ClockIcon } from '../../../components/icons';
import { staffKeys } from '../keys';
import { fetchMyClock } from './api';
import { actionKey, runningKey, workCard, type ShiftLine } from './logic';

/** The card's height while it loads, so Today's grid does not move when it lands. */
const CARD_MIN_H = 66;

function useLineText(line: ShiftLine): string {
  const { t, locale } = useLocale();
  const role = (r: StaffRole) => t(`op.roles.${r}` as MessageKey);
  switch (line.kind) {
    case 'running':
      return t(runningKey(line), {
        role: role(line.role),
        time: formatTime(new Date(line.until), locale),
        next: line.next ? role(line.next) : '',
      });
    case 'today':
      return t('staff.clock.card.today', {
        list: line.shifts
          .map((s) =>
            t('staff.clock.card.shift', {
              role: role(s.role),
              range: formatTimeRangeShort(new Date(s.starts), new Date(s.ends), locale),
            }),
          )
          .join(' · '),
      });
    case 'noShiftNow':
      return t('staff.clock.card.noShiftNow');
    case 'noHours':
      return t('staff.clock.card.noHoursToday');
  }
}

function LineText({ line }: { line: ShiftLine }) {
  const { colors, fonts } = useTheme();
  return (
    <Text
      testID="staff.clock.line"
      numberOfLines={2}
      style={{ fontFamily: fonts.body600, fontSize: 13, lineHeight: 18, color: colors.mut }}
    >
      {useLineText(line)}
    </Text>
  );
}

export function WorkCard({ venueId, mainRole }: { venueId: string; mainRole: StaffRole }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const clock = useQuery({
    queryKey: staffKeys.myClock(venueId),
    queryFn: () => fetchMyClock(venueId),
  });
  const { refetch } = clock;
  // Back on Today after a scan, or after a while away: read the day again.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const shell = { padding: space.sm, minHeight: CARD_MIN_H, justifyContent: 'center' as const };

  // A card already read stays up through a failed refetch (offline at the door); the
  // retry line is only for a card that never loaded.
  if (!clock.data && clock.isPending) {
    return (
      <Card style={[shell, { gap: 8 }]}>
        <View testID="staff.clock.loading" style={{ gap: 8 }}>
          <Skeleton height={16} width="45%" />
          <Skeleton height={12} width="70%" />
        </View>
      </Card>
    );
  }

  if (!clock.data) {
    return (
      <Card style={[shell, { flexDirection: 'row', alignItems: 'center', gap: space.m }]}>
        <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13, lineHeight: 18, color: colors.mut }}>
          {t('staff.clock.card.loadFailed')}
        </Text>
        <LinkText testID="staff.clock.retry" label={t('staff.clock.card.retry')} onPress={() => void refetch()} />
      </Card>
    );
  }

  const card = workCard(clock.data, mainRole);

  if (!card.ready) {
    return (
      <Card style={[shell, { flexDirection: 'row', alignItems: 'center', gap: space.sm }]}>
        <ClockIcon size={18} color={colors.mut} />
        <Text
          testID="staff.clock.not-ready"
          style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13, lineHeight: 18, color: colors.mut }}
        >
          {t('staff.clock.card.notReady')}
        </Text>
      </Card>
    );
  }

  const atWork = card.state === 'in';
  const headline =
    atWork && card.since
      ? t('staff.clock.card.atWorkSince', { time: formatTime(new Date(card.since), locale) })
      : t('staff.clock.card.notStarted');

  return (
    <Card
      style={[
        shell,
        { flexDirection: 'row', alignItems: 'center', gap: space.m },
        // At work is "here and now": the green tint, the one green surface on Today.
        atWork ? { backgroundColor: colors.gtint, borderColor: colors.gline } : null,
      ]}
    >
      <View testID="staff.clock" style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: atWork ? colors.gstrong : colors.fnt3,
            }}
          />
          <Text
            testID="staff.clock.state"
            numberOfLines={1}
            style={{ flexShrink: 1, fontFamily: fonts.display800, fontSize: 16, lineHeight: 21, color: colors.ink }}
          >
            {headline}
          </Text>
        </View>
        <LineText line={card.line} />
      </View>
      <Button
        testID="staff.clock.action"
        label={t(actionKey(card.action))}
        variant={atWork ? 'secondary' : 'primary'}
        size="compact"
        onPress={() => router.push({ pathname: '/staff-clock', params: { kind: card.action } })}
      />
    </Card>
  );
}
