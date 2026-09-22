/**
 * clean.ts — the only door between the database and any vendor (plan §11.0).
 * Each stage on its own, then the composition on a 20-row payments-like
 * sample whose shaped size is pinned: the diet is a contract, not a hope.
 */
import { describe, expect, it } from 'vitest';
import {
  cap,
  capMarker,
  clean,
  CleanError,
  DATA_SENTENCE,
  fold,
  frame,
  handle,
  measure,
  normalise,
  project,
  redact,
  sourceForTool,
  sourceForToolName,
  toolResultBlock,
  type CleanSource,
  type Row,
} from '../supabase/functions/_shared/assistant/clean.ts';
import { newHandleTable, toJson } from '../supabase/functions/_shared/assistant/handles.ts';
import { toolByName } from '../supabase/functions/_shared/assistant/tools.ts';

const TZ = 'Asia/Baghdad';
const STAFF_A = '11111111-1111-4111-8111-111111111111';
const STAFF_B = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';

function uuid(n: number): string {
  const h = n.toString(16).padStart(12, '0');
  return `aaaaaaaa-bbbb-4ccc-8ddd-${h}`;
}

/** 20 payment rows as assistant_payments_list returns them (contracts, Lane A). */
function paymentsSample(n = 20): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: uuid(1000 + i),
      tab_id: uuid(2000 + i),
      day_session_id: SESSION,
      method: i % 3 === 0 ? 'card' : 'cash',
      amount_iqd: 15000 + i * 2500,
      tendered_iqd: i % 3 === 0 ? 15000 + i * 2500 : 20000 + i * 2500,
      change_iqd: i % 3 === 0 ? 0 : 5000,
      recorded_by: i % 2 ? STAFF_A : STAFF_B,
      recorded_by_name: i % 2 ? 'Ali' : 'Sara',
      created_at: `2026-09-20T${String(8 + (i % 12)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:13.512+00:00`,
      refunded_iqd: i === 4 ? 15000 : null,
    });
  }
  return rows;
}

const opts = () => ({ tz: TZ, lang: 'en' as const, handles: newHandleTable(null) });

describe('project', () => {
  const source: CleanSource = { kind: 'tool', name: 'payments_list', rows_path: 'rows', id_keys: ['id'], columns: ['id', 'amount_iqd', 'method'], tool_kind: 'list' };

  it('keeps allowlisted columns, drops and names the rest', () => {
    const r = project([{ id: 'a', amount_iqd: 1, method: 'cash', pin_hash: 'x', created_at: 'y' }], source);
    expect(Object.keys(r.rows[0] as Row)).toEqual(['id', 'amount_iqd', 'method']);
    expect(r.dropped).toEqual(['created_at', 'pin_hash']);
    expect(r.cols_in).toBe(5);
  });

  it('narrows to the requested subset', () => {
    const r = project([{ id: 'a', amount_iqd: 1, method: 'cash' }], source, ['amount_iqd']);
    expect(r.rows[0]).toEqual({ amount_iqd: 1 });
  });

  it('refuses a requested column outside the allowlist', () => {
    expect(() => project([{ id: 'a' }], source, ['pin_hash'])).toThrowError(CleanError);
    try {
      project([{ id: 'a' }], source, ['created_at']);
    } catch (e) {
      expect((e as CleanError).code).toBe('UNKNOWN_COLUMN');
    }
  });

  it("allows '*' only for curated kinds", () => {
    const agg: CleanSource = { kind: 'tool', name: 'panel_headline', rows_path: 'figures', id_keys: [], columns: '*', tool_kind: 'aggregate' };
    expect(project([{ revenue: 1 }], agg).rows).toEqual([{ revenue: 1 }]);
    const list: CleanSource = { ...agg, name: 'payments_list', tool_kind: 'list' };
    expect(() => project([{ revenue: 1 }], list)).toThrowError(/only allowed for aggregate/);
    const chunk: CleanSource = { kind: 'chunk', name: 'note', rows_path: null, id_keys: [], columns: '*' };
    expect(() => project([{ body: 'x' }], chunk)).toThrowError(CleanError);
  });

  it('flattens nested objects to dotted names', () => {
    const agg: CleanSource = { kind: 'tool', name: 'report_cafe', rows_path: null, id_keys: [], columns: '*', tool_kind: 'aggregate' };
    expect(project([{ kpis: { sales_iqd: 5, tabs: 2 } }], agg).rows[0]).toEqual({ 'kpis.sales_iqd': 5, 'kpis.tabs': 2 });
  });
});

