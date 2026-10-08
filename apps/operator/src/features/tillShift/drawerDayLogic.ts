/**
 * The pure rules behind the owner's and manager's Cash drawer day
 * (`DrawerDay`, /till/drawer): the figures above the day's shifts, and the day
 * stepper's bound. No React, no fetches. Every amount is a stamped figure from
 * app.till_shift_list (an open shift's are its running figures); this file only
 * adds them up. A shift ended with the day carries no count, so it adds nothing
 * to Counted or Difference and is not in the "counted" tally.
 */
import type { ListShift, OutsideRow } from './tillShiftLogic';

export interface DaySummary {
  shifts: number;
  /** Shifts still open. */
  open: number;
  /** Closed shifts that were counted (an own-PIN or manager-PIN close, not "ended with the day"). */
  counted: number;
  cashTaken: number;
  cashRefunded: number;
  cardTaken: number;
  /** What the counted shifts' drawers held at their ends. */
  countedIqd: number;
  /** The counted shifts' differences added: negative is short, positive is over. */
  varianceIqd: number;
  /** Money taken or paid out at a station while no shift was open there. */
  outsideCashIn: number;
  outsideCashOut: number;
}

export function summariseDay(list: { shifts: readonly ListShift[]; outside: readonly OutsideRow[] }): DaySummary {
  const s: DaySummary = {
    shifts: list.shifts.length,
    open: 0,
    counted: 0,
    cashTaken: 0,
    cashRefunded: 0,
    cardTaken: 0,
    countedIqd: 0,
    varianceIqd: 0,
    outsideCashIn: 0,
    outsideCashOut: 0,
  };
  for (const sh of list.shifts) {
    if (sh.closed_at === null) s.open += 1;
    s.cashTaken += sh.cash_payments_iqd;
    s.cashRefunded += sh.cash_refunds_iqd;
    s.cardTaken += sh.card_payments_iqd;
    if (sh.closed_at !== null && sh.cash_counted_iqd !== null && sh.cash_variance_iqd !== null) {
      s.counted += 1;
      s.countedIqd += sh.cash_counted_iqd;
      s.varianceIqd += sh.cash_variance_iqd;
    }
  }
  for (const o of list.outside) {
    s.outsideCashIn += o.cash_payments_iqd;
    s.outsideCashOut += o.cash_refunds_iqd;
  }
  return s;
}

/** The day stepper may go forward only while the shown day is before the latest one. */
export function canStepForward(shown: string | null, latest: string | null): boolean {
  return shown !== null && latest !== null && shown < latest;
}

/** The activity line under a shift: counts, in the vocabulary the shift screens already use. */
export function activityParts(s: Pick<ListShift, 'payment_count' | 'refund_count' | 'drawer_open_count'>): { key: 'payments' | 'refunds' | 'drawerOpens'; count: number }[] {
  return (
    [
      { key: 'payments', count: s.payment_count },
      { key: 'refunds', count: s.refund_count },
      { key: 'drawerOpens', count: s.drawer_open_count },
    ] as const
  ).filter((p) => p.count > 0).map((p) => ({ key: p.key, count: p.count }));
}
