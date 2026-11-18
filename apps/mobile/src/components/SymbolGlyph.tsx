import type { ComponentProps } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView, type SFSymbol } from 'expo-symbols';

type IonName = ComponentProps<typeof Ionicons>['name'];

/**
 * The Android twin of each SF Symbol the app draws: Ionicons' filled set, the closest in style
 * (SF Symbols themselves are Apple-only). A symbol without an entry renders `fallback`.
 */
const IONICONS: Partial<Record<SFSymbol, IonName>> = {
  'gift.fill': 'gift',
  'cup.and.saucer.fill': 'cafe',
  calendar: 'calendar',
  'figure.tennis': 'tennisball',
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
  'plus.square.fill': 'add-circle',
  'arrow.left.arrow.right': 'swap-horizontal',
  'list.clipboard.fill': 'clipboard',
  'tablecells.fill': 'grid',
  receipt: 'receipt',
  'slider.horizontal.3': 'options',
  'box.truck.fill': 'basket',
  'fork.knife': 'restaurant',
  'person.2.fill': 'people',
  'eye.fill': 'eye',
  'camera.fill': 'camera',
};

/** One glyph: the SF Symbol on iOS, its Ionicons twin elsewhere. */
export function SymbolGlyph({
  name,
  size,
  color,
  fallback,
  style,
}: {
  name: SFSymbol;
  size: number;
  color: string;
  fallback?: React.ReactElement;
  style?: StyleProp<ViewStyle>;
}) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView name={name} size={size} weight="medium" tintColor={color} style={style} fallback={fallback} />
    );
  }
  const ion = IONICONS[name];
  return ion ? <Ionicons name={ion} size={size + 1} color={color} /> : (fallback ?? null);
}
