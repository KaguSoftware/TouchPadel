/**
 * The assistant, one tap from every staff screen: a round button over the
 * bottom-right corner (the bottom-left in Arabic). Every staff role gets it
 * (owner call 2026-10-16): the owner opens the paid assistant (or the free
 * one, if they picked it), everyone else the free assistant only, which finds
 * pages and explains how things work and reads no data; the edge functions
 * are the wall either way (`assistant-chat` is owner-only). It stays off the assistant's own screens and off every screen outside the
 * staff area (sign-in, the guest tabs), where it would cover the work. The
 * main panel (`/staff`) carries it in its header instead (AssistantButton),
 * where the floating one sat over Sign out.
 *
 * It is drawn per screen, by the (staff) Stack's `screenLayout`
 * (withAssistantFab), not once over the navigator: a single overlay could only
 * follow the pathname, which changes after the navigation, so the button
 * appeared and vanished late on every push and pop (owner, 2026-10-09). Inside
 * the screen it moves with the page's own transition.
 */
import { useEffect, type ReactElement } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../../i18n/LocaleProvider';
import { Text } from '../../i18n/text';
import { brand, radius, space, useTheme } from '../../theme';
import { SparkIcon } from '../../components/icons';
import { useStaffStatus } from '../staff/StaffStatusProvider';
import { loadFreeMode } from './freeMode';

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
 * The (staff) Stack's `screenLayout` (app/(staff)/_layout.tsx): a staff page's content with the floating
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
      from={path ?? pathname}
      style={{ position: 'absolute', end: EDGE, bottom: EDGE + insets.bottom }}
    />
  );
}

/**
 * The assistant button, in place; every staff role, like the floating one.
 * Round by default; `labelled` makes it a flat pill with the word beside the
 * spark, the shape Today's greeting card carries (owner, 2026-10-09). `from`
 * is the page it sits on, handed to the free assistant as where the question
 * was asked.
 */
export function AssistantButton({
  testID,
  size = SIZE,
  labelled = false,
  from,
  style,
}: {
  testID: string;
  size?: number;
  labelled?: boolean;
  from?: string;
  style?: ViewStyle;
}) {
  const { t } = useLocale();
  const { fonts } = useTheme();
  const { status } = useStaffStatus();
  const owner = status.kind === 'staff' && status.staff.role === 'owner';
  // The owner's paid-or-free choice, read before the tap so the screen opens on it.
  useEffect(() => {
    if (owner) loadFreeMode();
  }, [owner]);
  if (status.kind !== 'staff') return null;
  const hint = owner ? t('staff.assistant.entry.hint') : t('staff.assistant.free.entryHint');
  const open = () =>
    router.push(from ? { pathname: '/staff-assistant', params: { from } } : '/staff-assistant');
  if (labelled) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('staff.assistant.entry.title')}
        accessibilityHint={hint}
        onPress={open}
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
      accessibilityHint={hint}
      onPress={open}
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
