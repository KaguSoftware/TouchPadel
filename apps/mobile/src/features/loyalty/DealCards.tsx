import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Deal, DealVoucher, MyDeals } from '@touch/core/loyalty';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Hint, MicroLabel } from '../../components/ui';
import { CheckIcon, LockIcon } from '../../components/icons';
import { useToast } from '../../components/overlays';
import { brand, palettes, radius, space, useTheme } from '../../theme';
import { mapErrorToKey } from '../booking/errors';
import { DealArt } from './DealArt';
import { DealSheet } from './DealSheet';
import { dealName } from './deals';
import { liveDealVoucher } from './dealVouchers';
import { dealValueText } from './dealText';
import { useMyDealVouchers, useRedeemDeal } from './hooks';
import { tierName } from './logic';

export { dealFacts, dealHeadline, dealValueText, type DealFact } from './dealText';

/** The small word in a deal picture's corner. It sits on the picture, so it is theme-invariant. */
export function DealTag({ deal, voucher }: { deal: Deal; voucher: DealVoucher | null }) {
  const { t, locale } = useLocale();
  const { fonts } = useTheme();
  const paper = palettes.light;
  const look =
    deal.state === 'open' && voucher
      ? { bg: brand.green, fg: brand.greenInk, label: t('loyalty.guest.deals.redeemed'), icon: 'check' as const }
      : deal.state === 'used'
        ? { bg: brand.navyCard, fg: brand.navyText, label: t('loyalty.guest.deals.used'), icon: null }
        : deal.state === 'locked' && deal.tier
          ? { bg: brand.navyCard, fg: brand.white, label: tierName(deal.tier, locale), icon: 'lock' as const }
          : deal.state === 'open' && !deal.live_now
            ? { bg: paper.amb, fg: paper.ambtext, label: t('loyalty.guest.deals.notNow'), icon: null }
            : null;
  if (!look) return null;
  const Icon = look.icon === 'check' ? CheckIcon : look.icon === 'lock' ? LockIcon : null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: radius.pill,
        backgroundColor: look.bg,
        paddingVertical: 3,
        paddingHorizontal: 8,
      }}
    >
      {Icon ? <Icon size={11} color={look.fg} strokeWidth={2.4} /> : null}
      <Text numberOfLines={1} style={{ fontFamily: fonts.body700, fontSize: 11, color: look.fg }}>
        {look.label}
      </Text>
    </View>
  );
}

/** A card's height: one to a row, the picture is the whole card. */
const TILE_HEIGHT = 136;

/**
 * One deal on a list (Majed, 2026-11-15, third pass: B+ posters, full width): the picture with
 * the deal's name over its value, one to a row. Its line, every fact and Redeem are in the sheet
 * a tap opens. A screen reader hears the name and the value.
 */
function DealTile({
  testID,
  deal,
  voucher,
  onOpen,
}: {
  testID: string;
  deal: Deal;
  voucher: DealVoucher | null;
  onOpen: () => void;
}) {
  const { t, locale } = useLocale();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={`${testID}.deal.${deal.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${dealName(deal, locale)}. ${dealValueText(deal, t, locale)}`}
      accessibilityHint={t('loyalty.guest.deals.detailsHint')}
      onPress={onOpen}
      style={({ pressed }) => ({
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: voucher ? colors.gstrong : colors.line,
        overflow: 'hidden',
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <DealArt
        deal={deal}
        title={dealName(deal, locale)}
        height={TILE_HEIGHT}
        dimmed={deal.state !== 'open'}
        corner={<DealTag deal={deal} voucher={voucher} />}
      />
    </Pressable>
  );
}

/**
 * The deals (0410; compact tiles since 2026-11-15), as the server orders them. A tap opens the
 * deal's sheet; Redeem there gives the deal's own QR, a 15-minute single-use code
 * (`redeem_deal`, `app/deal-voucher.tsx`). A deal with a live code says Redeemed and its sheet
 * offers Show code. With no deals it draws nothing at all.
 */
export function DealsSection({
  testID,
  deals,
  points12m,
  tz,
}: {
  /** `<route>`; each tile takes `${testID}.deal.<id>`, the sheet `${testID}.deal-sheet`. */
  testID: string;
  deals: MyDeals | null | undefined;
  /** The member's points in the last 12 months, for what a locked deal's card still needs. */
  points12m: number;
  tz: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const codes = useMyDealVouchers(!!deals && deals.deals.length > 0);
  const redeem = useRedeemDeal();
  const [openId, setOpenId] = useState<string | null>(null);
  if (!deals || deals.deals.length === 0) return null;
  const opened = deals.deals.find((d) => d.id === openId) ?? null;
  const showCode = (voucherId: string) => {
    setOpenId(null);
    router.push({ pathname: '/deal-voucher', params: { id: voucherId } });
  };
  const onRedeem = (id: string) => {
    if (redeem.isPending) return;
    redeem.mutate(id, {
      onSuccess: (r) => showCode(r.voucher.id),
      onError: (err) => toast(t(mapErrorToKey(err)), 'error'),
    });
  };
  return (
    <View testID={`${testID}.deals`} style={{ gap: space.s, marginTop: space.s }}>
      <View style={{ gap: 0 }}>
        <MicroLabel>{t('loyalty.guest.deals.title')}</MicroLabel>
        <Hint>{t('loyalty.guest.deals.hint')}</Hint>
      </View>
      <View style={{ gap: space.s }}>
        {deals.deals.map((deal) => (
          <DealTile
            key={deal.id}
            testID={testID}
            deal={deal}
            voucher={liveDealVoucher(codes.data, deal.id)}
            onOpen={() => setOpenId(deal.id)}
          />
        ))}
      </View>
      <DealSheet
        testID={`${testID}.deal-sheet`}
        deal={opened}
        voucher={opened ? liveDealVoucher(codes.data, opened.id) : null}
        points12m={points12m}
        tz={tz}
        busy={redeem.isPending}
        onRedeem={onRedeem}
        onShowCode={showCode}
        onClose={() => setOpenId(null)}
      />
    </View>
  );
}
