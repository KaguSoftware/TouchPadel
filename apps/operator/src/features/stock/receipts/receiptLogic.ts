/**
 * The pure half of Goods in ▸ "Scanned receipts" (ReceiptsPanel.tsx,
 * ReceiptReview.tsx; 0236/0237): the payloads of app.receipts_to_review and
 * app.receipt_detail read defensively, a read line turned into a Goods in
 * draft (the receipt's own unit converted to the ingredient's base unit, and
 * the cost per base unit from the printed total), how sure a match is, and the
 * confirm payload. No React here, so the node test beside it covers every
 * branch.
 */
import { parseQty, unitCostFromPack, type DeliveryLineDraft } from '../stockLogic';

export type ReceiptStatus = 'uploaded' | 'reading' | 'read' | 'failed' | 'confirmed' | 'rejected';
export type MatchSource = 'alias' | 'trigram' | 'manual' | 'none';
export type LineFlag = 'ARITHMETIC' | 'NO_PRICE' | 'TOTAL_MISMATCH' | 'UNCLEAR' | 'SMALL_AMOUNT' | 'TRUNCATED';

export interface ReceiptSummary {
  id: string;
  status: ReceiptStatus;
  error_code: string | null;
  source: 'phone' | 'operator';
  storage_path: string;
  uploaded_by_name: string | null;
  created_at: string;
  supplier_name_read: string | null;
  total_iqd_read: number | null;
  line_count: number;
  matched_count: number;
}

export interface ReceiptLine {
  id: string;
  line_no: number;
  text_read: string;
  qty_read: number | null;
  unit_read: string | null;
  unit_price_iqd_read: number | null;
  line_total_iqd_read: number | null;
  expiry_read: string | null;
  flags: LineFlag[];
  ingredient_id: string | null;
  match_source: MatchSource;
  confidence: number | null;
}

export interface ReceiptDetail {
  id: string;
  status: ReceiptStatus;
  error_code: string | null;
  source: 'phone' | 'operator';
  storage_path: string;
  created_at: string;
  read_at: string | null;
  /** When the current or last reading started (0240), and the database clock then. */
  reading_started_at: string | null;
  server_now: string | null;
  model: string | null;
  supplier_name_read: string | null;
  supplier_id: string | null;
  receipt_date: string | null;
  total_iqd_read: number | null;
  delivery_id: string | null;
  lines: ReceiptLine[];
}

