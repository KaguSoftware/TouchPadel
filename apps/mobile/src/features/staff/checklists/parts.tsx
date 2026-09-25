/**
 * Small pieces the daily-work pages share (checklists, production, stock,
 * teachings, suggestions, recipes, and the supplies, marketing and notes pages
 * beside them): the page's lead line, a label over a group of controls, the
 * long-text field's box, a status tag, and a stored work photo shown by
 * signed URL.
 */
import type { ReactNode } from 'react';
import { Image, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Text } from '../../../i18n/text';
import { radius, space, useTheme } from '../../../theme';
import { MicroLabel } from '../../../components/ui';
import { staffKeys } from '../keys';
import { staffPhotoUrl } from '../photo';

/** The sentence under a page's title that says what the page is for. One style on every staff page. */
export function Lead({ children }: { children: ReactNode }) {
  const { colors, fonts } = useTheme();
  return <Text style={{ fontFamily: fonts.body400, fontSize: 13, lineHeight: 20, color: colors.mut2 }}>{children}</Text>;
}

/**
 * The label over a group of controls that is not a Field (a segmented
 * control, a photo row, a pair of choices). It reads as a Field's own label
 * does, and sits the same distance from what came before and what it names,
 * so a form keeps one vocabulary.
 */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <MicroLabel style={{ marginTop: space.sm, marginBottom: -3 }}>{children}</MicroLabel>;
}

/**
 * Field pins its box to one line's height, `multiline` included
 * (components/ui.tsx), so a teaching of up to 4,000 characters was typed and
 * re-read through a 47 pt slot. A long-text field on these pages passes
 * `boxStyle={MULTILINE_BOX}` and `style={MULTILINE_TEXT}`: the box opens at
 * about five lines, grows with the text to about eleven, then scrolls, and
 * Android starts the text at the top as iOS already does. One pair for the
 * whole staff phone, defined beside the protocol forms that use it too.
 */
export { MULTILINE_BOX, MULTILINE_TEXT } from '../protocols/multiline';

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
