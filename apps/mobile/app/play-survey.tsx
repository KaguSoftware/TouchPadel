import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Button } from '../src/components/ui';
import { Rise, TiltPress } from '../src/components/motion';
import { CheckIcon } from '../src/components/icons';
import { SheetTextButton } from '../src/components/SheetButtons';
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
import { useOwnProfile, useSetAgeBand } from '../src/features/profile/hooks';
import { useSetMyGender } from '../src/features/matches/hooks';
import { errorCodeOf } from '../src/features/matches/errors';
import {
  AGE_BANDS,
  EMPTY_ANSWERS,
  GENDER_CHOICES,
  PLAY_LEVELS,
  PLAY_WANTS,
  PLAY_YEARS,
  genderToSave,
  nextStep,
  previousStep,
  consistentAnswers,
  parseAgeBand,
  stepIsRequired,
  surveyStepsFor,
  toggleWant,
  withLevel,
  yearsFitLevel,
  type AgeBand,
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
 *   1. level   REQUIRED (0368, Majed 2026-10-24): one tap, then Next. This
 *              step carries no Skip, and a run that ends without a level
 *              records nothing at all, so the next launch asks again — the
 *              question is unavoidable without ever trapping anyone.
 *   2. age     only while the profile has no band (an older account, or a
 *              social sign-in that skipped the form): one tap of six.
 *   3. years   one tap chooses and moves on
 *   4. wants   as many as they like, then Next (or Done when it is the last)
 *   5. gender  only while the profile has none: a tap chooses, Done saves.
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
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 15.5,
              color: colors.ink,
              textAlign: 'auto',
            }}
          >
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
  // The sheet's height: the old 0.86 detent's, near enough, and under the
  // largest a sheet may take (the screen less the status bar).
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.round(windowHeight * 0.82);
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
  // 0368: the band is asked here only while the profile has none. Latched like
  // the gender, so the step stays once this run has it.
  // A row cached before 0368, or a server without it, has no `age_band` key at
  // all: then the band is NOT KNOWN, and the step is not asked (the save would
  // have nowhere to land).
  const bandUnset =
    !!profile.data && 'age_band' in profile.data && parseAgeBand(profile.data.age_band) === null;
  const [askAge, setAskAge] = useState(bandUnset);
  if (bandUnset && !askAge) setAskAge(true);
  const steps = surveyStepsFor({ askGender, genderOnly, askAge: askAge && !editing });
  const lastStep = steps[steps.length - 1];

  const [answers, setAnswers] = useState<PlayAnswers>(() => answersOf(play));
  const [gender, setGenderChoice] = useState<GenderChoice | null>(null);
  const [band, setBand] = useState<AgeBand | null>(null);
  const [phase, setPhase] = useState<Phase>(
    genderOnly ? 'gender' : startAtWants ? 'wants' : 'level',
  );
  const [failed, setFailed] = useState(false);
  const save = useSavePlayProfile();
  const setGender = useSetMyGender();
  const setAgeBand = useSetAgeBand();
  // 0339: a tournament suggestion only while an open one fits the guest.
  const available = useSuggestionAvailability();
  const saving = save.isPending || setGender.isPending || setAgeBand.isPending;

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

  // Swiped away mid-survey: the same as Skip, with what was answered. Plain
  // async, because this runs as the screen goes and its hooks with it.
  useEffect(
    () => () => {
      if (editing || settled.current) return;
      settled.current = true;
      // 0368: the level is required, so a run swiped away before it is
      // answered stamps nothing — `play_survey_at` stays null and the next
      // launch asks again.
      if (latest.current.level === null) return;
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

  /** The band, once, and only when the profile has none: another device's answer stands. */
  const saveBand = async () => {
    if (!band || parseAgeBand(profile.data?.age_band) !== null) return;
    await setAgeBand.mutateAsync(band);
  };

  const finish = async (final: PlayAnswers) => {
    if (saving) return;
    settled.current = true;
    setFailed(false);
    try {
      // The gender alone leaves the play answers as they are. A retry after
      // the gender failed saves the play answers again, which changes nothing.
      if (!genderOnly) await save.mutateAsync(final);
      await saveBand();
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
      // Skip never shows on the level step, so a level is always answered by
      // the time this runs; a band chosen on the way is kept too.
      savePlayProfile(queryClient, latest.current).catch((error: unknown) =>
        captureException(error, { scope: 'playSurvey.skipSave' }),
      );
      void saveBand().catch((error: unknown) =>
        captureException(error, { scope: 'playSurvey.skipBand' }),
      );
    }
    back();
  };

  const goNext = (from: SurveyStep, next: PlayAnswers) => {
    const to = nextStep(steps, from);
    if (to) setPhase(to);
    else void finish(next);
  };

  // A tap only picks; Next moves on (Sait, 2026-10-20: "the user should press next").
  const choose = (step: 'level' | 'years', value: string) => {
    touched.current = true;
    // A new level drops a years answer it contradicts (advanced and "Not yet").
    const next =
      step === 'level'
        ? withLevel(answers, value as NonNullable<PlayAnswers['level']>)
        : ({ ...answers, years: value } as PlayAnswers);
    setAnswers(next);
  };

  const goBack = () => {
    if (phase === 'result') return;
    const prev = previousStep(steps, phase);
    if (prev) setPhase(prev);
  };

  const openFromResult = (kind: SuggestionKind) => {
    back();
    openSuggestion(kind);
  };

  const canGoBack = phase !== 'result' && previousStep(steps, phase) !== null;
  // Skip the first time only, and never on the required level step (0368);
  // editing closes with a swipe or a tap outside.
  const canSkip = !editing && phase !== 'result' && !stepIsRequired(phase);
  const question: Record<SurveyStep, MessageKey> = {
    level: 'playProfile.survey.level.question',
    age: 'playProfile.survey.age.question',
    years: 'playProfile.survey.years.question',
    wants: 'playProfile.survey.wants.question',
    gender: 'playProfile.survey.gender.question',
  };
  const hint: Partial<Record<SurveyStep, MessageKey>> = {
    age: 'playProfile.survey.age.hint',
    wants: 'playProfile.survey.wants.hint',
    gender: 'playProfile.survey.gender.hint',
  };
  const genderLabel: Record<GenderChoice, MessageKey> = {
    female: 'matches.gender.female',
    male: 'matches.gender.male',
  };

  // A sheet sized to this view (`fitToContents` in app/_layout.tsx), of a fixed
  // height, so Back, Next and the step dots sit at its foot on every step (Sait,
  // 2026-10-20). No scroll view: no step holds more than five tiles, and a
  // formSheet lays a scroll view out from its own top edge, under the grabber
  // and over the bar.
  return (
    <View style={{ height: sheetHeight, backgroundColor: colors.bg }}>
      <View>
        {/* The sheet's own bar: Skip, the first time only, the system's own button
            on iOS. Editing has no Cancel: a swipe down or a tap outside the sheet
            closes it unsaved. Back sits at the foot with the step dots and the
            step's button (Sait, 2026-10-20). Without Skip, the bar is only the
            room under the grabber. */}
        {canSkip ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingTop: space.xl,
              paddingStart: space.l,
              paddingEnd: space.l,
              minHeight: 44 + space.xl,
            }}
          >
            <SheetTextButton
              testID="play-survey.skip"
              label={t('playProfile.survey.skip')}
              onPress={skip}
            />
          </View>
        ) : (
          <View style={{ height: space.xxl }} />
        )}

        {/* The step's heading, under the bar. Keyed by step, so it rises in afresh. */}
        <View
          key={`head-${phase}`}
          style={{
            paddingStart: space.l,
            paddingEnd: space.l,
            paddingTop: space.s,
            paddingBottom: space.m,
          }}
        >
          {phase === 'result' ? (
            <Rise>
              <Text
                accessibilityRole="header"
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 24,
                  color: colors.ink,
                  textAlign: 'auto',
                }}
              >
                {t('playProfile.result.title')}
              </Text>
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
                {t('playProfile.result.body')}
              </Text>
            </Rise>
          ) : (
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
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 24,
                  color: colors.ink,
                  textAlign: 'auto',
                }}
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
          )}
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {/* Keyed by step, so each step's tiles rise in afresh. */}
        <View key={phase} style={{ gap: space.sm, paddingStart: space.l, paddingEnd: space.l }}>
          {phase === 'result' ? (
            <>
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
                : phase === 'age'
                  ? AGE_BANDS.map((v, i) => (
                      <Tile
                        key={v}
                        testID={`play-survey.age.${kebab(v)}`}
                        title={t(`profile.ageBand.${v}`)}
                        selected={band === v}
                        index={i + 1}
                        onPress={() => setBand(v)}
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
      </View>
      {/* The foot: the step dots, then Back and the step's button. */}
      <View
        style={{
          gap: space.m,
          paddingStart: space.l,
          paddingEnd: space.l,
          paddingTop: space.l,
          paddingBottom: space.xl + insets.bottom,
        }}
      >
        <View style={{ alignItems: 'center' }}>
          <Dots phase={phase} steps={steps} />
        </View>
        {failed ? (
          <Text
            style={{
              fontFamily: fonts.body600,
              fontSize: 13,
              color: colors.redtext,
              textAlign: 'center',
            }}
          >
            {t('playProfile.survey.saveFailed')}
          </Text>
        ) : null}
        {/* Back beside the step's button, the app's own buttons (Sait, 2026-10-20). */}
        <View style={{ flexDirection: 'row', gap: space.s }}>
          {canGoBack ? (
            <Button
              testID="play-survey.back"
              variant="secondary"
              label={t('common.back')}
              onPress={goBack}
              style={{ flex: 1 }}
            />
          ) : null}
          {phase === 'result' ? (
            <Button
              testID="play-survey.finish"
              label={t('common.done')}
              onPress={back}
              style={{ flex: 1 }}
            />
          ) : phase === lastStep ? (
            <Button
              testID="play-survey.done"
              label={t(failed ? 'common.retry' : editing ? 'common.save' : 'common.done')}
              busy={saving}
              onPress={() => void finish(answers)}
              style={{ flex: 1 }}
            />
          ) : phase !== 'gender' ? (
            // Off until a one-answer step is answered; wants may stay empty.
            <Button
              testID="play-survey.next"
              label={t('common.next')}
              disabled={
                phase === 'age' ? band === null : phase !== 'wants' && answers[phase] === null
              }
              onPress={() => goNext(phase, answers)}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
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
