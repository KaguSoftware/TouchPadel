import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { Button, FormScreen, Hint, MicroLabel, Screen, SegmentedControl } from '../../src/components/ui';
import { useToast } from '../../src/components/overlays';
import { space, useTheme } from '../../src/theme';
import { RequireCoach } from '../../src/features/coach/RequireCoach';
import { mapErrorToKey } from '../../src/features/booking/errors';
import { useCoachRecord } from '../../src/features/ranks/hooks';
import { PlayerField, SetsInput } from '../../src/features/ranks/PlayerField';
import { buildScore, coachSeatsReady, normaliseUsername, type CoachWinner, type SetInput } from '../../src/features/ranks/logic';
import { useBack } from '../../src/navigation/back';
import { useBlueHeaderOptions } from '../../src/navigation/blueHeader';

type Seat = 'a1' | 'a2' | 'b1' | 'b2';
const SEATS: readonly Seat[] = ['a1', 'a2', 'b1', 'b2'];

/**
 * Enter a result (0444 `ranks_coach_record`, Majed 2026-11-16: "if they don't write it the
 * operator or coach can set it"): a game the coach watched, by the players' usernames, side A
 * and side B (each side's second player may be empty), who won or a draw, and the sets if
 * known. It is confirmed at once and counts like a desk entry; nobody else confirms it.
 */
function CoachModeResultScreen() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const toast = useToast();
  const back = useBack('/coach-mode');
  const headerOptions = useBlueHeaderOptions(t('coaching.coach.result.title'));
  const record = useCoachRecord();

  const [names, setNames] = useState<Record<Seat, string>>({ a1: '', a2: '', b1: '', b2: '' });
  const [known, setKnown] = useState<Record<Seat, boolean>>({ a1: false, a2: false, b1: false, b2: false });
  const [winner, setWinner] = useState<CoachWinner>('a');
  const [sets, setSets] = useState<SetInput[]>([
    ['', ''],
    ['', ''],
    ['', ''],
  ]);

  // One stable setter per seat, so a field's "is this a known player" effect runs only on change.
  const knownSetters = useMemo(() => {
    const mark = (seat: Seat) => (k: boolean) => setKnown((prev) => (prev[seat] === k ? prev : { ...prev, [seat]: k }));
    return { a1: mark('a1'), a2: mark('a2'), b1: mark('b1'), b2: mark('b2') };
  }, []);

  const ready = coachSeatsReady([names.a1, names.a2, names.b1, names.b2]);
  const score = buildScore(sets);
  // A filled seat must be a known player; an empty second seat is fine.
  const seatsKnown = SEATS.every((s) => known[s] || normaliseUsername(names[s]) === '');
  const canSend = ready === 'ready' && seatsKnown && score !== 'invalid';

  const send = () => {
    if (!canSend) return;
    record.mutate(
      { ...names, winner, score: score === 'invalid' ? null : score },
      {
        onSuccess: () => {
          toast(t('coaching.coach.result.saved'), 'success');
          back();
        },
        onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
      },
    );
  };

  const field = (seat: Seat) => (
    <PlayerField
      key={seat}
      label={t(seat.endsWith('1') ? 'coaching.coach.result.player1' : 'coaching.coach.result.player2')}
      testID={`coach-mode-result.${seat}`}
      value={names[seat]}
      onChange={(v) => setNames((p) => ({ ...p, [seat]: v }))}
      onKnown={knownSetters[seat]}
    />
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={headerOptions} />
      <FormScreen contentStyle={{ gap: space.xl, paddingTop: space.l }}>
        <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 20, color: colors.mut }}>
          {t('coaching.coach.result.intro')}
        </Text>

        <View style={{ gap: space.m }}>
          <MicroLabel>{t('coaching.coach.result.sideA')}</MicroLabel>
          {field('a1')}
          {field('a2')}
          <MicroLabel style={{ marginTop: space.s }}>{t('coaching.coach.result.sideB')}</MicroLabel>
          {field('b1')}
          {field('b2')}
          {ready === 'repeat' ? (
            <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.redtext }}>{t('ranks.report.repeat')}</Text>
          ) : (
            <Hint>{t('ranks.report.usernameHint')}</Hint>
          )}
        </View>

        <View style={{ gap: space.s }}>
          <MicroLabel>{t('coaching.coach.result.winner')}</MicroLabel>
          <SegmentedControl
            testID="coach-mode-result.winner"
            options={[
              { value: 'a', label: t('coaching.coach.result.winA') },
              { value: 'b', label: t('coaching.coach.result.winB') },
              { value: 'draw', label: t('coaching.coach.result.draw') },
            ]}
            value={winner}
            onChange={setWinner}
          />
        </View>

        <View style={{ gap: space.s }}>
          <MicroLabel>{t('ranks.report.score')}</MicroLabel>
          <SetsInput
            testID="coach-mode-result.set"
            sets={sets}
            onChange={setSets}
            invalid={score === 'invalid'}
            sideLabels={['a', 'b']}
          />
        </View>

        <Button
          testID="coach-mode-result.submit"
          label={t('coaching.coach.result.submit')}
          variant="cta"
          busy={record.isPending}
          disabled={!canSend || record.isPending}
          onPress={send}
        />
      </FormScreen>
    </Screen>
  );
}

export default function CoachModeResultRoute() {
  return (
    <RequireCoach>
      <CoachModeResultScreen />
    </RequireCoach>
  );
}
