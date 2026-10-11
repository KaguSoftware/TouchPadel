import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button } from '../src/components/ui';
import { Rise, TiltPress } from '../src/components/motion';
import { BackChevronIcon, CheckIcon } from '../src/components/icons';
import { SuggestionRow, useOpenSuggestion } from '../src/components/forYou';
import { useToast } from '../src/components/overlays';
import { RequireSession } from '../src/features/auth/RequireSession';
import { useBack } from '../src/navigation/back';
import { captureException } from '../src/lib/telemetry';
import { savePlayProfile, usePlayProfile, useSavePlayProfile } from '../src/features/playProfile/hooks';
import {
  EMPTY_ANSWERS,
  PLAY_LEVELS,
  PLAY_WANTS,
  PLAY_YEARS,
  SURVEY_STEPS,
  nextStep,
  previousStep,
  toggleWant,
  type PlayAnswers,
  type PlayProfile,
  type SurveyStep,
} from '../src/features/playProfile/logic';
import { topSuggestions, type SuggestionKind } from '../src/features/playProfile/suggest';

/**
 * The play survey (docs/design/play-coaches/contracts-2026-10-11.md §8): the
 * platform's form sheet (app/_layout.tsx), three questions, one per step.
 *
 *   1. level   one tap chooses and moves on
 *   2. years   one tap chooses and moves on
 *   3. wants   as many as they like, then Done
 *
 * Skip sits in the corner of every step and ends the survey there, saving
 * what was answered (nothing answered is a skip, and the server stamps it, so
 * it never asks again). Swiping the sheet down counts as the same Skip. One
 * save, at the end. With answers, a short "Here's where to start" follows:
 * the top two suggestions (suggest.ts), each a way into the Play or Coaches
 * tab, and Done.
 *
 * `mode=edit` is Edit profile's "Your game" row and the Play strip's "Change
 * answers": the same steps prefilled, Cancel in place of Skip (it saves
 * nothing), Save at the end, no suggestions page.
 */

type Phase = SurveyStep | 'result';

/** Long enough to see the tile you tapped turn blue, short enough not to wait. */
const ADVANCE_MS = 240;
const RESULT_COUNT = 2;

const kebab = (value: string) => value.replace(/_/g, '-');

function answersOf(p: PlayProfile | null): PlayAnswers {
  return p ? { level: p.level, years: p.years, wants: p.wants } : EMPTY_ANSWERS;
}

function Dots({ phase }: { phase: Phase }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const at = phase === 'result' ? SURVEY_STEPS.length - 1 : SURVEY_STEPS.indexOf(phase);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('playProfile.survey.progress', {
        n: formatNumber(at + 1, locale),
        total: formatNumber(SURVEY_STEPS.length, locale),
      })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: phase === 'result' ? 0 : 1 }}
    >
      {SURVEY_STEPS.map((s, i) => (
        <View
          key={s}
          style={{
            width: i === at ? 18 : 7,
            height: 7,
            borderRadius: radius.pill,
            backgroundColor: i <= at ? colors.blue : colors.line2,
          }}
        />
      ))}
    </View>
  );
}

function Tile({
  testID,
  title,
  body,
  selected,
  multi,
  index,
  onPress,
}: {
  testID: string;
  title: string;
  body?: string;
  selected: boolean;
  multi?: boolean;
  index: number;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Rise index={index}>
      <TiltPress
        testID={testID}
        onPress={onPress}
        accessibilityRole={multi ? 'checkbox' : 'radio'}
        accessibilityState={multi ? { checked: selected } : { selected }}
        accessibilityLabel={body ? `${title}. ${body}` : title}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: body ? 68 : 56,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: space.sm,
          paddingBottom: space.sm,
          borderRadius: radius.card,
          borderWidth: 1.5,
          borderColor: selected ? colors.blue : colors.line,
          backgroundColor: selected ? colors.tint : colors.card,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 15.5, color: colors.ink, textAlign: 'auto' }}>
            {title}
          </Text>
          {body ? (
            <Text
              style={{
                marginTop: 2,
                fontFamily: fonts.body400,
                fontSize: 12.5,
                lineHeight: 17,
                color: colors.mut,
                textAlign: 'auto',
              }}
            >
              {body}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: multi ? 7 : radius.pill,
            borderWidth: selected ? 0 : 1.5,
            borderColor: colors.line2,
            backgroundColor: selected ? colors.blue : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <CheckIcon size={13} color={colors.card} /> : null}
        </View>
      </TiltPress>
    </Rise>
  );
}

