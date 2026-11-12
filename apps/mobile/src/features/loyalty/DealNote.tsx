import { View } from 'react-native';
import type { Deal } from '@touch/core/loyalty';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { MicroLabel } from '../../components/ui';
import { TagIcon } from '../../components/icons';
import { palettes, radius, space, useTheme } from '../../theme';
import { dealValueText } from './DealCards';
import { dealName } from './deals';

/**
 * The picked deal on the member card, over the code (0410): its name, what it is worth, and the
 * one line that makes "use it in the app" real at the counter: the cashier applies it when they
 * scan this code.
 *
 * It sits on the QR's white paper in both themes, so it takes the LIGHT palette's green (the
 * same reason the countdown bar under the code does).
 */
export function DealNote({ testID, deal }: { testID: string; deal: Deal }) {
  const { t, locale } = useLocale();
  const { fonts } = useTheme();
  const paper = palettes.light;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${t('loyalty.guest.deals.cardLabel')}: ${dealName(deal, locale)}, ${dealValueText(deal, t, locale)}. ${t('loyalty.guest.deals.cardLine')}`}
      style={{
        alignSelf: 'stretch',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.s,
        marginBottom: space.sm,
        borderRadius: radius.cell,
        borderWidth: 1,
        borderColor: paper.gline,
        backgroundColor: paper.gtint,
        paddingVertical: 10,
        paddingHorizontal: space.sm,
      }}
    >
      {/* Level with the label's line. */}
      <View style={{ height: 15, justifyContent: 'center' }}>
        <TagIcon size={15} color={paper.gtext} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: space.s,
          }}
        >
          <MicroLabel style={{ color: paper.gtext }}>{t('loyalty.guest.deals.cardLabel')}</MicroLabel>
          <Text
            style={{
              flexShrink: 1,
              fontFamily: fonts.display800,
              fontSize: 13,
              color: paper.gtext2,
              fontVariant: ['tabular-nums'],
            }}
          >
            {dealValueText(deal, t, locale)}
          </Text>
        </View>
        <Text
          numberOfLines={2}
          style={{ fontFamily: fonts.body700, fontSize: 15, lineHeight: 21, color: paper.ink }}
        >
          {dealName(deal, locale)}
        </Text>
        <Text style={{ fontFamily: fonts.body400, fontSize: 12.5, lineHeight: 18, color: paper.gtext2 }}>
          {t('loyalty.guest.deals.cardLine')}
        </Text>
      </View>
    </View>
  );
}
