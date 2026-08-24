/**
 * Cash change calculation on top of @touch/core money (integer IQD, no floats,
 * no rounding — venue_settings.cash_rounding_iqd defaults to 1 = off).
 */
import { iqd, subIqd, type IQD } from '@touch/core';

export interface ChangeResult {
  /** true when tendered covers the amount due. */
  sufficient: boolean;
  /** tendered - due when sufficient, else 0. */
  changeIqd: IQD;
  /** due - tendered when short, else 0. */
  shortByIqd: IQD;
}

export function computeChange(dueIqd: number, tenderedIqd: number): ChangeResult {
  const due = iqd(dueIqd);
  const tendered = iqd(tenderedIqd);
  if (tendered >= due) {
    return { sufficient: true, changeIqd: subIqd(tendered, due), shortByIqd: iqd(0) };
  }
  return { sufficient: false, changeIqd: iqd(0), shortByIqd: subIqd(due, tendered) };
}
