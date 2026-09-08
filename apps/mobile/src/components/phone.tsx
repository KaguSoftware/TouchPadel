/**
 * The app's ONE phone input (sign-up, complete-profile, edit-profile).
 *
 * A phone number without a country code is not dialable, and the desk dials
 * these. So the country is never implicit: the field carries a tappable code
 * chip on its leading edge, defaulted to Iraq (the venue's country — the
 * client's own number is +964, see docs/client/06), and the box beside it
 * takes the NATIONAL digits only. The two are joined into E.164 on save, which
 * is the shape already stored in `profiles.phone` and in `user_metadata`.
 *
 * The chip sits INSIDE the field's border rather than beside it, so the pair
 * still reads as one control: it is passed to `Field` as its `lead`
 * adornment, which puts both in one flex row that the border, the focus ring
 * and the error color all wrap. Being a real row child (not an overlay) it
 * needs no measurement, and the row is logical, so in Arabic the chip lands
 * on the right with no direction ternary anywhere. The digits stay LTR either
 * way (spec §06 Forms) — `Field` already forces that for a phone-pad.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReduceMotion } from '../lib/useReduceMotion';
import { CountryPickerNative } from './phone.ios-picker';
import { REDUCED_MOTION_MS } from '../features/courtTransition/spec';
import { Text } from '../i18n/text';
import { useLocale, useLocaleSwitch } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';
import { SearchIcon } from './icons';
import { Field } from './ui';
import {
  COUNTRIES,
  countryByIso,
  flagOf,
  formatNational,
  maxNationalDigits,
  sanitizeNationalInput,
  type Country,
} from '../features/profile/phone';

export function PhoneField({
  iso,
  onChangeIso,
  national,
  onChangeNational,
  label,
  error,
  dense,
  placeholder,
}: {
  iso: string;
  onChangeIso: (iso: string) => void;
  /** National digits only — no dial code, no trunk zero. */
  national: string;
  onChangeNational: (national: string) => void;
  /** Omitted on sign-up, whose fields are placeholder-labelled. */
  label?: string;
  error?: string | null;
  dense?: boolean;
  placeholder?: string;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);
  const shown = formatNational(iso, national);
  // The formatted width of a COMPLETE number for this country: the cap the
  // native field enforces. Derived from a dummy full-length number rather than
  // from `shown`, which would shrink to whatever is typed so far and lock the
  // field at its current length.
  const maxShownLength = useMemo(
    () => formatNational(iso, '0'.repeat(maxNationalDigits(iso))).length,
    [iso],
  );
  // `undefined` means "leave the caret alone" — the state after the guest has
  // moved it themselves. It is only forced to the end on the render that
  // follows a keystroke, which is the render that reformats the value.
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(
    undefined,
  );
  const onType = useCallback(
    (next: string) => {
      // Capped to the country's own length: past it the digits are dropped, so
      // the field stops rather than accepting a number that could never dial.
      const digits = sanitizeNationalInput(next, iso);
      onChangeNational(digits);
      // Reformatting moves everything after the caret, so the only stable
      // place to put it is the end of what the guest has typed so far.
      const end = formatNational(iso, digits).length;
      setSelection({ start: end, end });
    },
    [iso, onChangeNational],
  );
  // Once the platform reports the caret where we asked for it, control is
  // handed back: holding `selection` fixed would stop the guest tapping into
  // the middle of their own number.
  const onSelectionChange = useCallback(() => setSelection(undefined), []);
  const country = countryByIso(iso);
  const flag = flagOf(country.iso);
  // Derived from the field's own vertical padding rather than a flat number:
  // `dense` fields are 2 pt shorter, and a fixed inset made the hairline sit
  // proportionally lower on one screen than the other.
  const dividerInset = (dense ? 13 : 14) - DIVIDER_TRIM;

  return (
    <>
      {/*
       * `ltrBox`: the BOX is held left-to-right, the LABEL above it still
       * flips with the language.
       *
       * A phone number reads left-to-right in every locale — the dial code
       * precedes the national digits — so letting the pair mirror put the
       * country chip on the right in Arabic and made it read as a different
       * control from the English one. Owner's call, 2026-09-06: same box in
       * both languages, only the label moves.
       */}
      <Field
        ltrBox
        label={label}
        // The VALUE shown is grouped for the country; the value stored stays
        // bare digits. Formatting on the way out and sanitising on the way in
        // keeps this component's contract (`national` is digits) exactly as it
        // was — every caller, `composePhone` and `validatePhone` are untouched
        // — while the guest sees the shape their own country writes.
        value={shown}
        onChangeText={onType}
        // The caret, held explicitly at the end while typing.
        //
        // This is a controlled field whose value is REWRITTEN on every
        // keystroke — `7705` becomes `770 5`, two characters longer than what
        // was typed — and an uncontrolled caret is placed by the platform
        // against the string it had before. Inserting a separator therefore
        // made it lurch. Pinning it to the end of the new string is correct
        // for typing and for backspacing, which is all this field supports:
        // it is a phone-pad, so there is no selection gesture to preserve
        // beyond the tap that `onSelectionChange` reports below.
        selection={selection}
        onSelectionChange={onSelectionChange}
        // Refused NATIVELY, not corrected afterwards. Trimming in `onType`
        // still let the native input accept the keystroke and paint it for a
        // frame before React reset the value, so the extra digit visibly
        // appeared and vanished. `maxLength` is the length of the FORMATTED
        // string — the separators are characters in the field too — computed
        // from a full-length number for this country so it does not shrink as
        // the guest types.
        maxLength={maxShownLength}
        placeholder={placeholder}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        dense={dense}
        error={error}
        lead={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('auth.countryCode')}
            accessibilityValue={{ text: `+${country.dial}` }}
            onPress={() => setPickerOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              // Field's own inset on the outside, so the flag starts exactly
              // where a plain field's first character does.
              paddingStart: space.m,
              // Chevron → divider. The divider is drawn at this box's trailing
              // EDGE, so this padding only ever covers the chip's own side of
              // it; the gap on the far side is Field's LEAD_GAP.
              //
              // CHEVRON_BLEED is added because the caret is a 7x7 box rotated
              // 45°: its corners reach ~4.95 px from centre while the box is
              // only 3.5 px half-wide, so the drawn tip overhangs the layout
              // box and eats into this padding. Without the correction the
              // visible gap here is 8.55 px against 10 px on the other side.
              paddingEnd: CHIP_GAP + CHEVRON_BLEED,
              // Matches the input's own vertical padding, so the divider and
              // the text share a baseline box.
              paddingTop: dense ? 13 : 14,
              paddingBottom: dense ? 13 : 14,
            }}
          >
            {/* Conditional: `flagOf` returns '' for a code it cannot map, and
                an empty Text would still consume the row's `gap`, leaving the
                code floating off the leading edge for no visible reason. */}
            {flag ? <Text style={{ fontSize: 15 }}>{flag}</Text> : null}
            {/* Latin content in an Arabic UI: pinned LTR so the plus stays in
                front of the digits. `writingDirection` is a paragraph
                property, not a physical alignment — the rule the RTL guard
                enforces. */}
            <Text
              style={{
                fontFamily: fonts.body600,
                fontSize: 14,
                color: colors.ink,
                writingDirection: 'ltr',
              }}
            >
              {`+${country.dial}`}
            </Text>
            <Chevron color={colors.fnt} />
            {/*
             * Hairline between the code and the digits, on the trailing edge.
             * Inset from the field's top and bottom so it reads as a separator
             * between two contents rather than a second border cutting the box
             * in half.
             */}
            <View
              style={{
                position: 'absolute',
                end: 0,
                top: dividerInset,
                bottom: dividerInset,
                width: 1,
                backgroundColor: colors.line2,
              }}
            />
          </Pressable>
        }
      />

      <CountryPicker
        visible={pickerOpen}
        selected={iso}
        onSelect={(next) => {
          onChangeIso(next);
          // The number is CLEARED on a country change (owner's call,
          // 2026-09-06). Digits typed for one country rarely mean anything
          // under another — the lengths and the trunk rules differ — and a
          // half-kept number silently trimmed to the new country's length is
          // worse than an empty field the guest can simply retype.
          if (next !== iso) onChangeNational('');
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

/**
 * The nominal gap either side of the divider. Field applies the matching half
 * after the adornment (its LEAD_GAP); this side adds CHEVRON_BLEED on top,
 * because the caret's drawn tip overhangs its layout box.
 *
 * This used to be a measured overlay: the chip was absolutely positioned and
 * the input's `paddingStart` was grown to the chip's `onLayout` width. That
 * double-counted the chip's own trailing padding (11 + 12 = 23 px of dead
 * space against 13 on the leading edge), and it had a first-render frame in
 * which the width was still 0 and the digits sat underneath the chip. A flex
 * row has neither problem: the input simply takes the width that is left.
 */
const CHIP_GAP = 10;
/**
 * How far the rotated caret overhangs its own layout box, per side:
 * (√2 · 3.5) − 3.5 ≈ 1.45. Added to the chip's trailing padding so the gap the
 * EYE sees matches Field's LEAD_GAP on the far side of the divider.
 */
const CHEVRON_BLEED = 1.45;
/**
 * How far the hairline stops SHORT of the input's text box. Subtracted from
 * the field's vertical padding, so the separator keeps the same visual
 * relationship to the text on both the dense and the regular field instead of
 * riding a fixed inset that only suited one of them.
 */
const DIVIDER_TRIM = 3;

/**
 * The chip's disclosure caret, drawn from two borders — no icon asset. It
 * points DOWN (the picker opens below), which is direction-neutral, so the
 * two edges are named logically and the glyph is identical in both languages.
 */
function Chevron({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 7,
        height: 7,
        borderEndWidth: 1.5,
        borderBottomWidth: 1.5,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        marginTop: -3,
      }}
    />
  );
}

