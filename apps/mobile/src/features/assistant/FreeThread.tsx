/**
 * The free assistant's thread (owner call 2026-10-16): every staff role's only
 * assistant, and the owner's when they pick "The free AI". It finds pages and
 * explains how things work; it cannot see sales, bookings or any other data,
 * and the screen says so. No scopes, no models, no spend, no history list:
 * the thread lives here, in state, and the last turns go back with each
 * question because the server stores nothing (`assistant-free`).
 *
 * An answer that names a staff page earns up to three "Open <page>" buttons,
 * only for pages this person can open (the ones sent with the question).
 * The logic is `free.ts` (vitest); this file draws it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { countPhrase } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../theme';
import { Button, MicroLabel } from '../../components/ui';
import { SparkIcon } from '../../components/icons';
import { captureException } from '../../lib/telemetry';
import { useStaffStatus } from '../staff/StaffStatusProvider';
import { sendFreeQuestion } from './api';
import {
  FREE_STARTERS,
  FreeStreamError,
  answerPages,
  applyFreeEvent,
  buildFreeBody,
  freeErrorMessage,
  freePages,
  freeTurn,
  routeSegment,
  type FreeError,
  type FreeLiveTurn,
} from './free';
import { AnswerText, Composer, UserBubble } from './parts';

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** The thread's state machine: one turn per question, streamed, Stop aborts. */
function useFreeChat({
  route,
  lang,
  pages,
}: {
  route: string | null;
  lang: 'en' | 'ar';
  pages: ReturnType<typeof freePages>;
}) {
  const [turns, setTurns] = useState<FreeLiveTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  // The latest thread and arguments, for an ask fired from a press.
  const turnsRef = useRef(turns);
  const argsRef = useRef({ route, lang, pages });
  useEffect(() => {
    turnsRef.current = turns;
    argsRef.current = { route, lang, pages };
  });

  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => controller.current?.abort(), []);

  const ask = useCallback(async (text: string, replace?: number) => {
    const question = text.trim();
    if (question === '' || controller.current) return;
    const earlier = turnsRef.current.filter((t) => t.id !== replace);
    const id = nextId.current++;
    const ac = new AbortController();
    controller.current = ac;
    setStreaming(true);
    setTurns([...earlier, freeTurn(id, question)]);
    const patch = (fn: (t: FreeLiveTurn) => FreeLiveTurn) =>
      setTurns((cur) => cur.map((t) => (t.id === id ? fn(t) : t)));
    const { route: from, lang: l, pages: p } = argsRef.current;
    try {
      await sendFreeQuestion(buildFreeBody({ text: question, lang: l, route: from, earlier, pages: p }), {
        signal: ac.signal,
        onEvent: (name, data) => patch((t) => applyFreeEvent(t, name, data)),
      });
    } catch (err) {
      if (isAbort(err)) {
        patch((t) => ({ ...t, done: true, stopped: true }));
      } else {
        if (!(err instanceof FreeStreamError)) captureException(err, { scope: 'assistant.free.ask' });
        const info: FreeError = err instanceof FreeStreamError ? err.info : { code: 'UNKNOWN' };
        patch((t) => ({ ...t, done: true, error: t.error ?? info }));
      }
    } finally {
      controller.current = null;
      setStreaming(false);
      patch((t) => (t.done ? t : { ...t, done: true }));
    }
  }, []);

  return { turns, streaming, ask, stop };
}

export interface FreeThreadProps {
  /** `<route>` base (`staff-assistant`); the thread's controls extend it. */
  testID: string;
  /** The staff page the person came from, or null. */
  from: string | null;
  /** The owner only: back to the paid assistant. */
  onUsePaid?: () => void;
}