const STATUSES: readonly ReceiptStatus[] = ['uploaded', 'reading', 'read', 'failed', 'confirmed', 'rejected'];
const SOURCES: readonly MatchSource[] = ['alias', 'trigram', 'manual', 'none'];
const FLAGS: readonly LineFlag[] = ['ARITHMETIC', 'NO_PRICE', 'TOTAL_MISMATCH', 'UNCLEAR', 'SMALL_AMOUNT', 'TRUNCATED'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : dflt;

/** app.receipts_to_review as returned; anything else reads as none. */
export function readReceipts(payload: unknown): ReceiptSummary[] {
  if (!isObject(payload) || !Array.isArray(payload.receipts)) return [];
  return payload.receipts
    .filter((r): r is Record<string, unknown> => isObject(r) && typeof r.id === 'string')
    .map((r) => ({
      id: r.id as string,
      status: oneOf(r.status, STATUSES, 'uploaded'),
      error_code: str(r.error_code),
      source: r.source === 'operator' ? 'operator' : 'phone',
      storage_path: str(r.storage_path) ?? '',
      uploaded_by_name: str(r.uploaded_by_name),
      created_at: str(r.created_at) ?? '',
      supplier_name_read: str(r.supplier_name_read),
      total_iqd_read: num(r.total_iqd_read),
      line_count: num(r.line_count) ?? 0,
      matched_count: num(r.matched_count) ?? 0,
    }));
}

/** app.receipt_detail as returned; null when it is not one. */
export function readReceiptDetail(payload: unknown): ReceiptDetail | null {
  if (!isObject(payload) || typeof payload.id !== 'string') return null;
  const lines = (Array.isArray(payload.lines) ? payload.lines : [])
    .filter((l): l is Record<string, unknown> => isObject(l) && typeof l.id === 'string')
    .map((l) => ({
      id: l.id as string,
      line_no: num(l.line_no) ?? 0,
      text_read: str(l.text_read) ?? '',
      qty_read: num(l.qty_read),
      unit_read: str(l.unit_read),
      unit_price_iqd_read: num(l.unit_price_iqd_read),
      line_total_iqd_read: num(l.line_total_iqd_read),
      expiry_read: str(l.expiry_read),
      flags: (Array.isArray(l.flags) ? l.flags : []).filter((f): f is LineFlag => FLAGS.includes(f as LineFlag)),
      ingredient_id: str(l.ingredient_id),
      match_source: oneOf(l.match_source, SOURCES, 'none'),
      confidence: num(l.confidence),
    }))
    .sort((a, b) => a.line_no - b.line_no);
  return {
    id: payload.id,
    status: oneOf(payload.status, STATUSES, 'uploaded'),
    error_code: str(payload.error_code),
    source: payload.source === 'operator' ? 'operator' : 'phone',
    storage_path: str(payload.storage_path) ?? '',
    created_at: str(payload.created_at) ?? '',
    read_at: str(payload.read_at),
    reading_started_at: str(payload.reading_started_at),
    server_now: str(payload.server_now),
    model: str(payload.model),
    supplier_name_read: str(payload.supplier_name_read),
    supplier_id: str(payload.supplier_id),
    receipt_date: str(payload.receipt_date),
    total_iqd_read: num(payload.total_iqd_read),
    delivery_id: str(payload.delivery_id),
    lines,
  };
}

// ---------------------------------------------------------------------------
// A read line -> a Goods in draft
// ---------------------------------------------------------------------------

type ReadUnit = 'g' | 'kg' | 'ml' | 'l' | 'count' | 'pack';

// Receipt units as printed, English and Arabic, lower case, dots dropped.
const UNIT_WORDS: Record<ReadUnit, readonly string[]> = {
  g: ['g', 'gr', 'grm', 'gram', 'grams', 'غ', 'غم', 'غرام', 'جرام', 'جم'],
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'كغ', 'كغم', 'كيلو', 'كيلوغرام', 'كيلوجرام', 'كلغ'],
  ml: ['ml', 'mls', 'millilitre', 'milliliter', 'مل', 'ملل'],
  l: ['l', 'lt', 'ltr', 'litre', 'liter', 'litres', 'liters', 'لتر', 'ليتر'],
  count: ['pc', 'pcs', 'piece', 'pieces', 'ea', 'each', 'unit', 'units', 'no', 'nos', 'btl', 'bottle', 'bottles', 'can', 'cans',
          'حبة', 'حبه', 'قطعة', 'قطعه', 'عدد', 'قنينة', 'قنينه', 'بطل'],
  pack: ['pack', 'packs', 'pk', 'pkt', 'packet', 'box', 'boxes', 'bx', 'carton', 'cartons', 'ctn', 'case', 'cases', 'crate',
         'bag', 'bags', 'tray', 'عبوة', 'عبوه', 'علبة', 'علبه', 'كرتون', 'كرتونة', 'كيس', 'صندوق', 'باكيت', 'طبقة', 'طبق'],
};

export function readUnit(unit: string | null): ReadUnit | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase().replace(/\./g, '');
  for (const [kind, words] of Object.entries(UNIT_WORDS) as [ReadUnit, readonly string[]][]) {
    if (words.includes(u)) return kind;
  }
  return null;
}

export interface StockIngredient {
  id: string;
  unit: 'g' | 'ml' | 'pc';
  pack_size: number | null;
  pack_cost_iqd: number | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * How the receipt's quantity becomes the ingredient's base unit: by weight or
 * volume, as pieces, as packs of the ingredient's pack size (a box, or a
 * bottle, can or piece of an ingredient kept in g or ml), or not at all (the
 * manager types it). A unit word nobody knows ("درزن", "dozen") is never
 * guessed: a piece-counted item takes the number as pieces only when the
 * receipt printed no unit at all.
 */
