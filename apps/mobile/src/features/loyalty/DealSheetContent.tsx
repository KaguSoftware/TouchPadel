import { ScrollView, View } from 'react-native';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { Button, MicroLabel } from '../../components/ui';
import { space, useTheme } from '../../theme';
import { DealArt } from './DealArt';
import { DealTag } from './DealCards';
import { dealFacts, dealHeadline } from './dealText';
import { dealName } from './deals';
import type { DealSheetProps } from './DealSheet.types';

/**
 * What a tap on a deal opens (Majed, 2026-11-15: "when they click on that card, it would show the
 * details and the hours, what time it is valid for ... and how many times they can use it"): the
 * picture again, larger, the name and its line, every fact (what earns it and what is given for a
 * buy-one-get-one, days, hours, the end, the minimum bill, uses left, the card it needs, until
 * Redeem, which gives the deal's own 15-minute QR (or Show code while that code lives).
 * Shared by the iOS and Android sheets (DealSheet.ios.tsx, DealSheet.tsx).
 */
export function DealSheetContent({
  testID,
  deal,
  voucher,
  points12m,
  tz,
  busy,
  onRedeem,
  onShowCode,
  height,
}: Omit<DealSheetProps, 'onClose' | 'deal'> & { deal: NonNullable<DealSheetProps['deal']>; height: number }) {
  const { t, locale } = useLocale();
  const { colors, fonts } = useTheme();
  const open = deal.state === 'open';
  const facts = dealFacts(deal, { t, locale, tz, pickedUntil: null, points12m });
  return (
    <ScrollView
      testID={`${testID}.scroll`}
      style={{ height, backgroundColor: colors.card }}
      contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
    >
      <DealArt deal={deal} height={196} dimmed={!open} corner={<DealTag deal={deal} voucher={voucher} />} />
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.l, gap: space.l }}>
        <View style={{ gap: space.xs }}>
          <Text
            testID={`${testID}.name`}
            accessibilityRole="header"
            style={{ fontFamily: fonts.display800, fontSize: 22, lineHeight: 28, color: colors.ink }}
          >
            {dealName(deal, locale)}
          </Text>
          <Text style={{ fontFamily: fonts.body400, fontSize: 14, lineHeight: 20, color: colors.mut }}>
            {dealHeadline(deal, t, locale)}
          </Text>
        </View>

        <View style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
          {facts.map((f) => (
            <View
              key={f.key}
              testID={`${testID}.fact.${f.key}`}
              accessible
              accessibilityLabel={`${f.label}: ${f.value}`}
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                gap: space.l,
                paddingVertical: 11,
                borderBottomWidth: 1,
                borderBottomColor: colors.line,
              }}
            >
              <Text style={{ flexGrow: 1, fontFamily: fonts.body400, fontSize: 13.5, color: colors.mut }}>{f.label}</Text>
              <Text
                style={{
                  flexShrink: 1,
                  fontFamily: fonts.body700,
                  fontSize: 13.5,
                  lineHeight: 19,
                  color: colors.ink,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {f.value}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ gap: space.xs }}>
          <MicroLabel>{t('loyalty.guest.deals.howTitle')}</MicroLabel>
          <Text style={{ fontFamily: fonts.body400, fontSize: 13.5, lineHeight: 20, color: colors.ink }}>
            {t('loyalty.guest.deals.how')}
          </Text>
        </View>

        {open && voucher ? (
          <Button
            testID={`${testID}.show`}
            label={t('loyalty.guest.deals.showCode')}
            variant="primary"
            onPress={() => onShowCode(voucher.id)}
          />
        ) : open ? (
          <Button
            testID={`${testID}.redeem`}
            label={t('loyalty.guest.deals.redeem')}
            variant="cta"
            busy={busy}
            disabled={busy}
            onPress={() => onRedeem(deal.id)}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}