export function FreeThread({ testID, from, onUsePaid }: FreeThreadProps) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { status } = useStaffStatus();
  const role = status.kind === 'staff' ? status.staff.role : null;
  const lang = locale === 'ar' ? 'ar' : 'en';
  const pages = useMemo(() => (role ? freePages(role, (key) => t(key)) : []), [role, t]);
  const chat = useFreeChat({ route: from, lang, pages });
  const [draft, setDraft] = useState('');

  const send = (text: string) => {
    setDraft('');
    void chat.ask(text);
  };

  const scroller = useRef<ScrollView>(null);
  const last = chat.turns[chat.turns.length - 1];
  const tick = `${chat.turns.length}:${last?.text.length ?? 0}:${last?.done ? 1 : 0}`;
  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: true });
  }, [tick]);

  const errorText = (err: FreeError) => {
    const { message } = freeErrorMessage(err);
    return message.kind === 'minute'
      ? countPhrase('staff.assistant.free.errors.minute', message.seconds, locale)
      : t(message.key);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 56 + insets.top : 0}
    >
      <ScrollView
        ref={scroller}
        testID={`${testID}.thread`}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: space.l,
          paddingTop: space.m,
          paddingBottom: space.l,
          gap: space.l,
        }}
      >
        {chat.turns.length === 0 ? (
          <View style={{ gap: space.l, paddingTop: space.s }}>
            <View style={{ gap: space.s }}>
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  backgroundColor: colors.tint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SparkIcon size={23} color={colors.blue} />
              </View>
              <Text style={{ fontFamily: fonts.display800, fontSize: 24, lineHeight: 30, color: colors.ink }}>
                {t('staff.assistant.free.emptyTitle')}
              </Text>
              <Text
                testID={`${testID}.free.intro`}
                style={{ fontFamily: fonts.body400, fontSize: 16, lineHeight: 23, color: colors.mut }}
              >
                {t('staff.assistant.free.intro')}
              </Text>
            </View>
            <View style={{ gap: space.xs }}>
              <MicroLabel style={{ paddingStart: 4 }}>{t('staff.assistant.empty.try')}</MicroLabel>
              <View
                style={{
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.card,
                  overflow: 'hidden',
                }}
              >
                {FREE_STARTERS.map((id, i) => (
                  <Pressable
                    key={id}
                    testID={`${testID}.free.starter.${id}`}
                    accessibilityRole="button"
                    disabled={chat.streaming}
                    onPress={() => send(t(`staff.assistant.free.starters.${id}`))}
                    style={({ pressed }) => ({
                      paddingVertical: 16,
                      paddingHorizontal: space.l,
                      borderBottomWidth: i === FREE_STARTERS.length - 1 ? 0 : 1,
                      borderBottomColor: colors.sub,
                      backgroundColor: pressed ? colors.sub : 'transparent',
                    })}
                  >
                    <Text style={{ fontFamily: fonts.body600, fontSize: 16, lineHeight: 22, color: colors.ink }}>
                      {t(`staff.assistant.free.starters.${id}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        ) : null}

        {chat.turns.map((turn) => {
          const base = `${testID}.answer.${turn.id}`;
          const reading = !turn.done && turn.text === '';
          const links = turn.done && !turn.error ? answerPages(turn.text, pages) : [];
          const failure = turn.error ? freeErrorMessage(turn.error) : null;
          return (
            <View key={turn.id} style={{ gap: space.l }}>
              <UserBubble text={turn.question} />
              <View style={{ gap: space.s, maxWidth: '100%' }}>
                {turn.text !== '' || reading ? (
                  <View
                    testID={base}
                    style={{
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: radius.card,
                      borderStartStartRadius: 6,
                      paddingVertical: space.m,
                      paddingHorizontal: space.l,
                    }}
                  >
                    {reading ? (
                      <View
                        accessibilityRole="progressbar"
                        accessibilityLabel={t('staff.assistant.free.thinking')}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}
                      >
                        <ActivityIndicator size="small" color={colors.mut} />
                        <Text style={{ fontFamily: fonts.body600, fontSize: 15, color: colors.mut }}>
                          {t('staff.assistant.free.thinking')}
                        </Text>
                      </View>
                    ) : (
                      <AnswerText text={turn.text} unverified={[]} />
                    )}
                  </View>
                ) : null}
                {turn.stopped ? (
                  <Text style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 20, color: colors.mut }}>
                    {t('staff.assistant.free.stopped')}
                  </Text>
                ) : null}
                {links.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                    {links.map((page) => (
                      <Button
                        key={page.route}
                        testID={`${base}.open.${routeSegment(page.route)}`}
                        label={t('staff.assistant.free.open', { page: page.label })}
                        variant="secondary"
                        size="compact"
                        onPress={() => router.push(page.route as Href)}
                      />
                    ))}
                  </View>
                ) : null}
                {turn.error && failure ? (
                  <View style={{ gap: space.xs }}>
                    <Text
                      testID={`${base}.error`}
                      accessibilityRole="alert"
                      style={{ fontFamily: fonts.body600, fontSize: 14.5, lineHeight: 21, color: colors.redtext }}
                    >
                      {errorText(turn.error)}
                    </Text>
                    {failure.retry && turn.id === last?.id ? (
                      <View style={{ alignSelf: 'flex-start' }}>
                        <Button
                          testID={`${base}.retry`}
                          label={t('staff.assistant.free.retry')}
                          variant="secondary"
                          size="compact"
                          disabled={chat.streaming}
                          onPress={() => void chat.ask(turn.question, turn.id)}
                        />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={{ gap: space.s, paddingTop: space.s, paddingBottom: space.s + insets.bottom }}>
        {/* Always in view: what this assistant is, and (for the owner) the way back. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space.s,
            paddingHorizontal: space.l,
          }}
        >
          <Text
            testID={`${testID}.free.badge`}
            style={{ flexShrink: 1, fontFamily: fonts.body600, fontSize: 13, lineHeight: 18, color: colors.mut }}
          >
            {t('staff.assistant.free.badge')}
          </Text>
          {onUsePaid ? (
            <Pressable
              testID={`${testID}.free.use-paid`}
              accessibilityRole="button"
              hitSlop={10}
              disabled={chat.streaming}
              onPress={onUsePaid}
              style={({ pressed }) => ({ opacity: chat.streaming ? 0.4 : pressed ? 0.6 : 1 })}
            >
              <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.blue }}>
                {t('staff.assistant.free.usePaid')}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Composer
          testID={`${testID}.composer`}
          value={draft}
          onChange={setDraft}
          onSend={() => send(draft)}
          onStop={chat.stop}
          streaming={chat.streaming}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
