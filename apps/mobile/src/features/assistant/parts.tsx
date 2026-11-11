/**
 * The assistant's building blocks on the phone: the owner's bubble, the answer
 * (blocks, unverified figures, what was read, refusals), the scope chips and
 * the composer. Colours and type are the app's tokens; no raw hex, no physical
 * left/right. Every interactive element takes a `testID` from its call site
 * (`staff-assistant.<element>`).
 */
import { memo, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { isolate } from '@touch/i18n';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../theme';
import { Button, SegmentedControl } from '../../components/ui';
import { ArrowUpIcon, ChevronIcon, StopIcon } from '../../components/icons';
import {
  DEFAULT_MODEL_VALUE,
  PHONE_SCOPES,
  modelName,
  sourcesOf,
  textOfContent,
  type GatePayload,
  type MessageRow,
  type SourceItem,
} from './chat';
import { outcomeText } from '@touch/core/assistant/outcome';
import { parseBlocks, splitInline } from './blocks';
import { endingErrorKey, storedEnding, type Ending } from './thread';

// ── The answer's text ───────────────────────────────────────────────────────

function Inline({
  text,
  unverified,
  style,
}: {
  text: string;
  unverified: readonly string[];
  style: StyleProp<TextStyle>;
}) {
  const { colors, fonts } = useTheme();
  const segments = useMemo(() => splitInline(text, unverified), [text, unverified]);
  return (
    // Selectable: the owner copies a figure or a sentence out of an answer.
    <Text style={style} selectable>
      {segments.map((seg, i) => (
        <Text
          key={i}
          style={[
            seg.bold ? { fontFamily: fonts.body700 } : null,
            // An unchecked figure is a labelled mark, never colour alone: the
            // footnote under the answer says what the underline means.
            seg.unverified
              ? {
                  backgroundColor: colors.amb,
                  color: colors.ambtext,
                  textDecorationLine: 'underline',
                  textDecorationStyle: 'dotted',
                }
              : null,
          ]}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

const NUMERIC = /^[\d.,%\s-]+$/;

export const AnswerText = memo(function AnswerText({
  text,
  unverified,
}: {
  text: string;
  unverified: readonly string[];
}) {
  const { colors, fonts } = useTheme();
  const body: TextStyle = {
    fontFamily: fonts.body400,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  };
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <View style={{ gap: space.s }}>
      {blocks.map((b, bi) => {
        switch (b.kind) {
          case 'h':
            return (
              <Inline
                key={bi}
                text={b.text}
                unverified={unverified}
                style={[body, { fontFamily: fonts.body700 }]}
              />
            );
          case 'p':
            return b.lines.map((line, li) => (
              <Inline key={`${bi}-${li}`} text={line} unverified={unverified} style={body} />
            ));
          case 'ul':
          case 'ol':
            return (
              <View key={bi} style={{ gap: 4 }}>
                {b.items.map((item, li) => (
                  <View key={li} style={{ flexDirection: 'row', gap: space.s }}>
                    <Text style={[body, { minWidth: 18, color: colors.mut }]}>
                      {b.kind === 'ol' ? `${li + 1}.` : '•'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Inline text={item} unverified={unverified} style={body} />
                    </View>
                  </View>
                ))}
              </View>
            );
          case 'table':
            return (
              // A table is wider than a phone: it scrolls sideways inside the
              // answer rather than squeezing four columns into 300 points.
              <ScrollView
                key={bi}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -space.xs }}
                contentContainerStyle={{ paddingHorizontal: space.xs }}
              >
                <View>
                  {[b.header, ...b.rows].map((row, ri) => (
                    <View
                      key={ri}
                      style={{
                        flexDirection: 'row',
                        borderBottomWidth: ri === b.rows.length ? 0 : 1,
                        borderBottomColor: colors.line,
                      }}
                    >
                      {row.map((cell, ci) => (
                        <View key={ci} style={{ minWidth: 96, paddingVertical: 8, paddingEnd: space.m }}>
                          <Inline
                            text={cell}
                            unverified={unverified}
                            style={[
                              body,
                              { fontSize: 14.5, lineHeight: 20 },
                              ri === 0
                                ? { fontFamily: fonts.body700, color: colors.mut }
                                : NUMERIC.test(cell)
                                  ? { fontFamily: fonts.body600 }
                                  : null,
                            ]}
                          />
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
        }
      })}
    </View>
  );
});

// ── The owner's bubble ──────────────────────────────────────────────────────

export function UserBubble({ text }: { text: string }) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'flex-end',
        maxWidth: '85%',
        backgroundColor: colors.tint,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.card,
        borderEndEndRadius: 6,
        paddingVertical: 12,
        paddingHorizontal: space.m,
      }}
    >
      <Text style={{ fontFamily: fonts.body600, fontSize: 16, lineHeight: 24, color: colors.ink }}>
        {text}
      </Text>
    </View>
  );
}

// ── The answer ──────────────────────────────────────────────────────────────

export interface AnswerProps {
  /** `<route>.<element>` base the answer's own controls extend. */
  testID: string;
  text: string;
  tools: readonly (SourceItem & { pending?: boolean })[];
  gate: GatePayload | null;
  streaming?: boolean;
  /** How the turn ended (stored: from its tokens; live: from the stream). Drawn as one note. */
  ending?: Ending;
  /** The answer said a scope is off; one button each, each re-asks the last question. */
  turnOn?: readonly AssistantScope[];
  onTurnOn?: (scope: AssistantScope) => void;
  turningOn?: boolean;
  /** Ask again after an error; sends a new message only when pressed. */
  onRetry?: () => void;
}

export function Answer(props: AnswerProps) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const { text, tools, gate, streaming } = props;
  const ending: Ending = props.ending ?? { kind: 'ok' };
  const unverified = useMemo(() => gate?.unverified?.map((u) => u.raw) ?? [], [gate]);
  const reading = !!streaming && text === '';
  const showCard = text !== '' || reading;

  return (
    <View style={{ gap: space.s, maxWidth: '100%' }}>
      {showCard ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.card,
            borderStartStartRadius: 6,
            paddingVertical: space.m,
            paddingHorizontal: space.l,
            gap: space.s,
          }}
        >
          {reading ? (
            <View
              testID={`${props.testID}.reading`}
              accessibilityRole="progressbar"
              accessibilityLabel={t('staff.assistant.message.reading')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}
            >
              <ActivityIndicator size="small" color={colors.mut} />
              <Text style={{ fontFamily: fonts.body600, fontSize: 15, color: colors.mut }}>
                {t('staff.assistant.message.reading')}
              </Text>
            </View>
          ) : (
            <AnswerText text={text} unverified={unverified} />
          )}
          {unverified.length > 0 ? (
            <Text
              testID={`${props.testID}.unverified`}
              style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 19, color: colors.ambtext }}
            >
              {unverified.length === 1
                ? t('staff.assistant.message.unverifiedOne')
                : t('staff.assistant.message.unverifiedMany', { n: unverified.length })}
              {gate?.retried ? ` ${t('staff.assistant.message.gateRetried')}` : ''}
            </Text>
          ) : null}
        </View>
      ) : null}

      {ending.kind === 'stopped' ? (
        <Text
          testID={`${props.testID}.note`}
          style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 20, color: colors.mut }}
        >
          {t('staff.assistant.composer.stopped')}
        </Text>
      ) : null}

      {ending.kind === 'cut_short' || ending.kind === 'refused' ? (
        <Text
          testID={`${props.testID}.note`}
          style={{ fontFamily: fonts.body400, fontSize: 14.5, lineHeight: 21, color: colors.mut }}
        >
          {ending.kind === 'cut_short' ? t('staff.assistant.message.cutShort') : t('staff.assistant.message.refused')}
        </Text>
      ) : null}

      {ending.kind === 'job_proposed' ? (
        <Text
          testID={`${props.testID}.job`}
          style={{ fontFamily: fonts.body400, fontSize: 14.5, lineHeight: 21, color: colors.mut }}
        >
          {t('staff.assistant.message.job')}
        </Text>
      ) : null}

      {ending.kind === 'error' || ending.kind === 'connection' ? (
        <View style={{ gap: space.xs }}>
          <Text
            testID={`${props.testID}.error`}
            accessibilityRole="alert"
            style={{ fontFamily: fonts.body600, fontSize: 14.5, lineHeight: 21, color: colors.redtext }}
          >
            {t(
              `staff.assistant.errors.${endingErrorKey(ending.kind === 'error' ? ending.code : 'CONNECTION')}`,
            )}
          </Text>
          {props.onRetry ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                testID={`${props.testID}.retry`}
                label={t('staff.assistant.message.retry')}
                variant="secondary"
                size="compact"
                onPress={props.onRetry}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {props.turnOn && props.turnOn.length > 0 && props.onTurnOn ? (
        <View style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {props.turnOn.map((scope) => (
              <Button
                key={scope}
                testID={`${props.testID}.turn-on.${scope}`}
                label={t('staff.assistant.scopes.turnOn', { scope: t(`staff.assistant.scopes.${scope}`) })}
                variant="secondary"
                size="compact"
                busy={props.turningOn}
                onPress={() => props.onTurnOn?.(scope)}
              />
            ))}
          </View>
          <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 19, color: colors.mut }}>
            {t('staff.assistant.scopes.turnOnHint')}
          </Text>
        </View>
      ) : null}

      {!streaming && tools.length > 0 ? <SourcesRow testID={props.testID} tools={tools} /> : null}
    </View>
  );
}

