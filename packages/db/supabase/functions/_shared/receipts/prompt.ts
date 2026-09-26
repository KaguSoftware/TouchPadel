/**
 * The instructions and the output shape for each kind of paper. Vendor-free:
 * the pipeline calls promptFor(kind, names) and hands connect.ts the system
 * text, the user text and the JSON schema, which it passes to the model
 * (structured output, or the schema pasted into the prompt for a model
 * without it). validate.ts checks whatever comes back against the same shape.
 */
import type { ScanKind } from './types.ts';

export const RECEIPT_MAX_LINES = 200;

export const RECEIPT_SYSTEM_PROMPT = [
  'You read photographed supplier receipts and invoices for a cafe and padel club in Iraq.',
  'Most are HANDWRITTEN, usually in Arabic (Iraqi wording), sometimes English or both, on a printed or blank pad,',
  'with Arabic-Indic (٠١٢٣٤٥٦٧٨٩) or Western digits. Read slowly: handwriting, crossed-out and rewritten numbers,',
  'columns that drift, and the seller correcting a line are all normal.',
  'Return ONLY the JSON object described by the schema. Rules:',
  '- One entry in "lines" per purchased item, in the order printed. Skip subtotals, taxes, discounts, deposits and payment rows.',
  '- "text": the item wording exactly as printed (keep the original language; do not translate or correct it).',
  '- "qty": the quantity as printed. "unit": the unit as printed (kg, g, L, ml, box, carton, pc, كيلو, علبة ...), or omit it.',
  '- Money is Iraqi dinar (IQD), whole numbers only: no decimals, no thousands separators. 25,000 and ٢٥٠٠٠ are 25000.',
  '- Copy only numbers written on the receipt. Never compute a missing price or total; omit the field instead.',
  '- "unit_price_iqd" and "line_total_iqd": as written for that line. "total_iqd": the grand total, if written.',
  '- "supplier_name": the seller named in the header, if any. "receipt_date": YYYY-MM-DD, if printed.',
  '- "expiry_date": YYYY-MM-DD only when an expiry is printed on that line.',
  '- Handwritten amounts are often in thousands of dinar: "15 ألف", "15 الف", "15 أ" or "15" under a column headed',
  '  ألف / بالآلاف all mean 15000. Write the full amount in dinar. A crossed-out number is ignored; read the one written beside it.',
  '- Handwritten lists often give only a line total ("سكر 5 كيلو 10000"): then omit unit_price_iqd.',
  '- Set "unclear": true on any line where you are not sure of a word, the quantity or an amount (smudged, overwritten,',
  '  ambiguous digits such as ١ and ٧, or a thousands shorthand you had to guess). Still give your best reading.',
  '- If the photo is not a receipt or cannot be read at all, return {"lines": []}.',
].join('\n');

/** JSON Schema of the reading (draft 2020-12 subset every vendor accepts). */
export const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    supplier_name: { type: 'string' },
    receipt_date: { type: 'string', description: 'YYYY-MM-DD' },
    total_iqd: { type: 'integer', minimum: 0 },
    lines: {
      type: 'array',
      maxItems: RECEIPT_MAX_LINES,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          qty: { type: 'number', exclusiveMinimum: 0 },
          unit: { type: 'string' },
          unit_price_iqd: { type: 'integer', minimum: 0 },
          line_total_iqd: { type: 'integer', minimum: 0 },
          expiry_date: { type: 'string', description: 'YYYY-MM-DD' },
          unclear: { type: 'boolean', description: 'true when any part of the line was hard to read' },
        },
        required: ['text'],
      },
    },
  },
  required: ['lines'],
} as const;

/** The text that goes beside a receipt's image. */
export function receiptUserText(supplierNames: readonly string[]): string {
  const names = supplierNames.slice(0, 100);
  return [
    'Read this receipt.',
    'Currency: IQD.',
    names.length > 0
      ? `Suppliers this branch buys from (the header is often one of these): ${names.join('; ')}.`
      : 'No supplier list is on file.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Order slips: a waiter's handwritten order, read into menu items.
// ---------------------------------------------------------------------------

export const SLIP_MAX_LINES = 60;

export const SLIP_SYSTEM_PROMPT = [
  'You read photographed HANDWRITTEN order slips that waiters write at the tables of a cafe in Iraq.',
  'They are usually in Arabic (Iraqi wording and cafe slang), sometimes English or both, often hurried, abbreviated,',
  'crossed out and rewritten, with Arabic-Indic (٠١٢٣٤٥٦٧٨٩) or Western digits.',
  'Return ONLY the JSON object described by the schema. Rules:',
  '- One entry in "lines" per ordered item, in the order written. A crossed-out item is not ordered: leave it out.',
  '- "text": the item as written (keep the original language and spelling; do not translate or correct it).',
  '  When the wording clearly means an item on the menu list you are given, you may write that menu name instead.',
  '- "qty": how many, a whole number. "2 لاتيه", "لاتيه ×2", "لاتيه 2" and "٢ لاتيه" are all 2. Omit it when no number is written.',
  '- "notes": what is written about that item for the kitchen or bar ("بدون سكر", "no ice", "extra shot", "حار"). Omit when none.',
  '- "table_number": the table as written at the top or side ("طاولة 5", "ط5", "T5", "5"), digits only if you can. Omit when none.',
  '- Never add prices, totals or anything that is not written.',
  '- Set "unclear": true on any line where you are not sure of the item or the number (hurried writing, overwritten,',
  '  ambiguous digits such as ١ and ٧). Still give your best reading.',
  '- If the photo is not an order slip or cannot be read at all, return {"lines": []}.',
].join('\n');

export const SLIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    table_number: { type: 'string' },
    lines: {
      type: 'array',
      maxItems: SLIP_MAX_LINES,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          qty: { type: 'integer', minimum: 1, maximum: 99 },
          notes: { type: 'string' },
          unclear: { type: 'boolean', description: 'true when any part of the line was hard to read' },
        },
        required: ['text'],
      },
    },
  },
  required: ['lines'],
} as const;

/** The text that goes beside an order slip's image. */
export function slipUserText(menuNames: readonly string[]): string {
  const names = menuNames.slice(0, 250);
  return [
    'Read this order slip.',
    names.length > 0
      ? `Items on this cafe's menu (the slip names some of these, often shortened): ${names.join('; ')}.`
      : 'No menu is on file.',
  ].join('\n');
}

/**
 * Everything a model needs for one kind of paper. `names` are the branch's
 * supplier names (receipt) or menu item names (order slip), from the
 * begin-reading RPC.
 */
export function promptFor(kind: ScanKind, names: readonly string[]): {
  system: string;
  userText: string;
  schema: Record<string, unknown>;
} {
  if (kind === 'order_slip') {
    return { system: SLIP_SYSTEM_PROMPT, userText: slipUserText(names), schema: SLIP_SCHEMA };
  }
  return { system: RECEIPT_SYSTEM_PROMPT, userText: receiptUserText(names), schema: RECEIPT_SCHEMA };
}
