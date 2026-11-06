/**
 * Sign-in's one field: an email or a phone number. Once what is typed is a
 * phone number, its country slides into the field's leading edge as a chip
 * (flag and dial code) and the field keeps only the rest of the number:
 *
 *   0770…      Iraq's chip appears, the digits stay as written (0770 123 4567)
 *   +44…       the moment `+44` is complete it slides left into the chip and
 *              the field holds what follows, grouped for that country
 *   backspace  at the very start of the field takes the code back out
 *
 * The label is a floating one: it rests inside the field where a placeholder
 * would, and glides up above the box (shrinking) when the field is focused or
 * holds anything, and back when it is emptied and left.
 *
 * Tapping the chip opens the same country sheet the phone field uses; the
 * number is kept across a change of country.
 *
 * The VALUE this component takes and gives is the plain text the screen keeps
 * (features/auth/identifier.ts): `+447700900123`, `07701234567` or an email.
 * The chip and the grouping are display only. `testID` is REQUIRED: the chip
 * takes `${testID}.country`.
 *
 * Motion holds still under the OS "Reduce Motion". The box is held
 * left-to-right while a chip shows, as the phone field does (a dial code
 * precedes the digits in every language).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { useReduceMotion } from '../lib/useReduceMotion';
import { space, useTheme } from '../theme';
import { Field, LINE } from './ui';
import { Chevron, CountryPicker } from './phone';
import { FloatingLabel } from './FloatingLabel';
import {
  DEFAULT_ISO,
  countryByIso,
  flagOf,
  formatNational,
  sanitizeNationalInput,
} from '../features/profile/phone';
import {
  formatLocal,
  identifierKind,
  normalizeIdentifier,
  splitCountryCode,
} from '../features/auth/identifier';

const SLIDE = 18;
const ENTER_MS = 320;
const EXIT_MS = 200;

export function IdentifierField({
  testID,
  value,
  onChangeText,
  placeholder,
  error,
  onSubmitEditing,
  style,
}: {
  testID: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  error?: string | null;
  onSubmitEditing?: () => void;
  /** Lands on the wrapper (the margin against the neighbour above). */
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, fonts } = useTheme();
  const { t } = useLocale();
  const reduceMotion = useReduceMotion();
  const found = splitCountryCode(value);
  // A dial code several countries share (+1) names its main country; the one
  // the guest picked for it is remembered so the chip shows their choice.
  const [picked, setPicked] = useState<{ dial: string; iso: string } | null>(null);
  const cc = found && picked && picked.dial === found.dial ? { ...found, iso: picked.iso } : found;
  const [pickerOpen, setPickerOpen] = useState(false);
  const local = !cc && identifierKind(value) === 'phone';
  const chipIso = cc ? cc.iso : local ? DEFAULT_ISO : null;
  const chipDial = cc ? cc.dial : local ? countryByIso(DEFAULT_ISO).dial : null;

  // The chip slides in when it first shows and again when the country changes,
  // and fades out the other way when the number is cleared: `leaving` keeps the
  // last chip on screen until that fade ends. Layout effects, so each reset
  // lands before the first painted frame.
  const [enter] = useState(() => new Animated.Value(1));
  const [leaving, setLeaving] = useState<{ iso: string; dial: string } | null>(null);
  const lastChip = useRef<{ iso: string; dial: string } | null>(null);
  const shownDial = useRef<string | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );
  useLayoutEffect(() => {
    if (chipIso && chipDial) lastChip.current = { iso: chipIso, dial: chipDial };
  }, [chipIso, chipDial]);
  useLayoutEffect(() => {
    if (chipDial === shownDial.current) return;
    const cleared = shownDial.current !== null && chipDial === null;
    shownDial.current = chipDial;
    enter.stopAnimation();
    if (exitTimer.current) clearTimeout(exitTimer.current);
    if (chipDial === null) {
      if (cleared && !reduceMotion && lastChip.current) {
        setLeaving(lastChip.current);
        Animated.timing(enter, {
          toValue: 0,
          duration: EXIT_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start();
        // A timer, not the animation's callback: the chip is removed on time
        // whether or not the native driver reports back.
        exitTimer.current = setTimeout(() => setLeaving(null), EXIT_MS + 40);
      }
      return;
    }
    setLeaving(null);
    if (reduceMotion) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chipDial, reduceMotion, enter]);
  // What the chip draws: the live country, or the one fading out.
  const view = chipIso && chipDial ? { iso: chipIso, dial: chipDial } : leaving;

  const selection = useRef({ start: 0, end: 0 });
  const [forced, setForced] = useState<{ start: number; end: number } | null>(null);

  const shown = cc ? formatNational(cc.iso, cc.rest) : local ? formatLocal(value) : value;

  // The floating label is up while focused or holding anything (the chip counts).
  const [focused, setFocused] = useState(false);
  const floated = focused || shown !== '' || view !== null;

  const onType = (text: string) => {
    if (cc && !text.includes('+')) {
      // Everything cleared at once (select all, delete): the code goes too and
      // its chip fades out. Deleting the LAST digit leaves the code in place.
      if (text === '' && shown.length > 1) {
        onChangeText('');
        return;
      }
      // The code is in the chip: the field holds the rest, capped for the country.
      onChangeText(`+${cc.dial}${sanitizeNationalInput(text, cc.iso)}`);
      return;
    }
    onChangeText(normalizeIdentifier(text));
  };

  return (
    <FloatingLabel label={placeholder ?? ''} floated={floated} style={style}>
      <Field
        testID={testID}
        value={shown}
        onChangeText={onType}
        accessibilityLabel={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        error={error}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        onSubmitEditing={onSubmitEditing}
        ltrBox={view !== null}
        selection={forced ?? undefined}
        onSelectionChange={(e) => {
          selection.current = e.nativeEvent.selection;
          if (forced && e.nativeEvent.selection.start === forced.start) setForced(null);
        }}
        onKeyPress={(e) => {
          // Backspace at the very start takes the code back out of the chip.
          if (
            e.nativeEvent.key === 'Backspace' &&
            cc &&
            selection.current.start === 0 &&
            selection.current.end === 0
          ) {
            onChangeText(`+${cc.dial.slice(0, -1)}${cc.rest}`);
            setForced({ start: cc.dial.length, end: cc.dial.length });
          }
        }}
        lead={
          view ? (
            <Animated.View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                // Field's own inset on the outside, so the flag starts where a plain
                // field's first character does.
                paddingStart: space.m,
                alignSelf: 'stretch',
                opacity: enter,
                transform: [
                  {
                    translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [-SLIDE, 0] }),
                  },
                ],
              }}
            >
              <Pressable
                testID={`${testID}.country`}
                accessibilityRole="button"
                accessibilityLabel={t('auth.countryCode')}
                accessibilityValue={{ text: `+${view.dial}` }}
                disabled={leaving !== null}
                onPress={() => setPickerOpen(true)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  alignSelf: 'stretch',
                  paddingEnd: 10,
                }}
              >
                <Text style={{ fontSize: 15, lineHeight: LINE }}>{flagOf(view.iso)}</Text>
                <Text
                  style={{
                    fontFamily: fonts.body600,
                    fontSize: 14,
                    lineHeight: LINE,
                    color: colors.ink,
                    writingDirection: 'ltr',
                  }}
                >
                  {`+${view.dial}`}
                </Text>
                <Chevron color={colors.fnt} />
              </Pressable>
              <View
                style={{
                  position: 'absolute',
                  end: 0,
                  top: 12,
                  bottom: 12,
                  width: 1,
                  backgroundColor: colors.line2,
                }}
              />
            </Animated.View>
          ) : undefined
        }
      />
      <CountryPicker
        testID={`${testID}.country`}
        visible={pickerOpen}
        selected={chipIso ?? DEFAULT_ISO}
        onSelect={(iso) => {
          setPickerOpen(false);
          const dial = countryByIso(iso).dial;
          // The number is kept across a change of country, re-capped for the new one.
          const digits = cc ? cc.rest : value.replace(/[^0-9]/g, '').replace(/^0+/, '');
          setPicked({ dial, iso });
          onChangeText(`+${dial}${sanitizeNationalInput(digits, iso)}`);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </FloatingLabel>
  );
}
