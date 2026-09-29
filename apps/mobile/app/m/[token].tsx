import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { countPhrase, formatDate, formatTime } from '@touch/i18n';
import { pickLocale } from '@touch/core';
import { Text } from '../../src/i18n/text';
import { useLocale } from '../../src/i18n/LocaleProvider';
import { useAuth } from '../../src/features/auth/context';
import { DEFAULT_TZ } from '../../src/features/availability/assemble';
import { requestBookingSheet } from '../../src/features/courtTransition/openIntent';
import { useMatchByToken, useMatchInvite } from '../../src/features/matches/hooks';
import { byCategory, type MatchCategory } from '../../src/features/matches/logic';
import { errorCodeOf, refusalKey } from '../../src/features/matches/errors';
import { isMatchToken } from '../../src/features/matches/links';
import { setPendingJoin } from '../../src/features/matches/pendingJoin';
import { radius, space, useTheme } from '../../src/theme';
import { Button, Screen } from '../../src/components/ui';
import { ErrorState } from '../../src/components/states';
import { CategoryPill, MatchRestrictedCard } from '../../src/components/match';

/**
 * The invite link's landing (docs/design/open-matches/guest.md §4.18,
 * route `match-link`). Every spelling of an invite (`/m`, `/en/m`, `/ar/m`,
 * the https origin, the custom scheme) reaches here through +native-intent.
 *
 * No session guard: signed out, the guest sees the DF-9 card (day, time,
 * branch, category, seats left; no names, no price) and signs in or signs up
 * with a `pendingJoin` that brings them back here. Signed in, the match's
 * detail by token decides: the full shape opens the match screen with the
 * token, a restricted viewer (banned, the other gender, a block either way)
 * gets the restricted card in place (R32), and a gone match the closed
 * layout. Signing in never joins by itself (GD-2). The stored branch is
 * never written (DF-1).
 */
export default function MatchLinkScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const token = isMatchToken(params.token) ? params.token : null;
  const { session, initializing } = useAuth();
  if (!token) return <ClosedLayout />;
  if (initializing) return <Waiting />;
  return session ? <SignedIn token={token} /> : <SignedOut token={token} />;
}

function Waiting() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  return (
    <Screen edges={['top', 'bottom']}>
      <View
        testID="match-link.waiting"
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm }}
      >
        <ActivityIndicator color={colors.blue} size="large" />
        <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, color: colors.mut }}>
          {t('matches.link.waiting')}
        </Text>
      </View>
    </Screen>
  );
}

function useFindMatch(): () => void {
  const router = useRouter();
  return () => {
    requestBookingSheet();
    router.replace('/(tabs)');
  };
}

/** "This match is no longer open" and "Find a match" (a bad token, a gone match, a closed invite). */
function ClosedLayout() {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const find = useFindMatch();
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.l }}>
        <Text
          testID="match-link.closed"
          style={{
            fontFamily: fonts.display900,
            fontSize: 22,
            color: colors.ink,
            textAlign: 'center',
          }}
        >
          {t('matches.link.closed')}
        </Text>
        <Button
          testID="match-link.find"
          label={t('matches.link.find')}
          variant="cta"
          onPress={find}
        />
      </View>
    </Screen>
  );
}