describe('redact', () => {
  it('pseudonymises phones in Latin and Arabic-Indic digits and in international form to ONE stable handle', () => {
    const handles = newHandleTable(null);
    const r = redact(
      [
        { note: 'call 07701234567 tomorrow' },
        { note: 'رقمه ٠٧٧٠١٢٣٤٥٦٧ للتأكيد' },
        { note: 'or +964 770 123 4567 / 00964 770 123 4567' },
        { guest_phone: '07701234567' },
      ],
      handles,
    );
    expect(r.rows[0]?.note).toBe('call phone#1 tomorrow');
    expect(r.rows[1]?.note).toBe('رقمه phone#1 للتأكيد');
    expect(r.rows[2]?.note).toBe('or phone#1 / phone#1');
    expect(r.rows[3]?.guest_phone).toBe('phone#1');
    expect(r.redacted).toBe(5);
    // the raw number never survives anywhere in the output
    expect(JSON.stringify(r.rows)).not.toMatch(/770\s?123/);
  });

  it('pseudonymises emails inside free text and in email columns', () => {
    const handles = newHandleTable(null);
    const r = redact([{ note: 'reach Ali at ali.h@example.com or ALI.H@EXAMPLE.COM', email: 'sara@example.org' }], handles);
    expect(r.rows[0]?.note).toBe('reach Ali at email#1 or email#1');
    expect(r.rows[0]?.email).toBe('email#2');
    expect(r.redacted).toBe(3);
  });

  it('leaves amounts, timestamps and short numbers alone', () => {
    const r = redact([{ note: 'paid 1,250,000 at 2026-09-20 14:30, table 12, order 250000' }], newHandleTable(null));
    expect(r.rows[0]?.note).toBe('paid 1,250,000 at 2026-09-20 14:30, table 12, order 250000');
    expect(r.redacted).toBe(0);
  });

  it('drops excluded columns that slipped through and summarises before/after to changed_keys', () => {
    const r = redact(
      [{ id: 1, pin_hash: 'abc', expo_push_token: 't', api_secret: 's', before: { status: 'open', total: 5 }, after: { status: 'settled', total: 5 } }],
      newHandleTable(null),
    );
    expect(r.rows[0]).toEqual({ id: 1, changed_keys: ['status'] });
    expect(r.dropped).toEqual(['api_secret', 'expo_push_token', 'pin_hash']);
  });

  it('keeps the pseudonym table in the handles so the UI can restore it', () => {
    const handles = newHandleTable(null);
    redact([{ phone: '07701234567' }], handles);
    expect(toJson(handles)).toMatchObject({ 'phone#1': 'phone:07701234567', _next: { phone: 2 } });
  });
});

describe('normalise', () => {
  it('formats timestamps venue-local without seconds or zone', () => {
    const r = normalise([{ created_at: '2026-09-20T11:30:13.512+00:00', settled_at: '2026-09-20 23:05:00+00' }], TZ);
    expect(r[0]?.created_at).toBe('2026-09-20 14:30');
    expect(r[0]?.settled_at).toBe('2026-09-21 02:05');
  });

  it('IQD to integers, percentages to one decimal, other floats to two, booleans to y/n', () => {
    const r = normalise([{ amount_iqd: 12499.6, occupancy_pct: 43.267, avg_items: 3.14159, is_active: true, refunded: false, count: 7 }], TZ);
    expect(r[0]).toEqual({ amount_iqd: 12500, occupancy_pct: 43.3, avg_items: 3.14, is_active: 'y', refunded: 'n', count: 7 });
  });

  it('Arabic-Indic digits in values become ASCII; column names are untouched; enums unchanged', () => {
    const r = normalise([{ 'ملاحظة٢': 'الطاولة ١٢', status: 'awaiting_payment' }], TZ);
    expect(r[0]).toEqual({ 'ملاحظة٢': 'الطاولة 12', status: 'awaiting_payment' });
  });
});

describe('fold', () => {
  it('removes nulls, moves single-valued columns to the legend, marks sparse columns', () => {
    const f = fold([
      { a: 1, same: 'x', rare: null, b: 'q' },
      { a: 2, same: 'x', rare: null, b: null },
      { a: 3, same: 'x', rare: 9, b: 'r' },
      { a: 4, same: 'x', rare: null, b: 's' },
    ]);
    expect(f.legend).toEqual([{ key: 'same', value: 'x' }]);
    expect(f.sparse).toEqual(['rare']);
    expect(f.columns).toEqual(['a', 'b']);
    expect(f.rows[0]).toEqual({ a: 1, b: 'q' });
    expect(f.rows[2]).toEqual({ a: 3, rare: 9, b: 'r' });
  });

  it('a single row folds nothing', () => {
    const f = fold([{ a: 1, b: 'x' }]);
    expect(f.legend).toEqual([]);
    expect(f.columns).toEqual(['a', 'b']);
  });
});

