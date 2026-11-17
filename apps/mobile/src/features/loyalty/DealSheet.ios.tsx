/**
 * A deal's sheet on iOS: the native SwiftUI `BottomSheet` (UIKit draws the sheet, its grabber,
 * the detents and the drag to dismiss), hosting the shared content (`DealSheetContent`), as the
 * café item sheet does (`features/cafe/ItemDetail.ios.tsx`). Android's half is `DealSheet.tsx`.
 */
import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  environment,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { useWindowDimensions } from 'react-native';
import { useLocale } from '../../i18n/LocaleProvider';
import { brand, useTheme } from '../../theme';
import { DealSheetContent } from './DealSheetContent';
import type { DealSheetProps } from './DealSheet.types';

/** Opens at most of the screen, and drags up to full; a drag down dismisses. */
const OPEN_FRACTION = 0.86;

export function DealSheet({ deal, onClose, ...rest }: DealSheetProps) {
  const { appearance, colors } = useTheme();
  const { locale } = useLocale();
  const { height } = useWindowDimensions();
  const scheme = appearance === 'dark' ? 'dark' : 'light';
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }} colorScheme={scheme}>
      <BottomSheet isPresented={deal !== null} onIsPresentedChange={(next) => !next && onClose()}>
        <Group
          modifiers={[
            presentationDetents([{ fraction: OPEN_FRACTION }, 'large']),
            presentationDragIndicator('visible'),
            presentationBackground(colors.card),
            environment({ key: 'locale', value: locale }),
            environment({ key: 'colorScheme', value: scheme }),
          ]}
        >
          <Host useViewportSizeMeasurement colorScheme={scheme} seedColor={brand.blue}>
            {deal ? (
              <RNHostView>
                <DealSheetContent deal={deal} height={height} {...rest} />
              </RNHostView>
            ) : (
              <></>
            )}
          </Host>
        </Group>
      </BottomSheet>
    </Host>
  );
}
