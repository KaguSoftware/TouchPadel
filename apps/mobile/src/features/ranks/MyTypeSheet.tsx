import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button } from '../../components/ui';
import { useToast } from '../../components/overlays';
import { radius, space, useTheme } from '../../theme';
import { mapErrorToKey } from '../booking/errors';
import { useSetMyType } from './hooks';
import { TYPE_CODES, type TypeCode } from './logic';

/** A line under each choice: the play-survey's words for A/B/C, its own for New. */
const BODY = {
  advanced: 'playProfile.survey.level.advanced.body',
  intermediate: 'playProfile.survey.level.intermediate.body',
  beginner: 'playProfile.survey.level.beginner.body',
  new: 'ranks.myType.newBody',
} as const;

/**
 * The player picks their own type (0444 `set_my_play_level`, Majed 2026-11-16): Type A, B, C
 * or New, the values sent the stored codes. Open only while `touch.can_change_type`; a refusal
 * (RANKS_LEVEL_LOCKED once the desk or a coach checked them) shows in the phone's words.
 * A platform sheet, as the coach's level sheet is.
 */
export function MyTypeSheet({
  visible,
  current,
  provisionalGames,
  onClose,
  testID,
}: {
  visible: boolean;
  current: TypeCode | null;
  /** The rules' provisional_games, for "until you have played N games"; null without it. */
  provisionalGames: number | null;
  onClose: () => void;
  testID: string;
}) {
  const { t, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const save = useSetMyType();
  // Each opening starts from what is set now: the caller remounts the sheet per opening (`key`).
  const [picked, setPicked] = useState<TypeCode | null>(current);

  const submit = () => {
    if (!picked) return;
    save.mutate(picked, {
      onSuccess: () => {
        toast(t('ranks.myType.saved'), 'success');
        onClose();
      },
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'formSheet' : undefined}
      onRequestClose={onClose}
    >
      <View testID={testID} style={{ flex: 1, direction: dir, backgroundColor: colors.bg }}>
        <ScrollView
          contentContainerStyle={{
            paddingStart: space.xl,
            paddingEnd: space.xl,
            paddingTop: space.xxl,
            paddingBottom: 40 + insets.bottom,
            gap: space.m,
          }}
        >
          <Text style={{ fontFamily: fonts.display800, fontSize: 20, color: colors.ink }}>{t('ranks.myType.sheetTitle')}</Text>
          <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 20, color: colors.mut }}>
            {t('ranks.myType.sheetBody')}
          </Text>
          <View style={{ gap: space.s }} accessibilityRole="radiogroup">
            {TYPE_CODES.map((code) => {
              const on = picked === code;
              return (
                <Pressable
                  key={code}
                  testID={`${testID}.option.${code}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setPicked(code)}
                  style={{
                    paddingStart: space.m,
                    paddingEnd: space.m,
                    paddingTop: 12,
                    paddingBottom: 12,
                    gap: 2,
                    borderRadius: radius.button,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? colors.blue : colors.line,
                    backgroundColor: colors.card,
                  }}
                >
                  <Text style={{ fontFamily: on ? fonts.body800 : fonts.body700, fontSize: 15, color: colors.ink }}>
                    {t(`coaching.coach.level.type.${code}`)}
                  </Text>
                  <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: colors.mut2 }}>
                    {t(BODY[code])}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ fontFamily: fonts.body400, fontSize: 12, lineHeight: 18, color: colors.fnt }}>
            {provisionalGames !== null
              ? t('ranks.myType.sheetLock', { games: isolateLtr(String(provisionalGames)) })
              : t('ranks.myType.sheetLockNoNumbers')}
          </Text>
          <Button
            testID={`${testID}.save`}
            label={t('ranks.myType.save')}
            variant="cta"
            busy={save.isPending}
            disabled={!picked || picked === current || save.isPending}
            onPress={submit}
          />
          <Button
            testID={`${testID}.cancel`}
            label={t('common.cancel')}
            variant="secondary"
            disabled={save.isPending}
            onPress={onClose}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}
