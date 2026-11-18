/**
 * The item sheet on Android: Material's own `ModalBottomSheet` (Compose: the drag handle, the
 * scrim, swipe and back to dismiss), hosting the shared content (`ItemDetailContent`). iOS's half
 * is `ItemDetail.ios.tsx`; props in `ItemDetail.types.ts`.
 */
import { Host, ModalBottomSheet, RNHostView } from '@expo/ui/jetpack-compose';
import { useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme';
import { ItemDetailContent } from './ItemDetailContent';
import type { ItemDetailProps } from './ItemDetail.types';

/** The most of the screen the sheet takes; the content is only as tall as it needs. */
const HEIGHT_FRACTION = 0.85;

export function ItemDetail({ item, categoryEn, testID, onClose }: ItemDetailProps) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  if (!item) return null;
  const sheetHeight = Math.round(height * HEIGHT_FRACTION) - 40; // less the drag handle; the sheet hugs its content
  return (
    <Host>
      <ModalBottomSheet
        onDismissRequest={onClose}
        skipPartiallyExpanded
        containerColor={colors.card}
      >
        <RNHostView>
          <ItemDetailContent
            item={item}
            categoryEn={categoryEn}
            testID={testID}
            height={sheetHeight}
          />
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}