function SignedIn({ token }: { token: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const find = useFindMatch();
  const byToken = useMatchByToken(token);
  const view = byToken.data ?? null;
  const restricted = view?.restricted === true;
  // The restricted card's day and branch come from the public invite (no names).
  const invite = useMatchInvite(restricted ? token : null);

  useEffect(() => {
    if (view && !view.restricted) {
      router.replace({ pathname: '/match/[id]', params: { id: view.id, t: token } });
    }
  }, [view, router, token]);

  if (byToken.isError) {
    if (errorCodeOf(byToken.error) === 'MATCH_NOT_FOUND') return <ClosedLayout />;
    return (
      <Screen edges={['top', 'bottom']}>
        <ErrorState
          testID="match-link.error"
          title={t('errors.loadFailedTitle')}
          message={t('matches.link.error')}
          retryLabel={t('common.retry')}
          onRetry={() => void byToken.refetch()}
          busy={byToken.isRefetching}
        />
      </Screen>
    );
  }
  if (!view || !view.restricted) return <Waiting />;

  const card = invite.data && invite.data.status !== 'closed' ? invite.data : null;
  const tz = card?.timezone ?? view.timezone ?? DEFAULT_TZ;
  const startAt = card?.startAt ?? view.startAt;
  const venue = card?.venue ?? view.venue;
  const start = startAt ? new Date(startAt) : null;
  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingTop: space.l }}
      >
        <MatchRestrictedCard
          testID="match-link"
          when={
            start ? `${formatDate(start, locale, tz)} · ${formatTime(start, locale, tz)}` : null
          }
          branch={
            venue
              ? pickLocale({ en: venue.nameEn ?? '', ar: venue.nameAr ?? '' }, locale) || null
              : null
          }
          category={card?.category ?? view.category}
          message={t(refusalKey(view.refusal))}
          onFind={find}
        />
      </ScrollView>
    </Screen>
  );
}

function SignedOut({ token }: { token: string }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const invite = useMatchInvite(token);

  if (invite.isError) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ErrorState
          testID="match-link.error"
          title={t('errors.loadFailedTitle')}
          message={t('matches.link.error')}
          retryLabel={t('common.retry')}
          onRetry={() => void invite.refetch()}
          busy={invite.isRefetching}
        />
      </Screen>
    );
  }
  if (!invite.data) return <Waiting />;
  if (invite.data.status === 'closed') return <ClosedLayout />;

  const m = invite.data;
  const tz = m.timezone ?? DEFAULT_TZ;
  const start = new Date(m.startAt);
  const branch = pickLocale({ en: m.venue.nameEn ?? '', ar: m.venue.nameAr ?? '' }, locale);
  // Both ways in come back here after the auth flow (continueAfterAuth).
  const go = (pathname: '/sign-in' | '/sign-up') => {
    setPendingJoin({ kind: 'link', token });
    router.push(pathname);
  };
  const cat: MatchCategory = m.category;
  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingTop: space.l }}
      >
        <View
          testID="match-link.card"
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.card,
            padding: space.l,
            gap: 8,
          }}
        >
          <Text style={{ fontFamily: fonts.display900, fontSize: 18, color: colors.ink }}>
            {t('matches.common.title')}
          </Text>
          <Text style={{ fontFamily: fonts.display900, fontSize: 30, color: colors.ink }}>
            {formatTime(start, locale, tz)}
          </Text>
          <Text style={{ fontFamily: fonts.body600, fontSize: 13.5, color: colors.mut2 }}>
            {[formatDate(start, locale, tz), branch].filter(Boolean).join(' · ')}
          </Text>
          <CategoryPill category={cat} />
          <Text style={{ fontFamily: fonts.body700, fontSize: 13.5, color: colors.gtext }}>
            {m.status === 'full'
              ? t('matches.link.full')
              : countPhrase('matches.count.seatsLeft', m.seatsLeft, locale)}
          </Text>
          {m.joinPolicy === 'approve' ? (
            <Text style={{ fontFamily: fonts.body400, fontSize: 13, color: colors.mut2 }}>
              {t(byCategory(cat, 'matches.common.approves'))}
            </Text>
          ) : null}
        </View>
        <Button
          testID="match-link.sign-in"
          label={t('matches.link.signIn')}
          variant="cta"
          onPress={() => go('/sign-in')}
          style={{ marginTop: space.l }}
        />
        <Button
          testID="match-link.sign-up"
          label={t('matches.link.signUp')}
          variant="secondary"
          onPress={() => go('/sign-up')}
          style={{ marginTop: space.sm }}
        />
      </ScrollView>
    </Screen>
  );
}