/**
 * Platform dispatch for the country sheet. iOS gets the real SwiftUI sheet
 * (owner's call, this session) — its presentation, detents and scrolling are
 * UIKit's, so none of the JS sheet's motion applies there; Android keeps the
 * JS sheet below. Both are given the same localized-name resolver and the same
 * search predicate, so a row reads identically on either platform.
 *
 * The locale plumbing lives HERE rather than in each implementation so the two
 * cannot drift: `Intl.DisplayNames` is the platform's own CLDR data, with the
 * English name as the fallback on a runtime built without full ICU.
 */
function CountryPicker(props: {
  visible: boolean;
  selected: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const display = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  }, [locale]);
  const nameOf = useCallback(
    (c: Country) => {
      try {
        return display?.of(c.iso) ?? c.name;
      } catch {
        return c.name;
      }
    },
    [display],
  );
  return Platform.OS === 'ios' ? (
    <CountryPickerIOS {...props} nameOf={nameOf} />
  ) : (
    <CountryPickerJS {...props} nameOf={nameOf} />
  );
}

/** iOS: the SwiftUI sheet, with the app's own chrome values handed across. */
function CountryPickerIOS({
  visible,
  selected,
  onSelect,
  onClose,
  nameOf,
}: {
  visible: boolean;
  selected: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
  nameOf: (c: Country) => string;
}) {
  const { colors, appearance } = useTheme();
  const { t, locale, dir } = useLocale();
  const [query, setQuery] = useState('');
  return (
    <CountryPickerNative
      visible={visible}
      selected={selected}
      query={query}
      onChangeQuery={setQuery}
      onSelect={onSelect}
      onClose={onClose}
      nameOf={nameOf}
      searchPlaceholder={t('auth.countryCodeSearch')}
      locale={locale}
      rtl={dir === 'rtl'}
      dark={appearance === 'dark'}
      tint={colors.ink}
    />
  );
}

