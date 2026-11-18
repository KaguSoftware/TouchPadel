import { Platform } from 'react-native';

/**
 * iOS Settings' rounder, continuous corners for a card of menu rows. Spread it into the card's
 * style; Android returns nothing and keeps `radius.card`.
 */
export const IOS_ROUND =
  Platform.OS === 'ios' ? ({ borderRadius: 26, borderCurve: 'continuous' } as const) : undefined;
