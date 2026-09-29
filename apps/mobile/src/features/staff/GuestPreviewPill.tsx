/**
 * "Back to staff view": floats over the guest tabs while a staff session is
 * looking at the guest app (guestPreview.ts), above the tab bar and clear of
 * the screens' own titles. One tap ends the preview; GuestTabsGate then sends
 * the session back to Today.
 */
import { Pressable, View } from 'react-native';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { radius, shadows, space, useTheme } from '../../theme';
import { BackArrowIcon } from '../../components/icons';
import { useTabBarHeight } from '../../components/useTabBarHeight';
import { setGuestPreview } from './guestPreview';

export function GuestPreviewPill() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const tabBar = useTabBarHeight();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', start: 0, end: 0, bottom: tabBar + space.sm, alignItems: 'center' }}
    >
      <Pressable
        testID="tabs.back-to-staff"
        accessibilityRole="button"
        accessibilityHint={t('staff.shell.guestView.note')}
        onPress={() => setGuestPreview(false)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          minHeight: 44,
          paddingStart: space.l,
          paddingEnd: space.l,
          borderRadius: radius.pill,
          backgroundColor: colors.ink,
          opacity: pressed ? 0.85 : 1,
          boxShadow: shadows.toast,
        })}
      >
        <BackArrowIcon size={16} color={colors.bg} />
        <Text style={{ fontFamily: fonts.body700, fontSize: 14, color: colors.bg }}>{t('staff.shell.guestView.back')}</Text>
      </Pressable>
    </View>
  );
}
