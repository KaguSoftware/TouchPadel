/**
 * The country picker as REAL SwiftUI, for iOS only (owner's call, this
 * session): a native `BottomSheet` holding a native grouped `List`, so the
 * sheet's presentation, its detents, its rubber-banding and its scrolling are
 * all UIKit's rather than anything driven from JS. The JS sheet in `phone.tsx`
 * stays as the Android implementation, and `CountryPickerNative` is selected
 * per platform at the single call site there.
 *
 * TWO THINGS ARE KNOWINGLY GIVEN UP HERE, both inherent to native views:
 *
 *  1. LANGUAGE AND DIRECTION. This app's locale is application state and the
 *     RN root is pinned LTR for it (src/i18n/nativeDirection.ts). SwiftUI
 *     reads the SYSTEM locale instead, so an Arabic guest on an English phone
 *     gets an LTR, English-chrome sheet inside an RTL form. The row CONTENT is
 *     still localized — the names come from the same `nameOf` the JS sheet
 *     uses — but the sheet's own furniture is the platform's.
 *  2. THEMING. `colorScheme` and `seedColor` are handed the app's own values
 *     below, which is as far as a native surface can be pushed toward the
 *     brand; the list background, separators and search field remain iOS's.
 *
 * There is no `.searchable` in @expo/ui, so the search is a native `TextField`
 * in its own section with the filtering done in JS — the same predicate as the
 * JS sheet (English name, localized name, dial code).
 */
import { useMemo } from 'react';
import {
  BottomSheet,
  Group,
  Host,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text,
  TextField,
} from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  contentShape,
  environment,
  font,
  foregroundStyle,
  listStyle,
  multilineTextAlignment,
  onTapGesture,
  presentationDetents,
  presentationDragIndicator,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { COUNTRIES, flagOf, type Country } from '../features/profile/phone';

export function CountryPickerNative({
  visible,
  selected,
  query,
  onChangeQuery,
  onSelect,
  onClose,
  nameOf,
  searchPlaceholder,
  locale,
  rtl,
  dark,
  tint,
}: {
  visible: boolean;
  selected: string;
  query: string;
  onChangeQuery: (q: string) => void;
  onSelect: (iso: string) => void;
  onClose: () => void;
  /** The caller's localized-name resolver, shared with the JS sheet. */
  nameOf: (c: Country) => string;
  searchPlaceholder: string;
  /** The APP's locale (a BCP-47 tag), not the phone's. */
  locale: string;
  /** Whether that locale is right-to-left. */
  rtl: boolean;
  dark: boolean;
  tint: string;
}) {
  const results = useMemo(() => {
    if (!visible) return COUNTRIES;
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const digits = q.replace(/\D/g, '');
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        nameOf(c).toLowerCase().includes(q) ||
        (digits.length > 0 && c.dial.startsWith(digits)),
    );
  }, [visible, query, nameOf]);

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }} colorScheme={dark ? 'dark' : 'light'}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(next) => {
          // Fires for the drag-to-dismiss too, which is the whole point of
          // using the native sheet: the gesture reports back through the same
          // path as the explicit close.
          if (!next) onClose();
        }}
      >
        <Group
          modifiers={[
            // Opens PARTIAL, not full-screen: the same 85 % the Android sheet
            // uses for its own height, so the two platforms leave the same
            // strip of the screen behind the card. A single detent — the sheet
            // is a picker, not something to resize — so the drag gesture
            // dismisses rather than snapping between heights.
            presentationDetents([{ fraction: SHEET_FRACTION }]),
            // The sheet's own grabber — the pill at the top edge that says the
            // card is draggable. A presentation modifier, so it belongs on the
            // Group wrapping the sheet's content rather than on the content
            // itself; UIKit draws it, which is why there is no handle View
            // here the way the JS sheet has one.
            presentationDragIndicator('visible'),
          ]}
        >
        <Host useViewportSizeMeasurement colorScheme={dark ? 'dark' : 'light'} seedColor={tint}>
          <List
            modifiers={[
              listStyle('insetGrouped'),
              // The app's own locale, pushed into the SwiftUI environment and
              // inherited by everything below. Without it a native view reads
              // the SYSTEM locale, so an Arabic guest on an English phone got
              // an LTR sheet — the divergence this file's header warns about.
              // Setting it here mirrors the in-app language switch, which is
              // as close as a native surface gets to the JS sheet's behaviour.
              environment({ key: 'locale', value: locale }),
              // The app's appearance, for the same reason and by the same
              // route. `colorScheme` on the OUTER `Host` cannot reach here:
              // `BottomSheet` presents through SwiftUI's `.sheet`, which hosts
              // its content in a separate controller that does NOT inherit the
              // presenting view's environment. Without this the rows fall back
              // to the SYSTEM appearance, so a dark-mode guest on a light
              // phone got black text on the sheet's dark ground.
              environment({ key: 'colorScheme', value: dark ? 'dark' : 'light' }),
            ]}
          >
            <Section>
              <HStack spacing={8}>
                {/* The platform's own search glyph, so the row reads as an
                    iOS search field rather than a plain text row. Secondary
                    style is what SF uses for a field's leading affordance. */}
                <Image systemName="magnifyingglass" modifiers={[foregroundStyle('secondary')]} />
                <TextField
                  placeholder={searchPlaceholder}
                  onTextChange={onChangeQuery}
                  modifiers={[
                    autocorrectionDisabled(true),
                    // The placeholder and typed text follow the app's script.
                    // The locale environment above drives the field's layout
                    // direction; this pins the text's alignment within it,
                    // which SwiftUI otherwise leaves at the system locale's.
                    multilineTextAlignment(rtl ? 'trailing' : 'leading'),
                  ]}
                />
              </HStack>
            </Section>
            {/*
             * There is a band of empty white below the last row that resisted
             * `listSectionMargins({ edges: 'bottom', length: 0 })` — so it is
             * not the section's margin. It is most likely the SHEET's detent
             * sizing itself taller than the list, which is a presentation
             * concern rather than a list one. Left as-is by the owner's call
             * (2026-09-06); the next things to try are `listSectionSpacing`,
             * or dropping `insetGrouped` for `plain` so the rows run edge to
             * edge with no surrounding inset at all.
             */}
            <Section>
              {results.map((c) => (
                <HStack
                  key={c.iso}
                  spacing={10}
                  modifiers={[
                    // The whole row is the hit target, not just the glyphs on
                    // it — without a content shape the taps between the labels
                    // fall through.
                    contentShape(shapes.rectangle()),
                    onTapGesture(() => onSelect(c.iso)),
                  ]}
                >
                  <Text>{flagOf(c.iso)}</Text>
                  <Text modifiers={c.iso === selected ? [font({ weight: 'semibold' })] : []}>
                    {nameOf(c)}
                  </Text>
                  <Spacer />
                  <Text modifiers={[foregroundStyle('secondary')]}>{`+${c.dial}`}</Text>
                </HStack>
              ))}
            </Section>
          </List>
        </Host>
        </Group>
      </BottomSheet>
    </Host>
  );
}

/**
 * How much of the screen the sheet covers, matching the Android drawer's
 * `height: '85%'` so the strip of backdrop left above it reads the same on
 * both platforms.
 */
const SHEET_FRACTION = 0.85;
