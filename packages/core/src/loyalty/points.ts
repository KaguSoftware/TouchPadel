// Earn and redeem arithmetic (loyalty build contracts §1.3). The SQL in app.trg_loyalty_earn
// and app.loyalty_redeem is the authority; this twin lets the till and the apps show the same
// numbers before the server answers, and packages/db/tests/loyalty.test.ts checks they agree.

export type TabKind = 'cafe' | 'shop' | 'lesson' | 'tournament';

export interface EarnSwitches {
  earn_cafe: boolean;
  earn_shop: boolean;
  earn_court: boolean;
  earn_lesson: boolean;
  earn_tournament: boolean;
}

export interface EarnInput {
  kind: TabKind;
  /** Sum of the tab's payments, IQD. */
  paid: number;
  /** tabs.court_iqd: the court fee carried on the tab. */
  courtIqd: number;
  iqdPerPoint: number;
  multiplier: number;
  switches: EarnSwitches;
}

export function earnPoints(i: EarnInput): number {
  if (i.paid <= 0 || i.iqdPerPoint <= 0) return 0;
  const court = Math.min(Math.max(i.courtIqd, 0), i.paid);
  const rest = i.paid - court;
  const own: Record<TabKind, boolean> = {
    cafe: i.switches.earn_cafe,
    shop: i.switches.earn_shop,
    lesson: i.switches.earn_lesson,
    tournament: i.switches.earn_tournament,
  };
  const eligible = (i.switches.earn_court ? court : 0) + (own[i.kind] ? rest : 0);
  // Integer arithmetic, as the SQL does it (floor(eligible * multiplier / iqd_per_point)): the
  // multiplier is numeric(3,2), so it is exact in hundredths and no float edge (10/3*3) can drift.
  return Math.floor((eligible * Math.round(i.multiplier * 100)) / (i.iqdPerPoint * 100));
}

/** Points that fit the tab: rounded down so the discount never exceeds what is left to pay. */
export function redeemAmount(p: { points: number; pointValueIqd: number; remainingIqd: number }): {
  points: number;
  amountIqd: number;
} {
  if (p.points <= 0 || p.pointValueIqd <= 0 || p.remainingIqd <= 0)
    return { points: 0, amountIqd: 0 };
  const fit = Math.min(p.points, Math.floor(p.remainingIqd / p.pointValueIqd));
  return { points: fit, amountIqd: fit * p.pointValueIqd };
}
