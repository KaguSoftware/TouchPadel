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
import {
  savePlayProfile,
  usePlayProfile,
  useSavePlayProfile,
  useSuggestionAvailability,
} from '../src/features/playProfile/hooks';
import { useOwnProfile } from '../src/features/profile/hooks';
import { useSetMyGender } from '../src/features/matches/hooks';
import { errorCodeOf } from '../src/features/matches/errors';
import {
  EMPTY_ANSWERS,
  GENDER_CHOICES,
  PLAY_LEVELS,
  PLAY_WANTS,
  PLAY_YEARS,
  genderToSave,
  nextStep,
  previousStep,
  consistentAnswers,
  surveyStepsFor,
  toggleWant,
  withLevel,
  yearsFitLevel,
  type GenderChoice,
  type PlayAnswers,
  type PlayProfile,
  type SurveyStep,
} from '../src/features/playProfile/logic';
import { topSuggestions, type SuggestionKind } from '../src/features/playProfile/suggest';

/**
 * The play survey (docs/design/play-coaches/contracts-2026-10-11.md §8): the
 * platform's form sheet (app/_layout.tsx), one question per step. It is the
 * one place the app asks about the player (2026-10-12); every question is
 * optional.
 *
 *   1. level   one tap chooses and moves on
 *   2. years   one tap chooses and moves on
 *   3. wants   as many as they like, then Next (or Done when it is the last)
 *   4. gender  only while the profile has none: a tap chooses, Done saves.
 *              Set once (OM-28, `set_my_gender`; the front desk corrects
 *              it), so it never saves on a tap, a Skip or a swipe, and
 *              "Prefer not to say" writes nothing.
 *
 * Skip sits in the corner of every step and ends the survey there, saving
 * what was answered (nothing answered is a skip, and the server stamps it, so
 * it never asks again). Swiping the sheet down counts as the same Skip. One
 * save, at the end. With answers, a short "Here's where to start" follows:
 * the top two suggestions (suggest.ts), each a way into the Play or Coaches
 * tab, and Done.
 *
 * `mode=edit` is Edit profile's "Your game" row, the Play strip's "Change
 * answers" and the Coaches tab's level line: the same steps prefilled, Cancel
 * in place of Skip (it saves nothing), Save at the end, no suggestions page.
 *
 * `step=wants` (with `mode=edit`) is the Join tab's "more suggestions" line:
 * the same edit, opened at "What are you after?", with Back to the others.
 *
 * `step=gender` is the match and tournament screens' way in when a women's or
 * men's game needs the answer (GENDER_REQUIRED): the gender alone, Cancel,
 * Save, and back to the game, which re-reads the profile.
 */

type Phase = SurveyStep | 'result';

/** Long enough to see the tile you tapped turn blue, short enough not to wait. */
const ADVANCE_MS = 240;
const RESULT_COUNT = 2;

const kebab = (value: string) => value.replace(/_/g, '-');

function answersOf(p: PlayProfile | null): PlayAnswers {
  return p ? consistentAnswers({ level: p.level, years: p.years, wants: p.wants }) : EMPTY_ANSWERS;
}

