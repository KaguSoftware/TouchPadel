/**
 * The item sheet on iOS: a native SwiftUI `BottomSheet` (UIKit draws the sheet, its grabber, the
 * detents and the drag to dismiss), hosting the shared content (`ItemDetailContent`). Android's
 * half is `ItemDetail.tsx`; props in `ItemDetail.types.ts`. Out of the RN tree like the other
 * native sheets, so the sheet itself takes no testID; the content inside does.
 */
import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  environment,
  presentationDetents,
  presentationBackground,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { useWindowDimensions } from 'react-native';
import { useLocale } from '../../i18n/LocaleProvider';
import { brand, useTheme } from '../../theme';
import { ItemDetailContent } from './ItemDetailContent';
import type { ItemDetailProps } from './ItemDetail.types';

/** Opens at most of the screen, and drags up to full; a drag down dismisses. */
const OPEN_FRACTION = 0.88;

export function ItemDetail({ item, categoryEn, testID, onClose }: ItemDetailProps) {
  const { appearance, colors } = useTheme();
  const { locale } = useLocale();
  const { height } = useWindowDimensions();
  const scheme = appearance === 'dark' ? 'dark' : 'light';
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }} colorScheme={scheme}>
      <BottomSheet isPresented={item !== null} onIsPresentedChange={(next) => !next && onClose()}>
        <Group
          modifiers={[
            presentationDetents([{ fraction: OPEN_FRACTION }, 'large']),
            presentationDragIndicator('visible'),
            // A solid ground: iOS 26 draws a partial-height sheet on glass, which showed as a
            // frosted strip under the content.
            presentationBackground(colors.card),
            // `.sheet` content does not inherit the presenter's environment.
            environment({ key: 'locale', value: locale }),
            environment({ key: 'colorScheme', value: scheme }),
          ]}
        >
          <Host useViewportSizeMeasurement colorScheme={scheme} seedColor={brand.blue}>
            {item ? (
              <RNHostView>
                <ItemDetailContent
                  item={item}
                  categoryEn={categoryEn}
                  testID={testID}
                  height={height}
                  onClose={onClose}
                />
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
