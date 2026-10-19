import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, ScrollView, View, useWindowDimensions } from 'react-native';
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
import { useOwnProfile } from '../profile/hooks';
import { displayPhone } from '../profile/phone';
import { mapErrorToKey } from '../booking/errors';
import { useMemberCard, useRotateMemberCard } from './hooks';
import { msToNextTick, stepFraction } from './logic';
import { radius, space, useTheme } from '../../theme';
import { Button, Hint, MicroLabel } from '../../components/ui';
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
 * scans, the member code under it, and the guest's number for a till that types it instead.
 *
 * The code is computed HERE, offline, from the card's secret (`memberToken`), and drawn again on
 * every step; the server accepts the current step ± 2. The card comes from `my_member_card`, or
 * from the copy SecureStore kept when there is no signal at the till (useMemberCard). "Get a new
 * code" rotates the secret, for a code that was shared or will not scan.
 *
 * The QR, the member code and the phone are LTR in both languages: they are marks and numbers,
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
  /** `<route>.<element>`; the parts take `${testID}.qr`, `.code`, `.progress`, `.phone`, `.new-code`, `.error`. */
  testID: string;
  /** Space under the last thing: the home indicator on a pushed screen, the tab bar on a tab. */
  bottomPad: number;
  /** After "Get a new code": the Club tab puts the guest's points here. */
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const profile = useOwnProfile(!!session);
  const { card, cached, query } = useMemberCard(userId);
  const rotate = useRotateMemberCard(userId);
  const toast = useToast();
  const now = useNow();

  const live = card ? memberToken(card, now) : null;
  const qrSize = Math.min(QR_MAX, width - space.l * 2 - space.xl * 2);
  const phone = profile.data?.phone ? displayPhone(profile.data.phone) : '';

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
        {/* The code: on white, edge to edge of its own card, in both themes. */}
        <View
          style={{
            alignItems: 'center',
            backgroundColor: QR_PAPER,
            borderRadius: radius.sheet,
            borderWidth: 1,
            borderColor: colors.line,
            paddingTop: space.xl,
            paddingBottom: space.l,
            paddingStart: space.xl,
            paddingEnd: space.xl,
          }}
        >
          <View
            testID={`${testID}.qr`}
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('loyalty.guest.card.show')}
            style={{ direction: 'ltr' }}
          >
            <MemberQr token={live.token} size={qrSize} />
          </View>
          {/* The member code, for a till whose scanner is down: typed as printed. */}
          <Text
            testID={`${testID}.code`}
            style={{
              marginTop: space.sm,
              fontFamily: fonts.display800,
              fontSize: 20,
              letterSpacing: tracking(3),
              color: QR_INK,
              textAlign: 'center',
              writingDirection: 'ltr',
              fontVariant: ['tabular-nums'],
            }}
          >
            {isolateLtr(live.token)}
          </Text>
          {/* The countdown: the bar empties as the step runs out, then the code changes. */}
          <View
            style={{
              marginTop: space.sm,
              alignSelf: 'stretch',
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.line,
              overflow: 'hidden',
              direction: 'ltr',
            }}
          >
            <View
              testID={`${testID}.progress`}
              style={{
                height: 4,
                width: `${Math.round(stepFraction(live.secondsLeft, card.step) * 100)}%`,
                backgroundColor: colors.blue,
              }}
            />
          </View>
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
        </View>

        <View style={{ alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 14,
              color: colors.ink,
              textAlign: 'center',
            }}
          >
            {t('loyalty.guest.card.show')}
          </Text>
          <MicroLabel style={{ marginTop: space.s }}>
            {t('loyalty.guest.card.memberCode')}
          </MicroLabel>
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

        {/* "Or say your number": the till's other way in, exact match on the phone. */}
        {phone ? (
          <View style={{ alignItems: 'center' }}>
            <Text
              testID={`${testID}.phone`}
              style={{
                fontFamily: fonts.display900,
                fontSize: 28,
                color: colors.ink,
                writingDirection: 'ltr',
                fontVariant: ['tabular-nums'],
              }}
            >
              {isolateLtr(phone)}
            </Text>
            <Text
              style={{
                marginTop: 4,
                fontFamily: fonts.body600,
                fontSize: 13,
                color: colors.mut,
                textAlign: 'center',
              }}
            >
              {t('loyalty.guest.card.sayNumber')}
            </Text>
          </View>
        ) : (
          <Text
            style={{
              fontFamily: fonts.body600,
              fontSize: 13,
              color: colors.mut,
              textAlign: 'center',
            }}
          >
            {t('loyalty.guest.card.sayNumber')}
          </Text>
        )}

        <Button
          testID={`${testID}.new-code`}
          label={t('loyalty.guest.card.newCode')}
          variant="secondary"
          size="medium"
          busy={rotate.isPending}
          onPress={onNewCode}
          style={{ backgroundColor: 'transparent' }}
        />
        {children}
      </ScrollView>
    );
  })();

  return body;
}