/**
 * Full-height sheet: the list is long enough that the notice sheet's
 * content-sized box would be useless. Search matches the country's English
 * name, its localized name and its dial code, so an Arabic guest can type
 * "العراق" or "964" or "iraq".
 *
 * Presentation is driven here rather than by `animationType="slide"`, which
 * translates the modal root as ONE layer: the scrim is part of that layer, so
 * the backdrop arrives already at full strength and rides up WITH the drawer —
 * a dark slab entering the screen instead of a dim behind a sheet. Split in
 * two (the BookingSheet's treatment): the scrim fades 0 → 1 in place while the
 * sheet alone travels, and on the way out the sheet leaves first. The Modal
 * therefore stays mounted one beat past `visible` — `present` — so the exit
 * has something to animate; Reduce Motion collapses both to a cut.
 */
function CountryPickerJS({
  visible,
  selected,
  onSelect,
  onClose,
  nameOf,
}: {
  visible: boolean;
  selected: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
  /** Shared with the iOS sheet by the dispatcher, so the two cannot drift. */
  nameOf: (c: Country) => string;
}) {
  const { colors, fonts } = useTheme();
  const { t, dir } = useLocale();
  const { switching } = useLocaleSwitch();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [query, setQuery] = useState('');
  const { present, scrim, translateY, onSheetLayout, onStageLayout, panHandlers } =
    useSheetTransition(visible, reduceMotion, onClose);

  const results = useMemo(() => {
    // Nothing to filter while the sheet is closed — and this component stays
    // mounted inside every screen that has a phone field, so the work would
    // otherwise be repeated on each of their renders for a list nobody is
    // looking at.
    if (!present) return COUNTRIES;
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const digits = q.replace(/\D/g, '');
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        nameOf(c).toLowerCase().includes(q) ||
        (digits.length > 0 && c.dial.startsWith(digits)),
    );
  }, [present, query, nameOf]);

  return (
    <Modal
      visible={present}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        onLayout={onStageLayout}
        style={{
          flex: 1,
          direction: dir,
          pointerEvents: switching ? 'none' : 'auto',
          justifyContent: 'flex-end',
        }}
      >
        {/* The scrim is its own layer, BEHIND the sheet and never transformed,
            so it dims in place instead of sliding on-screen as a dark slab.
            The animated node is a plain View with the Pressable INSIDE it,
            rather than an Animated.createAnimatedComponent(Pressable): a
            Pressable re-renders on its own press state, and an animated one
            re-renders the animated node with it, which puts JS work on the
            frames the dim is being driven through. The touch target is the
            same rectangle either way — the strip left uncovered above the
            sheet does what it looks like it does (the notice sheet's
            contract). */}
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            start: 0,
            end: 0,
            bottom: 0,
            backgroundColor: brand.scrim,
            opacity: scrim,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            style={{ flex: 1 }}
          />
        </Animated.View>
        <Animated.View
          onLayout={onSheetLayout}
          style={{
            // Tall, but never the whole screen: the strip of scrim left above
            // is what tells the guest this is dismissible.
            //
            // A REAL height, not a max on an auto-sized box. The list inside
            // takes `flex: 1`, and flex divides the space a parent HAS — in a
            // content-sized parent that is nothing, so the rows collapsed to
            // zero height and the sheet showed an empty card. The bottom-edge
            // gap this once left is handled by the root's own alignment
            // instead, not by letting the box shrink.
            height: '85%',
            backgroundColor: colors.card,
            borderTopStartRadius: radius.sheet,
            borderTopEndRadius: radius.sheet,
            paddingTop: space.l,
            paddingBottom: insets.bottom,
            transform: [{ translateY }],
          }}
        >
          {/* The drag area. It covers the handle and the title but NOT the
              list: a responder over the rows would swallow their scroll, since
              a scroll and a dismiss are the same downward drag. */}
          <View {...panHandlers}>
            <View
              style={{
                width: 38,
                height: 4,
                borderRadius: radius.pill,
                backgroundColor: colors.line2,
                alignSelf: 'center',
                marginBottom: space.m,
              }}
            />
          </View>
          <View style={{ paddingStart: space.xl, paddingEnd: space.xl }}>
            <Text
              style={{
                fontFamily: fonts.display900,
                fontSize: 17,
                textTransform: 'uppercase',
                color: colors.ink,
              }}
            >
              {t('auth.countryCode')}
            </Text>
            <Field
              value={query}
              onChangeText={setQuery}
              placeholder={t('auth.countryCodeSearch')}
              autoCorrect={false}
              clearButtonMode="while-editing"
              dense
              // On the BOX, not the input: with a `lead` adornment the border
              // and background belong to the row wrapping the glass and the
              // text, so styling the input alone left the icon's corner white.
              boxStyle={{ backgroundColor: colors.sub, borderColor: 'transparent' }}
              style={{ backgroundColor: 'transparent' }}
              lead={
                // Sits in the field's own adornment slot, so the glass is
                // inside the box's border and the text starts after it — the
                // same slot the country chip uses on the phone input. Logical
                // padding, so under Arabic the glass leads from the right with
                // no direction ternary here.
                <View style={{ paddingStart: space.m, justifyContent: 'center' }}>
                  <SearchIcon size={15} color={colors.fnt} strokeWidth={1.8} />
                </View>
              }
            />
          </View>

          <FlatList
            data={results}
            keyExtractor={keyOfCountry}
            keyboardShouldPersistTaps="handled"
            // Takes the slack now the sheet grows from its content: without
            // it the box would shrink to the header plus the button and the
            // 85 % cap would never be reached.
            style={{ flex: 1, marginTop: space.sm }}
            contentContainerStyle={{ paddingBottom: space.xl }}
            // Every row is the same height, so the list can place them by
            // arithmetic instead of measuring each one as it mounts — the
            // measurement pass is JS work, and it lands on exactly the frames
            // the open animation is running through.
            getItemLayout={getItemLayout}
            // Hairlines between the rows, as the native iOS list draws. With
            // the rows unseparated the names ran together as one block, which
            // is half of why the list read as cramped; the height alone did
            // not fix it. Inset past the flag so the line starts under the
            // TEXT, the way a platform list indents its separators.
            ItemSeparatorComponent={CountrySeparator}
            // The table is 66 rows, not the ~200 an earlier pass here assumed,
            // and `getItemLayout` already spares the measurement pass — so one
            // screenful is built in well under a frame and the rows are simply
            // there as the sheet arrives. Deferring them behind the animation
            // was measured at ~0.01 ms of saved work and cost a visible beat of
            // empty sheet on every open. `removeClippedSubviews` is likewise
            // NOT set: at this length it saves nothing and causes blank rows on
            // iOS.
            initialNumToRender={20}
            ListEmptyComponent={
              <Text
                style={{
                  fontFamily: fonts.body400,
                  fontSize: 13,
                  color: colors.mut,
                  paddingStart: space.xl,
                  paddingEnd: space.xl,
                  paddingTop: space.m,
                }}
              >
                {t('auth.countryCodeNoResults')}
              </Text>
            }
            renderItem={({ item }) => (
              <CountryRow
                country={item}
                name={nameOf(item)}
                active={item.iso === selected}
                onSelect={onSelect}
              />
            )}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}


