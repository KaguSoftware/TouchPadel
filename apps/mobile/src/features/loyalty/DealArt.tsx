import type { ReactNode } from 'react';
import { Image, View } from 'react-native';
import type { Deal, DealThing } from '@touch/core/loyalty';
import { formatNumber, isolateLtr, type Locale } from '@touch/i18n';
import { Text } from '../../i18n/text';
import { useLocale } from '../../i18n/LocaleProvider';
import { mirror, type Dir } from '../../i18n/direction';
import { brand, useTheme } from '../../theme';
import { categoryArtFor } from '../cafe/categoryArt';
import { menuPhotoUrl } from '../cafe/logic';
import { DealDrawing, type DealDrawingKind } from './dealDrawings';
import { dealArt, type DealArt as Art, type DealValue } from './deals';

/**
 * The picture on a deal, "B+" (Majed, 2026-11-15, picked from the deal-card directions): a poster.
 * One solid theme-invariant ground edge to edge (brand blue for the café, navy for a court, the
 * navy card shade when locked or used), the value large in white with its word in green, and on
 * the far side either the photo, cut in on a slanted green court line, or a drawing in the café
 * menu's own style hanging off the corner the way the menu's section bands carry theirs.
 *
 * No gradients, no glow and no wash: a locked or used deal changes ground and greys its figure
 * instead of sitting under a dark layer.
 *
 *   item     the photo of what it is off; with no photo, its category's drawing
 *   split    buy one, get one: both things side by side on the slant, "1+1" and FREE (or its percent)
 *   court    the padel racket and ball (dealDrawings.tsx)
 *   amount / percent   the category's drawing when the deal is on exactly one menu category,
 *            otherwise the till receipt (the whole café bill)
 *
 * The Club tab's full-width card (with the deal's name over the value) and the sheet's header draw
 * the same picture at their own height. It is decoration for the eye: what holds it carries the words for a screen reader.
 */

const MINUS = '−';
/** The slant of the court line the photo is cut on (physical; flipped for Arabic). */
const SLANT_DEG = 12;
/** Where the slanted cut crosses the middle of the picture, from its start edge. */
const CUT = '56%';

/** The value as the picture prints it: "20%", "−2,000", always in Latin digits left to right. */
function figure(v: Exclude<DealValue, { kind: 'free' }>, locale: Locale): string {
  return v.kind === 'percent'
    ? isolateLtr(`${formatNumber(v.percent, locale)}%`)
    : isolateLtr(`${MINUS}${formatNumber(v.iqd, locale)}`);
}

/** What the far side of the poster shows. */
type Side =
  | { kind: 'photo'; things: DealThing[] }
  | { kind: 'drawing'; which: DealDrawingKind };

/** A thing's drawing when it has no photo: its category's, else the receipt. */
function thingDrawing(thing: DealThing): DealDrawingKind {
  return thing.category_en && categoryArtFor(thing.category_en)
    ? { kind: 'category', nameEn: thing.category_en }
    : { kind: 'bill' };
}

function sideFor(art: Art, deal: Pick<Deal, 'on'>): Side {
  if (art.kind === 'split') {
    const things = art.buy ? [art.buy, art.get] : [art.get];
    if (things.some((t) => menuPhotoUrl(t.photo_path))) return { kind: 'photo', things };
    return { kind: 'drawing', which: thingDrawing(art.get) };
  }
  if (art.kind === 'item') {
    return menuPhotoUrl(art.thing.photo_path)
      ? { kind: 'photo', things: [art.thing] }
      : { kind: 'drawing', which: thingDrawing(art.thing) };
  }
  if (art.kind === 'court') return { kind: 'drawing', which: { kind: 'court' } };
  const only = deal.on.categories.length === 1 && deal.on.items.length === 0 ? deal.on.categories[0] : null;
  return only && categoryArtFor(only.name_en)
    ? { kind: 'drawing', which: { kind: 'category', nameEn: only.name_en } }
    : { kind: 'drawing', which: { kind: 'bill' } };
}

/** One thing's photo filling its box; with no photo, its drawing on the ground. */
function ThingFace({ thing, ground, size }: { thing: DealThing; ground: string; size: number }) {
  const url = menuPhotoUrl(thing.photo_path);
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        style={{ flex: 1, backgroundColor: brand.navyCard }}
      />
    );
  }
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: ground }}>
      <DealDrawing which={thingDrawing(thing)} ground={ground} size={size} />
    </View>
  );
}

/**
 * The photo side: a box skewed into the slant, and the photos inside skewed back by the same
 * amount about the same middle height, so the cut slants while the photos stay true. A green
 * court line runs down the cut; two things sit side by side with a green line between them.
 */
