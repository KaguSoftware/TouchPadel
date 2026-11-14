/**
 * 0412/0413 legacy café history, the source side: the three files
 * client-data/cafe-pos-2026/extract.py writes from the old till's PDFs are
 * held to the till's own printed totals, agree with each other, and are
 * exactly what migration 0413 loads. The PDFs are not in git (`*.pdf` is
 * ignored), so this cannot re-read them; `python3 extract.py --check` does,
 * on a machine that has them. Pure: no stack.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_DIR, dayFigures, migrationRowsSql, parseCsv, readHistory } from '../scripts/lib/legacy-cafe.mjs';

const { hours, items, products } = readHistory();
const days = dayFigures(hours);
const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);
const inMonth = (m: string) => <T extends { day: string }>(r: T) => r.day.startsWith(m);

describe('0413 legacy café history: the files are the till\'s reports, nothing added', () => {
  it('covers 2 June to 31 October 2026: 147 trading days, the known gaps and no other', () => {
    expect(days).toHaveLength(147);
    expect(days[0]!.day).toBe('2026-06-02');
    expect(days.at(-1)!.day).toBe('2026-10-31');
    const have = new Set(days.map((d) => d.day));
    const missing: string[] = [];
    for (let t = Date.UTC(2026, 5, 2); t <= Date.UTC(2026, 9, 31); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (!have.has(d)) missing.push(d);
    }
    // Closed 25-26 June and 3-4 August; 30 June is in no report.
    expect(missing).toEqual(['2026-06-25', '2026-06-26', '2026-06-30', '2026-08-03', '2026-08-04']);
  });

  it('the orders columns add up to the till\'s printed gross for each monthly orders report', () => {
    // The last page of each orders report (المبلغ الكلي). The reports stop a day
    // early: June 2-29, July 1-30, August 1-30, September 1-29.
    const printed: [string, string, number][] = [
      ['2026-06-02', '2026-06-29', 20_946_500],
      ['2026-07-01', '2026-07-30', 26_678_750],
      ['2026-08-01', '2026-08-30', 20_050_250],
      ['2026-09-01', '2026-09-29', 25_205_000],
    ];
    for (const [from, to, gross] of printed) {
      const rows = hours.filter((h) => h.day >= from && h.day <= to);
      expect(rows.every((h) => h.orders !== null), `${from}: an orders report covers every hour`).toBe(true);
      expect(sum(rows, (h) => h.orders_gross_iqd ?? 0), from).toBe(gross);
    }
  });

  it('received money is the amount less the discount, to the till\'s rounding', () => {
    const covered = hours.filter((h) => h.orders !== null);
    const off = sum(covered, (h) => h.orders_gross_iqd! - h.discount_iqd! - h.received_iqd!);
    // The till rounds a percentage discount per order: a few dinars a month.
    expect(Math.abs(off)).toBeLessThan(100);
    expect(sum(covered, (h) => h.discount_iqd!)).toBe(1_971_893);
  });

  it('no orders report covers 31 July, 31 August, 30 September or October: unknown, never zero', () => {
    const unknown = days.filter((d) => !d.has_orders_export).map((d) => d.day);
    expect(unknown).toHaveLength(34);
    expect(unknown.slice(0, 3)).toEqual(['2026-07-31', '2026-08-31', '2026-09-30']);
    expect(unknown.slice(3).every((d) => d.startsWith('2026-10'))).toBe(true);
    for (const h of hours.filter((x) => unknown.includes(x.day))) {
      expect([h.orders, h.orders_gross_iqd, h.discount_iqd, h.received_iqd]).toEqual([null, null, null, null]);
    }
    for (const d of days.filter((x) => !x.has_orders_export)) {
      expect(d.discount_iqd).toBeNull();
      expect(d.net_iqd).toBe(d.gross_iqd);
    }
  });

  it('the day rule gives the calendar months of the README', () => {
    const month = (m: string) => sum(days.filter(inMonth(m)), (d) => d.gross_iqd);
    expect(month('2026-06')).toBe(20_946_500);
    expect(month('2026-07')).toBe(27_401_500);
    expect(month('2026-08')).toBe(20_813_500);
    expect(month('2026-09')).toBe(26_307_000);
    expect(month('2026-10')).toBe(23_386_500);
    expect(sum(days, (d) => d.orders)).toBe(28_847);
  });

  it('the items file is the hours file, line for line: same money and units every day', () => {
    const byDay = new Map<string, { gross: number; units: number }>();
    for (const i of items) {
      const d = byDay.get(i.day) ?? { gross: 0, units: 0 };
      d.gross += i.unit_price_iqd * i.units;
      d.units += i.units;
      byDay.set(i.day, d);
    }
    expect(byDay.size).toBe(147);
    for (const d of days) {
      const rows = hours.filter((h) => h.day === d.day);
      expect(byDay.get(d.day), d.day).toEqual({ gross: sum(rows, (h) => h.items_gross_iqd), units: sum(rows, (h) => h.units) });
    }
    expect(sum(items, (i) => i.unit_price_iqd * i.units)).toBe(118_014_500);
  });

  it('where both reports hold a whole day and agree, they agree on the orders too (August, September)', () => {
    const full = days.filter((d) => /^2026-0[89]/.test(d.day) && d.has_orders_export && !['2026-08-30', '2026-09-29'].includes(d.day));
    for (const d of full) {
      const rows = hours.filter((h) => h.day === d.day);
      expect(sum(rows, (h) => h.orders_gross_iqd!), d.day).toBe(sum(rows, (h) => h.items_gross_iqd));
      expect(sum(rows, (h) => h.orders!), d.day).toBe(sum(rows, (h) => h.tickets));
    }
  });

  it('every sold product and price has exactly one products row, with a known group', () => {
    const key = (p: { product: string; unit_price_iqd: number }) => `${p.product}\u0000${p.unit_price_iqd}`;
    const sold = new Set(items.map(key));
    expect(new Set(products.map(key)).size).toBe(products.length);
    expect([...sold].sort()).toEqual(products.map(key).sort());
    const groups = ['dessert_food', 'juice', 'smoothie_shake', 'mojito', 'iced_coffee', 'water_ice', 'hot_coffee', 'tea_chocolate', 'espresso', 'other'];
    for (const p of products) {
      expect(groups, p.product).toContain(p.group_key);
      expect(p.cost_iqd === null, p.product).toBe(p.cost_stated === null);
    }
  });

  it('a cost is one of the owner\'s sheet (item-costs-2026-11.md), on its own line', () => {
    const sheet = readFileSync(join(DATA_DIR, '..', 'item-costs-2026-11.md'), 'utf8');
    const stated = new Map<string, number>();
    for (const line of sheet.split('\n')) {
      const cells = line.split('|').map((c) => c.trim());
      // | # | Item (as written) | English | Cost (IQD) |
      if (cells.length >= 6 && /^\d+$/.test(cells[1] ?? '') && /^[\d,]+$/.test(cells[4] ?? '')) {
        stated.set(cells[2]!, Number(cells[4]!.replace(/,/g, '')));
      }
    }
    expect(stated.size).toBeGreaterThanOrEqual(39);
    for (const p of products.filter((x) => x.cost_iqd !== null)) {
      expect(stated.get(p.cost_stated!), `${p.product}: "${p.cost_stated}"`).toBe(p.cost_iqd);
    }
    // The share of item money a cost is known for, and what is kept on it.
    const cost = new Map(products.map((p) => [`${p.product}\u0000${p.unit_price_iqd}`, p.cost_iqd]));
    const known = items.filter((i) => cost.get(`${i.product}\u0000${i.unit_price_iqd}`) != null);
    const knownGross = sum(known, (i) => i.unit_price_iqd * i.units);
    const knownCost = sum(known, (i) => cost.get(`${i.product}\u0000${i.unit_price_iqd}`)! * i.units);
    expect(Math.round((knownGross / 118_014_500) * 1000) / 10).toBe(61.4);
    expect(Math.round(((knownGross - knownCost) / knownGross) * 1000) / 10).toBe(64);
  });

  it('migration 0413 carries exactly the rows these files make', () => {
    const file = readFileSync(
      join(DATA_DIR, '..', '..', 'supabase', 'migrations', '20261113000413_legacy_cafe_history_data.sql'), 'utf8');
    expect(file.endsWith(migrationRowsSql())).toBe(true);
    expect(hours).toHaveLength(1866);
    expect(items).toHaveLength(8479);
    expect(products).toHaveLength(183);
  });

  it('the CSV reader keeps a quoted comma and a doubled quote', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([{ a: 'x, y', b: 'say "hi"' }]);
  });
});
