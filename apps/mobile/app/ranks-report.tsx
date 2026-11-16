import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useBack } from '../src/navigation/back';
import { formatDateTime, isolate, isolateLtr } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { RequireSession } from '../src/features/auth/RequireSession';
import { mapErrorToKey } from '../src/features/booking/errors';
import { useMyRanks, useReportGame } from '../src/features/ranks/hooks';
import { PlayerField, SetsInput } from '../src/features/ranks/PlayerField';
import { buildScore, normaliseUsername, playersReady, type SetInput } from '../src/features/ranks/logic';
import { Button, FormScreen, Hint, MicroLabel, Screen, SegmentedControl } from '../src/components/ui';
import { useToast } from '../src/components/overlays';
import { radius, space, useTheme } from '../src/theme';

type Slot = 'partner' | 'opponent1' | 'opponent2';
const SLOTS: readonly Slot[] = ['partner', 'opponent1', 'opponent2'];

/**
 * Add the score of a game the guest booked and played (migration 0364, `ranks_report`). Their
 * partner and the two opponents by username, who won, and the sets if they like. It goes to the
 * opponents to confirm; nothing counts until one of them does.
 */
function RanksReportScreen() {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const back = useBack('/ranks');
  const toast = useToast();
  const params = useLocalSearchParams<{ reservationId?: string; startAt?: string; courtEn?: string; courtAr?: string }>();
  const reservationId = typeof params.reservationId === 'string' ? params.reservationId : '';
  const my = useMyRanks(true);
  const report = useReportGame();
  const own = my.data?.enabled ? my.data.username : null;
  const recent = my.data?.enabled ? my.data.recent : [];

  const [names, setNames] = useState<Record<Slot, string>>({ partner: '', opponent1: '', opponent2: '' });
  const [known, setKnown] = useState<Record<Slot, boolean>>({ partner: false, opponent1: false, opponent2: false });
  const [won, setWon] = useState<'won' | 'lost'>('won');
  const [sets, setSets] = useState<SetInput[]>([
    ['', ''],
    ['', ''],
    ['', ''],
  ]);

  // One stable setter per place, so a field's "is this a known player" effect runs only on change.
  const knownSetters = useMemo(() => {
    const mark = (slot: Slot) => (k: boolean) =>
      setKnown((prev) => (prev[slot] === k ? prev : { ...prev, [slot]: k }));
    return { partner: mark('partner'), opponent1: mark('opponent1'), opponent2: mark('opponent2') };
  }, []);

  const usernames: [string, string, string] = [names.partner, names.opponent1, names.opponent2];
  const ready = playersReady(usernames, own);
  const score = buildScore(sets);
  const canSend = !!reservationId && ready === 'ready' && SLOTS.every((s) => known[s]) && score !== 'invalid';

  // A recent player fills the first empty place, and never a place twice.
  const taken = new Set(usernames.map(normaliseUsername));
  const fillRecent = (username: string) => {
    const slot = SLOTS.find((s) => normaliseUsername(names[s]) === '');
    if (!slot || taken.has(username)) return;
    setNames((prev) => ({ ...prev, [slot]: username }));
  };

  const court = locale === 'ar' ? params.courtAr || params.courtEn : params.courtEn;
  const when = params.startAt ? formatDateTime(new Date(params.startAt), locale) : '';

  const send = () => {
    if (!canSend) return;
    report.mutate(
      {
        reservationId,
        partner: names.partner,
        opponent1: names.opponent1,
        opponent2: names.opponent2,
        won: won === 'won',
        score: score === 'invalid' ? null : score,
      },
      {
        onSuccess: () => {
          toast(t('ranks.report.sent'), 'info');
          back();
        },
        onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
      },
    );
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t('ranks.report.title') }} />
      <FormScreen contentStyle={{ gap: space.xl, paddingTop: space.l }}>
        <View style={{ gap: space.xs }}>
          {court || when ? (
            <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>
              {[court, when].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 20, color: colors.mut }}>
            {t('ranks.report.intro')}
          </Text>
        </View>

        <View style={{ gap: space.m }}>
          <PlayerField
            label={t('ranks.report.partner')}
            testID="ranks-report.partner"
            value={names.partner}
            onChange={(v) => setNames((p) => ({ ...p, partner: v }))}
            onKnown={knownSetters.partner}
          />
          <MicroLabel style={{ marginTop: space.s }}>{t('ranks.report.opponents')}</MicroLabel>
          <PlayerField
            label={t('ranks.report.opponent1')}
            testID="ranks-report.opponent1"
            value={names.opponent1}
            onChange={(v) => setNames((p) => ({ ...p, opponent1: v }))}
            onKnown={knownSetters.opponent1}
          />
          <PlayerField
            label={t('ranks.report.opponent2')}
            testID="ranks-report.opponent2"
            value={names.opponent2}
            onChange={(v) => setNames((p) => ({ ...p, opponent2: v }))}
            onKnown={knownSetters.opponent2}
          />
          {ready === 'repeat' ? (
            <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.redtext }}>
              {t('ranks.report.repeat')}
            </Text>
          ) : null}
          {recent.length > 0 ? (
            <View style={{ gap: space.s }}>
              <MicroLabel>{t('ranks.report.recent')}</MicroLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {recent.map((p) => {
                  const used = taken.has(p.username);
                  return (
                    <Pressable
                      key={p.username}
                      testID={`ranks-report.recent.${p.username}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: used }}
                      disabled={used}
                      onPress={() => fillRecent(p.username)}
                      style={({ pressed }) => ({
                        paddingVertical: 7,
                        paddingHorizontal: space.sm,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: colors.line2,
                        backgroundColor: colors.card,
                        opacity: used ? 0.4 : pressed ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ fontFamily: fonts.body700, fontSize: 13, color: colors.ink }}>
                        {p.name ? isolate(p.name) : isolateLtr(`@${p.username}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            <Hint>{t('ranks.report.usernameHint')}</Hint>
          )}
        </View>

        <View style={{ gap: space.s }}>
          <MicroLabel>{t('ranks.report.whoWon')}</MicroLabel>
          <SegmentedControl
            testID="ranks-report.winner"
            options={[
              { value: 'won', label: t('ranks.report.weWon') },
              { value: 'lost', label: t('ranks.report.theyWon') },
            ]}
            value={won}
            onChange={setWon}
          />
        </View>

        <View style={{ gap: space.s }}>
          <MicroLabel>{t('ranks.report.score')}</MicroLabel>
          <SetsInput testID="ranks-report.set" sets={sets} onChange={setSets} invalid={score === 'invalid'} />
        </View>

        <Button
          testID="ranks-report.submit"
          label={t('ranks.report.submit')}
          variant="cta"
          busy={report.isPending}
          disabled={!canSend || report.isPending}
          onPress={send}
        />
      </FormScreen>
    </Screen>
  );
}

export default function GuardedRanksReportScreen() {
  return (
    <RequireSession>
      <RanksReportScreen />
    </RequireSession>
  );
}