describe('handle', () => {
  it('replaces ids with letter handles by key, the same uuid always the same handle', () => {
    const handles = newHandleTable(null);
    const rows = handle(
      [
        { id: uuid(1), tab_id: uuid(2), recorded_by: STAFF_A, court_id: uuid(3), note: `see ${uuid(2)} later` },
        { id: uuid(4), tab_id: uuid(2), recorded_by: STAFF_A, court_id: uuid(3) },
      ],
      ['id', 'tab_id', 'recorded_by', 'court_id'],
      handles,
    );
    expect(rows[0]).toEqual({ id: 'x1', tab_id: 't1', recorded_by: 's1', court_id: 'k1', note: 'see t1 later' });
    expect(rows[1]).toEqual({ id: 'x2', tab_id: 't1', recorded_by: 's1', court_id: 'k1' });
  });

  it('uses the payment / reservation / customer letters', () => {
    const handles = newHandleTable(null);
    const rows = handle([{ payment_id: uuid(1), reservation_id: uuid(2), customer_id: uuid(3), item_id: uuid(4) }], ['payment_id', 'reservation_id', 'customer_id', 'item_id'], handles);
    expect(rows[0]).toEqual({ payment_id: 'p1', reservation_id: 'r1', customer_id: 'c1', item_id: 'i1' });
  });
});

describe('cap and frame', () => {
  it('caps at the limit and counts the rest from the payload or the RPC total', () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ i }));
    expect(cap(rows).rows.length).toBe(500);
    expect(cap(rows).more).toBe(100);
    expect(cap(rows.slice(0, 500), 500, 1740).more).toBe(1240);
    expect(capMarker(1240)).toBe('… 1,240 more rows; narrow the filter or propose a job');
  });

  it('frames the block as data with the source and row count and one fixed sentence', () => {
    const src: CleanSource = { kind: 'tool', name: 'payments_list', rows_path: 'rows', id_keys: [], columns: [] , tool_kind: 'list' };
    const out = frame(src, 'body', 3);
    expect(out).toBe(`<data source="payments_list" rows="3">\nbody\n</data>\n${DATA_SENTENCE}`);
  });

  it('measure reports bytes and a byte-based token estimate', () => {
    const m = measure({ a: 1 }, 'abcd'.repeat(10), { rows_in: 1, rows_out: 1, cols_in: 1, cols_out: 1, dropped: [], redacted: 0 });
    expect(m.bytes_in).toBe(7);
    expect(m.bytes_out).toBe(40);
    expect(m.tokens_est).toBe(10);
  });
});

