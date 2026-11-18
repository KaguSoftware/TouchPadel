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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '../../i18n/LocaleProvider';
import { brand, useTheme } from '../../theme';
import { ItemDetailContent, itemContentHeight } from './ItemDetailContent';
import type { ItemDetailProps } from './ItemDetail.types';

/** The tallest the sheet gets; a drag down dismisses. */
const OPEN_FRACTION = 0.88;
/** The grabber above the content and the sheet's float off the bottom. */
const CHROME = 32;

export function ItemDetail({ item, categoryEn, testID, onClose }: ItemDetailProps) {
  const { appearance, colors } = useTheme();
  const { locale } = useLocale();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The sheet is as tall as its content, worked out once here so it never changes while it opens
  // (it breaks the open animation), and never past `maxHeight`.
  const maxHeight = Math.round(OPEN_FRACTION * (height - insets.top));
  const contentH = item
    ? itemContentHeight(item, locale, width, maxHeight - CHROME, insets.bottom)
    : Math.round(maxHeight * 0.6);
  const detentH = contentH + CHROME;
  // React measures the photo from the hidden host, not from the sheet, so the photo viewer needs
  // to be told where the sheet's top-left is on the screen: the sheet sits at the bottom, `detentH`
  // tall, and floats a few points off the sides and bottom (an estimate; the viewer fades into
  // the photo).
  const screenOffset = { x: 8, y: height - detentH + 16 };
  const scheme = appearance === 'dark' ? 'dark' : 'light';
  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }} colorScheme={scheme}>
      <BottomSheet isPresented={item !== null} onIsPresentedChange={(next) => !next && onClose()}>
        <Group
          modifiers={[
            presentationDetents([{ height: detentH }]),
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
                  height={contentH}
                  fixed
                  screenOffset={screenOffset}
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