/**
 * The sheet's open/close motion, standing in for `animationType="slide"` —
 * whose single sliding layer carried the scrim up together with the drawer.
 *
 * The drawer travels its OWN FULL HEIGHT: in from below the bottom edge, and
 * back out clear of it, so the closed state is genuinely off-screen rather
 * than a sheet parked low. The distance is the drawer's own measured height:
 * it must be a number, because the native driver interpolates transforms
 * numerically and drops percentage strings — a '100%' travel compiles and
 * simply never moves.
 *
 * TRANSLATE ONLY, deliberately. An accompanying scale (the booking sheet has
 * one) re-rasterizes the whole subtree every frame — the list, the rounded
 * corners and all of the text — and that costs frames for no gain here. A
 * translate moves a layer the GPU has already rasterized.
 *
 * The spring is also STAGED: it does not start until the Modal's own window
 * has presented and laid out (`onStageLayout`). That presentation costs
 * several frames on both platforms, and an animation started in the mounting
 * commit burns them off-screen, so the sheet enters already part-way up and
 * covers only what is left — the jump that read as a stutter.
 *
 * `present` keeps the Modal mounted across the exit — one that unmounts the
 * instant `visible` goes false takes its own exit animation down with it.
 * Both outputs ride the native driver, opacity and transform being the two
 * properties it supports.
 */
