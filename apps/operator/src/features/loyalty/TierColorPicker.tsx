/**
 * A loyalty tier's card colour (0376): the owner picks one of the closed list (TIER_COLORS,
 * @touch/core/loyalty), and the guest's points card on the phone takes it in that tier: its court
 * lines, the tier's name, the guest's raised name; black is a black card.
 *
 * Each choice shows a small card, so the owner sees roughly what the guest will: the brand blue
 * with lines in the tier's colour, or the black card. The phone draws the real one
 * (apps/mobile/src/theme/tokens.ts `tierFinish`).
 */
import type { CSSProperties } from 'react';
import { TIER_COLORS, TIER_SWATCH, type TierColor } from '@touch/core/loyalty';
import { useLocale } from '../../lib/i18n';
import { WizardChoice, WizardChoices } from '../../components/StepWizard';

const K = 'ws.loyalty.setup.tiers';

/** The points card's own blue (brand #3360AB), the ground of every tier but black. */
const CARD_BLUE = '#3360AB';
/** The black card's charcoal lines (the phone's `tierFinish.black.lines`). */
const BLACK_LINES = '#6B6E76';

/** A card a few dozen pixels wide in the tier's colour. */
export function TierCardChip({ color, width = 56 }: { color: TierColor; width?: number }) {
  const black = color === 'black';
  const lines = black ? BLACK_LINES : TIER_SWATCH[color];
  const ground = black ? TIER_SWATCH.black : CARD_BLUE;
  const style: CSSProperties = {
    display: 'inline-block',
    inlineSize: width,
    // A bank card's proportions, as the phone's card has them.
    aspectRatio: '85.6 / 53.98',
    borderRadius: Math.round(width / 9),
    flexShrink: 0,
    background: `repeating-linear-gradient(118deg, transparent 0 9px, ${lines} 9px 11px), ${ground}`,
    boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.14)`,
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
          background: black ? '#D4D6DB' : TIER_SWATCH[color],
        }}
      />
    </span>
  );
}

/** The six colours as choice cards; the picked one ticked. */
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
      {TIER_COLORS.map((c) => (
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
