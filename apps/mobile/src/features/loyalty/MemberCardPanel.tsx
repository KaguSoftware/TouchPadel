import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Animated, Easing, ScrollView, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  QR_INK,
  QR_PAPER,
  QUIET_MODULES,
  memberToken,
  qrModules,
  qrPath,
} from '@touch/core/loyalty';
import { isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { useAuth } from '../auth/context';
import { mapErrorToKey } from '../booking/errors';
import { useMemberCard, useRotateMemberCard } from './hooks';
import { msToNextTick, stepFraction } from './logic';
import { brand, palettes, radius, space, useTheme } from '../../theme';
import { Button, Hint, MicroLabel } from '../../components/ui';
import { useReduceMotion } from '../../lib/useReduceMotion';
import { ErrorState, SkeletonList } from '../../components/states';
import { useToast } from '../../components/overlays';

/** The widest the code is drawn: past this a phone held at arm's length gains nothing. */
const QR_MAX = 300;

/** The clock, ticking on whole seconds (the server's TOTP counter moves on them too). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      id = setTimeout(tick, msToNextTick(Date.now()));
    };
    id = setTimeout(tick, msToNextTick(Date.now()));
    return () => clearTimeout(id);
  }, []);
  return now;
}

/**
 * The QR, black on white with its quiet zone, whatever the theme: a scanner reads contrast, not
 * a brand (core qr.ts). One path of horizontal runs; the viewBox carries the quiet zone so the
 * white margin scales with the code.
 */
/**
 * The code's countdown (Sait, 2026-10-20): a bar that fills smoothly from the
 * reading start (left in English, right in Arabic) across the step, empty again
 * when the code changes. One linear run per code on the native driver, from
 * where the step already is, so it neither jumps a second at a time nor drifts
 * from the code (steps are whole multiples of `step` seconds since the epoch,
 * as memberToken's are). Under Reduce Motion it moves a second at a time.
 */
function CountdownBar({
  testID,
  token,
  step,
  secondsLeft,
}: {
  testID: string;
  token: string;
  step: number;
  secondsLeft: number;
}) {
  const { dir } = useLocale();
  const reduce = useReduceMotion();
  const [fill] = useState(() => new Animated.Value(0));
  const stepMs = (step > 0 ? step : 30) * 1000;
  useEffect(() => {
    if (reduce) return;
    const at = (Date.now() % stepMs) / stepMs;
    fill.setValue(at);
    const run = Animated.timing(fill, {
      toValue: 1,
      duration: stepMs * (1 - at),
      easing: Easing.linear,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [token, stepMs, reduce, fill]);
  // Reduce Motion: no run; the bar follows the panel's own second tick.
  useEffect(() => {
    if (reduce) fill.setValue(1 - stepFraction(secondsLeft, stepMs / 1000));
  }, [reduce, secondsLeft, stepMs, fill]);
  return (
    <View
      style={{
        marginTop: space.sm,
        alignSelf: 'stretch',
        height: 4,
        borderRadius: 2,
        // On the QR's white card in both themes, so the light palette's track and the
        // brand blue: blue mode's `blue` is white, and the fill vanished on the paper.
        backgroundColor: palettes.light.line,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        testID={testID}
        style={{
          height: 4,
          width: '100%',
          backgroundColor: brand.blue,
          // Grows from the reading start: the left edge in English, the right in Arabic.
          transformOrigin: dir === 'rtl' ? 'right' : 'left',
          transform: [{ scaleX: fill }],
        }}
      />
    </View>
  );
}

/** The code's size under the QR before it is fitted to the QR's width. */
const CODE_PT = 20;

function MemberQr({ token, size }: { token: string; size: number }) {
  const { d, size: modules } = useMemo(() => qrPath(qrModules(token)), [token]);
  const total = modules + QUIET_MODULES * 2;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`${-QUIET_MODULES} ${-QUIET_MODULES} ${total} ${total}`}
    >
      <Rect x={-QUIET_MODULES} y={-QUIET_MODULES} width={total} height={total} fill={QR_PAPER} />
      <Path d={d} fill={QR_INK} />
    </Svg>
  );
}

/**
 * The member card (loyalty plan §5.1; build contracts L-4): a rotating TOTP code as a QR the till
 * scans, and the member code under it for a till that types it instead. No phone number: it
 * left the card (Sait, 2026-10-20).
 *
 * The code is computed HERE, offline, from the card's secret (`memberToken`), and drawn again on
 * every step; the server accepts the current step ± 2. The card comes from `my_member_card`, or
 * from the copy SecureStore kept when there is no signal at the till (useMemberCard). "Get a new
 * code" rotates the secret, for a code that was shared or will not scan.
 *
 * The QR and the member code are LTR in both languages: they are marks and numbers,
 * not prose. No brightness change: expo-brightness is not a dependency (plan §5.1).
 *
 * A panel since 2026-10-19, so the Club tab (app/(tabs)/club.tsx) shows the same card the
 * pushed screen (app/member-card.tsx) does. Signed-in only: the caller gates the session.
 */
export function MemberCardPanel({
  testID,
  bottomPad,
  children,
}: {
  /** `<route>.<element>`; the parts take `${testID}.qr`, `.code`, `.progress`, `.new-code`, `.error`. */
  testID: string;
  /** Space under the last thing: the home indicator on a pushed screen, the tab bar on a tab. */
  bottomPad: number;
  /** Above the code: the Club tab puts the guest's points card here. */
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { card, cached, query } = useMemberCard(userId);
  const rotate = useRotateMemberCard(userId);
  const toast = useToast();
  const now = useNow();

  const live = card ? memberToken(card, now) : null;
  const qrSize = Math.min(QR_MAX, width - space.l * 2 - space.m * 2);
  // The code under the QR runs exactly the width of the QR's black squares (Sait,
  // 2026-10-20), not the drawing's, which carries the white quiet zone. An
  // unspaced twin measures the code's natural width at 20 pt: a narrower code
  // shares the gap that is left out between its letters, a wider one (the usual
  // 19 characters) is set smaller to fit.
  const [codeW, setCodeW] = useState<number | null>(null);
  // The compiler memoizes this on the token, as MemberQr's own useMemo does.
  const qrInkModules = live ? qrPath(qrModules(live.token)).size : 0;
  const qrInkW =
    qrInkModules > 0 ? (qrSize * qrInkModules) / (qrInkModules + QUIET_MODULES * 2) : qrSize;
  // The quiet zone's depth round the black squares: the line above and the code
  // below sit over it, a little off the squares.
  const qrQuiet = (qrSize - qrInkW) / 2;

  const onNewCode = () => {
    if (rotate.isPending) return;
    Alert.alert(t('loyalty.guest.card.newCodeTitle'), t('loyalty.guest.card.newCodeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('loyalty.guest.card.newCodeConfirm'),
        onPress: () =>
          rotate.mutate(undefined, {
            onSuccess: () => toast(t('loyalty.guest.card.newCodeDone'), 'info'),
            onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
          }),
      },
    ]);
  };

  const body = (() => {
    if (!card || !live) {
      if (query.isError) {
        return (
          <ErrorState
            testID={`${testID}.error`}
            title={t('loyalty.guest.card.error')}
            message={t(mapErrorToKey(query.error))}
            retryLabel={t('common.retry')}
            onRetry={() => void query.refetch()}
            busy={query.isRefetching}
          />
        );
      }
      return <SkeletonList rows={1} height={qrSize} />;
    }
    return (
      <ScrollView
        contentContainerStyle={{
          paddingTop: space.l,
          paddingBottom: bottomPad,
          alignItems: 'stretch',
          gap: space.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* What the card has earned, first (Majed, 2026-10-22): the Club tab's points card. */}
        {children}
        {/* The code: on white, edge to edge of its own card, in both themes. */}
        <View
          style={{
            alignItems: 'center',
            backgroundColor: QR_PAPER,
            borderRadius: radius.sheet,
            borderWidth: 1,
            borderColor: colors.line,
            // Tight round the code (Majed, 2026-10-22): the QR's own quiet zone is margin enough.
            paddingTop: space.m,
            paddingBottom: space.m,
            paddingStart: space.m,
            paddingEnd: space.m,
          }}
        >
          {/* What to do with it, on the white above the code (Sait, 2026-10-20). */}
          <Text
            style={{
              // Over the QR's white border, the same 12 pt from the squares as the code
              // below; in front of it, or the border's white square hides the line.
              marginBottom: space.sm - qrQuiet,
              zIndex: 1,
              fontFamily: fonts.body700,
              fontSize: 14,
              color: QR_INK,
              textAlign: 'center',
            }}
          >
            {t('loyalty.guest.card.show')}
          </Text>
          <View
            testID={`${testID}.qr`}
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('loyalty.guest.card.show')}
            style={{ direction: 'ltr' }}
          >
            <MemberQr token={live.token} size={qrSize} />
          </View>
          {/* The member code, for a till whose scanner is down: typed as printed,
              spread to the QR's width. Letter spacing also follows the last
              letter, so the box is one gap wider and nudged half a gap to stay centred. */}
          <Text
            accessible={false}
            importantForAccessibility="no"
            onTextLayout={(e) => setCodeW(e.nativeEvent.lines[0]?.width ?? null)}
            style={{
              position: 'absolute',
              opacity: 0,
              fontFamily: fonts.display800,
              fontSize: CODE_PT,
              fontVariant: ['tabular-nums'],
            }}
          >
            {live.token}
          </Text>
          {(() => {
            const n = live.token.length;
            const fits = codeW !== null && codeW <= qrInkW;
            const gap = codeW !== null && fits && n > 1 ? (qrInkW - codeW) / (n - 1) : 0;
            const fontSize = codeW !== null && !fits ? (CODE_PT * qrInkW) / codeW : CODE_PT;
            return (
              <Text
                testID={`${testID}.code`}
                numberOfLines={1}
                style={{
                  marginTop: space.sm - qrQuiet,
                  width: codeW !== null ? qrInkW + gap : undefined,
                  // The code reads left to right in both languages, so the nudge is physical.
                  transform: [{ translateX: gap / 2 }],
                  fontFamily: fonts.display800,
                  fontSize,
                  letterSpacing: gap,
                  color: QR_INK,
                  writingDirection: 'ltr',
                  fontVariant: ['tabular-nums'],
                  opacity: codeW !== null ? 1 : 0,
                }}
              >
                {live.token}
              </Text>
            );
          })()}
          {/* The countdown: the bar fills as the step runs out, then the code changes. */}
          <CountdownBar
            testID={`${testID}.progress`}
            token={live.token}
            step={card.step}
            secondsLeft={live.secondsLeft}
          />
          <Text
            style={{
              marginTop: 6,
              fontFamily: fonts.body600,
              fontSize: 12,
              color: colors.fnt,
              fontVariant: ['tabular-nums'],
            }}
          >
            {t('loyalty.guest.card.refreshesIn', { seconds: isolateLtr(String(live.secondsLeft)) })}
          </Text>
          {/* The till's other way in, said only: no number on the card (Sait, 2026-10-20).
              On the white, so in the paper's own muted ink in both themes. */}
          <Text
            style={{
              marginTop: space.sm,
              fontFamily: fonts.body600,
              fontSize: 13,
              color: palettes.light.mut,
              textAlign: 'center',
            }}
          >
            {t('loyalty.guest.card.sayNumber')}
          </Text>
        </View>

        <View style={{ alignItems: 'center' }}>
          <MicroLabel>{t('loyalty.guest.card.memberCode')}</MicroLabel>
          <Text
            style={{
              marginTop: 2,
              fontFamily: fonts.body700,
              fontSize: 15,
              letterSpacing: tracking(2),
              color: colors.mut,
              writingDirection: 'ltr',
            }}
          >
            {isolateLtr(card.member_code)}
          </Text>
          {cached ? (
            <Hint style={{ textAlign: 'center' }}>{t('loyalty.guest.card.offline')}</Hint>
          ) : null}
        </View>

        <Button
          testID={`${testID}.new-code`}
          label={t('loyalty.guest.card.newCode')}
          variant="secondary"
          size="medium"
          busy={rotate.isPending}
          onPress={onNewCode}
          // Sign out's ground (Sait, 2026-10-20): the page's own, so the brand lines
          // behind the Club tab do not show through it.
          style={{ backgroundColor: colors.bg }}
        />
      </ScrollView>
    );
  })();

  return body;
}