/** "Sources read: 3", closed; open, one line per tool with its outcome. */
function SourcesRow({ testID, tools }: { testID: string; tools: readonly SourceItem[] }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Pressable
        testID={`${testID}.sources`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          alignSelf: 'flex-start',
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, color: colors.mut }}>
          {tools.length === 1
            ? t('staff.assistant.message.sourcesOne')
            : t('staff.assistant.message.sources', { n: tools.length })}
        </Text>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <ChevronIcon size={14} color={colors.mut} />
        </View>
      </Pressable>
      {open
        ? tools.map((tool) => (
            <View key={tool.call_id} style={{ flexDirection: 'row', gap: space.s, paddingStart: 2 }}>
              <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, color: colors.mut }}>
                {isolate(tool.name)}
              </Text>
              {tool.error ? (
                <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, color: colors.redtext }}>
                  {t('staff.assistant.message.failed')}
                </Text>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );
}

// ── A stored turn ───────────────────────────────────────────────────────────

/**
 * One stored row. Memoised on the row itself (react-query keeps its identity
 * between refetches that did not change it), so a token arriving in the live
 * turn re-renders none of these and re-parses none of their text.
 */
export const StoredTurn = memo(function StoredTurn({
  m,
  testID,
  retryText,
  onAsk,
}: {
  m: MessageRow;
  testID: string;
  /** The question to ask again, on the last row of a thread that failed; else null. */
  retryText: string | null;
  onAsk: (text: string) => void;
}) {
  const view = useMemo(() => {
    const text = textOfContent(m.content);
    return {
      text,
      shown: m.role === 'assistant' ? outcomeText(text) : text,
      tools: sourcesOf(m.sources).items,
      ending: m.role === 'assistant' ? storedEnding(m) : ({ kind: 'ok' } as Ending),
    };
  }, [m]);
  if (m.role === 'user') return <UserBubble text={view.text} />;
  return (
    <Answer
      testID={testID}
      text={view.shown}
      tools={view.tools}
      gate={m.gate}
      ending={view.ending}
      // A stored answer never offers "turn on": the question it would re-ask is only
      // known for the turn in front of the owner.
      onRetry={retryText !== null ? () => onAsk(retryText) : undefined}
    />
  );
});

