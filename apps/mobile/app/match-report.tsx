import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useReportPlayer } from '../src/features/matches/hooks';
import {
  byCategory,
  MATCH_CATEGORIES,
  REPORT_REASONS,
  type MatchCategory,
  type ReportReason,
} from '../src/features/matches/logic';
import { errorCodeOf, matchErrorText } from '../src/features/matches/errors';
import { useBack } from '../src/navigation/back';
import { radius, space, useTheme } from '../src/theme';
import { Button, ErrorText, FormScreen, MicroLabel, Screen } from '../src/components/ui';
import { useToast } from '../src/components/overlays';

const REASON_KEY: Record<ReportReason, MessageKey> = {
  offensive_name: 'matches.report.offensiveName',
  abusive_behaviour: 'matches.report.abusiveBehaviour',
  harassment: 'matches.report.harassment',
  unsafe_play: 'matches.report.unsafePlay',
  no_show: 'matches.report.noShow',
  other: 'matches.report.other',
};

/**
 * Report a player (docs/design/open-matches/guest.md §4.17): a modal, like
 * the terms gate, opened from a seat's or a request's menu on the match
 * screen. One reason, in the §1.3 order, and "Also block this player".
 *
 * The report goes to the venue's managers; the player is never told who
 * reported them. The server is state-idempotent (one report per reporter,
 * target and match), so a second send answers `duplicate` and thanks the
 * guest the same way.
 */
function MatchReportScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const back = useBack();
  const toast = useToast();
  const params = useLocalSearchParams<{
    matchId?: string;
    seatId?: string;
    requestId?: string;
    name?: string;
    category?: string;
  }>();
  const matchId = typeof params.matchId === 'string' && params.matchId ? params.matchId : null;
  const seatId = typeof params.seatId === 'string' && params.seatId ? params.seatId : null;
  const requestId =
    !seatId && typeof params.requestId === 'string' && params.requestId ? params.requestId : null;
  // Display only: the server finds the player from the seat or the request.
  const name =
    typeof params.name === 'string' && params.name ? params.name : t('matches.common.player');
  const category: MatchCategory = (MATCH_CATEGORIES as readonly string[]).includes(
    params.category ?? '',
  )
    ? (params.category as MatchCategory)
    : 'open';
  const report = useReportPlayer();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = !!matchId && (!!seatId || !!requestId);

  const onSubmit = () => {
    if (!valid || !reason) return;
    setError(null);
    report.mutate(
      { matchId: matchId!, reason, seatId, requestId, block: alsoBlock },
      {
        onSuccess: () => {
          toast(t('matches.report.thanks'));
          back();
        },
        onError: (err) => {
          if (errorCodeOf(err) === 'REPORT_TARGET_INVALID') {
            toast(t('matches.errors.reportTargetInvalid'), 'error');
            back();
            return;
          }
          setError(matchErrorText(err, t, { locale }));
        },
      },
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('matches.report.title', { name }) }} />
      <FormScreen contentStyle={{ paddingTop: space.l }}>
        <MicroLabel style={{ marginBottom: 6 }}>{t('matches.report.reasonLabel')}</MicroLabel>
        <View
          accessibilityRole="radiogroup"
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.button,
            overflow: 'hidden',
          }}
        >
          {REPORT_REASONS.map((code, i) => {
            const selected = reason === code;
            const label = t(
              code === 'no_show' ? byCategory(category, 'matches.report.noShow') : REASON_KEY[code],
            );
            return (
              <Pressable
                key={code}
                testID={`match-report.reason.${code}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={label}
                onPress={() => setReason(code)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  paddingStart: space.m,
                  paddingEnd: space.m,
                  paddingTop: 14,
                  paddingBottom: 14,
                  backgroundColor: pressed ? colors.sub : 'transparent',
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.sub,
                })}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: selected ? colors.blue : colors.line2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selected ? (
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: colors.blue,
                      }}
                    />
                  ) : null}
                </View>
                <Text
                  style={{ flex: 1, fontFamily: fonts.body600, fontSize: 14, color: colors.ink }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          testID="match-report.block-row"
          accessibilityRole="switch"
          accessibilityState={{ checked: alsoBlock }}
          onPress={() => setAlsoBlock((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.l }}
        >
          <Switch
            testID="match-report.block"
            value={alsoBlock}
            onValueChange={setAlsoBlock}
            trackColor={{ true: colors.blue, false: colors.line }}
            accessibilityLabel={t(byCategory(category, 'matches.report.block'))}
          />
          <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13.5, color: colors.ink }}>
            {t(byCategory(category, 'matches.report.block'))}
          </Text>
        </Pressable>

        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 12.5,
            lineHeight: 19,
            color: colors.mut2,
            marginTop: space.l,
          }}
        >
          {t(byCategory(category, 'matches.report.note'))}
        </Text>

        <ErrorText>{error}</ErrorText>

        <Button
          testID="match-report.submit"
          label={t('matches.report.submit')}
          variant="cta"
          busy={report.isPending}
          disabled={!valid || !reason}
          onPress={onSubmit}
          style={{ marginTop: space.m }}
        />
        <Button
          testID="match-report.cancel"
          label={t('common.cancel')}
          variant="ghost"
          onPress={back}
          style={{ marginTop: space.s }}
        />
      </FormScreen>
    </Screen>
  );
}

export default function GuardedMatchReportScreen() {
  return (
    <RequireSession>
      <MatchReportScreen />
    </RequireSession>
  );
}
