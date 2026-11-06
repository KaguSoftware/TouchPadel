import { brand, useTheme, withAlpha } from '../theme';

/**
 * The green icon chip of the staff Today tiles (`app/staff.tsx`): a green ring
 * and fill round the glyph, brand green on a faint green in dark mode and the
 * strong green on its tint in light. Every green icon in the guest app reads
 * these so the two sides look alike.
 */
export function useIconChip() {
  const { colors, appearance } = useTheme();
  return appearance === 'dark'
    ? { fill: withAlpha(brand.green, 0.12), line: withAlpha(brand.green, 0.4), fg: brand.green }
    : { fill: colors.gtint, line: colors.gline, fg: colors.gstrong };
}
