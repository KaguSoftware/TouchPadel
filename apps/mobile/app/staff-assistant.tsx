import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_SCOPES, type AssistantScope } from '@touch/core/assistant/tools';
import { Text } from '../src/i18n/text';
import { useLocale } from '../src/i18n/LocaleProvider';
import { radius, space, useTheme } from '../src/theme';
import { Hint, MicroLabel, Screen } from '../src/components/ui';
import { ErrorState, SkeletonList } from '../src/components/states';
import { ClockIcon, PlusIcon, SlidersIcon, SparkIcon } from '../src/components/icons';
import { useToast } from '../src/components/overlays';
import { RequireStaff } from '../src/features/staff/RequireStaff';
import { useStaffStatus } from '../src/features/staff/StaffStatusProvider';
import {
  assistantKeys,
  fetchConversation,
  fetchMessages,
  fetchModels,
  setModel,
  setScopes,
} from '../src/features/assistant/api';
import {
  SUGGESTIONS,
  chatCostMicros,
  isModelNotPriced,
  normaliseScopes,
  refusedScopes,
  sourcesOf,
  textOfContent,
  toggleScope,
  type MessageRow,
} from '../src/features/assistant/chat';
import { useAssistantChat } from '../src/features/assistant/useAssistantChat';
import { Answer, Composer, ScopeChips, UserBubble } from '../src/features/assistant/parts';
import { SettingsSheet } from '../src/features/assistant/SettingsSheet';
import { captureException } from '../src/lib/telemetry';

/**
 * The owner's assistant on the phone (docs/design/assistant). One screen: the
 * thread, the scopes the chat may read as chips, the composer; the model and
 * what was spent sit behind the header's settings button (SettingsSheet). Reached from
 * the highlighted button on Today, owner only; the edge function
 * (`assistant-chat`) and RLS are the wall, this gate only keeps a page from
 * rendering a refusal.
 *
 * The record is the database: stored rows render the thread, the live turn
 * streams over it and gives way when its stored rows arrive. A new chat holds
 * its scopes here until the first question creates the row.
 */

const T = 'staff-assistant';

