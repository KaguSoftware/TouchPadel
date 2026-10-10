/**
 * A Today group's pages on iOS: a native SwiftUI `BottomSheet`, the country
 * picker's (src/components/phone.ios-picker.tsx), so UIKit draws the sheet,
 * its glass, its grabber and the swipe down that closes it (owner,
 * 2026-10-10). Its content is the same React Native header and rows as
 * Android's sheet (GroupModal, app/staff.tsx), hosted by `RNHostView`: the
 * title stays put and only the rows scroll. The sheet fits its content
 * (`fitToContents`) up to 85 % of the screen.
 *
 * A row closes the sheet and opens its page once the sheet has gone, so the
 * push does not race the dismissal.
 */
import { useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  presentationBackground,
  presentationDragIndicator,
  presentationSizing,
} from '@expo/ui/swift-ui/modifiers';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { space, useTheme } from '../../theme';
import type { StaffRowDef } from './rows';
import { GroupRows, type TodayGroup } from './todayGroups';

export function GroupSheetIOS({
  groups,
  openKey,
  label,
  onClosed,
  onOpen,
}: {
  groups: TodayGroup[];
  /** The open group's key; null closes the sheet. */
  openKey: string | null;
  label: (row: StaffRowDef) => string;
  onClosed: () => void;
  onOpen: (row: StaffRowDef) => void;
}) {
  const { t, dir } = useLocale();
  const { colors, fonts, appearance } = useTheme();
  const { width, height } = useWindowDimensions();
  // The row tapped, opened after the dismissal.
  const pending = useRef<StaffRowDef | null>(null);
  // The group last opened, kept on the sheet while it slides away.
  const [lastKey, setLastKey] = useState(openKey);
  if (openKey !== null && openKey !== lastKey) setLastKey(openKey);
  const shown = groups.find((g) => g.key === lastKey) ?? null;
  // The rows scroll only when they overflow. A scroll view that can scroll
  // takes the drag first, so the swipe down only closed the sheet from the
  // grabber; with nothing to scroll the sheet takes it at once, as Apple's do.
  const [boxHeight, setBoxHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const overflows = contentHeight > boxHeight + 1;

  return (
    // Sized like @expo/ui's own community sheet: a zero-width Host or a hosted
    // view with no width lays the rows out at nothing, and the sheet opened
    // full height and blank.
    <Host
      style={{ position: 'absolute', width }}
      pointerEvents="none"
      colorScheme={appearance === 'dark' ? 'dark' : 'light'}
    >
      <BottomSheet
        isPresented={openKey !== null && shown !== null}
        fitToContents
        onIsPresentedChange={(next) => {
          // The swipe down reports here too.
          if (!next) onClosed();
        }}
        onDismiss={() => {
          const row = pending.current;
          pending.current = null;
          if (row) onOpen(row);
        }}
      >
        <Group
          modifiers={[
            // Hug the content on iPad as well, rather than near full height.
            presentationSizing('fitted'),
            presentationDragIndicator('visible'),
            // Solid, the page's own ground, not the glass (owner, 2026-10-10:
            // the white sheet read better).
            presentationBackground(colors.bg),
          ]}
        >
          <RNHostView matchContents>
            <View style={{ width, maxHeight: height * 0.85, direction: dir }}>
              <View
                style={{
                  paddingTop: space.xl,
                  paddingStart: space.l,
                  paddingEnd: space.l,
                  paddingBottom: space.m,
                }}
              >
                {shown ? (
                  <Text style={{ fontFamily: fonts.display800, fontSize: 19, color: colors.ink }}>
                    {t(shown.titleKey)}
                  </Text>
                ) : null}
              </View>
              <ScrollView
                style={{ flexShrink: 1 }}
                scrollEnabled={overflows}
                bounces={overflows}
                alwaysBounceVertical={false}
                onLayout={(e) => setBoxHeight(e.nativeEvent.layout.height)}
                onContentSizeChange={(_, h) => setContentHeight(h)}
                contentContainerStyle={{
                  paddingStart: space.l,
                  paddingEnd: space.l,
                  paddingBottom: space.l,
                }}
                showsVerticalScrollIndicator={false}
              >
                {shown ? (
                  <View testID="staff.sheet.list">
                    <GroupRows
                      group={shown}
                      label={label}
                      onOpen={(row) => {
                        pending.current = row;
                        onClosed();
                      }}
                    />
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}
