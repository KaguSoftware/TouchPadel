/**
 * A loyalty tier's card colour (0376, 0416): the owner picks one of the club's four cards (white,
 * Touch Padel green, Touch Padel blue, black: CARD_LADDER, @touch/core/loyalty), and the guest's
 * points card on the phone takes it in that tier: its court lines, the tier's name, the guest's
 * raised name; black is a black card. A tier saved in a pre-0416 metal still shows it as a choice
 * until the owner moves it onto a card.
 *
 * Each choice shows a small card in its colour, so the owner sees roughly what the guest will.
 * The phone draws the real one (apps/mobile/src/theme/tokens.ts `tierFinish`).
 */
import type { CSSProperties } from 'react';
import { TIER_SWATCH, offeredTierColors, type TierColor } from '@touch/core/loyalty';
import { useLocale } from '../../lib/i18n';
import { WizardChoice, WizardChoices } from '../../components/StepWizard';

const K = 'ws.loyalty.setup.tiers';

/** The points card's own blue (brand #3360AB): the blue card, and the ground of the legacy metals. */
const CARD_BLUE = '#3360AB';
/** The black card's charcoal lines (the phone's `tierFinish.black.lines`). */
const BLACK_LINES = '#6B6E76';

/**
 * The club's four cards (0416) drawn as themselves: the card's ground in its colour, lines a step
 * off it, the tier word in the ink that reads on it. The metals keep the 0376 look (the brand blue
 * with lines in the metal).
 */
const CARD_CHIP: Partial<Record<TierColor, { ground: string; lines: string; word: string }>> = {
  white: { ground: '#F4F6FA', lines: '#D5DAE3', word: '#9AA3B2' },
  green: { ground: TIER_SWATCH.green, lines: '#8DBB55', word: '#3D5622' },
  blue: { ground: CARD_BLUE, lines: '#5A82C6', word: '#DCE7F8' },
  black: { ground: TIER_SWATCH.black, lines: BLACK_LINES, word: '#D4D6DB' },
};

/** A card a few dozen pixels wide in the tier's colour. */
export function TierCardChip({ color, width = 56 }: { color: TierColor; width?: number }) {
  const card = CARD_CHIP[color] ?? { ground: CARD_BLUE, lines: TIER_SWATCH[color], word: TIER_SWATCH[color] };
  const { lines, ground } = card;
  const style: CSSProperties = {
    display: 'inline-block',
    inlineSize: width,
    // A bank card's proportions, as the phone's card has them.
    aspectRatio: '85.6 / 53.98',
    borderRadius: Math.round(width / 9),
    flexShrink: 0,
    background: `repeating-linear-gradient(118deg, transparent 0 9px, ${lines} 9px 11px), ${ground}`,
    // A hairline that holds on the white card as well as the dark ones.
    boxShadow: `inset 0 0 0 1px ${color === 'white' ? 'rgba(20, 20, 22, 0.16)' : 'rgba(255, 255, 255, 0.14)'}`,
    // The lines are the tier's colour at full strength here, so a small card still shows it.
    position: 'relative',
  };
  return (
    <span aria-hidden="true" style={style} data-tier-color={color}>
      {/* The tier word in the corner. */}
      <span
        style={{
          position: 'absolute',
          insetBlockStart: '18%',
          insetInlineEnd: '10%',
          inlineSize: '28%',
          blockSize: '10%',
          borderRadius: 2,
          background: card.word,
        }}
      />
    </span>
  );
}

/** The four cards as choice cards (and a legacy colour the tier still has); the picked one ticked. */
export function TierColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: TierColor;
  onChange: (c: TierColor) => void;
  disabled?: boolean;
}) {
  const { tr } = useLocale();
  return (
    <WizardChoices small label={tr(`${K}.color`)}>
      {offeredTierColors(value).map((c) => (
        <WizardChoice
          key={c}
          on={value === c}
          disabled={disabled}
          onPick={() => onChange(c)}
          testId={`loyalty-tier-color-${c}`}
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
              <TierCardChip color={c} />
              {tr(`${K}.colors.${c}`)}
            </span>
          }
        />
      ))}
    </WizardChoices>
  );
}

/** The chip and the colour's name, as the tier table and the wizard's Review read it. */
export function TierColorLabel({ color }: { color: TierColor }) {
  const { tr } = useLocale();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <TierCardChip color={color} width={32} />
      {tr(`${K}.colors.${color}`)}
    </span>
  );
}
