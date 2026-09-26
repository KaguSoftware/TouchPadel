/**
 * Photo scanning (Phase 2, Milestone 4b): the contract between the
 * receipt-scan edge function and whatever model reads the photo. Two kinds of
 * paper are read the same way:
 *
 *   receipt     a supplier's (mostly handwritten) receipt -> Goods in
 *   order_slip  a waiter's handwritten order slip        -> an order on a tab
 *
 * The model sits behind ONE interface, ReceiptReader, built in ONE file,
 * connect.ts, and never needs to know which kind it is reading: the pipeline
 * hands it the system text, the user text and the JSON schema for the kind
 * (prompt.ts). Everything else (the photo, the spend cap, validation,
 * matching, the review, Goods in and the till) is model-agnostic. Pure: no
 * Deno, no npm: imports, so the Node test suite imports it.
 */

export type ScanKind = 'receipt' | 'order_slip';

/** Image types the staff-media bucket accepts (0159). */
export type ReceiptMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ReceiptReadInput {
  /** Which paper this is. A real model can ignore it: system, userText and schema already say everything. */
  kind: ScanKind;
  /** The photo, base64 without a data: prefix. */
  imageBase64: string;
  mediaType: ReceiptMediaType;
  /** The instructions (prompt.ts), sent as the system prompt. */
  system: string;
  /** The text that goes beside the image in the user turn. */
  userText: string;
  /** The JSON Schema the answer must follow (structured output / JSON mode). */
  schema: Record<string, unknown>;
  /** Aborted after the edge function's time limit. */
  signal: AbortSignal;
}

/**
 * What a model hands back, before validate.ts. Loose on purpose: the
 * validator, not the adapter, decides what is kept.
 */
export type RawReading = unknown;

/** Tokens the call used, for app.llm_record_usage. */
export interface ReceiptUsage {
  input: number;
  output: number;
  cache_write?: number;
  cache_read?: number;
}

export interface ReceiptReadResult {
  reading: RawReading;
  usage: ReceiptUsage;
}

export interface ReceiptReader {
  /**
   * The model name as priced in platform_settings.llm_pricing (an unpriced
   * model is billed at the blended fallback rate).
   */
  readonly model: string;
  read(input: ReceiptReadInput): Promise<ReceiptReadResult>;
}

/** Why a read failed. Stored as supplier_receipts.error_code. */
export type ReceiptReaderErrorCode = 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'UPSTREAM' | 'TIMEOUT' | 'UNREADABLE';

export class ReceiptReaderError extends Error {
  constructor(
    readonly code: ReceiptReaderErrorCode,
    message: string,
    /** Tokens already spent when the failure happened, if the vendor said. */
    readonly usage?: ReceiptUsage,
  ) {
    super(message);
    this.name = 'ReceiptReaderError';
  }
}

/** One validated line, as app.receipt_store_reading takes it. */
export interface ReadingLine {
  text: string;
  qty?: number;
  unit?: string;
  unit_price_iqd?: number;
  line_total_iqd?: number;
  expiry_date?: string;
  flags: LineFlag[];
}

/**
 * ARITHMETIC  qty x unit price is not the line total (more than 1 IQD per unit off)
 * NO_PRICE    neither a unit price nor a line total was read
 * TOTAL_MISMATCH  the line totals do not add up to the receipt total (on every line)
 * UNCLEAR     the model said it was not sure of the line (handwriting): check it against the photo
 */
export type LineFlag = 'ARITHMETIC' | 'NO_PRICE' | 'TOTAL_MISMATCH' | 'UNCLEAR';

/** A validated reading, as app.receipt_store_reading takes it. */
export interface Reading {
  supplier_name?: string;
  receipt_date?: string;
  total_iqd?: number;
  lines: ReadingLine[];
}

/** One validated order-slip line, as app.slip_store_reading takes it. */
export interface SlipLine {
  text: string;
  /** How many, 1 to 99. */
  qty?: number;
  /** What the waiter wrote beside it ("no sugar", "extra shot"), for the kitchen. */
  notes?: string;
  flags: SlipFlag[];
}

/** UNCLEAR: the model was not sure of the line. NO_QTY: no quantity was written (1 is assumed on the till). */
export type SlipFlag = 'UNCLEAR' | 'NO_QTY';

/** A validated order slip, as app.slip_store_reading takes it. */
export interface SlipReading {
  /** The table as written ("5", "T5", "ط5"), digits folded; resolved to a table by the server. */
  table_number?: string;
  lines: SlipLine[];
}
