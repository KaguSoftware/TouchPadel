/**
 * A deal's sheet on Android: Material's own `ModalBottomSheet` (Compose: the drag handle, the
 * scrim, swipe and back to dismiss), hosting the shared content (`DealSheetContent`), as the café
 * item sheet does (`features/cafe/ItemDetail.tsx`). iOS's half is `DealSheet.ios.tsx`.
 */
import { Host, ModalBottomSheet, RNHostView } from '@expo/ui/jetpack-compose';
import { useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme';
import { DealSheetContent } from './DealSheetContent';
import type { DealSheetProps } from './DealSheet.types';

/** The sheet's share of the screen; the content scrolls inside it. */
const HEIGHT_FRACTION = 0.85;

export function DealSheet({ deal, onClose, ...rest }: DealSheetProps) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  if (!deal) return null;
  return (
    <Host>
      <ModalBottomSheet onDismissRequest={onClose} skipPartiallyExpanded containerColor={colors.card}>
        <RNHostView>
          <DealSheetContent deal={deal} height={Math.round(height * HEIGHT_FRACTION)} {...rest} />
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}
