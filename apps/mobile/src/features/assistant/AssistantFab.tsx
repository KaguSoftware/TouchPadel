/**
 * The owner's assistant, one tap from every staff screen: a round button over
 * the bottom-right corner (the bottom-left in Arabic). Only the owner's staff
 * session gets it; the edge function and RLS refuse anyone else regardless.
 * It stays off the assistant's own screens and off every screen outside the
 * staff area (sign-in, the guest tabs), where it would cover the work. The
 * main panel (`/staff`) carries it in its header instead (AssistantButton),
 * where the floating one sat over Sign out.
 *
 * It is drawn per screen, by the root Stack's `screenLayout`
 * (withAssistantFab), not once over the navigator: a single overlay could only
 * follow the pathname, which changes after the navigation, so the button
 * appeared and vanished late on every push and pop (owner, 2026-10-09). Inside
 * the screen it moves with the page's own transition.
 */
import type { ReactElement } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../../i18n/LocaleProvider';
import { Text } from '../../i18n/text';
import { brand, radius, space, useTheme } from '../../theme';
import { SparkIcon } from '../../components/icons';
import { useStaffStatus } from '../staff/StaffStatusProvider';

const SIZE = 56;
const EDGE = 16;

/**
 * The button floats on staff pages only: not on the assistant's own, and not
 * on the main panel, whose header holds it.
 */
export function fabHidden(pathname: string): boolean {
  return (
    pathname === '/staff' ||
    pathname.startsWith('/staff-assistant') ||
    !pathname.startsWith('/staff')
  );
}

/**
 * The root Stack's `screenLayout`: a staff page's content with the floating
 * button over it. Every other screen, and a staff sheet (the button stays on
 * the page beneath it, as before), is returned untouched.
 */
export function withAssistantFab({
  route,
  options,
  children,
}: {
  route: { name: string };
  options: { presentation?: string };
  children: ReactElement;
}): ReactElement {
  const path = `/${route.name}`;
  const sheet = options.presentation !== undefined && options.presentation !== 'card';
  if (sheet || fabHidden(path)) return children;
  return (
    <View style={{ flex: 1 }}>
      {children}
      <AssistantFab path={path} />
    </View>
  );
}

/** `path` is the screen it is drawn in; without one, the current pathname. */
export function AssistantFab({ path }: { path?: string }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  if (fabHidden(path ?? pathname)) return null;
  return (
    <AssistantButton
      testID="staff.assistant.fab"
      style={{ position: 'absolute', end: EDGE, bottom: EDGE + insets.bottom }}
    />
  );
}

/**
 * The assistant button, in place; owner only, like the floating one. Round by
 * default; `labelled` makes it a flat pill with the word beside the spark, the
 * shape Today's greeting card carries (owner, 2026-10-09).
 */
export function AssistantButton({
  testID,
  size = SIZE,
  labelled = false,
  style,
}: {
  testID: string;
  size?: number;
  labelled?: boolean;
  style?: ViewStyle;
}) {
  const { t } = useLocale();
  const { fonts } = useTheme();
  const { status } = useStaffStatus();
  if (status.kind !== 'staff' || status.staff.role !== 'owner') return null;
  if (labelled) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('staff.assistant.entry.title')}
        accessibilityHint={t('staff.assistant.entry.hint')}
        onPress={() => router.push('/staff-assistant')}
        style={({ pressed }) => ({
          ...style,
          height: size,
          paddingStart: space.m,
          paddingEnd: space.m,
          borderRadius: radius.pill,
          backgroundColor: brand.blue,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: pressed ? 0.88 : 1,
        })}
      >
        <SparkIcon size={Math.round(size * 0.42)} color={brand.green} />
        <Text style={{ fontFamily: fonts.body800, fontSize: 13, color: brand.white }}>
          {t('staff.assistant.title')}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('staff.assistant.entry.title')}
      accessibilityHint={t('staff.assistant.entry.hint')}
      onPress={() => router.push('/staff-assistant')}
      style={({ pressed }) => ({
        ...style,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: brand.blue,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.88 : 1,
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      })}
    >
      <SparkIcon size={Math.round(size * 0.46)} color={brand.green} />
    </Pressable>
  );
}
