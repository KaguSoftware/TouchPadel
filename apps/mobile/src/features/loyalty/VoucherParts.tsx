/**
 * The two pieces a 15-minute code screen is built from, shared by the reward's
 * (`app/reward-voucher.tsx`, 0415) and the deal's (`app/deal-voucher.tsx`, 0445) so the two stay
 * the same screen: the bar that empties, and how a code ended.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { VOUCHER_LIFETIME_MS } from '@touch/core/loyalty';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { space, useTheme } from '../../theme';
import { voucherFraction, type VoucherPhase } from './vouchers';

/**
 * The 15 minutes as a bar that empties toward the reading start (right to left in English, left
 * to right in Arabic). One linear run on the native driver from where it is to empty, started
 * again whenever a read moves the clock; under Reduce Motion it follows the second tick.
 */
export function DrainBar({
  testID,
  msLeft,
  expiresAt,
  readAt,
  color,
  track,
}: {
  testID: string;
  msLeft: number;
  expiresAt: string;
  readAt: number;
  color: string;
  track: string;
}) {
  const { dir } = useLocale();
  const reduce = useReduceMotion();
  const [fill] = useState(() => new Animated.Value(voucherFraction(msLeft, VOUCHER_LIFETIME_MS)));
  useEffect(() => {
    if (reduce) return;
    fill.setValue(voucherFraction(msLeft, VOUCHER_LIFETIME_MS));
    const run = Animated.timing(fill, {
      toValue: 0,
      duration: Math.max(0, msLeft),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
    // A new read or a new voucher restarts the run; the tick does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt, readAt, reduce, fill]);
  useEffect(() => {
    if (reduce) fill.setValue(voucherFraction(msLeft, VOUCHER_LIFETIME_MS));
  }, [reduce, msLeft, fill]);
  return (
    <View
      style={{
        marginTop: space.s,
        alignSelf: 'stretch',
        height: 6,
        borderRadius: 3,
        backgroundColor: track,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        testID={testID}
        style={{
          height: 6,
          width: '100%',
          backgroundColor: color,
          transformOrigin: dir === 'rtl' ? 'right' : 'left',
          transform: [{ scaleX: fill }],
        }}
      />
    </View>
  );
}

/**
 * How a code ended: collected (green, the till scanned it), expired or cancelled. It fades in,
 * because the server ended it while the guest was looking at the code. `art` takes the place of
 * the clock on an expired or cancelled code (the deal's picture, when the screen has it).
 */
export function VoucherOutcome({
  testID,
  phase,
  title,
  body,
  art,
  children,
}: {
  testID: string;
  phase: VoucherPhase;
  title: string;
  body: string;
  art?: ReactNode;
  children: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  const reduce = useReduceMotion();
  const [shown] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) {
      shown.setValue(1);
      return;
    }
    const run = Animated.timing(shown, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.exp),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [phase, reduce, shown]);
  const collected = phase === 'collected';
  return (
    <Animated.View
      testID={testID}
      style={{ opacity: shown, gap: space.m, alignItems: 'stretch', marginTop: space.m }}
    >
      <View style={{ alignItems: 'center', gap: space.sm }}>
        {art && !collected ? (
          art
        ) : (
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: collected ? colors.gtint : colors.tint,
              borderWidth: 1,
              borderColor: collected ? colors.gstrong : colors.line,
            }}
          >
            <Svg width={44} height={44} viewBox="0 0 24 24" fill="none">
              {collected ? (
                <Path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  stroke={colors.gstrong}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <>
                  <Circle cx={12} cy={12} r={8.5} stroke={colors.mut} strokeWidth={1.8} />
                  <Path
                    d="M12 7.5V12l3 2"
                    stroke={colors.mut}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              )}
            </Svg>
          </View>
        )}
        <Text
          style={{
            fontFamily: fonts.display900,
            fontSize: 24,
            lineHeight: 30,
            color: colors.ink,
            textAlign: 'center',
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily: fonts.body400,
            fontSize: 15,
            lineHeight: 22,
            color: colors.mut,
            textAlign: 'center',
            paddingHorizontal: space.m,
          }}
        >
          {body}
        </Text>
      </View>
      <View style={{ gap: space.sm }}>{children}</View>
    </Animated.View>
  );
}
