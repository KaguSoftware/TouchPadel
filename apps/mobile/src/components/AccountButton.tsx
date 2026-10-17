import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, useTheme } from '../theme';
import { useAuth } from '../features/auth/context';
import { useOwnProfile } from '../features/profile/hooks';
import { avatarInitialsOf } from '../features/profile/names';
import { frameOf, frameStyleOf } from '../features/profile/frames';
import { ProfileAvatar } from './ProfileAvatar';
import { PersonIcon } from './icons';

/** The avatar's drawn size; `hitSlop` takes the press target to 44. */
const SIZE = 36;
const SLOP = (44 - SIZE) / 2;

/**
 * The way into the account (Majed, 2026-10-17): the guest's own picture alone, on the trailing
 * edge of every tab's title row, where Profile used to be the bar's fifth tab. It opens the
 * account page (`app/profile.tsx`), which holds the member card, points and rewards, and the
 * café menu.
 *
 * Signed in, it is the same avatar as Profile's identity card: their photo, else their initials,
 * inside their frame. Signed out (browsing is public), a plain person in a quiet circle, and the
 * page it opens offers sign-in. No label beside it: the picture is the label, and the screen
 * reader hears "Your account".
 */
export function AccountButton({ testID }: { testID: string }) {
  const { t } = useLocale();
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const profile = useOwnProfile(!!session);
  const frame = frameOf(profile.data?.avatar_frame);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('profile.openAccount')}
      hitSlop={SLOP}
      onPress={() => router.push('/profile')}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {session ? (
        <ProfileAvatar
          path={profile.data?.avatar_path}
          initials={avatarInitialsOf(profile.data?.full_name, session.user.email)}
          size={SIZE}
          frame={frame}
          frameStyle={frameStyleOf(frame, profile.data?.avatar_frame_style)}
        />
      ) : (
        <View
          style={{
            width: SIZE,
            height: SIZE,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PersonIcon size={18} color={colors.ink} />
        </View>
      )}
    </Pressable>
  );
}