export function conversion(unit: string | null, ing: StockIngredient): 'measure' | 'pieces' | 'packs' | null {
  const kind = readUnit(unit);
  const printed = (unit ?? '').trim() !== '';
  const pack = ing.pack_size !== null && ing.pack_size > 0;
  if (ing.unit === 'g' && (kind === 'g' || kind === 'kg')) return 'measure';
  if (ing.unit === 'ml' && (kind === 'ml' || kind === 'l')) return 'measure';
  if (ing.unit === 'pc' && (kind === 'count' || !printed)) return 'pieces';
  if ((kind === 'pack' || kind === 'count') && pack) return 'packs';
  return null;
}

/** The receipt's quantity in the ingredient's base unit, or null when the units cannot be reconciled. */
export function baseQty(qty: number | null, unit: string | null, ing: StockIngredient): number | null {
  if (qty === null || qty <= 0) return null;
  const kind = readUnit(unit);
  switch (conversion(unit, ing)) {
    case 'measure':
      return round3(kind === 'kg' || kind === 'l' ? qty * 1000 : qty);
    case 'pieces':
      return round3(qty);
    case 'packs':
      return round3(qty * (ing.pack_size ?? 0));
    default:
      return null;
  }
}

/** What the line cost as printed: its total, else unit price x quantity. */
export function lineCost(l: Pick<ReceiptLine, 'qty_read' | 'unit_price_iqd_read' | 'line_total_iqd_read'>): number | null {
  if (l.line_total_iqd_read !== null) return l.line_total_iqd_read;
  if (l.unit_price_iqd_read !== null && l.qty_read !== null) return Math.round(l.unit_price_iqd_read * l.qty_read);
  return null;
}

/**
 * A draft for Goods in's line editor from one read line: quantity in the base
 * unit and cost per base unit from the receipt when they reconcile, else the
 * pack price, else blank for the manager to fill.
 */
export function draftFromLine(
  l: ReceiptLine,
  ing: StockIngredient | null,
): Pick<DeliveryLineDraft, 'ingredientId' | 'qtyReceived' | 'unitCostIqd' | 'expiryDate'> {
  if (!ing) return { ingredientId: '', qtyReceived: '', unitCostIqd: '', expiryDate: l.expiry_read ?? '' };
  const base = baseQty(l.qty_read, l.unit_read, ing);
  const cost = lineCost(l);
  const perBase = base !== null && base > 0 && cost !== null ? round4(cost / base) : unitCostFromPack(ing.pack_size, ing.pack_cost_iqd);
  return {
    ingredientId: ing.id,
    qtyReceived: base === null ? '' : String(base),
    unitCostIqd: perBase === null ? '' : String(perBase),
    expiryDate: l.expiry_read ?? '',
  };
}

export type MatchTone = 'sure' | 'check' | 'none';

/** A confirmed wording or a close name is sure; a looser one asks to be checked. */
export function matchTone(l: Pick<ReceiptLine, 'match_source' | 'confidence' | 'ingredient_id'>): MatchTone {
  if (!l.ingredient_id || l.match_source === 'none') return 'none';
  if (l.match_source === 'alias' || l.match_source === 'manual') return 'sure';
  return (l.confidence ?? 0) >= 0.7 ? 'sure' : 'check';
}

/** What the drafted lines come to, in IQD (quantity x cost per base unit). */
export function draftsTotal(drafts: readonly Pick<DeliveryLineDraft, 'qtyReceived' | 'unitCostIqd'>[]): number {
  return Math.round(
    drafts.reduce((sum, d) => {
      const q = parseQty(d.qtyReceived);
      const c = parseQty(d.unitCostIqd);
      return q !== null && c !== null ? sum + q * c : sum;
    }, 0),
  );
}

/** The drafts differ from the printed total by more than one dinar per line. */
export function totalOff(drafted: number, printed: number | null, lines: number): boolean {
  return printed !== null && Math.abs(drafted - printed) > Math.max(1, lines);
}

export interface ReviewDraft extends DeliveryLineDraft {
  key: string;
  /** The read line it came from; null for a line the manager added. */
  lineId: string | null;
}

/** app.confirm_receipt's p_lines. */
export function confirmLines(drafts: readonly ReviewDraft[]) {
  return drafts.map((d) => ({
    line_id: d.lineId,
    ingredient_id: d.ingredientId,
    qty_received: Number(d.qtyReceived),
    unit_cost_iqd: Number(d.unitCostIqd),
    expiry_date: d.expiryDate || null,
  }));
}