function useSheetTransition(
  visible: boolean,
  reduceMotion: boolean,
  /** Called when a downward drag has gone far enough to dismiss. */
  onDismiss: () => void,
) {
  // Whether the sheet is still on its way OUT, so the Modal outlives `visible`
  // for exactly as long as the drawer takes to leave. Raised during RENDER, on
  // the visible → hidden edge (React's adjust-state-on-prop-change idiom: it
  // re-renders this component before committing, rather than cascading a
  // second commit the way the same set from an effect would); the animation's
  // own completion lowers it. `present` is then pure derivation, so an OPEN
  // mounts in the very render that sets `visible`, with no commit to wait for.
  const [exiting, setExiting] = useState(false);
  const [staged, setStaged] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    // The stage belongs to one presentation of the Modal. Dropping it on the
    // OPENING edge means a reopen waits for its new window to lay out rather
    // than starting on the previous one's flag — otherwise the second open
    // races the presentation exactly as the first one used to.
    if (visible) setStaged(false);
    else setExiting(true);
  }
  // Lazy state, not a ref: the value must survive every render, but reading a
  // ref during render (to interpolate below) is the pattern the react-hooks
  // rule rejects. `useState` never re-runs its initializer, so this is the
  // same single Animated.Value, legibly held.
  const [p] = useState(() => new Animated.Value(0));
  // The drawer's own height, and so exactly how far it must travel to clear
  // the bottom edge. It has to be a NUMBER: the native driver interpolates
  // transforms numerically and ignores percentage strings, so a '100%' travel
  // animates nothing at all. Until the first layout lands, the window height
  // stands in — it always over-clears, so the sheet is never left part-way on
  // screen.
  const [travel, setTravel] = useState(() => Dimensions.get('window').height);
  // The drag reads the sheet's height synchronously on every finger move, so
  // it is held on a ref: state would always be one render behind the gesture.
  // Only ever touched inside callbacks — never read during render, which is
  // the case the react-hooks rule is about.
  const dragHeight = useRef(0);
  const onSheetLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) {
        // The drag reads this synchronously on every move, so it is kept on a
        // ref as well as in state — state would be a render behind the finger.
        dragHeight.current = h;
        setTravel((prev) => (prev === h ? prev : h));
      }
    },
    [],
  );

  // Drag-to-dismiss. The sheet has no Close button (owner's call,
  // 2026-09-06): it goes away by a downward drag, by a tap on the backdrop, or
  // by picking a country.
  //
  // The responder lives on the sheet's HEADER, not the whole card — a
  // responder over the list would swallow its scroll, and the two gestures are
  // the same downward drag. `p` is driven directly from the finger so the card
  // tracks it 1:1, then either springs home or completes the exit on release.
  // Only DOWNWARD movement counts: dragging up would lift the sheet past its
  // resting place and open a gap beneath it.
  // The responder is created ONCE (lazily), so it closes over the first
  // `onDismiss` it sees. Held on a ref and kept current by the effect below,
  // or a later prop identity would be called through a stale closure.
  const dismissRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  // Lazily rather than in a useMemo: the responder reads refs, and a useMemo
  // body runs during render, which the hooks rule rejects. Nothing it closes
  // over is ever replaced, so building it once is also simply correct.
  /* eslint-disable react-hooks/refs -- every ref in the responder below is
     read inside a gesture callback, which fires on touch and never during a
     render; the lazy initializer holding it runs outside the render phase too.
     The rule sees only the closure and cannot tell either apart. */
  const [pan] = useState(
    () =>
      PanResponder.create({
        // Claimed only once the drag is clearly vertical, so a tap on the handle
        // still reads as a tap and a sideways swipe is left alone.
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          const h = dragHeight.current || Dimensions.get('window').height;
          // Downward only: dragging up would carry the sheet past its resting
          // place and open a gap beneath it.
          if (g.dy > 0) p.setValue(Math.max(0, 1 - g.dy / h));
        },
        onPanResponderRelease: (_e, g) => {
          const h = dragHeight.current || Dimensions.get('window').height;
          // Past a third of the way down, or thrown downward fast enough, the
          // release completes the dismissal; anything short of that springs back.
          if (g.dy > h * 0.33 || g.vy > 0.6) dismissRef.current?.();
          else Animated.spring(p, { toValue: 1, ...SHEET_SPRING, useNativeDriver: true }).start();
        },
      }),
  );
  /* eslint-enable react-hooks/refs */

  // Set once the Modal's own window has actually presented and laid its
  // content out. The spring must not start before this: presenting a Modal
  // costs several frames on both platforms (iOS presents a view controller,
  // Android opens a new window), and an animation started in the mounting
  // commit spends that whole budget off-screen — the sheet then appears
  // already part-way up and travels only the remainder, which is the jump
  // that reads as a stutter. A single requestAnimationFrame was not enough:
  // it guesses one frame where the real cost is several, and varies by device.
  const onStageLayout = useCallback(() => setStaged(true), []);

  useEffect(() => {
    // Opening waits for the stage; closing is already on screen and can start
    // immediately.
    if (visible && !staged) {
      // Pinned off-screen until the spring is allowed to run, so the first
      // presented frame is the sheet at the bottom edge rather than wherever
      // the previous close left it.
      p.setValue(0);
      return;
    }

    const anim = reduceMotion
      ? // No spring under Reduce Motion: one short linear fade to the target,
        // matching REDUCED_MOTION_MS in the transition spec.
        Animated.timing(p, {
          toValue: visible ? 1 : 0,
          duration: REDUCED_MOTION_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      : Animated.spring(p, {
          toValue: visible ? 1 : 0,
          ...SHEET_SPRING,
          useNativeDriver: true,
        });
    anim.start(({ finished }) => {
      // Only a run that reached the end may unmount. A close cut short has
      // been superseded by a re-open, which needs the Modal kept.
      if (finished && !visible) setExiting(false);
    });
    return () => anim.stop();
  }, [visible, staged, reduceMotion, p]);

  return {
    present: visible || exiting,
    onSheetLayout,
    onStageLayout,
    panHandlers: pan.panHandlers,
    // The dim leads the drawer, reaching full strength over the first half of
    // the travel. Spread across the whole of it, the backdrop would still be
    // darkening after the sheet had landed.
    scrim: p.interpolate({
      inputRange: [0, SCRIM_LEAD, 1],
      outputRange: [0, 1, 1],
      extrapolate: 'clamp',
    }),
    // Clamped: a spring overshoots past 1, and unclamped the sheet would
    // travel PAST its resting place and open a gap under its own bottom edge.
    translateY: p.interpolate({
      inputRange: [0, 1],
      outputRange: [travel, 0],
      extrapolate: 'clamp',
    }),
  };
}

/**
 * Critically damped — ζ = 32.2 / (2·√(260·1)) ≈ 1.0 — so the sheet eases to
 * rest with no bounce, which a list of text would only make look unsteady.
 * Much tighter than the court transition's SPRING, which is tuned to a ~1.6 s
 * settle for a whole scene change; a picker should be done sooner than that,
 * and this one settles in ≈ 360 ms.
 *
 * Stiffness and damping move TOGETHER: ζ = damping / (2·√(stiffness·mass)), so
 * raising the stiffness alone to speed the sheet up would drop ζ below 1 and
 * put a bounce on the end of the travel.
 *
 * The rest thresholds are in the units of the value being animated, and that
 * value is the normalised 0 → 1 progress — NOT pixels. They match the house
 * SPRING's for that reason. Pixel-scale thresholds here (0.5 against a total
 * range of 1.0) let the spring call itself finished while it was still half a
 * travel from home, and the drawer jumped the remaining distance in one frame:
 * the "not smooth" was that snap, not the curve.
 */
const SHEET_SPRING = {
  stiffness: 260,
  damping: 32.2,
  mass: 1,
  restDisplacementThreshold: 0.0005,
  restSpeedThreshold: 0.002,
} as const;

/** Fraction of the travel over which the scrim reaches full strength. */
const SCRIM_LEAD = 0.5;

const keyOfCountry = (c: Country) => c.iso;

/**
 * One country. Split out and memoized because the list is ~200 rows long: as
 * an inline closure every row re-rendered on every keystroke in the search
 * field, and that JS work is what the sheet's own animation stutters on.
 * `onSelect` is the caller's handler, stable for as long as the picker is
 * open, so the default shallow compare is enough.
 */
const CountryRow = memo(function CountryRow({
  country,
  name,
  active,
  onSelect,
}: {
  country: Country;
  name: string;
  active: boolean;
  onSelect: (iso: string) => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => onSelect(country.iso)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: ROW_H,
        paddingStart: space.xl,
        paddingEnd: space.xl,
        backgroundColor: active ? colors.sub : 'transparent',
      }}
    >
      <Text style={{ fontSize: 18 }}>{flagOf(country.iso)}</Text>
      <Text style={{ flex: 1, fontFamily: fonts.body600, fontSize: 14, color: colors.ink }}>
        {name}
      </Text>
      <Text
        style={{
          fontFamily: fonts.body400,
          fontSize: 14,
          color: colors.mut,
          writingDirection: 'ltr',
        }}
      >
        {`+${country.dial}`}
      </Text>
    </Pressable>
  );
});

