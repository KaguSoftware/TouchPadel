import type { ComponentProps } from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView, type SFSymbol } from 'expo-symbols';

type IonName = ComponentProps<typeof Ionicons>['name'];

/**
 * The Android twin of each SF Symbol the app draws: Ionicons' filled set, the closest open set in
 * style (SF Symbols themselves are Apple-only and their licence keeps them off Android). A symbol
 * without an entry renders `fallback`.
 */
const IONICONS: Partial<Record<SFSymbol, IonName>> = {
  'gift.fill': 'gift',
  'cup.and.saucer.fill': 'cafe',
  calendar: 'calendar',
  'tennisball.fill': 'tennisball',
  'book.fill': 'book',
  'trophy.fill': 'trophy',
  'flag.fill': 'flag',
  'ticket.fill': 'ticket',
  'phone.fill': 'call',
  'hand.raised.fill': 'hand-left',
  'gearshape.fill': 'settings',
  qrcode: 'qr-code',
  pencil: 'pencil',
  'person.fill': 'person',
  'photo.fill': 'image',
  'envelope.fill': 'mail',
  'lock.fill': 'lock-closed',
  'trash.fill': 'trash',
  'clock.fill': 'time',
  'stopwatch.fill': 'stopwatch',
  'tag.fill': 'pricetag',
  'creditcard.fill': 'card',
  globe: 'globe',
  'sun.max.fill': 'sunny',
  'checkmark.circle.fill': 'checkmark-circle',
  magnifyingglass: 'search',
  'shippingbox.fill': 'cube',
  'bell.fill': 'notifications',
  'minus.circle.fill': 'remove-circle',
  'exclamationmark.triangle.fill': 'warning',
  'plus.circle.fill': 'add-circle',
  'arrow.left.arrow.right': 'swap-horizontal',
  'list.clipboard.fill': 'clipboard',
  'square.grid.2x2.fill': 'grid',
  receipt: 'receipt',
  'slider.horizontal.3': 'options',
  'basket.fill': 'basket',
  'fork.knife': 'restaurant',
  'person.2.fill': 'people',
  'eye.fill': 'eye',
  'camera.fill': 'camera',
};

/** One glyph: the SF Symbol on iOS, its Ionicons twin on Android. */
export function SymbolGlyph({
  name,
  size,
  color,
  fallback,
}: {
  name: SFSymbol;
  size: number;
  color: string;
  fallback?: React.ReactElement;
}) {
  if (Platform.OS === 'ios') {
    return <SymbolView name={name} size={size} weight="medium" tintColor={color} fallback={fallback} />;
  }
  const ion = IONICONS[name];
  return ion ? <Ionicons name={ion} size={size + 1} color={color} /> : (fallback ?? null);
}
