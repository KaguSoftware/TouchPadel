import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { splitSentence } from '../auth/linkedSentence';
import { brand, space, useTheme } from '../../theme';
import { CheckIcon } from '../../components/icons';

/**
 * The one consent checkbox: its sentence names both documents as links. Each
 * link opens that document alone (app/terms-review.tsx?doc=…); tapping
 * anywhere else on the row toggles the box.
 *
 * Derives its children's ids from `testID` (`<testID>.box`, `<testID>.link.terms`, `.link.privacy`).
 */
export function ConsentCheckbox({
  testID,
  checked,
  onToggle,
}: {
  testID: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.m }}
    >
      <View
        testID={`${testID}.box`}
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: checked ? brand.green : colors.fnt,
          backgroundColor: checked ? brand.green : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <CheckIcon size={13} color={brand.greenInk} strokeWidth={3} /> : null}
      </View>
      <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 13, lineHeight: 19, color: colors.ink }}>
        {splitSentence(t('auth.termsAgreeLinked')).map((part, i) =>
          part.kind === 'text' ? (
            part.text
          ) : (
            <Text
              key={i}
              testID={`${testID}.link.${part.name}`}
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/terms-review', params: { doc: part.name === 'privacy' ? 'privacy' : 'terms' } })}
              style={{ fontFamily: fonts.body700, color: colors.blue, textDecorationLine: 'underline' }}
            >
              {t(part.name === 'privacy' ? 'auth.privacyLink' : 'auth.termsLink')}
            </Text>
          ),
        )}
      </Text>
    </Pressable>
  );
}
