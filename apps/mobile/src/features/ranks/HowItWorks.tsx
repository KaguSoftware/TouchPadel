import { Modal, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button } from '../../components/ui';
import { space, useTheme } from '../../theme';
import { howLines, type Board, type MyRanks, type HowLine } from './logic';

/**
 * "How ranking works" (0444, plan §2): the two numbers in plain words. The Touch Level is how
 * good you are and moves by who you beat; the Season Race is your best games this season. Every
 * number in it is the server's (`howLines` reads the board and the guest's page); a number the
 * server did not send leaves its sentence without one, never a guess.
 *
 * A platform sheet (iOS formSheet, Android full screen), as coach mode's level sheet is.
 */
export function HowItWorksSheet({
  visible,
  board,
  mine,
  onClose,
  testID,
}: {
  visible: boolean;
  board: Board | null | undefined;
  mine: MyRanks | null | undefined;
  onClose: () => void;
  testID: string;
}) {
  const { t, dir } = useLocale();
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { level, race } = howLines(board, mine);

  const say = (line: HowLine) =>
    t(
      line.key,
      Object.fromEntries(Object.entries(line.params ?? {}).map(([k, v]) => [k, isolateLtr(String(v))])),
    );

  const section = (title: string, lines: HowLine[], id: string) => (
    <View testID={`${testID}.${id}`} style={{ gap: space.s }}>
      <Text style={{ fontFamily: fonts.display800, fontSize: 17, color: colors.ink }}>{title}</Text>
      {lines.map((line) => (
        <Text key={line.key} style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 21, color: colors.mut2 }}>
          {say(line)}
        </Text>
      ))}
    </View>
  );

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
            gap: space.xl,
          }}
        >
          <View style={{ gap: space.s }}>
            <Text style={{ fontFamily: fonts.display800, fontSize: 22, color: colors.ink }}>{t('ranks.how.title')}</Text>
            <Text style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 21, color: colors.mut }}>
              {t('ranks.how.intro')}
            </Text>
          </View>
          {section(t('ranks.how.levelTitle'), level, 'level')}
          {section(t('ranks.how.raceTitle'), race, 'race')}
          <Button testID={`${testID}.close`} label={t('ranks.how.close')} variant="primary" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}
