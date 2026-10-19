/**
 * Gender hours on the desk calendar (0353): a quiet hatched band over the
 * stretch of a court's column kept for women or men, named once at its top
 * ("Women only"). Drawn like the now line: absolutely placed in the court
 * column before the bookings, so it sits above the empty slots and below every
 * booking card, and never takes a click (the slot under it still opens a new
 * booking; the server and the dialog judge the guest).
 *
 * Women and men share one hatch and are told apart by the label, never by
 * colour alone. Two rules that clash on a court ("both": nobody can book)
 * take the warning hatch.
 */
import { useMemo, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { QK, fetchGenderRules, type GenderRuleRow } from '../../lib/queries';
import { useLocale } from '../../lib/i18n';
import { genderBands, type GenderBand } from './genderBandsLogic';

const NO_RULES: GenderRuleRow[] = [];

/**
 * The branch's gender rules for the desk. A failed read draws no bands (the
 * server still enforces), so it never blocks the calendar.
 */
export function useGenderRules(): readonly GenderRuleRow[] {
  const q = useQuery({ queryKey: QK.genderRules, queryFn: fetchGenderRules, staleTime: 60_000 });
  return q.data ?? NO_RULES;
}

const LABEL_KEY = {
  female: 'ws.genderHours.calendar.womenOnly',
  male: 'ws.genderHours.calendar.menOnly',
  both: 'ws.genderHours.calendar.both',
} as const;

function bandStyle(kept: GenderBand['kept']): CSSProperties {
  const ink = kept === 'both' ? 'var(--tp-warn-mark)' : 'var(--tp-accent)';
  return {
    backgroundImage: `repeating-linear-gradient(135deg, color-mix(in oklab, ${ink} 16%, transparent) 0 6px, transparent 6px 12px)`,
    border: `1px solid color-mix(in oklab, ${ink} 40%, transparent)`,
  };
}

export function GenderBands({
  rules,
  courtId,
  date,
  openMin,
  rowCount,
  slotMin,
  rowPitch,
  tz,
}: {
  rules: readonly GenderRuleRow[];
  courtId: string;
  /** The trading night's venue-local date. */
  date: string;
  /** The grid's first row, venue-local minutes past midnight of `date`. */
  openMin: number;
  rowCount: number;
  slotMin: number;
  /** One row plus its gap, as a CSS length (the calendar's ROW_PITCH). */
  rowPitch: string;
  tz: string;
}) {
  const { tr } = useLocale();
  const bands = useMemo(() => {
    if (rules.length === 0 || rowCount === 0) return [];
    const gridStart = wallTimeToUtc(date, openMin, tz);
    const gridEnd = wallTimeToUtc(date, openMin + rowCount * slotMin, tz);
    return genderBands(rules, courtId, date, gridStart, gridEnd, tz);
  }, [rules, courtId, date, openMin, rowCount, slotMin, tz]);

  return (
    <>
      {bands.map((b) => (
        <span
          key={b.fromMin}
          aria-hidden="true"
          data-gender-band={b.kept}
          style={{
            position: 'absolute',
            insetInline: 0,
            insetBlockStart: `calc(${b.fromMin / slotMin} * ${rowPitch})`,
            blockSize: `calc(${b.minutes / slotMin} * ${rowPitch} - var(--tp-sp-0))`,
            borderRadius: 'var(--tp-radius-sm)',
            pointerEvents: 'none',
            ...bandStyle(b.kept),
          }}
        >
          <span
            style={{
              position: 'absolute',
              insetBlockStart: 'var(--tp-sp-1)',
              insetInlineEnd: 'var(--tp-sp-1)',
              paddingInline: 'var(--tp-sp-1-5)',
              borderRadius: 'var(--tp-radius-pill)',
              background: b.kept === 'both' ? 'var(--tp-warn-soft)' : 'var(--tp-accent-soft)',
              color: b.kept === 'both' ? 'var(--tp-warn-fg)' : 'var(--tp-accent-soft-fg)',
              fontSize: 'var(--tp-fs-xs)',
              fontWeight: 600,
              lineHeight: '1.25rem',
              whiteSpace: 'nowrap',
            }}
          >
            {tr(LABEL_KEY[b.kept])}
          </span>
        </span>
      ))}
    </>
  );
}
