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
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../i18n/text';
import { useLocale, useLocaleSwitch } from '../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../theme';
import { Button, Field } from './ui';
import {
  COUNTRIES,
  countryByIso,
  flagOf,
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
  const country = countryByIso(iso);
  const flag = flagOf(country.iso);
  // Derived from the field's own vertical padding rather than a flat number:
  // `dense` fields are 2 pt shorter, and a fixed inset made the hairline sit
  // proportionally lower on one screen than the other.
  const dividerInset = (dense ? 13 : 14) - DIVIDER_TRIM;

  return (
    <>
      <Field
        label={label}
        value={national}
        onChangeText={(next) => onChangeNational(sanitizeNationalInput(next))}
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
              // …and the same gap again on the inside, between the divider and
              // the first digit. The input contributes NO leading padding of
              // its own (see Field's `lead` handling), so this single value is
              // the whole gap — it cannot be double-counted the way the old
              // measured overlay's was.
              paddingEnd: CHIP_GAP,
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
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

/**
 * Gap between the country chip and the first digit — and, by construction, the
 * same value on both sides of the divider.
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
 * Full-height sheet: the list is long enough that the notice sheet's
 * content-sized box would be useless. Search matches the country's English
 * name, its localized name and its dial code, so an Arabic guest can type
 * "العراق" or "964" or "iraq".
 */
function CountryPicker({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}) {
  const { colors, fonts } = useTheme();
  const { t, dir, locale } = useLocale();
  const { switching } = useLocaleSwitch();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  // Country names in the UI language, from the platform's own CLDR data — no
  // second translation table to keep in sync. Undefined on a JS runtime built
  // without full ICU, which is why every use falls back to the English name.
  const display = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  }, [locale]);

  // Stable per locale, so the filter below can depend on it honestly.
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

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const digits = q.replace(/\D/g, '');
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        nameOf(c).toLowerCase().includes(q) ||
        (digits.length > 0 && c.dial.startsWith(digits)),
    );
  }, [query, nameOf]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          direction: dir,
          pointerEvents: switching ? 'none' : 'auto',
          backgroundColor: brand.scrim,
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            // Tall, but never the whole screen: the strip of scrim left above
            // is what tells the guest this is dismissible.
            height: '85%',
            backgroundColor: colors.card,
            borderTopStartRadius: radius.sheet,
            borderTopEndRadius: radius.sheet,
            paddingTop: space.l,
            paddingBottom: insets.bottom,
          }}
        >
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
              style={{ backgroundColor: colors.sub, borderColor: 'transparent' }}
            />
          </View>

          <FlatList
            data={results}
            keyExtractor={(c) => c.iso}
            keyboardShouldPersistTaps="handled"
            style={{ marginTop: space.sm }}
            contentContainerStyle={{ paddingBottom: space.xl }}
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
            renderItem={({ item }) => {
              const active = item.iso === selected;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelect(item.iso)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingStart: space.xl,
                    paddingEnd: space.xl,
                    paddingTop: 12,
                    paddingBottom: 12,
                    backgroundColor: active ? colors.sub : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 18 }}>{flagOf(item.iso)}</Text>
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: fonts.body600,
                      fontSize: 14,
                      color: colors.ink,
                    }}
                  >
                    {nameOf(item)}
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.body400,
                      fontSize: 14,
                      color: colors.mut,
                      writingDirection: 'ltr',
                    }}
                  >
                    {`+${item.dial}`}
                  </Text>
                </Pressable>
              );
            }}
          />

          <View style={{ paddingStart: space.xl, paddingEnd: space.xl, paddingBottom: space.m }}>
            <Button
              label={t('common.close')}
              onPress={onClose}
              variant="secondary"
              size="medium"
              labelColor={colors.mut2}
              style={{ backgroundColor: colors.sub, borderWidth: 0 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
