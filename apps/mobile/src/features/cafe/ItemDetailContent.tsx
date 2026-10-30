import { useState } from 'react';
import { Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatIQD } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { CloseIcon, ExpandIcon } from '../../components/icons';
import { radius, space, useTheme } from '../../theme';
import { CategoryPlaceholder } from './categoryArt';
import { menuPhotoUrl, pickText, type MenuViewItem } from './logic';

const BTN = 36;

/**
 * The inside of the item sheet, laid out as the web menu's item sheet is (`ItemSheet.tsx`): the
 * photo (or the category's drawing) on top with a round close button and an expand button, then
 * a name header that stays put while the rest scrolls (the eyebrow, the name in capitals), the
 * hook, the description, the allergen chips, the sizes with their prices, and a foot with the
 * price. Hosted by the platform's own sheet (`ItemDetail.ios.tsx`: SwiftUI; `ItemDetail.tsx`:
 * Material), which bring the grabber, the detents and the drag to dismiss. Tapping the photo or
 * the expand button opens it over the sheet, where it pinches to zoom (iOS) and pans. Looking
 * only: the web's quantity, notes and add button are left out, nothing is ordered here.
 */
export function ItemDetailContent({
  item,
  categoryEn,
  testID,
  height,
  onClose,
}: {
  item: MenuViewItem;
  categoryEn: string;
  testID: string;
  /** The sheet's height, which the hosted view fills. */
  height: number;
  onClose(): void;
}) {
  const { t, locale } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [zoom, setZoom] = useState(false);
  const url = menuPhotoUrl(item.photo_path);
  const name = pickText(item.name_en, item.name_ar, locale);
  const hook = pickText(item.hook_en, item.hook_ar, locale);
  const description = pickText(item.description_en, item.description_ar, locale);
  const fallback = item.sizes.find((s) => s.is_default) ?? item.sizes[0];
  const roundButton = {
    position: 'absolute' as const,
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    backgroundColor: colors.card,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  };

  return (
    <View style={{ width, height, backgroundColor: colors.card }}>
      <View
        style={{
          width: '100%',
          aspectRatio: 4 / 3,
          maxHeight: height * 0.42,
          overflow: 'hidden',
        }}
      >
        {url ? (
          <Pressable
            testID={`${testID}.photo`}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('cafe.expandPhoto')}
            onPress={() => setZoom(true)}
            style={{ flex: 1 }}
          >
            <Image
              source={{ uri: url }}
              style={{ width: '100%', height: '100%', backgroundColor: colors.gtint }}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          </Pressable>
        ) : (
          <CategoryPlaceholder nameEn={categoryEn} width="100%" fill />
        )}
        {item.available ? null : (
          <View
            pointerEvents="none"
            style={{ ...StyleAbsoluteFill, alignItems: 'center', justifyContent: 'center' }}
          >
            <View
              style={{
                transform: [{ rotate: '-12deg' }],
                borderWidth: 2,
                borderColor: colors.ink,
                borderRadius: radius.cell,
                backgroundColor: colors.card,
                paddingHorizontal: 16,
                paddingVertical: 5,
              }}
            >
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 20,
                  color: colors.ink,
                  textTransform: 'uppercase',
                  letterSpacing: tracking(1),
                }}
              >
                {t('cafe.soldOut')}
              </Text>
            </View>
          </View>
        )}
        {url ? (
          <Pressable
            testID={`${testID}.expand`}
            accessibilityRole="button"
            accessibilityLabel={t('cafe.expandPhoto')}
            onPress={() => setZoom(true)}
            style={{ ...roundButton, bottom: space.m, end: space.m }}
          >
            <ExpandIcon size={18} color={colors.ink} />
          </Pressable>
        ) : null}
        <Pressable
          testID={`${testID}.close`}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={{ ...roundButton, top: space.m, end: space.m }}
        >
          <CloseIcon size={18} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView
        testID={`${testID}.scroll`}
        style={{ flex: 1 }}
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: space.l }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            backgroundColor: colors.card,
            paddingHorizontal: space.xl,
            paddingVertical: space.m,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.body700,
              fontSize: 11,
              color: colors.mut,
              textTransform: 'uppercase',
              letterSpacing: tracking(1.2),
            }}
          >
            {t('cafe.menu')}
          </Text>
          <Text
            testID={`${testID}.name`}
            style={{
              fontFamily: fonts.display800,
              fontSize: 22,
              lineHeight: 28,
              color: colors.ink,
              textTransform: 'uppercase',
              letterSpacing: tracking(0.9),
              marginTop: 2,
            }}
          >
            {name}
          </Text>
        </View>

        <View style={{ paddingHorizontal: space.xl, paddingTop: space.m, gap: space.s }}>
          {hook ? (
            <Text
              style={{
                fontFamily: fonts.body700,
                fontSize: 11,
                color: colors.gtext,
                textTransform: 'uppercase',
                letterSpacing: tracking(1.2),
              }}
            >
              {hook}
            </Text>
          ) : null}
          {description ? (
            <Text
              testID={`${testID}.description`}
              style={{
                fontFamily: fonts.body400,
                fontSize: 14.5,
                lineHeight: 21,
                color: colors.mut,
              }}
            >
              {description}
            </Text>
          ) : null}

          {item.allergens.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
              {item.allergens.map((a) => (
                <View
                  key={a.code}
                  style={{
                    paddingHorizontal: 9,
                    paddingVertical: 2,
                    borderRadius: radius.pill,
                    backgroundColor: colors.sub,
                  }}
                >
                  <Text style={{ fontFamily: fonts.body600, fontSize: 12, color: colors.ink }}>
                    {pickText(a.label_en, a.label_ar, locale)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {item.sizes.length > 1 ? (
            <View style={{ marginTop: space.m }}>
              <Text
                style={{
                  fontFamily: fonts.display800,
                  fontSize: 15,
                  color: colors.ink,
                  marginBottom: 6,
                }}
              >
                {t('cafe.size')}
              </Text>
              {item.sizes.map((s) => (
                <View
                  key={s.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: space.s,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.line,
                  }}
                >
                  <Text style={{ fontFamily: fonts.body600, fontSize: 15, color: colors.ink }}>
                    {pickText(s.name_en, s.name_ar, locale)}
                  </Text>
                  <Text
                    style={{
                      fontFamily: fonts.body400,
                      fontSize: 14,
                      color: colors.mut,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {formatIQD(s.price_iqd, locale)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {fallback ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'flex-end',
            paddingHorizontal: space.xl,
            paddingTop: space.m,
            paddingBottom: Math.max(insets.bottom, space.m),
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.card,
          }}
        >
          <Text
            testID={`${testID}.price`}
            style={{
              fontFamily: fonts.display800,
              fontSize: 22,
              color: colors.gtext,
              fontVariant: ['tabular-nums'],
            }}
          >
            {formatIQD(fallback.price_iqd, locale)}
          </Text>
        </View>
      ) : null}

      {zoom && url ? (
        <View style={{ ...StyleAbsoluteFill, backgroundColor: '#000' }}>
          <ScrollView
            testID={`${testID}.zoom`}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            bouncesZoom
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ width, height, justifyContent: 'center' }}
          >
            <Image
              source={{ uri: url }}
              style={{ width, height }}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </ScrollView>
          <Pressable
            testID={`${testID}.zoomClose`}
            accessibilityRole="button"
            accessibilityLabel={t('cafe.lightbox.close')}
            onPress={() => setZoom(false)}
            hitSlop={8}
            style={{ ...roundButton, top: space.m, end: space.m }}
          >
            <CloseIcon size={18} color={colors.ink} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const StyleAbsoluteFill = { position: 'absolute' as const, top: 0, bottom: 0, start: 0, end: 0 };