function PhotoSide({ things, ground, height, dir }: { things: DealThing[]; ground: string; height: number; dir: Dir }) {
  const skew = `${dir === 'rtl' ? SLANT_DEG : -SLANT_DEG}deg`;
  const unskew = `${dir === 'rtl' ? -SLANT_DEG : SLANT_DEG}deg`;
  return (
    <>
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          start: CUT,
          width: '100%',
          overflow: 'hidden',
          transform: [{ skewX: skew }],
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            // Wider than the visible part, so the counter-skew never shows the ground at a corner.
            start: '-12%',
            width: '60%',
            flexDirection: 'row',
            transform: [{ skewX: unskew }],
          }}
        >
          {things.map((thing, i) => (
            <View
              key={`${thing.name_en}:${i}`}
              style={{
                flex: 1,
                overflow: 'hidden',
                borderStartWidth: i > 0 ? 3 : 0,
                borderStartColor: brand.green,
              }}
            >
              <ThingFace thing={thing} ground={ground} size={Math.round(height * 0.5)} />
            </View>
          ))}
        </View>
      </View>
      {/* The court line on the cut. */}
      <View
        style={{
          position: 'absolute',
          top: -8,
          bottom: -8,
          start: CUT,
          width: 5,
          marginStart: -2.5,
          backgroundColor: brand.green,
          transform: [{ skewX: skew }],
        }}
      />
    </>
  );
}

/** The drawing side: the drawing large, tilted, cut by the poster's corner (the menu band's way). */
function DrawingSide({ which, ground, height, dir }: { which: DealDrawingKind; ground: string; height: number; dir: Dir }) {
  const size = Math.round(height * 0.98);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        end: -Math.round(height * 0.14),
        bottom: -Math.round(height * 0.17),
        transform: [{ rotate: `${dir === 'rtl' ? 10 : -10}deg` }],
      }}
    >
      <View style={mirror(dir)}>
        <DealDrawing which={which} ground={ground} size={size} />
      </View>
    </View>
  );
}

export function DealArt({
  deal,
  height,
  corner,
  dimmed,
  title,
}: {
  deal: Pick<Deal, 'type' | 'value' | 'look' | 'on'>;
  height: number;
  /** The deal's name over the value (the Club tab's full-width card; the sheet names it below). */
  title?: string;
  /** A small state word in the top corner (Redeemed, Not right now, Used, the card it needs). */
  corner?: ReactNode;
  /** Locked or used: the poster steps back (its own ground, a grey figure). */
  dimmed?: boolean;
}) {
  const { t, locale, dir } = useLocale();
  const { fonts } = useTheme();
  const art = dealArt(deal);
  const side = sideFor(art, deal);
  const ground = dimmed ? brand.navyCard : art.kind === 'court' ? brand.navy : brand.blue;

  const value =
    art.kind === 'split'
      ? {
          big: isolateLtr('1+1'),
          word:
            art.percent >= 100
              ? t('loyalty.guest.deals.freeTag')
              : isolateLtr(`${MINUS}${formatNumber(art.percent, locale)}%`),
        }
      : art.kind === 'amount'
        ? { big: figure({ kind: 'amount', iqd: art.iqd }, locale), word: `${t('loyalty.guest.deals.iqd')} ${t('loyalty.guest.deals.off')}` }
        : art.kind === 'percent'
          ? { big: figure({ kind: 'percent', percent: art.percent }, locale), word: t('loyalty.guest.deals.off') }
          : art.value.kind === 'amount'
            ? { big: figure(art.value, locale), word: `${t('loyalty.guest.deals.iqd')} ${t('loyalty.guest.deals.off')}` }
            : { big: figure(art.value, locale), word: t('loyalty.guest.deals.off') };

  const pad = Math.round(height * 0.11);
  const bigSize = Math.min(Math.round(height * 0.34), 60);
  const wordSize = height >= 160 ? 13 : 11;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, overflow: 'hidden', backgroundColor: ground }}
    >
      <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, opacity: dimmed ? 0.5 : 1 }}>
        {side.kind === 'photo' ? (
          <PhotoSide things={side.things} ground={ground} height={height} dir={dir} />
        ) : (
          <DrawingSide which={side.which} ground={ground} height={height} dir={dir} />
        )}
      </View>
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          start: pad,
          // The value keeps to its side of the cut, or clear of the drawing.
          width: side.kind === 'photo' ? '50%' : '58%',
          justifyContent: 'center',
        }}
      >
        {title ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: fonts.body700,
              fontSize: 13,
              lineHeight: 18,
              color: dimmed ? brand.navyText : brand.white,
              opacity: dimmed ? 1 : 0.85,
              marginBottom: 2,
            }}
          >
            {title}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{
            fontFamily: fonts.display900,
            fontSize: bigSize,
            lineHeight: Math.round(bigSize * 1.12),
            letterSpacing: -1,
            color: dimmed ? brand.navyText : brand.white,
            fontVariant: ['tabular-nums'],
          }}
        >
          {value.big}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: fonts.body800,
            fontSize: wordSize,
            lineHeight: Math.round(wordSize * 1.4),
            letterSpacing: dir === 'rtl' ? 0 : 0.8,
            textTransform: 'uppercase',
            color: dimmed ? brand.navyText : brand.green,
          }}
        >
          {value.word}
        </Text>
      </View>
      {corner ? <View style={{ position: 'absolute', top: 8, end: 8 }}>{corner}</View> : null}
    </View>
  );
}
