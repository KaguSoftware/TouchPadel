/**
 * Small formatting helpers the courts cards share. `rateText` is the one
 * rule every rate on the tab follows: below the twenty-booking floor a share
 * is printed as "n of N", never as a percentage that a single booking would
 * swing by five points.
 */
import { MIN_RATE_DENOM } from '@touch/core';
import type { Tr } from '../copy';
import type { Formatters } from '../format';

export function rateText(tr: Tr, f: Formatters, pct: number | null, n: number, d: number): string {
  if (pct == null || d < MIN_RATE_DENOM) return tr('ws.analytics.courts.kpi.nOfN', { n: f.num(n), total: f.num(d) });
  return f.pct(pct);
}

export function hoursText(f: Formatters, minutes: number): string {
  return f.num(Math.round(minutes / 6) / 10);
}

/** A span in minutes as people say it: "45 min", "5.5 h", "2 days". */
export function spanText(tr: Tr, f: Formatters, minutes: number): string {
  if (minutes < 90) return tr('ws.analytics.courts.units.minutesShort', { n: f.num(Math.round(minutes)) });
  if (minutes < 48 * 60) return tr('ws.analytics.courts.units.hoursShort', { n: f.num(Math.round(minutes / 6) / 10) });
  return tr('ws.analytics.courts.units.daysShort', { n: f.num(Math.round(minutes / 144) / 10) });
}