/**
 * A row's fixed height. Stated as a height rather than as padding so
 * `getItemLayout` can be honest about it — the two must not drift apart.
 *
 * 52, not the 42 this was: 42 packed the names close enough to read as one
 * block, and it sat under the 48 pt minimum touch target, so a mis-tap landed
 * on the neighbouring country. This is also close to the native iOS list row
 * the other platform shows, which keeps the two pickers feeling alike.
 */
const ROW_H = 52;
/**
 * The row PITCH: its height plus the hairline drawn under it. `getItemLayout`
 * places rows by arithmetic, so it has to count the separator — measuring the
 * row alone drifts by one hairline per row, which over the whole table is
 * enough to put a tap on the wrong country near the bottom.
 */
const ROW_PITCH = ROW_H + StyleSheet.hairlineWidth;
const getItemLayout = (_: unknown, index: number) => ({
  length: ROW_PITCH,
  offset: ROW_PITCH * index,
  index,
});

/**
 * The hairline between two rows, inset to start under the country NAME rather
 * than at the card's edge — a full-bleed rule would box each row in and read
 * heavier than the list it is meant to organise.
 */
function CountrySeparator() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.line,
        marginStart: SEPARATOR_INSET,
      }}
    />
  );
}

/** Past the flag and the row gap, so the line begins with the name. */
const SEPARATOR_INSET = space.xl + 18 + 10;
