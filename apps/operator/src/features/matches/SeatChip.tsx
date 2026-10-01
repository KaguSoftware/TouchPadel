/**
 * The seat chip after a match booking's name on the calendar and the board
 * (docs/design/open-matches/operator.md §5.8): `3/4` before any mark, then
 * "Here 2 · Missing 1" (matchLogic.seatChipOf).
 *
 * Drawn in the block's own ink (a hairline of currentColor on a transparent
 * ground), so it takes the booking's tone wherever it sits and adds no colour
 * token: a match is never a colour of its own. Nothing when the state has no
 * seat count; the chip is never guessed.
 */
import { formatNumber } from '@touch/i18n';
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';
import { seatChipOf } from './matchLogic';
import type { MatchState } from './matchPayloads';

export interface SeatChipProps {
  state: MatchState;
  /**
   * The booking has started by the screen's clock. The state's own signs come
   * first; this tells the one case they cannot (everyone left arrived, one
   * left late): after the start that late leaver is missing (R39).
   */
  started?: boolean;
}

export function SeatChip({ state, started = false }: SeatChipProps) {
  const { tr, locale } = useLocale();
  const chip = seatChipOf(state, started);
  if (!chip) return null;
  const text =
    chip.kind === 'fill'
      ? chip.text
      : tr('ws.matches.chip.marks', { here: formatNumber(chip.here, locale), missing: formatNumber(chip.missing, locale) });
  const label = tr('ws.matches.chip.aria', { taken: formatNumber(chip.taken, locale), total: formatNumber(chip.total, locale) });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="seat-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.2rem',
        flex: '0 0 auto',
        border: '1px solid currentColor',
        borderRadius: 'var(--tp-radius-pill)',
        background: 'transparent',
        color: 'inherit',
        paddingInline: '0.3rem',
        fontSize: 'var(--tp-fs-xs)',
        fontWeight: 600,
        lineHeight: 1.4,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name="users" size={12} />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
