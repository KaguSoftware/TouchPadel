/**
 * The one mapping from client-data/cafe-pos-2026/history-*.csv to the rows of
 * legacy_cafe_hours, legacy_cafe_item_days and legacy_cafe_products (migration
 * 0412). The three files are written by client-data/cafe-pos-2026/extract.py
 * from the old till's PDF exports; migration 0413 is `migrationRowsSql()` and
 * tests/legacy-cafe-source.test.ts fails if the file and this disagree. Nothing
 * here computes a figure: every value is copied from the files.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client-data', 'cafe-pos-2026');
export const DEFAULT_VENUE_ID = 'c0000000-0000-4000-8000-000000000001';

/** A small CSV reader: quoted fields, doubled quotes, \n line ends. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const int = (s) => {
  if (!/^\d+$/.test(s)) throw new Error(`not a whole number: "${s}"`);
  return Number(s);
};
const intOrNull = (s) => (s === '' ? null : int(s));
const read = (name) => parseCsv(readFileSync(join(DATA_DIR, name), 'utf8'));

/**
 * @typedef {{ day: string, hour: number, item_lines: number, units: number, items_gross_iqd: number, tickets: number,
 *   orders: number | null, orders_gross_iqd: number | null, discount_iqd: number | null, received_iqd: number | null }} CafeHourRow
 * @typedef {{ day: string, product: string, unit_price_iqd: number, units: number }} CafeItemDayRow
 * @typedef {{ product: string, unit_price_iqd: number, group_key: string, cost_iqd: number | null, cost_stated: string | null }} CafeProductRow
 */

/** @returns {{ hours: CafeHourRow[], items: CafeItemDayRow[], products: CafeProductRow[] }} */
export function readHistory() {
  return {
    hours: read('history-hours.csv').map((r) => ({
      day: r.day,
      hour: int(r.hour),
      item_lines: int(r.item_lines),
      units: int(r.units),
      items_gross_iqd: int(r.items_gross_iqd),
      tickets: int(r.tickets),
      orders: intOrNull(r.orders),
      orders_gross_iqd: intOrNull(r.orders_gross_iqd),
      discount_iqd: intOrNull(r.discount_iqd),
      received_iqd: intOrNull(r.received_iqd),
    })),
    items: read('history-items.csv').map((r) => ({
      day: r.day,
      product: r.product,
      unit_price_iqd: int(r.unit_price_iqd),
      units: int(r.units),
    })),
    products: read('history-products.csv').map((r) => ({
      product: r.product,
      unit_price_iqd: int(r.unit_price_iqd),
      group_key: r.group_key,
      cost_iqd: intOrNull(r.cost_iqd),
      cost_stated: r.cost_stated === '' ? null : r.cost_stated,
    })),
  };
}

/**
 * One figure per day, by the rule of the view legacy_cafe_days (0412): the
 * larger gross of the two reports, net = received + the items money the orders
 * report lacks, orders = the larger count. The tests compare the view with it.
 */
export function dayFigures(hours) {
  const days = new Map();
  for (const h of hours) {
    const d = days.get(h.day) ?? { day: h.day, items: 0, og: null, disc: null, recv: null, orders: null, tickets: 0, units: 0 };
    d.items += h.items_gross_iqd;
    d.tickets += h.tickets;
    d.units += h.units;
    if (h.orders !== null) {
      d.og = (d.og ?? 0) + h.orders_gross_iqd;
      d.disc = (d.disc ?? 0) + h.discount_iqd;
      d.recv = (d.recv ?? 0) + h.received_iqd;
      d.orders = (d.orders ?? 0) + h.orders;
    }
    days.set(h.day, d);
  }
  return [...days.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((d) => ({
      day: d.day,
      gross_iqd: Math.max(d.og ?? 0, d.items),
      discount_iqd: d.disc,
      net_iqd: (d.recv ?? 0) + Math.max(d.items - (d.og ?? 0), 0),
      orders: Math.max(d.orders ?? 0, d.tickets),
      units: d.units,
      has_orders_export: d.orders !== null,
    }));
}

const sqlValue = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** `insert … select <venue>, <casts> from (values …) v(cols)`: the venue id is written once, not per row. */
function insertSql(table, venueId, cols, rows, conflict) {
  const names = cols.map(([name]) => name);
  const values = rows.map((r) => `  (${names.map((c) => sqlValue(r[c])).join(', ')})`).join(',\n');
  const select = cols.map(([name, type]) => `v.${name}::${type}`).join(', ');
  return (
    `insert into ${table} (venue_id, ${names.join(', ')})\n` +
    `select '${venueId}'::uuid, ${select}\n  from (values\n${values}\n  ) as v(${names.join(', ')})\n` +
    `on conflict ${conflict} do nothing;\n`
  );
}

/**
 * The body of migration 0413: the old till's rows as SQL, so they reach every
 * database (hosted included) with the deploy. Generated; never edit by hand.
 */
export function migrationRowsSql(venueId = DEFAULT_VENUE_ID) {
  const { hours, items, products } = readHistory();
  return [
    insertSql(
      'legacy_cafe_hours',
      venueId,
      [
        ['day', 'date'],
        ['hour', 'smallint'],
        ['item_lines', 'int'],
        ['units', 'int'],
        ['items_gross_iqd', 'bigint'],
        ['tickets', 'int'],
        ['orders', 'int'],
        ['orders_gross_iqd', 'bigint'],
        ['discount_iqd', 'bigint'],
        ['received_iqd', 'bigint'],
      ],
      hours,
      '(venue_id, day, hour)',
    ),
    insertSql(
      'legacy_cafe_item_days',
      venueId,
      [
        ['day', 'date'],
        ['product', 'text'],
        ['unit_price_iqd', 'bigint'],
        ['units', 'int'],
      ],
      items,
      '(venue_id, day, product, unit_price_iqd)',
    ),
    insertSql(
      'legacy_cafe_products',
      venueId,
      [
        ['product', 'text'],
        ['unit_price_iqd', 'bigint'],
        ['group_key', 'text'],
        ['cost_iqd', 'bigint'],
        ['cost_stated', 'text'],
      ],
      products,
      '(venue_id, product, unit_price_iqd)',
    ),
  ].join('\n');
}
