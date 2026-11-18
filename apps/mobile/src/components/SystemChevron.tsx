import { Platform } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { mirror } from '../i18n/direction';
import { useLocale } from '../i18n/LocaleProvider';
import { useTheme, withAlpha } from '../theme';
import { ChevronIcon } from './icons';

/**
 * The row chevron. iOS: the system's small semibold `chevron.forward` in a quiet grey, as in
 * Settings, mirrored here rather than by the symbol (this app pins UIKit LTR, so `.forward`
 * would not flip). Android: the drawn chevron.
 */
export function SystemChevron() {
  const { colors } = useTheme();
  const { dir } = useLocale();
  if (Platform.OS !== 'ios') return <ChevronIcon size={16} color={colors.fnt2} />;
  return (
    <SymbolView
      name="chevron.forward"
      size={13}
      weight="semibold"
      tintColor={withAlpha(colors.fnt2, 0.65)}
      style={mirror(dir)}
      fallback={<ChevronIcon size={16} color={colors.fnt2} />}
    />
  );
}
