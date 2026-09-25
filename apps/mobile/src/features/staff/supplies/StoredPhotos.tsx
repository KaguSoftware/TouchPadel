/**
 * Stored work photos shown from their staff-media paths: a receipt, a take's
 * photos, a request's photos. Each path is read through a 10-minute signed
 * URL (photo.ts `staffPhotoUrl`, §2.3) under `staffKeys.photoUrl`, so the
 * storage policy decides who sees a photo, never this component. Nothing
 * here is pressable: a screen that opens a photo wraps it in its own control.
 */
import { Image, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocale } from '../../../i18n/LocaleProvider';
import { radius, space, useTheme } from '../../../theme';
import { staffKeys } from '../keys';
import { staffPhotoUrl } from '../photo';

/** A signed URL lives ten minutes; read it again a minute before that. */
const URL_FRESH_MS = 9 * 60_000;

function StoredPhoto({ path, size, n }: { path: string; size: number; n: number }) {
  const { t } = useLocale();
  const { colors } = useTheme();
  const url = useQuery({
    queryKey: staffKeys.photoUrl(path),
    queryFn: () => staffPhotoUrl(path),
    staleTime: URL_FRESH_MS,
  });
  return (
    <Image
      source={url.data ? { uri: url.data } : undefined}
      accessibilityLabel={t('staff.media.photo', { n })}
      resizeMode="cover"
      style={{ width: size, height: size, borderRadius: radius.cell, backgroundColor: colors.sub }}
    />
  );
}

export function StoredPhotos({ paths, size = 64 }: { paths: readonly string[]; size?: number }) {
  if (paths.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
      {paths.map((path, i) => (
        <StoredPhoto key={path} path={path} size={size} n={i + 1} />
      ))}
    </View>
  );
}
