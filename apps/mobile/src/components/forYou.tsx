/**
 * "For you": what the play survey's answers point at
 * (docs/design/play-coaches/contracts-2026-10-11.md §7, §8).
 *
 *   ForYouStrip     the Play tab mounts it above its timeline. One to three
 *                   suggestions, each with its "why" line, in a single card;
 *                   with no answers yet, one gentle card that opens the survey
 *                   and can be put away (remembered on the phone). Reads
 *                   everything it needs itself: the play profile from the
 *                   own-profile cache the tabs already hold.
 *   SuggestionRow   one suggestion as a pressable row; the survey's "Here's
 *                   where to start" page uses it too.
 *
 * Order only, never a filter (suggest.ts): the Play tab below the strip still
 * lists everything. Signed out, staff, or a profile not known yet: nothing.
 */
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '../i18n/text';
import { useLocale } from '../i18n/LocaleProvider';
import { radius, space, useTheme } from '../theme';
import { useAuth } from '../features/auth/context';
import { usePlayProfile } from '../features/playProfile/hooks';
import { hasAnswers } from '../features/playProfile/logic';
import { topSuggestions, type Suggestion, type SuggestionKind } from '../features/playProfile/suggest';
import { suggestionTarget } from '../features/playProfile/links';
import { dismissAsk, useAskDismissed } from '../features/playProfile/askDismissed';
import { Rise, TiltPress } from './motion';
import {
  CalendarIcon,
  ChevronIcon,
  CloseIcon,
  PadelBallIcon,
  SparkIcon,
  TrophyIcon,
  WhistleIcon,
} from './icons';

const MAX_STRIP = 3;

function KindIcon({ kind, color }: { kind: SuggestionKind; color: string }) {
  switch (kind) {
    case 'coaches':
      return <WhistleIcon size={17} color={color} />;
    case 'classes':
      return <CalendarIcon size={17} color={color} />;
    case 'matches':
      return <PadelBallIcon size={18} />;
    default:
      return <TrophyIcon size={17} color={color} />;
  }
}

/** Opens a suggestion: a tab (with the Play tab's chip) or the group sessions list. */
export function useOpenSuggestion() {
  const router = useRouter();
  return (kind: SuggestionKind) => {
    const target = suggestionTarget(kind);
    if (target.kind === 'push') router.push(target.href);
    else router.navigate(target.href);
  };
}

/** One suggestion: icon, what it is, and why it is here. */
export function SuggestionRow({
  testID,
  suggestion,
  onPress,
  last,
}: {
  testID: string;
  suggestion: Suggestion;
  onPress: () => void;
  last?: boolean;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const title = t(`playProfile.kind.${suggestion.kind}`);
  const why = t(`playProfile.why.${suggestion.reason}`);
  return (
    <TiltPress testID={testID} onPress={onPress} accessibilityLabel={`${title}. ${why}`}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingStart: space.l,
          paddingEnd: space.m,
          paddingTop: space.m,
          paddingBottom: space.m,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.line,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: radius.pill,
            backgroundColor: colors.gtint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <KindIcon kind={suggestion.kind} color={colors.gstrong} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink, textAlign: 'auto' }}>
            {title}
          </Text>
          <Text
            numberOfLines={2}
            style={{ marginTop: 2, fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut, textAlign: 'auto' }}
          >
            {why}
          </Text>
        </View>
        <ChevronIcon size={16} color={colors.fnt2} />
      </View>
    </TiltPress>
  );
}

/** The gentle ask: no answers yet, never asked on this account, not put away. */
function AskCard({ testID }: { testID: string }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  return (
    <Rise>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        {/* TiltPress styles its inner view, so the row's flex goes on a wrapper. */}
        <View style={{ flex: 1 }}>
        <TiltPress
          testID={`${testID}.ask`}
          onPress={() => router.push('/play-survey')}
          accessibilityLabel={`${t('playProfile.forYou.askTitle')}. ${t('playProfile.forYou.askBody')}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingStart: space.l,
            paddingTop: space.m,
            paddingBottom: space.m,
          }}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.pill,
              backgroundColor: colors.tint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SparkIcon size={17} color={colors.blue} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.body700, fontSize: 14.5, color: colors.ink, textAlign: 'auto' }}>
              {t('playProfile.forYou.askTitle')}
            </Text>
            <Text
              style={{ marginTop: 2, fontFamily: fonts.body400, fontSize: 12.5, color: colors.mut, textAlign: 'auto' }}
            >
              {t('playProfile.forYou.askBody')}
            </Text>
          </View>
        </TiltPress>
        </View>
        <Pressable
          testID={`${testID}.ask-dismiss`}
          accessibilityRole="button"
          accessibilityLabel={t('playProfile.forYou.askDismiss')}
          onPress={dismissAsk}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            alignSelf: 'stretch',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <CloseIcon size={15} color={colors.fnt} />
        </Pressable>
      </View>
    </Rise>
  );
}

export function ForYouStrip({ testID, surface }: { testID: string; surface: 'play' }) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const { session } = useAuth();
  const play = usePlayProfile();
  const dismissed = useAskDismissed();
  const open = useOpenSuggestion();

  if (!session || session.user.is_anonymous || !play) return null;

  if (!hasAnswers(play)) {
    // A skip is an answer too: only an account that was never asked meets the card.
    if (play.answeredAt !== null || dismissed !== false) return null;
    return <AskCard testID={testID} />;
  }

  const top = topSuggestions(play, MAX_STRIP);
  if (top.length === 0) return null;
  return (
    <View testID={`${testID}.${surface}`}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: space.s,
          paddingStart: space.xs,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.display800,
            fontSize: 15,
            color: colors.ink,
            textAlign: 'auto',
          }}
        >
          {t('playProfile.forYou.title')}
        </Text>
        <Pressable
          testID={`${testID}.edit`}
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.push({ pathname: '/play-survey', params: { mode: 'edit' } })}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingStart: space.s })}
        >
          <Text style={{ fontFamily: fonts.body700, fontSize: 12.5, color: colors.blue }}>
            {t('playProfile.forYou.change')}
          </Text>
        </Pressable>
      </View>
      <View
        style={{
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        {top.map((s, i) => (
          <Rise key={s.kind} index={i}>
            <SuggestionRow
              testID={`${testID}.${s.kind}`}
              suggestion={s}
              onPress={() => open(s.kind)}
              last={i === top.length - 1}
            />
          </Rise>
        ))}
      </View>
    </View>
  );
}
