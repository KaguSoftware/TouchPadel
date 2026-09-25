/**
 * Small pieces the daily-work pages share (checklists, production, stock,
 * teachings, suggestions, recipes): a status tag, and a stored work photo shown
 * by signed URL.
 */
import { Image, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Text } from '../../../i18n/text';
import { radius, useTheme } from '../../../theme';
import { staffKeys } from '../keys';
import { staffPhotoUrl } from '../photo';

export type TagTone = 'good' | 'warn' | 'bad' | 'info' | 'plain';

/** A short status word on a tinted ground ("Below par", "Waiting for the owner"). */
export function Tag({ label, tone = 'plain' }: { label: string; tone?: TagTone }) {
  const { colors, fonts } = useTheme();
  const look = {
    good: { bg: colors.gtint, fg: colors.gtext, line: colors.gline },
    warn: { bg: colors.amb, fg: colors.ambtext, line: colors.ambline },
    bad: { bg: colors.redtint, fg: colors.redtext, line: colors.redline },
    info: { bg: colors.tint, fg: colors.blue, line: colors.line },
    plain: { bg: colors.sub, fg: colors.mut, line: colors.line },
  }[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingStart: 8,
        paddingEnd: 8,
        paddingTop: 3,
        paddingBottom: 3,
        borderRadius: radius.pill,
        backgroundColor: look.bg,
        borderWidth: 1,
        borderColor: look.line,
      }}
    >
      <Text style={{ fontFamily: fonts.body700, fontSize: 11.5, color: look.fg }}>{label}</Text>
    </View>
  );
}

/**
 * A signed URL for a stored work photo, cached under the staff root (never on
 * disk) for less than its 10-minute life, so a list scrolled twice asks once.
 */
export function useStaffPhotoUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: staffKeys.photoUrl(path ?? ''),
    queryFn: () => staffPhotoUrl(path as string),
    enabled: !!path,
    staleTime: 8 * 60_000,
    gcTime: 9 * 60_000,
  });
}

/**
 * A stored work photo: the local file while it is the one just taken, else the
 * signed URL once it comes. A grey tile stands in until then.
 */
export function StaffPhotoThumb({
  path,
  localUri,
  size = 72,
  label,
}: {
  path: string | null;
  localUri?: string | null;
  size?: number;
  label: string;
}) {
  const { colors } = useTheme();
  const signed = useStaffPhotoUrl(localUri ? null : path);
  const uri = localUri ?? signed.data ?? null;
  return uri ? (
    <Image
      source={{ uri }}
      accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: radius.cell, backgroundColor: colors.sub }}
    />
  ) : (
    <View
      accessible
      accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: radius.cell, backgroundColor: colors.sub }}
    />
  );
}