function PlaySurvey() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const back = useBack();
  const openSuggestion = useOpenSuggestion();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const editing = mode === 'edit';

  const play = usePlayProfile();
  const [answers, setAnswers] = useState<PlayAnswers>(() => answersOf(play));
  const [phase, setPhase] = useState<Phase>('level');
  const [failed, setFailed] = useState(false);
  const save = useSavePlayProfile();

  // Edit mode opened before the profile landed: fill in once it does, unless
  // the guest has already started choosing.
  const touched = useRef(false);
  const known = play !== null;
  useEffect(() => {
    if (editing && known && !touched.current) setAnswers(answersOf(play));
    // Once, when the profile becomes known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, known]);

  // Saved, skipped or cancelled: nothing left for the unmount to do.
  const settled = useRef(false);
  const latest = useRef(answers);
  useEffect(() => {
    latest.current = answers;
  }, [answers]);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Swiped away mid-survey: the same as Skip, with what was answered. Plain
  // async, because this runs as the screen goes and its hooks with it.
  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      if (editing || settled.current) return;
      settled.current = true;
      savePlayProfile(queryClient, latest.current).catch((error: unknown) =>
        captureException(error, { scope: 'playSurvey.dismissSave' }),
      );
    },
    [editing, queryClient],
  );

  const finish = (final: PlayAnswers) => {
    settled.current = true;
    setFailed(false);
    save.mutate(final, {
      onSuccess: () => {
        if (editing) {
          toast(t('playProfile.survey.saved'), 'info');
          back();
        } else if (topSuggestions(final, RESULT_COUNT).length > 0) {
          setPhase('result');
        } else {
          back();
        }
      },
      onError: (error) => {
        // Not settled after all: a swipe now still saves.
        settled.current = false;
        setFailed(true);
        captureException(error, { scope: 'playSurvey.save' });
      },
    });
  };

  const skip = () => {
    settled.current = true;
    if (!editing) {
      // Fire and forget: the guest asked to be done, so the sheet goes now.
      savePlayProfile(queryClient, latest.current).catch((error: unknown) =>
        captureException(error, { scope: 'playSurvey.skipSave' }),
      );
    }
    back();
  };

  const goNext = (from: SurveyStep, next: PlayAnswers) => {
    const step = nextStep(from);
    if (step) setPhase(step);
    else finish(next);
  };

  const choose = (step: 'level' | 'years', value: string) => {
    if (advanceTimer.current) return;
    touched.current = true;
    const next = { ...answers, [step]: value } as PlayAnswers;
    setAnswers(next);
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      goNext(step, next);
    }, ADVANCE_MS);
  };

  const goBack = () => {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    if (phase === 'result') return;
    const prev = previousStep(phase);
    if (prev) setPhase(prev);
  };

  const openFromResult = (kind: SuggestionKind) => {
    back();
    openSuggestion(kind);
  };

  const canGoBack = phase === 'years' || phase === 'wants';
  const question: Record<SurveyStep, MessageKey> = {
    level: 'playProfile.survey.level.question',
    years: 'playProfile.survey.years.question',
    wants: 'playProfile.survey.wants.question',
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* The sheet's own bar: back, progress, and the way out, all always in reach. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: space.xl,
          paddingStart: space.s,
          paddingEnd: space.s,
          minHeight: 44 + space.xl,
        }}
      >
        <View style={{ width: 96, alignItems: 'flex-start' }}>
          {canGoBack ? (
            <Pressable
              testID="play-survey.back"
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              onPress={goBack}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <BackChevronIcon size={20} color={colors.ink} />
            </Pressable>
          ) : null}
        </View>
        <Dots phase={phase} />
        <View style={{ width: 96, alignItems: 'flex-end' }}>
          {phase !== 'result' ? (
            <Pressable
              testID="play-survey.skip"
              accessibilityRole="button"
              onPress={skip}
              hitSlop={8}
              style={({ pressed }) => ({
                minHeight: 44,
                justifyContent: 'center',
                paddingStart: space.sm,
                paddingEnd: space.sm,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.mut }}>
                {t(editing ? 'common.cancel' : 'playProfile.survey.skip')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: space.s,
          paddingBottom: space.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Keyed by step, so each step's tiles rise in afresh. */}
        <View key={phase} style={{ gap: space.sm }}>
          {phase === 'result' ? (
            <>
              <Rise>
                <Text
                  accessibilityRole="header"
                  style={{ fontFamily: fonts.display800, fontSize: 24, color: colors.ink, textAlign: 'auto' }}
                >
                  {t('playProfile.result.title')}
                </Text>
                <Text
                  style={{
                    marginTop: space.xs,
                    marginBottom: space.s,
                    fontFamily: fonts.body400,
                    fontSize: 13.5,
                    lineHeight: 19,
                    color: colors.mut,
                    textAlign: 'auto',
                  }}
                >
                  {t('playProfile.result.body')}
                </Text>
              </Rise>
              <View
                style={{
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.card,
                  overflow: 'hidden',
                }}
              >
                {topSuggestions(answers, RESULT_COUNT).map((s, i, all) => (
                  <Rise key={s.kind} index={i + 1}>
                    <SuggestionRow
                      testID={`play-survey.suggestion.${s.kind}`}
                      suggestion={s}
                      onPress={() => openFromResult(s.kind)}
                      last={i === all.length - 1}
                    />
                  </Rise>
                ))}
              </View>
            </>
          ) : (
            <>
              <Rise>
                {phase === 'level' && !editing ? (
                  <Text
                    style={{
                      marginBottom: space.xs,
                      fontFamily: fonts.body400,
                      fontSize: 13.5,
                      lineHeight: 19,
                      color: colors.mut,
                      textAlign: 'auto',
                    }}
                  >
                    {t('playProfile.survey.intro')}
                  </Text>
                ) : null}
                <Text
                  accessibilityRole="header"
                  style={{ fontFamily: fonts.display800, fontSize: 24, color: colors.ink, textAlign: 'auto' }}
                >
                  {t(question[phase])}
                </Text>
                {phase === 'wants' ? (
                  <Text
                    style={{
                      marginTop: space.xs,
                      fontFamily: fonts.body400,
                      fontSize: 13.5,
                      color: colors.mut,
                      textAlign: 'auto',
                    }}
                  >
                    {t('playProfile.survey.wants.hint')}
                  </Text>
                ) : null}
              </Rise>
              <View style={{ height: space.xs }} />
              {phase === 'level'
                ? PLAY_LEVELS.map((v, i) => (
                    <Tile
                      key={v}
                      testID={`play-survey.level.${kebab(v)}`}
                      title={t(`playProfile.survey.level.${v}.title`)}
                      body={t(`playProfile.survey.level.${v}.body`)}
                      selected={answers.level === v}
                      index={i + 1}
                      onPress={() => choose('level', v)}
                    />
                  ))
                : phase === 'years'
                  ? PLAY_YEARS.map((v, i) => (
                      <Tile
                        key={v}
                        testID={`play-survey.years.${kebab(v)}`}
                        title={t(`playProfile.survey.years.${v}`)}
                        selected={answers.years === v}
                        index={i + 1}
                        onPress={() => choose('years', v)}
                      />
                    ))
                  : PLAY_WANTS.map((v, i) => (
                      <Tile
                        key={v}
                        testID={`play-survey.wants.${kebab(v)}`}
                        title={t(`playProfile.survey.wants.${v}.title`)}
                        body={t(`playProfile.survey.wants.${v}.body`)}
                        selected={answers.wants.includes(v)}
                        multi
                        index={i + 1}
                        onPress={() => {
                          touched.current = true;
                          setAnswers((a) => ({ ...a, wants: toggleWant(a.wants, v) }));
                        }}
                      />
                    ))}
            </>
          )}
        </View>
      </ScrollView>

      <View
        style={{
          gap: space.s,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: space.sm,
          paddingBottom: space.sm + insets.bottom,
        }}
      >
        {failed ? (
          <Text style={{ fontFamily: fonts.body600, fontSize: 13, color: colors.redtext, textAlign: 'center' }}>
            {t('playProfile.survey.saveFailed')}
          </Text>
        ) : null}
        {phase === 'wants' ? (
          <Button
            testID="play-survey.done"
            label={t(failed ? 'common.retry' : editing ? 'common.save' : 'common.done')}
            busy={save.isPending}
            onPress={() => finish(answers)}
          />
        ) : phase === 'result' ? (
          <Button testID="play-survey.finish" label={t('common.done')} onPress={back} />
        ) : answers[phase] !== null ? (
          // Back on a step already answered, or editing: keep the answer and go on.
          <Button
            testID="play-survey.next"
            variant="secondary"
            label={t('common.next')}
            onPress={() => goNext(phase, answers)}
          />
        ) : null}
      </View>
    </View>
  );
}

export default function PlaySurveyScreen() {
  return (
    <RequireSession>
      <PlaySurvey />
    </RequireSession>
  );
}
