/**
 * Pure helpers for "Hand cash to the safe" on the day-close screen (0343,
 * main cash). The figures (what each drawer box took, its refunds, its net,
 * what was already handed in) arrive from app.main_cash_day_boxes; this file
 * only decides which rows show, what each input starts at, the total the
 * manager typed, and why the button is held.
 *
 * Majed 2026-10-16: the café till, the court desk and the shop desk are
 * separate boxes; at day close each hands its cash to the safe once. The
 * opening float is not in these figures and stays in the drawers.
 */

export const CASH_BOXES = ['cafe', 'desk', 'shop'] as const;
export type CashBox = (typeof CASH_BOXES)[number];

/** Server ceiling for one hand-in (main_cash_entries.amount_iqd). */
export const HAND_IN_MAX_IQD = 1_000_000_000;

/** One box of app.main_cash_day_boxes. */
export interface DayBox {
  box: CashBox;
  cash_in_iqd: number;
  cash_out_iqd: number;
  net_iqd: number;
  /** Null until this box was handed in for the day. */
  handed_in_iqd: number | null;
}

/** app.main_cash_day_boxes (0343). */
export interface DayBoxes {
  day_session_id: string;
  business_date: string;
  status: string;
  opening_float_iqd: number;
  boxes: DayBox[];
}

const isBox = (v: unknown): v is CashBox => typeof v === 'string' && (CASH_BOXES as readonly string[]).includes(v);
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);

/** The payload as returned, defensively read; null when it is not one. */
export function readDayBoxes(raw: unknown): DayBoxes | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.day_session_id !== 'string') return null;
  const boxes = Array.isArray(r.boxes) ? r.boxes : [];
  return {
    day_session_id: r.day_session_id,
    business_date: typeof r.business_date === 'string' ? r.business_date : '',
    status: typeof r.status === 'string' ? r.status : '',
    opening_float_iqd: int(r.opening_float_iqd),
    boxes: boxes
      .filter((b): b is Record<string, unknown> => b !== null && typeof b === 'object' && isBox((b as Record<string, unknown>).box))
      .map((b) => ({
        box: b.box as CashBox,
        cash_in_iqd: int(b.cash_in_iqd),
        cash_out_iqd: int(b.cash_out_iqd),
        net_iqd: int(b.net_iqd),
        handed_in_iqd: b.handed_in_iqd === null || b.handed_in_iqd === undefined ? null : int(b.handed_in_iqd),
      })),
  };
}

/** What a box's input starts at: its net cash, never below 0. The float stays in the drawer. */
export function defaultHandIn(b: Pick<DayBox, 'net_iqd'>): number {
  return Math.max(b.net_iqd, 0);
}

/**
 * done: handed in (by the server, or by this panel a moment ago);
 * kept: left at 0 when this panel handed the others in;
 * idle: took no cash and paid none back, so there is nothing to move;
 * open: waiting for an amount.
 */
export type HandInRowState = 'done' | 'kept' | 'idle' | 'open';

export interface HandInRow {
  box: CashBox;
  state: HandInRowState;
  cashIn: number;
  cashOut: number;
  /** The amount handed in (done rows), else null. */
  handedIn: number | null;
  /** The input's value (open rows): the manager's draft, else the default. */
  amount: number;
  /** The typed amount is more than the box took net: the extra comes out of the float. */
  overNet: boolean;
}

/** What this panel already did, laid over the server rows until the refetch lands. */
export interface HandInOverlay {
  handed: Partial<Record<CashBox, number>>;
  kept: readonly CashBox[];
}

export const NO_OVERLAY: HandInOverlay = { handed: {}, kept: [] };

export function handInRows(
  day: Pick<DayBoxes, 'boxes'>,
  drafts: Partial<Record<CashBox, number | null>>,
  overlay: HandInOverlay = NO_OVERLAY,
): HandInRow[] {
  return day.boxes.map((b) => {
    const handedIn = b.handed_in_iqd ?? overlay.handed[b.box] ?? null;
    const base = { box: b.box, cashIn: b.cash_in_iqd, cashOut: b.cash_out_iqd };
    if (handedIn !== null) return { ...base, state: 'done', handedIn, amount: 0, overNet: false };
    if (overlay.kept.includes(b.box)) return { ...base, state: 'kept', handedIn: null, amount: 0, overNet: false };
    if (b.cash_in_iqd === 0 && b.cash_out_iqd === 0) return { ...base, state: 'idle', handedIn: null, amount: 0, overNet: false };
    const draft = drafts[b.box];
    const amount = draft === undefined ? defaultHandIn(b) : (draft ?? 0);
    return { ...base, state: 'open', handedIn: null, amount, overNet: amount > Math.max(b.net_iqd, 0) };
  });
}

/** The sum the button carries: the open rows' amounts. */
export function handInTotal(rows: readonly HandInRow[]): number {
  return rows.reduce((sum, r) => (r.state === 'open' ? sum + r.amount : sum), 0);
}

/** p_boxes for app.main_cash_hand_in_day: the open rows with an amount above 0. */
export function handInPayload(rows: readonly HandInRow[]): { box: CashBox; amount_iqd: number }[] {
  return rows.filter((r) => r.state === 'open' && r.amount > 0).map((r) => ({ box: r.box, amount_iqd: r.amount }));
}

/** The open rows a successful hand-in left at 0: they read "kept in the drawer" afterwards. */
export function keptBoxes(rows: readonly HandInRow[]): CashBox[] {
  return rows.filter((r) => r.state === 'open' && r.amount <= 0).map((r) => r.box);
}

/** Why the button is held: every amount is 0. */
export type HandInBlock = 'zero' | null;

export function handInBlock(rows: readonly HandInRow[]): HandInBlock {
  return handInTotal(rows) > 0 ? null : 'zero';
}

/**
 * empty: no box took cash and none was handed in ("No cash to hand in");
 * done: nothing is left open (every row handed in, kept or idle);
 * form: at least one row waits for an amount.
 */
export type HandInView = 'empty' | 'done' | 'form';

export function handInView(rows: readonly HandInRow[]): HandInView {
  const touched = rows.some((r) => r.state === 'done' || r.state === 'kept');
  if (!touched && rows.every((r) => r.cashIn === 0)) return 'empty';
  return rows.some((r) => r.state === 'open') ? 'form' : 'done';
}

/**
 * A closed day whose cash has not all reached the safe: a box that took cash
 * (net above 0) and has no hand-in. The day-close screen offers the panel for
 * the last closed day only then; the Safe page covers everything else.
 */
export function hasPendingHandIn(day: Pick<DayBoxes, 'boxes' | 'status'> | null | undefined): boolean {
  if (!day || day.status !== 'closed') return false;
  return day.boxes.some((b) => b.handed_in_iqd === null && b.net_iqd > 0);
}

/** The panel's query key: under ['main-cash'] so the Safe page's writes refresh it. */
export const dayBoxesKey = (daySessionId: string) => ['main-cash', 'day-boxes', daySessionId] as const;

/** One key per attempt: kept across retries of the same submit, replaced after a success. */
export const newHandInKey = (): string => `safe.handin:${crypto.randomUUID()}`;
