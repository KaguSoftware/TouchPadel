import { useState } from 'react';
import { Image, View } from 'react-native';
import { Text } from '../i18n/text';
import { brand, radius, useTheme } from '../theme';
import { useAvatarUrl } from '../features/profile/hooks';

/**
 * The guest's round avatar (0302): their photo when they set one, otherwise
 * their initials on Touch Blue, ringed in Touch Green either way. The photo
 * arrives through a signed URL; while it loads, or if it fails, the initials
 * show, so the circle is never empty.
 */
export function ProfileAvatar({
  path,
  initials,
  size,
}: {
  path: string | null | undefined;
  initials: string;
  size: number;
}) {
  const { fonts } = useTheme();
  const url = useAvatarUrl(path);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!url.data && url.data !== failedUrl;
  const ring = size >= 70 ? 3 : 2.5;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        backgroundColor: brand.blue,
        borderWidth: ring,
        borderColor: brand.green,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {showPhoto ? (
        <Image
          source={{ uri: url.data }}
          onError={() => setFailedUrl(url.data ?? null)}
          style={{ width: size - ring * 2, height: size - ring * 2, borderRadius: radius.pill }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text
          style={{
            fontFamily: fonts.display800,
            fontSize: Math.round(size * 0.35),
            lineHeight: Math.round(size * 0.4),
            textAlign: 'center',
            includeFontPadding: false,
            color: brand.white,
          }}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}
