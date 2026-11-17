import { ActivityIndicator, Pressable, View } from 'react-native';
import type { LoyaltyReward } from '@touch/core/loyalty';
import { formatNumber, isolateLtr } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { brand, radius, space, useTheme } from '../../theme';
import { DealDrawing, type DealDrawingKind } from './dealDrawings';
import { rewardName } from './logic';
import { rewardLadder, type RewardTile } from './rewardLadder';

/**
 * The rewards on Points & rewards (Majed, 2026-11-16, "AD-1", picked from the rewards directions):
 * two tiles a row, cheapest first, the ones the balance covers before a "You · 340" line and the
 * ones still to reach after it (the points track), each tile filling with green from the bottom
 * as the points come in (the fill), its top edge on a slant with a white line on it. All green is
 * ready, with Redeem on the tile. On each tile the drawing sits on top, the reward and its points
 * in the middle, Redeem or the points to go at the bottom.
 *
 * Theme-invariant like the deal posters: navy card shade, brand green, the poster drawings.
 * No gradients and no glow. The green copy of a tile's face is decoration (hidden from a screen
 * reader); the face under it carries the words.
 */

const TILE_HEIGHT = 158;
/** The fill's top edge rises toward the end side by this much (physical; flipped for Arabic). */
const SLANT_DEG = 4;

function drawingFor(r: LoyaltyReward): DealDrawingKind {
  if (r.kind === 'court_hour') return { kind: 'court' };
  if (r.kind === 'iqd_off') return { kind: 'bill' };
  return { kind: 'gift' };
}

