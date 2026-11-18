import { useRef, useState, type ComponentRef } from 'react';
import { Image, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatIQD } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { ExpandIcon } from '../../components/icons';
import { radius, space, useTheme } from '../../theme';
import { CategoryPlaceholder } from './categoryArt';
import { PhotoViewer, type PhotoOrigin } from './PhotoViewer';
import { menuPhotoUrl, pickText, type MenuViewItem } from './logic';

const BTN = 28;
const PHOTO_BLEED = 40;

/** The photo is 4:3 across the sheet, but never taller than this. */
const photoHeight = (width: number) => Math.min(Math.round((width * 3) / 4), 300);

/**
 * How tall the sheet's content wants to be, worked out from the item alone so the iOS sheet can be
 * sized once, before it opens (a detent changed while it presents breaks the open animation).
 * The text is an estimate; if it comes up short the content scrolls, if long a little shows below.
 */
export function itemContentHeight(
  item: MenuViewItem,
  locale: 'en' | 'ar',
  width: number,
  max: number,
  bottomInset: number,
): number {
  const lines = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));
  const description = pickText(item.description_en, item.description_ar, locale);
  const hook = pickText(item.hook_en, item.hook_ar, locale);
  const perLine = Math.max(20, Math.floor((width - 2 * space.xl) / 7));
  let h = photoHeight(width) + 68; // the photo and the name header
  const body =
    (hook ? 20 : 0) +
    (description ? lines(description, perLine) * 21 + 8 : 0) +
    (item.allergens.length > 0 ? 30 : 0) +
    (item.sizes.length > 1 ? 40 + item.sizes.length * 40 : 0);
  h += space.m + body + Math.max(bottomInset, space.l);
  return Math.min(h, max);
}

/**
 * The inside of the item sheet, laid out as the web menu's item sheet is (`ItemSheet.tsx`): the
 * photo (or the category's drawing) on top with a round expand button, then
 * a name header that stays put while the rest scrolls (the eyebrow, the name in capitals), the
 * hook, the description, the allergen chips, the sizes with their prices, and a foot with the
 * price. Hosted by the platform's own sheet (`ItemDetail.ios.tsx`: SwiftUI; `ItemDetail.tsx`:
 * Material), which bring the grabber, the detents and the drag to dismiss. Tapping the photo or
 * the expand button opens it over the whole screen (not for a sold-out item), where it pinches to
 * zoom and pans, and a drag down sends it back to its place. Looking
 * only: the web's quantity, notes and add button are left out, nothing is ordered here.
 */
export function ItemDetailContent({
  item,
  categoryEn,
  testID,
  height,
  fixed,
  screenOffset,
}: {
  item: MenuViewItem;
  categoryEn: string;
  testID: string;
  /**
   * With `fixed`, the exact height the hosted view fills (the iOS sheet, sized once up front by
   * `itemContentHeight`); otherwise the most it may take, and it is only as tall as it needs.
   */
  height: number;
  fixed?: boolean;
  /**
   * Where this content's top-left corner is on the screen, when the host puts it somewhere the
   * layout cannot see (the iOS sheet: React measures from the hidden host, not from the sheet).
   */
  screenOffset?: { x: number; y: number };
}) {
  const { t, locale } = useLocale();
  const { colors, fonts, tracking } = useTheme();
  const insets = useSafeAreaInsets();
  const width = useWindowDimensions().width;
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState<PhotoOrigin | null>(null);
  const photoRef = useRef<ComponentRef<typeof View>>(null);
  /** Opens the photo over the screen, growing from where it sits now. */
  const openZoom = () => {
    const node = photoRef.current;
    if (!node) {
      setOrigin(null);
      setZoom(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setOrigin(
        w > 0 && h > 0
          ? {
              x: x + (screenOffset?.x ?? 0),
              y: y + (screenOffset?.y ?? 0),
              width: Math.min(w, width),
              height: h,
            }
          : null,
      );
      setZoom(true);
    });
  };
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
    <View style={{ width, height: fixed ? height : undefined, backgroundColor: colors.card }}>
      <View
        ref={photoRef}
        collapsable={false}
        style={{
          // Wider than the sheet on purpose: the sheet clips it, and the iOS host lays this view
          // out a few points narrower than the sheet, which showed as a blue strip beside it.
          width: width + PHOTO_BLEED,
          height: photoHeight(width),
          overflow: 'hidden',
        }}
      >
        {url && !item.available ? (
          <Image
            source={{ uri: url }}
            style={{ width: '100%', height: '100%', backgroundColor: colors.gtint }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : url ? (
          <Pressable
            testID={`${testID}.photo`}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('cafe.expandPhoto')}
            onPress={openZoom}
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
        {url && item.available ? (
          <Pressable
            testID={`${testID}.expand`}
            accessibilityRole="button"
            accessibilityLabel={t('cafe.expandPhoto')}
            onPress={openZoom}
            style={{ ...roundButton, bottom: space.s, end: space.s }}
          >
            <ExpandIcon size={14} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        testID={`${testID}.scroll`}
        style={fixed ? { flex: 1 } : { maxHeight: height * 0.58, flexGrow: 0 }}
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, space.l) }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            backgroundColor: colors.card,
            paddingHorizontal: space.xl,
            paddingVertical: space.m,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.m,
          }}
        >
          <View style={{ flex: 1 }}>
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
          {fallback ? (
            <Text
              testID={`${testID}.price`}
              style={{
                fontFamily: fonts.display800,
                fontSize: 20,
                color: colors.gtext,
                fontVariant: ['tabular-nums'],
              }}
            >
              {formatIQD(fallback.price_iqd, locale)}
            </Text>
          ) : null}
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

      {zoom && url ? (
        <PhotoViewer url={url} testID={testID} origin={origin} onClose={() => setZoom(false)} />
      ) : null}
    </View>
  );
}

const StyleAbsoluteFill = { position: 'absolute' as const, top: 0, bottom: 0, start: 0, end: 0 };
