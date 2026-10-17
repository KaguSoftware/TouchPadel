/**
 * The Safe page's pure logic (0343): the overview as the server sends it,
 * the three forms (pay, move, count) and what each sends.
 *
 * Every figure is the server's: the balance, each row's balance after it, the
 * month's costs and a count's difference. Nothing here adds money up; the
 * only arithmetic is the bar width on the costs list, which is drawing, not
 * a figure.
 */

/** What a cost is for, in the order the Pay form offers them (the server's list). */
export const PAY_CATEGORIES = ['shopping', 'supplier', 'rent', 'bills', 'repairs', 'marketing', 'other'] as const;
export type PayCategory = (typeof PAY_CATEGORIES)[number];
/** Every category a row can carry: wages, advances and coach pay come from their own pages. */
export type Category = PayCategory | 'wages' | 'advance' | 'coach_pay';

export type PaidFrom = 'safe' | 'bank';
export type Box = 'cafe' | 'desk' | 'shop';
export type EntryKind = 'payment' | 'hand_in' | 'to_drawer' | 'owner_in' | 'owner_out' | 'bank_in' | 'bank_out' | 'count';
export type EntrySource = 'manual' | 'day_close' | 'wage' | 'wage_advance' | 'coach_pay';
export type MoveKind = 'hand_in' | 'to_drawer' | 'owner_in' | 'owner_out' | 'bank_in' | 'bank_out';

/** The most a single row may move (0343's CHECK). */
export const AMOUNT_MAX = 1_000_000_000;
export const PAYEE_MAX = 80;
export const NOTE_MAX = 300;

export interface SafeEntry {
  id: string;
  kind: EntryKind;
  amountIqd: number;
  deltaIqd: number;
  paidFrom: PaidFrom | null;
  category: Category | null;
  payee: string | null;
  payeeHidden: boolean;
  note: string | null;
  box: Box | null;
  source: EntrySource;
  occurredOn: string;
  loggedAt: string;
  loggedByName: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  balanceAfterIqd: number | null;
}

export interface SafeCost {
  category: Category;
  totalIqd: number;
  count: number;
  fromBankIqd: number;
}

export interface SafeOverview {
  month: string | null;
  currentMonth: string | null;
  today: string | null;
  balanceIqd: number | null;
  todayIn: number;
  todayOut: number;
  lastCount: { countedIqd: number; differenceIqd: number; at: string; byName: string | null } | null;
  costs: SafeCost[];
  costsTotalIqd: number;
  entries: SafeEntry[];
  payees: { category: Category; payee: string }[];
  boxes: Box[];
  isOwner: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function readEntry(v: unknown): SafeEntry | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.kind !== 'string') return null;
  return {
    id: v.id,
    kind: v.kind as EntryKind,
    amountIqd: num(v.amount_iqd) ?? 0,
    deltaIqd: num(v.delta_iqd) ?? 0,
    paidFrom: (str(v.paid_from) as PaidFrom | null) ?? null,
    category: (str(v.category) as Category | null) ?? null,
    payee: str(v.payee),
    payeeHidden: v.payee_hidden === true,
    note: str(v.note),
    box: (str(v.box) as Box | null) ?? null,
    source: (str(v.source) as EntrySource | null) ?? 'manual',
    occurredOn: str(v.occurred_on) ?? '',
    loggedAt: str(v.logged_at) ?? '',
    loggedByName: str(v.logged_by_name),
    voidedAt: str(v.voided_at),
    voidedByName: str(v.voided_by_name),
    voidReason: str(v.void_reason),
    balanceAfterIqd: num(v.balance_after_iqd),
  };
}

/** app.main_cash_overview as the page reads it; anything missing reads as absent, never as 0. */
export function readOverview(v: unknown): SafeOverview {
  const o = isObj(v) ? v : {};
  const today = isObj(o.today_figures) ? o.today_figures : {};
  const lc = isObj(o.last_count) ? o.last_count : null;
  const boxes = arr(o.boxes).filter((b): b is Box => b === 'cafe' || b === 'desk' || b === 'shop');
  const counted = lc ? num(lc.counted_iqd) : null;
  return {
    month: str(o.month),
    currentMonth: str(o.current_month),
    today: str(o.today),
    balanceIqd: num(o.balance_iqd),
    todayIn: num(today.in_iqd) ?? 0,
    todayOut: num(today.out_iqd) ?? 0,
    lastCount:
      lc && counted !== null
        ? { countedIqd: counted, differenceIqd: num(lc.difference_iqd) ?? 0, at: str(lc.at) ?? '', byName: str(lc.by_name) }
        : null,
    costs: arr(o.costs).flatMap((c) =>
      isObj(c) && typeof c.category === 'string'
        ? [{ category: c.category as Category, totalIqd: num(c.total_iqd) ?? 0, count: num(c.count) ?? 0, fromBankIqd: num(c.from_bank_iqd) ?? 0 }]
        : [],
    ),
    costsTotalIqd: num(o.costs_total_iqd) ?? 0,
    entries: arr(o.entries).flatMap((e) => {
      const r = readEntry(e);
      return r ? [r] : [];
    }),
    payees: arr(o.payees).flatMap((p) =>
      isObj(p) && typeof p.category === 'string' && typeof p.payee === 'string' ? [{ category: p.category as Category, payee: p.payee }] : [],
    ),
    boxes: boxes.length > 0 ? boxes : ['cafe'],
    isOwner: o.is_owner === true,
  };
}

