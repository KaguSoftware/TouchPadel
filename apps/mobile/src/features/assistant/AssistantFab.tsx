/**
 * The owner's assistant, one tap from every staff screen: a round button over
 * the bottom-right corner (the bottom-left in Arabic). Only the owner's staff
 * session gets it; the edge function and RLS refuse anyone else regardless.
 * It stays off the assistant's own screens and off every screen outside the
 * staff area (sign-in, the guest tabs), where it would cover the work.
 */
import { Pressable } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../../i18n/LocaleProvider';
import { brand } from '../../theme';
import { SparkIcon } from '../../components/icons';
import { useStaffStatus } from '../staff/StaffStatusProvider';

const SIZE = 56;
const EDGE = 16;

/** The button shows on staff pages only, and not on the assistant's own. */
export function fabHidden(pathname: string): boolean {
  return pathname.startsWith('/staff-assistant') || !pathname.startsWith('/staff');
}

export function AssistantFab() {
  const { t } = useLocale();
  const { status } = useStaffStatus();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  if (status.kind !== 'staff' || status.staff.role !== 'owner') return null;
  if (fabHidden(pathname)) return null;
  return (
    <Pressable
      testID="staff.assistant.fab"
      accessibilityRole="button"
      accessibilityLabel={t('staff.assistant.entry.title')}
      accessibilityHint={t('staff.assistant.entry.hint')}
      onPress={() => router.push('/staff-assistant')}
      style={({ pressed }) => ({
        position: 'absolute',
        end: EDGE,
        bottom: EDGE + insets.bottom,
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
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
      <SparkIcon size={26} color={brand.green} />
    </Pressable>
  );
}