function Dots({ phase, steps }: { phase: Phase; steps: readonly SurveyStep[] }) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  const at = phase === 'result' ? steps.length - 1 : steps.indexOf(phase);
  // One question has no progress to show.
  const hidden = phase === 'result' || steps.length < 2;
  return (
    <View
      accessible={!hidden}
      accessibilityRole="progressbar"
      accessibilityLabel={t('playProfile.survey.progress', {
        n: formatNumber(at + 1, locale),
        total: formatNumber(steps.length, locale),
      })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: hidden ? 0 : 1 }}
    >
      {steps.map((s, i) => (
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
  disabled,
  index,
  onPress,
}: {
  testID: string;
  title: string;
  body?: string;
  selected: boolean;
  multi?: boolean;
  /** An answer that contradicts an earlier one: shown, dimmed, with its reason as the body. */
  disabled?: boolean;
  index: number;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Rise index={index}>
      <TiltPress
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        haptic={!disabled}
        accessibilityRole={multi ? 'checkbox' : 'radio'}
        accessibilityState={multi ? { checked: selected, disabled } : { selected, disabled }}
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
          opacity: disabled ? 0.45 : 1,
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
  const { mode, step } = useLocalSearchParams<{ mode?: string; step?: string }>();
  const genderOnly = step === 'gender';
  // `step=wants`: the Join tab's "more suggestions" line opens at that question.
  const startAtWants = step === 'wants' && !genderOnly;
  const editing = mode === 'edit' || genderOnly;

  const play = usePlayProfile();
  const profile = useOwnProfile(true);
  // null is "never answered"; a row cached by an older build has no `gender`
  // at all, and then only `step=gender` (sent by the server's refusal) asks.
  const genderUnset = profile.data?.gender === null;
  // Latched: once this run asks the gender, the step stays, even after the
  // save fills the profile in under it.
  const [askGender, setAskGender] = useState(genderUnset);
  if (genderUnset && !askGender) setAskGender(true);
  const steps = surveyStepsFor({ askGender, genderOnly });
  const lastStep = steps[steps.length - 1];

  const [answers, setAnswers] = useState<PlayAnswers>(() => answersOf(play));
  const [gender, setGenderChoice] = useState<GenderChoice | null>(null);
  const [phase, setPhase] = useState<Phase>(genderOnly ? 'gender' : startAtWants ? 'wants' : 'level');
  const [failed, setFailed] = useState(false);
  const save = useSavePlayProfile();
  const setGender = useSetMyGender();
  // 0339: a tournament suggestion only while an open one fits the guest.
  const available = useSuggestionAvailability();
  const saving = save.isPending || setGender.isPending;

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

  /** The gender, once, and only on Done: another device answering first is fine. */
  const saveGender = async () => {
    const value = genderToSave(gender);
    if (!value || profile.data?.gender) return;
    try {
      await setGender.mutateAsync(value);
    } catch (error) {
      if (errorCodeOf(error) !== 'GENDER_ALREADY_SET') throw error;
      toast(t('matches.errors.genderAlreadySet'), 'info');
    }
  };

  const finish = async (final: PlayAnswers) => {
    if (saving) return;
    settled.current = true;
    setFailed(false);
    try {
      // The gender alone leaves the play answers as they are. A retry after
      // the gender failed saves the play answers again, which changes nothing.
      if (!genderOnly) await save.mutateAsync(final);
      await saveGender();
    } catch (error) {
      // Not settled after all: a swipe now still saves.
      settled.current = false;
      setFailed(true);
      captureException(error, { scope: 'playSurvey.save' });
      return;
    }
    if (editing) {
      toast(t('playProfile.survey.saved'), 'info');
      back();
    } else if (topSuggestions(final, RESULT_COUNT, available).length > 0) {
      setPhase('result');
    } else {
      back();
    }
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
    const to = nextStep(steps, from);
    if (to) setPhase(to);
    else void finish(next);
  };

  const choose = (step: 'level' | 'years', value: string) => {
    if (advanceTimer.current) return;
    touched.current = true;
    // A new level drops a years answer it contradicts (advanced and "Not yet").
    const next =
      step === 'level'
        ? withLevel(answers, value as NonNullable<PlayAnswers['level']>)
        : ({ ...answers, years: value } as PlayAnswers);
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
    const prev = previousStep(steps, phase);
    if (prev) setPhase(prev);
  };

  const openFromResult = (kind: SuggestionKind) => {
    back();
    openSuggestion(kind);
  };

  const canGoBack = phase !== 'result' && previousStep(steps, phase) !== null;
  const question: Record<SurveyStep, MessageKey> = {
    level: 'playProfile.survey.level.question',
    years: 'playProfile.survey.years.question',
    wants: 'playProfile.survey.wants.question',
    gender: 'playProfile.survey.gender.question',
  };
  const hint: Partial<Record<SurveyStep, MessageKey>> = {
    wants: 'playProfile.survey.wants.hint',
    gender: 'playProfile.survey.gender.hint',
  };
  const genderLabel: Record<GenderChoice, MessageKey> = {
    female: 'matches.gender.female',
    male: 'matches.gender.male',
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
        <Dots phase={phase} steps={steps} />
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
                {topSuggestions(answers, RESULT_COUNT, available).map((s, i, all) => (
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
                {hint[phase] ? (
                  <Text
                    style={{
                      marginTop: space.xs,
                      fontFamily: fonts.body400,
                      fontSize: 13.5,
                      lineHeight: 19,
                      color: colors.mut,
                      textAlign: 'auto',
                    }}
                  >
                    {t(hint[phase])}
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
                  ? PLAY_YEARS.map((v, i) => {
                      const fits = yearsFitLevel(answers.level, v);
                      return (
                        <Tile
                          key={v}
                          testID={`play-survey.years.${kebab(v)}`}
                          title={t(`playProfile.survey.years.${v}`)}
                          body={
                            fits || !answers.level
                              ? undefined
                              : t('playProfile.survey.years.notWithLevel', {
                                  level: t(`playProfile.survey.level.${answers.level}.title`),
                                })
                          }
                          selected={answers.years === v}
                          disabled={!fits}
                          index={i + 1}
                          onPress={() => choose('years', v)}
                        />
                      );
                    })
                  : phase === 'wants'
                    ? PLAY_WANTS.map((v, i) => (
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
                      ))
                    : GENDER_CHOICES.map((v, i) => (
                        <Tile
                          key={v}
                          testID={`play-survey.gender.${v}`}
                          title={t(genderLabel[v])}
                          selected={gender === v}
                          index={i + 1}
                          onPress={() => setGenderChoice(v)}
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
        {phase === 'result' ? (
          <Button testID="play-survey.finish" label={t('common.done')} onPress={back} />
        ) : phase === lastStep ? (
          <Button
            testID="play-survey.done"
            label={t(failed ? 'common.retry' : editing ? 'common.save' : 'common.done')}
            busy={saving}
            onPress={() => void finish(answers)}
          />
        ) : phase === 'wants' || (phase !== 'gender' && answers[phase] !== null) ? (
          // Wants is never one tap; on a step already answered, or editing:
          // keep the answer and go on.
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