// ── Scope chips ─────────────────────────────────────────────────────────────

/**
 * What the chat may read, as a row of toggles above the composer. A scope the
 * chat already carries but a phone does not offer (set on the desktop) shows
 * too, so the row never hides something that is on.
 */
export function ScopeChips({
  testID,
  scopes,
  onToggle,
  disabled,
}: {
  testID: string;
  scopes: readonly AssistantScope[];
  onToggle: (scope: AssistantScope) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const shown = [...PHONE_SCOPES, ...scopes.filter((s) => !PHONE_SCOPES.includes(s))];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: space.s, paddingHorizontal: space.l }}
      style={{ flexGrow: 0 }}
    >
      {shown.map((scope) => {
        const on = scopes.includes(scope);
        return (
          <Pressable
            key={scope}
            testID={`${testID}.${scope}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: !!disabled }}
            disabled={disabled}
            hitSlop={{ top: 6, bottom: 6 }}
            onPress={() => onToggle(scope)}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: 15,
              borderRadius: radius.pill,
              borderWidth: 1,
              // Selected is the brand green, with its black ink (11.85:1); off is
              // a plain card, so the chips read as on or off at a glance.
              borderColor: on ? brand.green : colors.line,
              backgroundColor: on ? brand.green : colors.card,
              opacity: disabled ? 0.55 : pressed ? 0.75 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: fonts.body700,
                fontSize: 14,
                color: on ? brand.greenInk : colors.ink,
              }}
            >
              {t(`staff.assistant.scopes.${scope}`)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── Model ───────────────────────────────────────────────────────────────────

/**
 * Which model answers the next question: "Default" (the venue's choice) and one
 * segment per model the pricing table can bill. Pick-one, so a segmented
 * control, not chips (those are on/off toggles). A chat that names no model
 * shows "Default"; an existing chat saves the choice at once. It lives in the
 * chat's settings sheet (SettingsSheet.tsx), full width, at the regular size.
 */
export function ModelRow({
  testID,
  models,
  value,
  onChange,
  disabled,
}: {
  testID: string;
  models: readonly string[];
  /** The chat's model, or null for the venue default. */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const options = [
    { value: DEFAULT_MODEL_VALUE, label: t('staff.assistant.model.default') },
    ...models.map((m) => ({ value: m, label: modelName(m) })),
  ];
  return (
    <View
      accessibilityLabel={t('staff.assistant.model.title')}
      style={{ opacity: disabled ? 0.55 : 1 }}
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      <SegmentedControl<string>
        testID={testID}
        options={options}
        value={value ?? DEFAULT_MODEL_VALUE}
        onChange={(next) => onChange(next === DEFAULT_MODEL_VALUE ? null : next)}
      />
    </View>
  );
}

// ── Composer ────────────────────────────────────────────────────────────────

export function Composer({
  testID,
  value,
  onChange,
  onSend,
  onStop,
  streaming,
}: {
  testID: string;
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const canSend = value.trim() !== '';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: space.s,
        marginHorizontal: space.l,
        paddingStart: space.m,
        paddingEnd: 6,
        paddingVertical: 6,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.line2,
        borderRadius: 26,
      }}
    >
      <TextInput
        testID={`${testID}.input`}
        value={value}
        onChangeText={onChange}
        placeholder={t('staff.assistant.composer.placeholder')}
        placeholderTextColor={colors.fnt}
        multiline
        editable={!streaming}
        // A thumb's keyboard has a Return key: it is a new line here, and Send is
        // the button, so a long question is never fired half-written.
        style={{
          flex: 1,
          maxHeight: 140,
          minHeight: 40,
          paddingTop: 9,
          paddingBottom: 9,
          fontFamily: fonts.body400,
          fontSize: 17,
          color: colors.ink,
        }}
      />
      {streaming ? (
        <Pressable
          testID={`${testID}.stop`}
          accessibilityRole="button"
          accessibilityLabel={t('staff.assistant.composer.stop')}
          onPress={onStop}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: colors.ink,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <StopIcon size={20} color={colors.ink} />
        </Pressable>
      ) : (
        <Pressable
          testID={`${testID}.send`}
          accessibilityRole="button"
          accessibilityLabel={t('staff.assistant.composer.send')}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={onSend}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: brand.blue,
            opacity: !canSend ? 0.35 : pressed ? 0.8 : 1,
          })}
        >
          <ArrowUpIcon size={20} color={brand.white} strokeWidth={2.4} />
        </Pressable>
      )}
    </View>
  );
}