/** The names typed before for a category, newest first, each once. */
export function payeesFor(payees: SafeOverview['payees'], category: Category | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of payees) {
    if (category !== null && p.category !== category) continue;
    if (seen.has(p.payee)) continue;
    seen.add(p.payee);
    out.push(p.payee);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The forms
// ---------------------------------------------------------------------------

export type Mode = 'pay' | 'move' | 'count';

export interface PayDraft {
  amount: number | null;
  category: PayCategory | null;
  payee: string;
  paidFrom: PaidFrom;
  note: string;
}
export const EMPTY_PAY: PayDraft = { amount: null, category: null, payee: '', paidFrom: 'safe', note: '' };

/** Why the Pay button is not ready yet, the first thing missing; null when it is. */
export type PayBlock = 'amount' | 'category' | 'payeeLong' | 'noteLong' | null;
export function payBlock(d: PayDraft): PayBlock {
  if (d.amount === null || d.amount <= 0 || d.amount > AMOUNT_MAX) return 'amount';
  if (d.category === null) return 'category';
  if (d.payee.trim().length > PAYEE_MAX) return 'payeeLong';
  if (d.note.trim().length > NOTE_MAX) return 'noteLong';
  return null;
}

export function payArgs(d: PayDraft, key: string): Record<string, unknown> {
  return {
    p_amount_iqd: d.amount,
    p_category: d.category,
    p_payee: d.payee.trim() || null,
    p_paid_from: d.paidFrom,
    p_note: d.note.trim() || null,
    p_idempotency_key: key,
  };
}

/**
 * A payment from the safe larger than what the safe shows: the money left
 * either way, so the page warns and still logs it. A comparison of the
 * server's balance with what was typed, not a sum.
 */
export function takesSafeBelowZero(d: Pick<PayDraft, 'amount' | 'paidFrom'>, balance: number | null): boolean {
  return d.paidFrom === 'safe' && balance !== null && d.amount !== null && d.amount > balance;
}

export type Direction = 'in' | 'out';
/** Where cash comes from (into the safe) or goes to (out of it): a drawer box, the bank, the owner. */
export type Party = Box | 'bank' | 'owner';

export interface MoveDraft {
  direction: Direction;
  party: Party | null;
  amount: number | null;
  note: string;
}
export const EMPTY_MOVE: MoveDraft = { direction: 'in', party: null, amount: null, note: '' };

/** The parties a branch can move cash with: its boxes, then the bank and the owner. */
export function partiesFor(boxes: readonly Box[]): Party[] {
  return [...boxes, 'bank', 'owner'];
}

export function moveKind(direction: Direction, party: Party): MoveKind {
  if (party === 'bank') return direction === 'in' ? 'bank_in' : 'bank_out';
  if (party === 'owner') return direction === 'in' ? 'owner_in' : 'owner_out';
  return direction === 'in' ? 'hand_in' : 'to_drawer';
}

export type MoveBlock = 'party' | 'amount' | 'noteLong' | null;
export function moveBlock(d: MoveDraft): MoveBlock {
  if (d.party === null) return 'party';
  if (d.amount === null || d.amount <= 0 || d.amount > AMOUNT_MAX) return 'amount';
  if (d.note.trim().length > NOTE_MAX) return 'noteLong';
  return null;
}

export function moveArgs(d: MoveDraft, key: string): Record<string, unknown> {
  const party = d.party ?? 'owner';
  const box = party === 'bank' || party === 'owner' ? null : party;
  return {
    p_kind: moveKind(d.direction, party),
    p_amount_iqd: d.amount,
    p_box: box,
    p_note: d.note.trim() || null,
    p_idempotency_key: key,
  };
}

export function countArgs(counted: number, expected: number, note: string, key: string): Record<string, unknown> {
  return { p_counted_iqd: counted, p_expected_iqd: expected, p_note: note.trim() || null, p_idempotency_key: key };
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/** A row the Safe page can take back: its own rows (logged here or at day close), still live. */
export function canVoid(e: Pick<SafeEntry, 'source' | 'voidedAt'>): boolean {
  return e.voidedAt === null && (e.source === 'manual' || e.source === 'day_close');
}

export type LedgerFilter = 'all' | 'payments' | 'moves';
export function filterEntries(entries: readonly SafeEntry[], f: LedgerFilter): SafeEntry[] {
  if (f === 'payments') return entries.filter((e) => e.kind === 'payment');
  if (f === 'moves') return entries.filter((e) => e.kind !== 'payment');
  return [...entries];
}

/** How a row reads: which way the money went for the safe. A bank-paid cost moved nothing. */
export function entryTone(e: Pick<SafeEntry, 'deltaIqd' | 'voidedAt'>): 'in' | 'out' | 'none' {
  if (e.voidedAt !== null || e.deltaIqd === 0) return 'none';
  return e.deltaIqd > 0 ? 'in' : 'out';
}

/** The bar on the costs list: a share of the biggest category, for drawing only. */
export function barShare(total: number, max: number): number {
  if (max <= 0 || total <= 0) return 0;
  return Math.max(0.02, Math.min(1, total / max));
}

/** The month stepper reaches the current month at most; the past is open. */
export function canStepForward(shown: string | null, current: string | null): boolean {
  return shown !== null && current !== null && shown < current;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
