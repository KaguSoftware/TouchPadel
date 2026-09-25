/**
 * The pure half of Waste and production's "Made today" (WasteAndProduction.tsx;
 * build-contracts-2026-09-23 §5.5): app.production_log_today's rows, every
 * batch recorded this business day with who made it and no cost, read
 * defensively. No React here, so the node test beside it covers every branch.
 */

export interface MadeRow {
  /** stock_movements.id, a bigint: a number in the payload. */
  movement_id: number | string;
  name_en: string;
  name_ar: string;
  qty: number;
  unit: string;
  staff_name: string | null;
  /** When it was recorded; '' when the payload's value is not a date. */
  at: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** An instant the screen can format; anything else is '' (formatting an invalid date throws). */
const instant = (v: unknown): string => (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? v : '');

/** The RPC's rows; anything that is not its shape reads as none, and a row without an id is dropped. */
export function readMade(payload: unknown): MadeRow[] {
  const rows = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? (payload as { rows?: unknown }).rows : undefined;
  if (!Array.isArray(rows)) return [];
  const out: MadeRow[] = [];
  for (const r of rows) {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) continue;
    const row = r as Record<string, unknown>;
    const id = row.movement_id;
    if (typeof id !== 'number' && typeof id !== 'string') continue;
    out.push({
      movement_id: id,
      name_en: str(row.name_en),
      name_ar: str(row.name_ar),
      qty: Number(row.qty) || 0,
      unit: str(row.unit),
      staff_name: typeof row.staff_name === 'string' ? row.staff_name : null,
      at: instant(row.at),
    });
  }
  return out;
}