function Tile({
  tile,
  busy,
  disabled,
  onRedeem,
}: {
  tile: RewardTile;
  busy: boolean;
  disabled: boolean;
  onRedeem: (r: LoyaltyReward) => void;
}) {
  const { t, locale, dir } = useLocale();
  const { fonts } = useTheme();
  const r = tile.reward;
  const pts = (n: number) => isolateLtr(formatNumber(n, locale));

  const face = (onGreen: boolean) => (
    <View style={{ height: TILE_HEIGHT, alignItems: 'center', paddingTop: 12, paddingBottom: 11, paddingHorizontal: 10 }}>
      <DealDrawing which={drawingFor(r)} ground={onGreen ? brand.green : brand.navyCard} size={44} />
      <View style={{ flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
        <Text
          numberOfLines={2}
          style={{
            fontFamily: fonts.body800,
            fontSize: 13.5,
            lineHeight: 17,
            textAlign: 'center',
            color: onGreen ? brand.greenInk : brand.white,
          }}
        >
          {rewardName(r, locale)}
        </Text>
        <Text
          style={{
            marginTop: 2,
            fontFamily: fonts.body700,
            fontSize: 11,
            lineHeight: 15,
            color: onGreen ? brand.greenInk : brand.navyText,
            fontVariant: ['tabular-nums'],
          }}
        >
          {t('loyalty.guest.rewards.pts', { points: pts(r.cost_points) })}
        </Text>
      </View>
      {tile.ready ? (
        <Pressable
          testID={`loyalty.reward.${r.id}.redeem`}
          accessibilityRole="button"
          accessibilityLabel={`${t('loyalty.guest.rewards.redeem')}, ${rewardName(r, locale)}`}
          accessibilityState={{ disabled, busy }}
          disabled={disabled}
          hitSlop={6}
          onPress={() => onRedeem(r)}
          style={({ pressed }) => ({
            minWidth: 92,
            height: 30,
            paddingHorizontal: 16,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: brand.navy,
            opacity: pressed ? 0.85 : disabled && !busy ? 0.6 : 1,
          })}
        >
          {busy ? (
            <ActivityIndicator size="small" color={brand.white} />
          ) : (
            <Text style={{ fontFamily: fonts.body800, fontSize: 12, color: brand.white }}>
              {t('loyalty.guest.rewards.redeem')}
            </Text>
          )}
        </Pressable>
      ) : (
        <Text
          style={{
            fontFamily: fonts.body800,
            fontSize: 11,
            lineHeight: 30,
            color: onGreen ? brand.greenInk : brand.navyText,
            fontVariant: ['tabular-nums'],
          }}
        >
          {t('loyalty.guest.rewards.toGo', { points: pts(tile.toGo) })}
        </Text>
      )}
    </View>
  );

  // The fill: a box from the green's height down, skewed so its top edge slants, and the green
  // face inside it skewed back by the same angle. skewY moves a point by its distance from the
  // middle across, which both share, so the face lands exactly on the tile while the edge slants.
  const fillTop = Math.round(TILE_HEIGHT * (1 - tile.fraction));
  const skew = `${dir === 'rtl' ? SLANT_DEG : -SLANT_DEG}deg`;
  const unskew = `${dir === 'rtl' ? -SLANT_DEG : SLANT_DEG}deg`;

  return (
    <View
      testID={`loyalty.reward.${r.id}`}
      style={{
        width: '48.4%',
        height: TILE_HEIGHT,
        borderRadius: radius.card,
        overflow: 'hidden',
        backgroundColor: tile.ready ? brand.green : brand.navyCard,
      }}
    >
      {tile.ready ? (
        face(true)
      ) : (
        <>
          {face(false)}
          {tile.fraction > 0 ? (
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                position: 'absolute',
                start: 0,
                end: 0,
                top: fillTop,
                bottom: -14,
                overflow: 'hidden',
                transform: [{ skewY: skew }],
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  start: 0,
                  end: 0,
                  top: -fillTop,
                  height: TILE_HEIGHT,
                  backgroundColor: brand.green,
                  transform: [{ skewY: unskew }],
                }}
              >
                {face(true)}
              </View>
              {/* The line on the fill's edge. */}
              <View style={{ position: 'absolute', start: 0, end: 0, top: 0, height: 3, backgroundColor: brand.white }} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** "You · 340" across the grid, green behind (what the balance covers), grey ahead. */
function YouLine({ balance, next, after }: { balance: number; next: RewardTile; after: boolean }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const pts = (n: number) => isolateLtr(formatNumber(n, locale));
  return (
    <View
      testID="loyalty.rewards.you"
      style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 }}
    >
      {after ? <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: colors.gstrong }} /> : null}
      <View style={{ borderRadius: radius.pill, backgroundColor: brand.blue, paddingVertical: 4, paddingHorizontal: 10 }}>
        <Text style={{ fontFamily: fonts.body800, fontSize: 11, color: brand.white, fontVariant: ['tabular-nums'] }}>
          {t('loyalty.guest.rewards.you', { points: pts(balance) })}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontFamily: fonts.body700, fontSize: 11, color: colors.mut }}
      >
        {t('loyalty.guest.rewards.next', { reward: rewardName(next.reward, locale), points: pts(next.toGo) })}
      </Text>
      <View style={{ flex: 1, minWidth: 12, height: 3, borderRadius: 2, backgroundColor: colors.line }} />
    </View>
  );
}

export function RewardTiles({
  rewards,
  balance,
  busyId,
  disabled,
  onRedeem,
}: {
  rewards: readonly LoyaltyReward[];
  balance: number;
  /** The reward whose Redeem is on its way. */
  busyId: string | null;
  disabled: boolean;
  onRedeem: (r: LoyaltyReward) => void;
}) {
  const { t } = useLocale();
  const { colors, fonts } = useTheme();

  if (rewards.length === 0) {
    return (
      <View
        accessibilityLabel={t('loyalty.guest.rewards.empty')}
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}
      >
        {[0, 1].map((i) => (
          <View
            key={i}
            testID={`loyalty.reward-soon.${i}`}
            style={{
              width: '48.4%',
              height: TILE_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.card,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: colors.line,
            }}
          >
            <Text style={{ fontFamily: fonts.body400, fontSize: 12, color: colors.mut }}>
              {t('loyalty.guest.rewards.soon')}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  const ladder = rewardLadder(rewards, balance);
  const tile = (x: RewardTile) => (
    <Tile key={x.reward.id} tile={x} busy={busyId === x.reward.id} disabled={disabled} onRedeem={onRedeem} />
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm }}>
      {ladder.ready.map(tile)}
      {ladder.next ? <YouLine balance={balance} next={ladder.next} after={ladder.ready.length > 0} /> : null}
      {ladder.ahead.map(tile)}
    </View>
  );
}