describe('clean() on the 20-row payments sample (golden)', () => {
  const spec = toolByName('payments_list')!;
  const data = { rows: paymentsSample(), total: 20 };
  const o = opts();
  const cleaned = clean(sourceForTool(spec), data, { ...o, total: 20 });
  const lines = cleaned.text.split('\n');

  it('lays out frame, legend, header, 20 TSV rows, closing tag and the data sentence', () => {
    expect(lines[0]).toBe('<data source="payments_list" rows="20">');
    expect(lines[1]).toBe('# payments_list: 20 rows; IQD integers; times Asia/Baghdad; day_session_id=x1 for all');
    expect(lines[2]).toBe('id\ttab_id\tmethod\tamount_iqd\ttendered_iqd\tchange_iqd\trecorded_by\trecorded_by_name\tcreated_at');
    const rows = lines.slice(3, 23);
    expect(rows).toHaveLength(20);
    for (const row of rows) expect(row.split('\t').length).toBeGreaterThanOrEqual(9);
    expect(lines[23]).toBe('</data>');
    expect(lines[24]).toBe(DATA_SENTENCE);
    expect(lines).toHaveLength(25);
  });

  it('puts the sparse refund on its row as a trailing key=value and nowhere else', () => {
    const withRefund = lines.filter((l) => l.includes('refunded_iqd='));
    expect(withRefund).toHaveLength(1);
    expect(withRefund[0]).toMatch(/\trefunded_iqd=15000$/);
  });

  it('shows handles, not uuids, and local times without seconds', () => {
    expect(cleaned.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(lines[3]).toMatch(/^p1\tt1\tcard\t15000\t15000\t0\ts1\tSara\t2026-09-20 11:00$/);
  });

  it('stays under 30 shaped tokens per row', () => {
    expect(cleaned.stats.rows_in).toBe(20);
    expect(cleaned.stats.rows_out).toBe(20);
    expect(cleaned.stats.tokens_est / cleaned.stats.rows_out).toBeLessThanOrEqual(30);
    // and beats the raw payload by a wide margin
    expect(cleaned.stats.bytes_out * 3).toBeLessThan(cleaned.stats.bytes_in);
  });

  it('records the receipt', () => {
    expect(cleaned.stats.cols_in).toBe(11);
    expect(cleaned.stats.dropped).toEqual([]);
    expect(cleaned.stats.redacted).toBe(0);
    expect(cleaned.numbers).toContain(15000);
    expect(cleaned.numbers).toContain(20);
  });

  it('extends the shared handle table deterministically', () => {
    const json = toJson(o.handles);
    expect(json['x1']).toBe(SESSION);
    expect(json['s1']).toBe(STAFF_B);
    expect(json['s2']).toBe(STAFF_A);
    expect((json['_next'] as Record<string, number>).p).toBe(21);
  });
});

describe('clean() edge cases', () => {
  it('appends the cap marker when the RPC total exceeds what was returned', () => {
    const spec = toolByName('payments_list')!;
    const c = clean(sourceForTool(spec), { rows: paymentsSample(5), total: 1245 }, { ...opts(), total: 1245 });
    expect(c.text).toContain('… 1,240 more rows; narrow the filter or propose a job');
  });

  it('caps a payload longer than the cap and says how many more', () => {
    const spec = toolByName('payments_list')!;
    const c = clean(sourceForTool(spec), { rows: paymentsSample(12) }, { ...opts(), cap: 10 });
    expect(c.stats.rows_in).toBe(12);
    expect(c.stats.rows_out).toBe(10);
    expect(c.text).toContain('… 2 more rows; narrow the filter or propose a job');
  });

  it('refuses an unknown requested column with UNKNOWN_COLUMN', () => {
    const spec = toolByName('payments_list')!;
    expect(() => clean(sourceForTool(spec), { rows: paymentsSample(2) }, { ...opts(), requested: ['card_number'] })).toThrowError(/not readable/);
  });

  it('refuses an unknown tool with UNKNOWN_SOURCE', () => {
    expect(() => sourceForToolName('drop_everything')).toThrowError(CleanError);
  });

  it('table_read takes its columns from the RPC and rejects a request outside them', () => {
    const spec = toolByName('table_read')!;
    const src = sourceForTool(spec, ['id', 'status']);
    const c = clean(src, { rows: [{ id: uuid(1), status: 'open', secret_token: 'zzz' }], total: 1, columns: ['id', 'status'] }, opts());
    expect(c.text).toContain('x1\topen');
    expect(c.text).not.toContain('zzz');
    expect(() => clean(src, { rows: [{ id: uuid(1) }] }, { ...opts(), requested: ['secret_token'] })).toThrowError(CleanError);
  });

  it('lays an aggregate object out as key/value lines with nested rows as sub-tables', () => {
    const spec = toolByName('report_cafe')!;
    const c = clean(
      sourceForTool(spec),
      { kpis: { sales_iqd: 1250000.4, tabs: 42, refund_pct: 2.345 }, rows: [{ day: '2026-09-19', sales_iqd: 600000 }, { day: '2026-09-20', sales_iqd: 650000 }] },
      opts(),
    );
    expect(c.text).toContain('kpis.sales_iqd\t1250000');
    expect(c.text).toContain('kpis.refund_pct\t2.3');
    expect(c.text).toContain('## rows: 2 rows');
    expect(c.text).toContain('day\tsales_iqd');
    expect(c.text).toContain('2026-09-20\t650000');
    expect(c.numbers).toContain(1250000);
    expect(c.numbers).toContain(650000);
  });

  it('redacts a customer note inside a lookup payload', () => {
    const spec = toolByName('customer_record')!;
    const c = clean(sourceForTool(spec), { id: uuid(9), full_name: 'Ali Hassan', phone: '+9647701234567', notes: [{ id: uuid(10), body: 'prefers court 2, 07701234567' }] }, opts());
    expect(c.text).toContain('phone\tphone#1');
    expect(c.text).toContain('phone#1');
    expect(c.text).not.toContain('7701234567');
    expect(c.stats.redacted).toBe(2);
  });

  it('a chunk is a titled paragraph with its route and the pseudonymised body', () => {
    const src: CleanSource = { kind: 'chunk', name: 'note', rows_path: null, id_keys: ['id', 'customer_id'], columns: ['id', 'customer_id', 'body', 'created_at'] };
    const c = clean(src, { id: uuid(1), customer_id: uuid(2), body: 'Wants a call on 07701234567 before Friday', created_at: '2026-09-20T09:00:00Z', pin_hash: 'no' }, opts());
    expect(c.text.split('\n')[0]).toBe('note');
    expect(c.text).toContain('Wants a call on phone#1 before Friday');
    expect(c.text).not.toContain('<data');
    expect(c.stats.dropped).toEqual(['pin_hash']);
  });

  it('toolResultBlock is the only constructor and carries the cleaned text verbatim', () => {
    const spec = toolByName('list_staff')!;
    const c = clean(sourceForTool(spec), [{ id: uuid(1), display_name: 'Ali', role: 'owner', is_active: true, has_pin: true }], opts());
    const block = toolResultBlock('toolu_1', c);
    expect(block).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: c.text });
    expect(toolResultBlock('toolu_2', c, true).is_error).toBe(true);
  });
});
