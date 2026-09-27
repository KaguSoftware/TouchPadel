/**
 * receipt-scan (Phase 2, Milestone 4b), the pure half: no Deno, no model,
 * no stack.
 *
 *   * validate.ts: money becomes whole IQD (Arabic-Indic digits and
 *     separators folded), bad fields are dropped rather than guessed, dates
 *     must be real, lines are capped, and each line is flagged where its own
 *     numbers do not add up;
 *   * readerFromEnv: `fake` is the stand-in, anything else asks connect.ts,
 *     which returns nothing until a model is connected;
 *   * scanReceipt against fake ports: a reading is stored; no model gives the
 *     receipt back as uploaded (503, nothing spent); the spend cap gives it
 *     back too (429); a model error fails it and still records the spend; an
 *     empty or malformed reading fails it; the fake is never metered;
 *   * the boundary: only _shared/receipts/connect.ts may name the model's key
 *     or call out to a vendor.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  validateReading,
  validateSlip,
  tableNumber,
  toNumber,
  toMoney,
  toQuantity,
  text,
  isoDate,
} from '../supabase/functions/_shared/receipts/validate.ts';
import { isLocalStack, readerFromEnv } from '../supabase/functions/_shared/receipts/index.ts';
import { readerConformance } from './receipt-reader-conformance.ts';
import { FAKE_MODEL, FAKE_READING, FAKE_SLIP } from '../supabase/functions/_shared/receipts/fake.ts';
import { RECEIPT_SCHEMA, SLIP_SCHEMA, promptFor, receiptUserText } from '../supabase/functions/_shared/receipts/prompt.ts';
import { ReceiptReaderError, type ReceiptReader } from '../supabase/functions/_shared/receipts/types.ts';
import {
  PortError,
  bytesToBase64,
  cleanUsage,
  mediaTypeOf,
  scanReceipt,
  type ScanPorts,
} from '../supabase/functions/receipt-scan/scan.ts';

// ── 1. validate ─────────────────────────────────────────────────────────────
describe('validateReading', () => {
  it('folds digits and separators into whole IQD, and drops what does not survive', () => {
    expect(toNumber('٢٥٬٠٠٠')).toBe(25000);
    expect(toNumber('25,000')).toBe(25000);
    expect(toNumber('۱۲')).toBe(12);
    expect(toNumber('1٫5')).toBe(1.5);
    expect(toNumber('12 kg')).toBeUndefined();
    expect(toNumber(Number.NaN)).toBeUndefined();

    const r = validateReading({
      supplier_name: '  Al   Rafidain  Dairy ',
      receipt_date: '2026-02-30',
      total_iqd: '٣٠٬٠٠٠',
      lines: [
        { text: '  Milk  1L ', qty: '12', unit: 'L', unit_price_iqd: '1,500', line_total_iqd: 18000 },
        { text: 'Sugar', qty: -1, unit_price_iqd: -5, line_total_iqd: 12000.4, expiry_date: '2027-01-15' },
        { text: '   ' },
        'not an object',
        { qty: 3 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reading).toEqual({
      supplier_name: 'Al Rafidain Dairy',
      total_iqd: 30000,
      lines: [
        { text: 'Milk 1L', qty: 12, unit: 'L', unit_price_iqd: 1500, line_total_iqd: 18000, flags: [] },
        { text: 'Sugar', line_total_iqd: 12000, expiry_date: '2027-01-15', flags: [] },
      ],
    });
  });

  it('flags arithmetic, a missing price and a total that does not add up', () => {
    const r = validateReading(JSON.stringify({
      total_iqd: 50000,
      lines: [
        { text: 'Beans', qty: 2, unit_price_iqd: 14000, line_total_iqd: 30000 },
        { text: 'Fee', qty: 1, line_total_iqd: 2000 },
      ],
    }));
    expect(r.ok && r.reading.lines.map((l) => l.flags)).toEqual([
      ['ARITHMETIC', 'TOTAL_MISMATCH'],
      ['TOTAL_MISMATCH'],
    ]);
    const n = validateReading({ lines: [{ text: 'Napkins', qty: 1 }] });
    expect(n.ok && n.reading.lines[0]!.flags).toEqual(['NO_PRICE']);
    // Handwriting: the model says which lines it was unsure of; only a true counts.
    const h = validateReading({ lines: [{ text: 'سكر', line_total_iqd: 10000, unclear: true }, { text: 'حليب', line_total_iqd: 5000, unclear: 'yes' }] });
    expect(h.ok && h.reading.lines.map((l) => l.flags)).toEqual([['UNCLEAR'], []]);
    // A total is only checked when every line printed one.
    const partial = validateReading({ total_iqd: 1, lines: [{ text: 'A', line_total_iqd: 5000 }, { text: 'B' }] });
    expect(partial.ok && partial.reading.lines[0]!.flags).toEqual([]);
  });

  it('accepts a fenced JSON string, refuses what is not a reading, caps the lines', () => {
    expect(validateReading('```json\n{"lines":[]}\n```')).toEqual({ ok: true, reading: { lines: [] } });
    expect(validateReading('I cannot read this')).toMatchObject({ ok: false });
    expect(validateReading({ items: [] })).toMatchObject({ ok: false, reason: 'lines is not an array' });
    expect(validateReading(null)).toMatchObject({ ok: false });
    const many = validateReading({ lines: Array.from({ length: 250 }, (_, i) => ({ text: `L${i}` })) });
    expect(many.ok && many.reading.lines).toHaveLength(200);
    expect(isoDate('2026-09-26')).toBe('2026-09-26');
    expect(isoDate('26/09/2026')).toBeUndefined();
    expect(isoDate('1999-01-01')).toBeUndefined();
  });

  it('reads an order slip: whole quantities, notes, the table number folded', () => {
    expect(tableNumber('طاولة ١٢')).toBe('12');
    expect(tableNumber('T05')).toBe('5');
    expect(tableNumber(7)).toBe('7');
    expect(tableNumber('bar')).toBeUndefined();
    const r = validateSlip({
      table_number: 'ط٣',
      lines: [
        { text: ' لاتيه ', qty: '٢', notes: 'بدون سكر' },
        { text: 'كرك', qty: 1.5, unclear: true },
        { text: 'Water', qty: 120 },
        { text: '' },
      ],
    });
    expect(r).toEqual({
      ok: true,
      reading: {
        table_number: '3',
        lines: [
          { text: 'لاتيه', qty: 2, notes: 'بدون سكر', flags: [] },
          { text: 'كرك', flags: ['NO_QTY', 'UNCLEAR'] },
          { text: 'Water', flags: ['NO_QTY'] },
        ],
      },
    });
    expect(validateSlip('no')).toMatchObject({ ok: false });
    const s = validateSlip(structuredClone(FAKE_SLIP));
    expect(s.ok && s.reading.lines).toHaveLength(FAKE_SLIP.lines.length);
  });

  it('the fake reading and the schema agree', () => {
    const r = validateReading(structuredClone(FAKE_READING));
    expect(r.ok && r.reading.lines).toHaveLength(FAKE_READING.lines.length);
    expect(RECEIPT_SCHEMA.required).toEqual(['lines']);
    expect(receiptUserText(['A', 'B'])).toContain('A; B');
  });
});

// ── 2. reader selection ─────────────────────────────────────────────────────
describe('readerFromEnv', () => {
  const env = (vars: Record<string, string>) => (n: string) => vars[n];
  it('fake is the stand-in; nothing is connected until connect.ts returns a reader', async () => {
    const fake = readerFromEnv(env({ RECEIPT_READER: ' Fake ', SUPABASE_URL: 'http://kong:8000' }));
    expect(fake?.model).toBe(FAKE_MODEL);
    const input = (kind: 'receipt' | 'order_slip') => ({
      kind, imageBase64: '', mediaType: 'image/jpeg' as const, ...promptFor(kind, []), signal: new AbortController().signal,
    });
    const res = await fake!.read(input('receipt'));
    expect(res.usage).toEqual({ input: 0, output: 0 });
    expect(res.reading).toEqual(FAKE_READING);
    expect((await fake!.read(input('order_slip'))).reading).toEqual(FAKE_SLIP);
    expect(readerFromEnv(env({}))).toBeNull();
    expect(readerFromEnv(env({ RECEIPT_API_KEY: 'k' }))).toBeNull();
  });
});

// ── 3. the flow ─────────────────────────────────────────────────────────────
interface Calls {
  failed: [string, string][];
  stored: unknown[];
  prompts: string[];
  usage: [string, unknown][];
  began: number;
  llm: number;
}

function reader(model: string, read: ReceiptReader['read']): ReceiptReader {
  return { model, read };
}

function fakePorts(over: Partial<ScanPorts> = {}): { ports: ScanPorts; calls: Calls } {
  const calls: Calls = { failed: [], stored: [], prompts: [], usage: [], began: 0, llm: 0 };
  const ports: ScanPorts = {
    kind: 'receipt',
    beginReading: async () => {
      calls.began++;
      return { storage_path: 'v/receipts/x.jpg', names: ['Fake Supplier'], token: null };
    },
    reader: reader('some-model', async (input) => {
      calls.prompts.push(input.userText);
      return { reading: { lines: [{ text: 'Milk', qty: 1, line_total_iqd: 1500 }] }, usage: { input: 1200, output: 80 } };
    }),
    llmBegin: async () => {
      calls.llm++;
    },
    download: async () => new Uint8Array([1, 2, 3]),
    storeReading: async (_id, reading) => {
      calls.stored.push(reading);
      return { lines: reading.lines.length, matched: 1 };
    },
    failReading: async (_id, code, status) => {
      calls.failed.push([code, status]);
    },
    recordUsage: async (model, usage) => {
      calls.usage.push([model, usage]);
    },
    log: () => {},
    ...over,
  };
  return { ports, calls };
}

describe('scanReceipt', () => {
  it('stores a reading and records the spend', async () => {
    const { ports, calls } = fakePorts();
    expect(await scanReceipt(ports, 'r1')).toEqual({ status: 200, body: { status: 'read', lines: 1, matched: 1 } });
    expect(calls.llm).toBe(1);
    expect(calls.usage).toEqual([['some-model', { input: 1200, output: 80, cache_write: 0, cache_read: 0 }]]);
    expect(calls.failed).toEqual([]);
    expect(calls.prompts[0]).toContain('Fake Supplier');
  });

  it('reads an order slip with the slip prompt and validator', async () => {
    let seen: { kind: string; schema: unknown; userText: string } | null = null;
    const { ports, calls } = fakePorts({
      kind: 'order_slip',
      beginReading: async () => ({ storage_path: 'v/slips/x.jpg', names: ['Latte', 'Cappuccino'], token: null }),
      reader: reader('some-model', async (input) => {
        seen = { kind: input.kind, schema: input.schema, userText: input.userText };
        return { reading: { table_number: 'ط٣', lines: [{ text: 'لاتيه', qty: 2 }, { text: 'كرك' }] }, usage: { input: 5, output: 5 } };
      }),
    });
    expect((await scanReceipt(ports, 's1')).status).toBe(200);
    expect(seen).toMatchObject({ kind: 'order_slip', schema: SLIP_SCHEMA });
    expect(seen!.userText).toContain('Latte; Cappuccino');
    expect(calls.stored).toEqual([{ table_number: '3', lines: [{ text: 'لاتيه', qty: 2, flags: [] }, { text: 'كرك', flags: ['NO_QTY'] }] }]);
  });

  it('no model: the receipt goes back to uploaded, nothing is spent', async () => {
    const { ports, calls } = fakePorts({ reader: null });
    expect(await scanReceipt(ports, 'r1')).toMatchObject({ status: 503, body: { error: 'RECEIPT_READER_NOT_CONFIGURED' } });
    expect(calls.failed).toEqual([['READER_NOT_CONFIGURED', 'uploaded']]);
    expect(calls.llm).toBe(0);
    expect(calls.usage).toEqual([]);
  });

  it('the spend cap gives the receipt back without calling the model', async () => {
    let called = false;
    const { ports, calls } = fakePorts({
      llmBegin: async () => {
        throw new PortError('LLM_MONTHLY_CAP');
      },
      reader: reader('some-model', async () => {
        called = true;
        return { reading: { lines: [] }, usage: { input: 1, output: 1 } };
      }),
    });
    expect(await scanReceipt(ports, 'r1')).toEqual({ status: 429, body: { error: 'LLM_MONTHLY_CAP' } });
    expect(called).toBe(false);
    expect(calls.failed).toEqual([['LLM_MONTHLY_CAP', 'uploaded']]);
  });

  it('begin errors are answered, not thrown', async () => {
    for (const [code, status] of [['RECEIPT_BUSY', 409], ['RECEIPT_ALREADY_DONE', 409], ['RECEIPT_NOT_FOUND', 404]] as const) {
      const { ports } = fakePorts({
        beginReading: async () => {
          throw new PortError(code);
        },
      });
      expect(await scanReceipt(ports, 'r1')).toEqual({ status, body: { error: code } });
    }
  });

  it('a model error fails the receipt with its code and still records what was spent', async () => {
    const { ports, calls } = fakePorts({
      reader: reader('some-model', async () => {
        throw new ReceiptReaderError('RATE_LIMITED', '429', { input: 900, output: 0 });
      }),
    });
    expect(await scanReceipt(ports, 'r1')).toEqual({ status: 502, body: { error: 'RECEIPT_READ_FAILED', code: 'RATE_LIMITED' } });
    expect(calls.failed).toEqual([['RATE_LIMITED', 'failed']]);
    expect(calls.usage).toEqual([['some-model', { input: 900, output: 0, cache_write: 0, cache_read: 0 }]]);
  });

  it('a hung model times out', async () => {
    const { ports, calls } = fakePorts({
      timeoutMs: 20,
      reader: reader('some-model', ({ signal }) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))),
    });
    expect(await scanReceipt(ports, 'r1')).toMatchObject({ status: 502, body: { code: 'TIMEOUT' } });
    expect(calls.failed).toEqual([['TIMEOUT', 'failed']]);
  });

  it('an empty or malformed reading fails the receipt; a missing photo too', async () => {
    const empty = fakePorts({ reader: reader('m', async () => ({ reading: { lines: [] }, usage: { input: 1, output: 1 } })) });
    expect(await scanReceipt(empty.ports, 'r1')).toMatchObject({ status: 422, body: { code: 'UNREADABLE' } });
    expect(empty.calls.usage).toHaveLength(1);
    const junk = fakePorts({ reader: reader('m', async () => ({ reading: 'sorry', usage: { input: 1, output: 1 } })) });
    expect(await scanReceipt(junk.ports, 'r1')).toMatchObject({ status: 502, body: { code: 'INVALID_READING' } });
    const photo = fakePorts({
      download: async () => {
        throw new Error('gone');
      },
    });
    expect(await scanReceipt(photo.ports, 'r1')).toMatchObject({ status: 502, body: { code: 'PHOTO_MISSING' } });
    expect(photo.calls.stored).toEqual([]);
  });

  it('the fake is never metered', async () => {
    const { ports, calls } = fakePorts({
      reader: readerFromEnv((n) => ({ RECEIPT_READER: 'fake', SUPABASE_URL: 'http://127.0.0.1:54321' })[n]),
    });
    expect((await scanReceipt(ports, 'r1')).status).toBe(200);
    expect(calls.llm).toBe(0);
    expect(calls.usage).toEqual([]);
    expect(calls.stored).toHaveLength(1);
  });

  it('photo helpers', () => {
    expect(mediaTypeOf('a/receipts/x.JPG')).toBe('image/jpeg');
    expect(mediaTypeOf('a/receipts/x.webp')).toBe('image/webp');
    expect(mediaTypeOf('a/receipts/x.gif')).toBeNull();
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });
});

// ── 3b. hardening (0240) ────────────────────────────────────────────────────
describe('validate: numbers, text and flags as Iraq writes them', () => {
  it('money reads dots and commas as thousands; a quantity reads a short comma as a decimal point', () => {
    expect(toMoney('25.000')).toBe(25000);
    expect(toMoney('1.500.000')).toBe(1500000);
    expect(toMoney('٢٥٬٠٠٠')).toBe(25000);
    expect(toMoney('٢٥،٠٠٠')).toBe(25000);
    expect(toMoney('12.5')).toBe(12.5);
    expect(toQuantity('1,5')).toBe(1.5);
    expect(toQuantity('٢٫٥')).toBe(2.5);
    expect(toQuantity('0,25')).toBe(0.25);
    expect(toQuantity('1,500')).toBe(1500);
    const r = validateReading({
      lines: [{ text: 'Sugar', qty: '1,5', unit: 'kg', unit_price_iqd: '2.000', line_total_iqd: '3.000' }],
    });
    expect(r.ok && r.reading.lines[0]).toMatchObject({ qty: 1.5, unit_price_iqd: 2000, line_total_iqd: 3000, flags: [] });
  });

  it('a price under 250 IQD is flagged as likely thousands shorthand', () => {
    const r = validateReading({ lines: [{ text: 'Milk', qty: 2, unit_price_iqd: 15, line_total_iqd: 30 }, { text: 'Free', line_total_iqd: 0 }] });
    expect(r.ok && r.reading.lines.map((l) => l.flags)).toEqual([['SMALL_AMOUNT'], []]);
  });

  it('text loses NUL, controls, direction overrides and lone surrogates, and is capped by characters', () => {
    expect(text('ab\u0000c\u0007d', 50)).toBe('abcd');
    expect(text('‮evil‬ name', 50)).toBe('evil name');
    expect(text('bad \uD800 half', 50)).toBe('bad half');
    expect(text('سكر‏', 50)).toBe('سكر‏');
    const emoji = '😀'.repeat(5);
    expect(text(emoji, 3)).toBe('😀😀😀');
    expect(Array.from(text('x'.repeat(250), 200)!)).toHaveLength(200);
    const r = validateReading({ supplier_name: '\u0000', lines: [{ text: 'Milk\u0000 1L', line_total_iqd: 1500 }] });
    expect(r.ok && r.reading).toEqual({ lines: [{ text: 'Milk 1L', line_total_iqd: 1500, flags: [] }] });
  });

  it('marks a cut-off paper, reads "true" as unsure, and drops a date in the future and table 0', () => {
    const many = validateReading({ lines: Array.from({ length: 205 }, (_, i) => ({ text: `L${i}`, line_total_iqd: 1000 })) });
    expect(many.ok && many.reading.lines.at(-1)!.flags).toContain('TRUNCATED');
    expect(many.ok && many.reading.lines[0]!.flags).not.toContain('TRUNCATED');
    const slips = validateSlip({ lines: Array.from({ length: 61 }, (_, i) => ({ text: `S${i}`, qty: 1 })) });
    expect(slips.ok && slips.reading.lines.at(-1)!.flags).toEqual(['TRUNCATED']);
    const u = validateReading({ lines: [{ text: 'A', line_total_iqd: 1000, unclear: 'true' }] });
    expect(u.ok && u.reading.lines[0]!.flags).toEqual(['UNCLEAR']);
    const now = new Date('2026-09-27T10:00:00Z');
    expect(validateReading({ receipt_date: '2026-09-28', lines: [] }, now)).toMatchObject({ reading: { receipt_date: '2026-09-28' } });
    expect(validateReading({ receipt_date: '2026-10-05', lines: [] }, now)).toEqual({ ok: true, reading: { lines: [] } });
    expect(tableNumber('طاولة ٠')).toBeUndefined();
    expect(tableNumber('0')).toBeUndefined();
  });
});

describe('readerFromEnv: the fake only on a local stack', () => {
  const env = (vars: Record<string, string>) => (n: string) => vars[n];
  it('refuses the fake on a hosted project, unless allowed on purpose', () => {
    const logs: string[] = [];
    expect(readerFromEnv(env({ RECEIPT_READER: 'fake', SUPABASE_URL: 'https://abc.supabase.co' }), (m) => logs.push(m))).toBeNull();
    expect(logs[0]).toContain('refused');
    expect(readerFromEnv(env({ RECEIPT_READER: 'fake' }))).toBeNull();
    expect(readerFromEnv(env({ RECEIPT_READER: 'fake', SUPABASE_URL: 'https://abc.supabase.co', ALLOW_FAKE_READER: '1' }))?.model).toBe(FAKE_MODEL);
    for (const url of ['http://kong:8000', 'http://127.0.0.1:54321', 'http://localhost:54321', 'http://host.docker.internal:54321']) {
      expect(isLocalStack(url), url).toBe(true);
    }
    expect(isLocalStack('https://kong.example.com')).toBe(false);
    expect(isLocalStack('not a url')).toBe(false);
  });

  it('the fake reader conforms to the contract a real one must meet', async () => {
    const fake = readerFromEnv(env({ RECEIPT_READER: 'fake', SUPABASE_URL: 'http://kong:8000' }))!;
    expect(await readerConformance(fake)).toEqual([]);
    const bad: ReceiptReader = {
      model: '',
      read: async () => ({ reading: {}, usage: { input: -1, output: 1.5 } }),
    };
    const problems = await readerConformance(bad, 50);
    expect(problems.join('\n')).toMatch(/model/);
    expect(problems.join('\n')).toMatch(/usage/);
    expect(problems.join('\n')).toMatch(/aborted read must reject/);
  });
});

describe('scanReceipt: nothing is left reading', () => {
  it('passes the lease token to store and fail', async () => {
    const seen: (string | null)[] = [];
    const { ports } = fakePorts({
      beginReading: async () => ({ storage_path: 'v/receipts/x.jpg', names: [], token: 'tok-1' }),
      storeReading: async (_id, reading, _m, token) => {
        seen.push(token);
        return { lines: reading.lines.length, matched: 0 };
      },
    });
    expect((await scanReceipt(ports, 'r1')).status).toBe(200);
    expect(seen).toEqual(['tok-1']);
  });

  it('a store that fails ends the reading (STORE_FAILED); one superseded is dropped quietly', async () => {
    const broken = fakePorts({
      storeReading: async () => {
        throw new PortError('connection reset');
      },
    });
    expect(await scanReceipt(broken.ports, 'r1')).toEqual({ status: 500, body: { error: 'RECEIPT_READ_FAILED', code: 'STORE_FAILED' } });
    expect(broken.calls.failed).toEqual([['STORE_FAILED', 'failed']]);
    expect(broken.calls.usage).toHaveLength(1);
    for (const code of ['RECEIPT_NOT_READING', 'READING_SUPERSEDED']) {
      const late = fakePorts({
        storeReading: async () => {
          throw new PortError(code);
        },
      });
      expect(await scanReceipt(late.ports, 'r1')).toEqual({ status: 409, body: { error: 'READING_SUPERSEDED' } });
      expect(late.calls.failed).toEqual([]);
    }
  });

  it('a failure to end the reading is logged, never thrown over the answer', async () => {
    const logs: string[] = [];
    const { ports } = fakePorts({
      reader: null,
      failReading: async () => {
        throw new PortError('down');
      },
      log: (m) => logs.push(m),
    });
    expect((await scanReceipt(ports, 'r1')).status).toBe(503);
    expect(logs.join('\n')).toContain('not ended');
  });

  it('an unexpected error after the paper was taken still ends it', async () => {
    const { ports, calls } = fakePorts({
      llmBegin: async () => {
        throw new PortError('boom');
      },
    });
    await expect(scanReceipt(ports, 'r1')).rejects.toThrow();
    expect(calls.failed).toEqual([['UPSTREAM', 'uploaded']]);
  });

  it('a reader that ignores the signal still times out on time', async () => {
    const { ports, calls } = fakePorts({
      timeoutMs: 30,
      reader: reader('some-model', () => new Promise(() => {})),
    });
    const started = Date.now();
    expect(await scanReceipt(ports, 'r1')).toMatchObject({ status: 502, body: { code: 'TIMEOUT' } });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls.failed).toEqual([['TIMEOUT', 'failed']]);
  });

  it('a missing photo or a hung download spends no budget', async () => {
    const missing = fakePorts({
      download: async () => {
        throw new Error('gone');
      },
    });
    expect(await scanReceipt(missing.ports, 'r1')).toMatchObject({ body: { code: 'PHOTO_MISSING' } });
    expect(missing.calls.llm).toBe(0);
    const hung = fakePorts({ downloadTimeoutMs: 20, download: () => new Promise(() => {}) });
    expect(await scanReceipt(hung.ports, 'r1')).toMatchObject({ body: { code: 'TIMEOUT' } });
    expect(hung.calls.llm).toBe(0);
    const odd = fakePorts({ beginReading: async () => ({ storage_path: 'v/receipts/x.gif', names: [], token: null }) });
    expect(await scanReceipt(odd.ports, 'r1')).toMatchObject({ body: { code: 'PHOTO_MISSING' } });
    expect(odd.calls.llm).toBe(0);
  });

  it('the new per-paper and per-person limits are answered 429', async () => {
    for (const code of ['SCAN_REREAD_LIMIT', 'SCAN_USER_DAILY_LIMIT']) {
      const { ports } = fakePorts({
        beginReading: async () => {
          throw new PortError(code);
        },
      });
      expect(await scanReceipt(ports, 'r1')).toEqual({ status: 429, body: { error: code } });
    }
  });

  it('usage is recorded as whole, non-negative counts', () => {
    expect(cleanUsage({ input: 12.6, output: -3, cache_read: Number.NaN })).toEqual({
      input: 13, output: 0, cache_write: 0, cache_read: 0,
    });
  });
});

// ── 4. boundary ─────────────────────────────────────────────────────────────
describe('boundary: only connect.ts knows the model', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const FUNCTIONS = resolve(here, '../supabase/functions');
  const SEAM = 'functions/_shared/receipts/connect.ts';
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const rel = (f: string) => 'functions/' + relative(FUNCTIONS, f).split(sep).join('/');

  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : tsFiles(full);
      return name.endsWith('.ts') ? [full] : [];
    });
  }

  it.each(['RECEIPT_API_KEY', 'RECEIPT_MODEL', 'connectReceiptModel'])('"%s" is used only by the seam', (token) => {
    const offenders = tsFiles(FUNCTIONS)
      .filter((f) => stripComments(readFileSync(f, 'utf8')).includes(token))
      .map(rel)
      .filter((f) => f !== SEAM && !(token === 'connectReceiptModel' && f === 'functions/_shared/receipts/index.ts'));
    expect(offenders).toEqual([]);
  });

  it('nothing else in the receipt code calls out or imports a vendor SDK', () => {
    const files = [...tsFiles(join(FUNCTIONS, '_shared/receipts')), ...tsFiles(join(FUNCTIONS, 'receipt-scan'))]
      .filter((f) => rel(f) !== SEAM);
    for (const f of files) {
      const src = stripComments(readFileSync(f, 'utf8'));
      expect(src, rel(f)).not.toMatch(/\bfetch\(/);
      const npm = [...src.matchAll(/from 'npm:([^']+)'/g)].map((m) => m[1]);
      expect(npm.filter((p) => !p!.startsWith('@supabase/supabase-js')), rel(f)).toEqual([]);
    }
  });
});
