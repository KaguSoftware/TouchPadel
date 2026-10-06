/**
 * The chat's settings, behind the header's sliders button (owner, 2026-10-07):
 * what the assistant has spent (this month, this chat) and which model answers
 * the next question. The model used to sit above the composer; it is a setting
 * the owner changes rarely, so it no longer takes room from the thread.
 *
 * The platform's sheet on iOS (`formSheet`), a full-screen slide on Android,
 * as coach mode's accept sheet. The modal sits outside the app's direction
 * root, so it takes `dir`. The body mounts only while the sheet is open, so the
 * month's spend is read fresh each time it opens.
 */
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isolate } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../theme';
import { Button, Hint, MicroLabel } from '../../components/ui';
import { assistantKeys, fetchUsage } from './api';
import { formatUsd, modelName } from './chat';
import { ModelRow } from './parts';

export interface SettingsSheetProps {
  /** `<route>.settings`; the sheet's own controls extend it. */
  testID: string;
  visible: boolean;
  onClose: () => void;
  /** This chat's spend so far (0 for a chat with no answer yet). */
  chatMicros: number;
  models: readonly string[];
  defaultModel: string | null;
  /** The chat's model, or null for the venue default. */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

export function SettingsSheet(props: SettingsSheetProps) {
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'formSheet' : undefined}
      onRequestClose={props.onClose}
    >
      <SettingsBody {...props} />
    </Modal>
  );
}

/** The sheet's content, exported so a smoke test can render it without a modal. */
export function SettingsBody({
  testID,
  onClose,
  chatMicros,
  models,
  defaultModel,
  value,
  onChange,
  disabled,
}: SettingsSheetProps) {
  const { t, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const usage = useQuery({ queryKey: assistantKeys.usage, queryFn: fetchUsage, staleTime: 0 });

  const month = usage.data ? isolate(formatUsd(usage.data.monthMicros)) : '…';
  const cap =
    usage.data && usage.data.capMicros !== null
      ? t('staff.assistant.settings.cap', { cap: isolate(formatUsd(usage.data.capMicros)) })
      : null;

  const valueStyle = {
    fontFamily: fonts.body700,
    fontSize: 18,
    lineHeight: 24,
    color: colors.ink,
    fontVariant: ['tabular-nums' as const],
  };
  const labelStyle = { fontFamily: fonts.body600, fontSize: 16, lineHeight: 22, color: colors.ink };

  return (
    <View testID={testID} style={{ flex: 1, direction: dir, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: space.xl,
          paddingTop: space.xl,
          paddingBottom: space.s,
        }}
      >
        <Text style={{ fontFamily: fonts.display800, fontSize: 22, lineHeight: 28, color: colors.ink }}>
          {t('staff.assistant.settings.title')}
        </Text>
        <Pressable
          testID={`${testID}.done`}
          accessibilityRole="button"
          hitSlop={12}
          onPress={onClose}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ fontFamily: fonts.body700, fontSize: 17, color: colors.blue }}>
            {t('staff.assistant.settings.done')}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.xl,
          paddingTop: space.m,
          paddingBottom: 40 + insets.bottom,
          gap: space.xxl,
        }}
      >
        <View style={{ gap: space.s }}>
          <MicroLabel style={{ paddingStart: 4 }}>{t('staff.assistant.settings.spend')}</MicroLabel>
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.card,
            }}
          >
            <View
              testID={`${testID}.month`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.m,
                paddingVertical: space.m,
                paddingHorizontal: space.l,
                borderBottomWidth: 1,
                borderBottomColor: colors.sub,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={labelStyle}>{t('staff.assistant.settings.month')}</Text>
                {cap ? (
                  <Text style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 20, color: colors.mut }}>
                    {cap}
                  </Text>
                ) : null}
              </View>
              <Text style={valueStyle}>{usage.isError ? '—' : month}</Text>
            </View>
            <View
              testID={`${testID}.chat`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.m,
                paddingVertical: space.m,
                paddingHorizontal: space.l,
              }}
            >
              <Text style={[labelStyle, { flex: 1 }]}>{t('staff.assistant.settings.chat')}</Text>
              <Text style={valueStyle}>{isolate(formatUsd(chatMicros))}</Text>
            </View>
          </View>
          {usage.isError ? (
            <View style={{ gap: space.s, alignItems: 'flex-start', paddingStart: 4 }}>
              <Text style={{ fontFamily: fonts.body600, fontSize: 14, lineHeight: 20, color: colors.redtext }}>
                {t('staff.assistant.settings.loadFailed')}
              </Text>
              <Button
                testID={`${testID}.retry`}
                label={t('common.retry')}
                variant="secondary"
                size="compact"
                onPress={() => void usage.refetch()}
              />
            </View>
          ) : null}
        </View>

        {models.length > 0 ? (
          <View style={{ gap: space.s }}>
            <MicroLabel style={{ paddingStart: 4 }}>{t('staff.assistant.model.title')}</MicroLabel>
            <ModelRow
              testID={`${testID}.model`}
              models={models}
              value={value}
              disabled={disabled}
              onChange={onChange}
            />
            <Hint style={{ paddingStart: 4 }}>
              {defaultModel
                ? t('staff.assistant.model.defaultIs', { model: modelName(defaultModel) })
                : t('staff.assistant.model.next')}
            </Hint>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
