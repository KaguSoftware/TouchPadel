/**
 * KDS ticket age color. Thresholds: green under 5 minutes, amber 5-10 minutes,
 * red past 10 minutes — and a ticket past its own target_seconds is always red
 * (a 4-minute espresso target goes red at 4 minutes, not 10).
 *
 * The board renders the same decision as an `AgeState` (fresh / warm / late)
 * on the `--tp-kds-*` tokens; `ageColor` stays as the single source of truth
 * so the thresholds are tested once.
 */
export type AgeColor = 'green' | 'amber' | 'red';
export type AgeState = 'fresh' | 'warm' | 'late';

export const GREEN_UNDER_SECONDS = 5 * 60;
export const AMBER_UNDER_SECONDS = 10 * 60;

export function ageColor(ageSeconds: number, targetSeconds: number): AgeColor {
  if (ageSeconds < 0) return 'green';
  if (targetSeconds > 0 && ageSeconds >= targetSeconds) return 'red';
  if (ageSeconds < GREEN_UNDER_SECONDS) return 'green';
  if (ageSeconds < AMBER_UNDER_SECONDS) return 'amber';
  return 'red';
}

const STATE_OF_COLOR: Record<AgeColor, AgeState> = { green: 'fresh', amber: 'warm', red: 'late' };

/** The kitchen-board state for an age: fresh under target, warm ageing, late past it. */
export function ageState(ageSeconds: number, targetSeconds: number): AgeState {
  return STATE_OF_COLOR[ageColor(ageSeconds, targetSeconds)];
}

/** Kitchen-board token for an AgeState (`--tp-kds-fresh` / `-warm` / `-late`). */
export function ageStateVar(state: AgeState): string {
  return `var(--tp-kds-${state})`;
}

/** Theme-token color for an AgeColor (light surfaces). */
export function ageColorVar(color: AgeColor): string {
  switch (color) {
    case 'green':
      return 'var(--tp-success-mark)';
    case 'amber':
      return 'var(--tp-warn-mark)';
    case 'red':
      return 'var(--tp-danger)';
  }
}

/** mm:ss display for a ticket age. */
export function formatAge(ageSeconds: number): string {
  const s = Math.max(0, Math.floor(ageSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