function AssistantThread({
  initialId,
  settingsOpen,
  onCloseSettings,
}: {
  initialId: string | null;
  settingsOpen: boolean;
  onCloseSettings: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { venueId } = useStaffStatus();

  const [conversationId, setConversationId] = useState<string | null>(initialId);
  const [newScopes, setNewScopes] = useState<AssistantScope[]>(() => normaliseScopes(DEFAULT_SCOPES));
  const [draft, setDraft] = useState('');
  // The model a chat that has no row yet will be created with (null = venue default).
  const [newModel, setNewModel] = useState<string | null>(null);

  const conversation = useQuery({
    queryKey: assistantKeys.conversation(conversationId ?? ''),
    queryFn: () => fetchConversation(conversationId!),
    enabled: conversationId !== null,
  });
  const messages = useQuery({
    queryKey: assistantKeys.messages(conversationId ?? ''),
    queryFn: () => fetchMessages(conversationId!),
    enabled: conversationId !== null,
  });

  const scopes = useMemo<AssistantScope[]>(
    () => (conversation.data ? normaliseScopes(conversation.data.scopes) : newScopes),
    [conversation.data, newScopes],
  );

  const modelsQ = useQuery({
    queryKey: assistantKeys.models,
    queryFn: fetchModels,
    staleTime: 5 * 60_000,
  });
  const models = modelsQ.data?.models ?? [];
  const chosenModel: string | null = conversationId ? (conversation.data?.model ?? null) : newModel;

  const changeModel = useMutation({
    mutationFn: async (next: string | null) => {
      if (conversationId) await setModel(conversationId, next);
      else setNewModel(next);
      return next;
    },
    onSuccess: () => {
      if (conversationId) {
        toast(t('staff.assistant.model.chatSaved'), 'success');
        void qc.invalidateQueries({ queryKey: assistantKeys.conversation(conversationId) });
        void qc.invalidateQueries({ queryKey: assistantKeys.conversations });
      }
    },
    onError: (err) => {
      if (!isModelNotPriced(err)) captureException(err, { scope: 'assistant.setModel' });
      toast(
        isModelNotPriced(err)
          ? t('staff.assistant.errors.ASSISTANT_MODEL_NOT_PRICED')
          : t('errors.generic'),
        'error',
      );
    },
  });

  const chat = useAssistantChat({
    conversationId,
    onConversation: setConversationId,
    scopes,
    model: chosenModel,
    venueId,
    lang: locale === 'ar' ? 'ar' : 'en',
  });

  const changeScopes = useMutation({
    mutationFn: async (next: AssistantScope[]) => {
      if (conversationId) await setScopes(conversationId, next);
      else setNewScopes(next);
      return next;
    },
    onSuccess: () => {
      if (conversationId) {
        void qc.invalidateQueries({ queryKey: assistantKeys.conversation(conversationId) });
        void qc.invalidateQueries({ queryKey: assistantKeys.conversations });
      }
    },
    onError: (err) => {
      captureException(err, { scope: 'assistant.setScopes' });
      toast(t('errors.generic'), 'error');
    },
  });

  const send = useCallback(
    (text: string, over?: readonly AssistantScope[]) => {
      setDraft('');
      void chat.ask(text, over);
    },
    [chat],
  );

  // A starter names the scopes it needs; asking it switches them on for the new
  // chat, so the chips above the composer say what the question will read.
  const ask = (text: string, needs: readonly AssistantScope[]) => {
    const next = normaliseScopes([...scopes, ...needs]);
    setNewScopes(next);
    send(text, next);
  };

  // "Cafe context is off for this chat" → Turn on Cafe → ask the same thing again.
  const [turningOn, setTurningOn] = useState(false);
  const turnOn = async (scope: AssistantScope) => {
    setTurningOn(true);
    try {
      await changeScopes.mutateAsync(normaliseScopes([...scopes, scope]));
      if (chat.lastQuestion) void chat.ask(chat.lastQuestion);
    } finally {
      setTurningOn(false);
    }
  };

  // The live turn is superseded once its stored rows are in the list.
  const stored: MessageRow[] = messages.data ?? [];
  const live = chat.live;
  const superseded =
    live !== null &&
    live.done &&
    !live.error &&
    !live.stopped &&
    live.assistantMessageId !== null &&
    stored.some((m) => m.id === live.assistantMessageId);
  const showLive = live !== null && !superseded;
  // A turn that failed half-way already has its question stored; the live bubble
  // shows it too, so the stored copy gives way (the last one, if it matches).
  const rows =
    showLive && stored.length > 0
      ? (() => {
          const last = stored[stored.length - 1]!;
          return last.role === 'user' && textOfContent(last.content) === live.userText
            ? stored.slice(0, -1)
            : stored;
        })()
      : stored;

  // Keep the newest thing in view as it arrives.
  const scroller = useRef<ScrollView>(null);
  const tick = `${rows.length}:${live?.text.length ?? 0}:${live?.tools.length ?? 0}:${live?.done ? 1 : 0}`;
  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: true });
  }, [tick]);

  const empty = conversationId === null && !live;
  const missing = conversationId !== null && conversation.isSuccess && conversation.data === null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 56 + insets.top : 0}
    >
      <ScrollView
        ref={scroller}
        testID={`${T}.thread`}
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
        {empty ? (
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
              <Text
                style={{ fontFamily: fonts.display800, fontSize: 24, lineHeight: 30, color: colors.ink }}
              >
                {t('staff.assistant.empty.title')}
              </Text>
              <Text
                style={{ fontFamily: fonts.body400, fontSize: 16, lineHeight: 23, color: colors.mut }}
              >
                {t('staff.assistant.empty.body')}
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
                {SUGGESTIONS.map((s, i) => (
                  <Pressable
                    key={s.id}
                    testID={`${T}.suggestion.${s.id}`}
                    accessibilityRole="button"
                    disabled={chat.streaming}
                    onPress={() => ask(t(`staff.assistant.suggestions.${s.id}`), s.scopes)}
                    style={({ pressed }) => ({
                      paddingVertical: 16,
                      paddingHorizontal: space.l,
                      borderBottomWidth: i === SUGGESTIONS.length - 1 ? 0 : 1,
                      borderBottomColor: colors.sub,
                      backgroundColor: pressed ? colors.sub : 'transparent',
                    })}
                  >
                    <Text style={{ fontFamily: fonts.body600, fontSize: 16, lineHeight: 22, color: colors.ink }}>
                      {t(`staff.assistant.suggestions.${s.id}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Hint>{t('staff.assistant.composer.billed')}</Hint>
          </View>
        ) : null}

        {conversationId !== null && messages.isPending && !live ? (
          <SkeletonList rows={3} height={72} />
        ) : null}
        {conversationId !== null && (messages.isError || conversation.isError) ? (
          <ErrorState
            testID={`${T}.error`}
            title={t('errors.loadFailedTitle')}
            message={t('staff.assistant.thread.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={() => {
              void messages.refetch();
              void conversation.refetch();
            }}
          />
        ) : null}
        {missing ? <Hint>{t('staff.assistant.thread.notFound')}</Hint> : null}

        {rows.map((m) => {
          const text = textOfContent(m.content);
          if (m.role === 'user') return <UserBubble key={m.id} text={text} />;
          const src = sourcesOf(m.sources);
          return (
            <Answer
              key={m.id}
              testID={`${T}.answer.${m.id}`}
              text={text}
              tools={src.items}
              gate={m.gate}
              jobProposed={src.hasJob}
              // A stored answer never offers "turn on": the question it would
              // re-ask is only known for the turn in front of the owner.
            />
          );
        })}

        {showLive && live ? (
          <>
            <UserBubble text={live.userText} />
            <Answer
              testID={`${T}.live`}
              text={live.text}
              tools={live.tools}
              gate={live.gate}
              streaming={!live.done}
              stopped={live.stopped}
              error={live.error}
              jobProposed={live.jobProposed}
              turnOn={
                live.done
                  ? refusedScopes(
                      live.tools.map((tool) => tool.error),
                      scopes,
                    )
                  : []
              }
              onTurnOn={(s) => void turnOn(s)}
              turningOn={turningOn}
              onRetry={chat.lastQuestion ? () => void chat.ask(chat.lastQuestion!) : undefined}
            />
          </>
        ) : null}
      </ScrollView>

      <View style={{ gap: space.s, paddingTop: space.s, paddingBottom: space.s + insets.bottom }}>
        <ScopeChips
          testID={`${T}.scope`}
          scopes={scopes}
          disabled={chat.streaming || changeScopes.isPending || missing}
          onToggle={(scope) => changeScopes.mutate(toggleScope(scopes, scope))}
        />
        <Composer
          testID={`${T}.composer`}
          value={draft}
          onChange={setDraft}
          onSend={() => send(draft)}
          onStop={chat.stop}
          streaming={chat.streaming}
        />
      </View>

      <SettingsSheet
        testID={`${T}.settings`}
        visible={settingsOpen}
        onClose={onCloseSettings}
        chatMicros={chatCostMicros(conversation.data)}
        models={models}
        defaultModel={modelsQ.data?.default_model ?? null}
        value={chosenModel}
        disabled={chat.streaming || changeModel.isPending || missing}
        onChange={(next) => {
          if (next !== chosenModel) changeModel.mutate(next);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function AssistantScreen() {
  const { t } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const fromParam = params.id && params.id !== '' ? params.id : null;

  // The thread owns its conversation id (a first question makes the row); the
  // screen only decides when to start over: a chat picked from the list, or
  // "New chat". Bumping `epoch` remounts the thread.
  const [session, setSession] = useState({ epoch: 0, id: fromParam });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const seen = useRef(fromParam);
  useEffect(() => {
    if (fromParam !== seen.current) {
      seen.current = fromParam;
      setSession((s) => ({ epoch: s.epoch + 1, id: fromParam }));
    }
  }, [fromParam]);

  const newChat = () => {
    seen.current = null;
    setSession((s) => ({ epoch: s.epoch + 1, id: null }));
    router.setParams({ id: '' });
  };

  return (
    <Screen edges={[]} padded={false}>
      <Stack.Screen
        options={{
          title: t('staff.assistant.title'),
          headerRight: () => (
            // Room at both ends: the native bar seats its right item hard against the
            // screen edge and the first icon against the title.
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.l,
                paddingHorizontal: space.m,
              }}
            >
              <Pressable
                testID={`${T}.settings-open`}
                accessibilityRole="button"
                accessibilityLabel={t('staff.assistant.settings.open')}
                hitSlop={10}
                onPress={() => setSettingsOpen(true)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <SlidersIcon size={24} color={colors.blue} />
              </Pressable>
              <Pressable
                testID={`${T}.chats`}
                accessibilityRole="button"
                accessibilityLabel={t('staff.assistant.chats.open')}
                hitSlop={10}
                onPress={() => router.push('/staff-assistant-chats')}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <ClockIcon size={24} color={colors.blue} />
              </Pressable>
              <Pressable
                testID={`${T}.new-chat`}
                accessibilityRole="button"
                accessibilityLabel={t('staff.assistant.chats.new')}
                hitSlop={10}
                onPress={newChat}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <PlusIcon size={24} color={colors.blue} />
              </Pressable>
            </View>
          ),
        }}
      />
      <AssistantThread
        key={session.epoch}
        initialId={session.id}
        settingsOpen={settingsOpen}
        onCloseSettings={() => setSettingsOpen(false)}
      />
    </Screen>
  );
}

export default function StaffAssistantRoute() {
  return (
    <RequireStaff roles={['owner']}>
      <AssistantScreen />
    </RequireStaff>
  );
}
