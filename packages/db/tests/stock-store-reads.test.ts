/**
 * stock_store_reads (docs/design/protocols/wave5-addendum-2026-09-25.md
 * §2.8.5, §5.3, §6.1): what the phone's store pages read.
 *
 *   * stock_pick_list, per purpose and role: log lists the role's kinds
 *     (shop stock only at the cafe, the desk refused the bakery), move lists
 *     what the source store holds with on_hand there, count lists names and
 *     units with no quantity (the kitchen counts the bakery only); a query
 *     is text, never a pattern; inactive and other venues' ingredients never
 *     appear;
 *   * stock_today gives each role only its sections: the moves (MOVE), the
 *     day's deliveries cut to the caller's kinds and the driver purchases
 *     waiting (LOG), the phone counts (COUNT); the others are null;
 *   * I12 no key at any depth ends in _iqd or starts with cost, price or
 *     supplier, and nothing carries a note, a theoretical quantity or a
 *     variance;
 *   * the driver and marketing are refused every purpose, and so are the
 *     barista, the assistant barista and prep.
 *
 * staff_stock_view's by_location and the waiter are in
 * staff-stock-view.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { stackAvailable } from './helpers';
import {
  BATCH,
  ING,
  KEEP,
  LINES,
  MK,
  OTHER_VENUE,
  Q,
  RES,
  T,
  dockerReachable,
  moneyKeys,
  ok,
  refused,
  scenario,
} from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();
const run = (body: string[]) => scenario('sr', body);

interface Item {
  ingredient_id: string;
  name_en: string;
  unit: string;
  kind: string;
  pack_size: number | null;
  on_hand?: number;
}
type Pick = { purpose: string; location: string; items: Item[] };
const pick = (purpose: string, location: string | null = null, query: string | null = null) =>
  `select app.stock_pick_list('${purpose}', ${location === null ? 'null' : `'${location}'`}, {{venue}}, ${query === null ? 'null' : `'${query}'`})`;
/** Our rows only (the venue holds other suites' ingredients too), as name → row. */
const ours = (p: Pick) => Object.fromEntries(p.items.filter((i) => i.name_en.startsWith('SR ')).map((i) => [i.name_en.slice(3), i]));

describe.skipIf(!docker)('stores: reads (rolled-back transactions)', () => {
  it('the pick list gives each purpose what its role may name (I12)', () => {
    const denied = { drv: 'driver', mkt: 'marketing', ab: 'assistant_barista', bar: 'barista' };
    const r = run([
      MK('hb', 'head_barista'), MK('hc', 'head_chef'), MK('chef', 'chef'), MK('wtr', 'waiter'),
      ...Object.entries(denied).map(([k, role]) => MK(k, role)),
      ING('beans', 'purchased', 'g', { packSize: 1000, packCost: 25000 }),
      ING('milk', 'purchased', 'ml'),
      ING('dough', 'prepared', 'g'),
      ING('ball', 'retail', 'pc'),
      ING('far', 'purchased', 'g', { venue: OTHER_VENUE }),
      KEEP('off', `insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id)
                   values ('purchased', 'SR off', 'متوقف', 'g', false, {{venue}}) returning id::text`),
      BATCH('beans_c', 'beans', 'cafe', 500, 20),
      BATCH('beans_b', 'beans', 'bakery', 100, 20),
      BATCH('dough_b', 'dough', 'bakery', 40, 5),
      BATCH('ball_c', 'ball', 'cafe', 5, 9000),
      T('log_hb', 'hb', pick('log')),
      T('log_hc', 'hc', pick('log')),
      T('log_desk', 'desk', pick('log')),
      T('log_desk_bak', 'desk', pick('log', 'bakery')),
      T('log_cashier', 'cashier', pick('log')),
      T('log_cashier_bak', 'cashier', pick('log', 'bakery')),
      T('move_wtr', 'wtr', pick('move')),
      T('move_wtr_bak', 'wtr', pick('move', 'bakery')),
      T('move_mgr', 'manager', pick('move')),
      T('count_chef', 'chef', pick('count')),
      T('count_hc', 'hc', pick('count', 'bakery')),
      T('count_chef_cafe', 'chef', pick('count', 'cafe')),
      T('count_owner_cafe', 'owner', pick('count', 'cafe')),
      T('query', 'manager', pick('log', null, 'SR bea')),
      T('query_arabic', 'manager', pick('log', null, 'مادة milk')),
      T('query_pattern', 'manager', pick('log', null, 'SR %')),
      T('bad_purpose', 'manager', pick('eat')),
      T('no_purpose', 'manager', `select app.stock_pick_list(null)`),
      T('bad_loc', 'manager', pick('move', 'kitchen')),
      T('far_venue', 'manager', `select app.stock_pick_list('log', null, {{other_venue}})`),
      T('hb_move', 'hb', pick('move')),
      T('hb_count', 'hb', pick('count')),
      T('wtr_log', 'wtr', pick('log')),
      T('wtr_count', 'wtr', pick('count')),
      T('chef_log', 'chef', pick('log')),
      T('desk_count', 'desk', pick('count')),
      ...[...Object.keys(denied), 'prep'].flatMap((who) =>
        ['log', 'move', 'count'].map((purpose) => T(`deny_${who}_${purpose}`, who, pick(purpose)))),
    ]);
    const names = (label: string) => Object.keys(ours(ok<Pick>(r, label))).sort();

    expect(ok<Pick>(r, 'log_hb')).toMatchObject({ purpose: 'log', location: 'cafe' });
    expect(names('log_hb')).toEqual(['beans', 'milk']);
    expect(ok<Pick>(r, 'log_hc').location).toBe('bakery');
    expect(names('log_hc')).toEqual(['beans', 'milk']);
    expect(names('log_desk')).toEqual(['ball']);
    expect(refused(r, 'log_desk_bak')).toBe('FORBIDDEN:location');
    expect(names('log_cashier')).toEqual(['ball', 'beans', 'milk']);
    expect(names('log_cashier_bak')).toEqual(['beans', 'milk']);
    for (const label of ['log_hb', 'log_cashier']) {
      expect(ok<Pick>(r, label).items.every((i) => !('on_hand' in i)), label).toBe(true);
    }

    // Move: what the source holds, with how much; never shop stock.
    const moveCafe = ours(ok<Pick>(r, 'move_wtr'));
    expect(Object.keys(moveCafe).sort()).toEqual(['beans']);
    expect(moveCafe.beans!.on_hand).toBe(500);
    const moveBakery = ours(ok<Pick>(r, 'move_wtr_bak'));
    expect(Object.keys(moveBakery).sort()).toEqual(['beans', 'dough']);
    expect([moveBakery.beans!.on_hand, moveBakery.dough!.on_hand]).toEqual([100, 40]);
    expect(Object.keys(ours(ok<Pick>(r, 'move_mgr')))).toEqual(['beans']);

    // Count: names and units, no quantity; the bakery without shop stock.
    expect(ok<Pick>(r, 'count_chef').location).toBe('bakery');
    expect(names('count_chef')).toEqual(['beans', 'dough', 'milk']);
    expect(names('count_hc')).toEqual(['beans', 'dough', 'milk']);
    const counted = ok<Pick>(r, 'count_chef').items[0]!;
    expect(Object.keys(counted).sort()).toEqual(['ingredient_id', 'kind', 'name_ar', 'name_en', 'pack_size', 'unit']);
    expect(refused(r, 'count_chef_cafe')).toBe('FORBIDDEN:location');
    expect(names('count_owner_cafe')).toEqual(['ball', 'beans', 'dough', 'milk']);

    expect(names('query')).toEqual(['beans']);
    expect(names('query_arabic')).toEqual(['milk']);
    expect(names('query_pattern')).toEqual([]);
    expect(refused(r, 'bad_purpose')).toBe('INVALID_ARGUMENT:purpose');
    expect(refused(r, 'no_purpose')).toBe('INVALID_ARGUMENT:purpose');
    expect(refused(r, 'bad_loc')).toBe('INVALID_ARGUMENT:location');
    expect(refused(r, 'far_venue')).toBe('FORBIDDEN');
    for (const label of ['hb_move', 'hb_count', 'wtr_log', 'wtr_count', 'chef_log', 'desk_count']) {
      expect(refused(r, label), label).toBe('FORBIDDEN:purpose');
    }
    for (const who of [...Object.keys(denied), 'prep']) {
      for (const purpose of ['log', 'move', 'count']) expect(refused(r, `deny_${who}_${purpose}`), `${who} ${purpose}`).toBe('FORBIDDEN');
    }

    // I12, and nothing inactive or of another venue, anywhere.
    for (const [label, o] of Object.entries(r)) {
      if (!o.ok) continue;
      expect(moneyKeys(o.data), label).toEqual([]);
      expect(Object.keys(ours(o.data as Pick)), label).not.toContain('off');
      expect(Object.keys(ours(o.data as Pick)), label).not.toContain('far');
    }
  });

  it('stock_today gives each role only its sections, with no money (I12)', () => {
    const denied = { drv: 'driver', mkt: 'marketing', ab: 'assistant_barista', bar: 'barista' };
    const r = run([
      MK('hb', 'head_barista'), MK('hc', 'head_chef'), MK('chef', 'chef'), MK('wtr', 'waiter'),
      ...Object.entries(denied).map(([k, role]) => MK(k, role)),
      ING('beans', 'purchased', 'g'),
      ING('ball', 'retail', 'pc'),
      BATCH('beans_c', 'beans', 'cafe', 500, 20),
      T('move', 'wtr', `select app.transfer_stock('cafe', 'bakery', jsonb_build_array(jsonb_build_object('ingredient_id', {{beans}}, 'qty', 50)))`),
      RES('t_id', 'move', 'transfer_id'),
      T('log', 'hb', `select app.log_stock(null, jsonb_build_array(jsonb_build_object('ingredient_id', {{beans}}, 'qty', 10)), 'a note')`),
      RES('d_log', 'log', 'delivery_id'),
      T('gi', 'manager', `select app.receive_delivery(${LINES([
        { ingredient_id: '{{beans}}', qty_received: 100, unit_cost_iqd: 20 },
        { ingredient_id: '{{ball}}', qty_received: 6, unit_cost_iqd: 9000 },
      ])}, 'SR Mill', 'paid cash')`),
      RES('d_gi', 'gi', 'delivery_id'),
      T('count', 'hc', `select app.submit_stock_count('bakery', jsonb_build_array(jsonb_build_object('ingredient_id', {{beans}}, 'counted_qty', 45)))`),
      RES('c_id', 'count', 'count_id'),
      // Driver purchases: one delivered and waiting, one not yet delivered.
      Q('waiting_before', `select to_jsonb(count(*)) from purchases
                            where venue_id = {{venue}}::uuid and delivered_at is not null and status = 'to_receive'`),
      KEEP('p1', `insert into purchases (venue_id, staff_id, bought_at, total_iqd, delivered_at, delivered_by)
                  values ({{venue}}::uuid, {{manager}}::uuid, now(), 1000, now(), {{manager}}::uuid) returning id::text`),
      KEEP('p2', `insert into purchases (venue_id, staff_id, bought_at, total_iqd)
                  values ({{venue}}::uuid, {{manager}}::uuid, now(), 1000) returning id::text`),
      ...(['wtr', 'hb', 'hc', 'chef', 'desk', 'cashier', 'manager', 'owner'] as const).map((who) =>
        T(`today_${who}`, who, `select app.stock_today({{venue}})`)),
      ...[...Object.keys(denied), 'prep'].map((who) => T(`deny_${who}`, who, `select app.stock_today()`)),
      T('far', 'manager', `select app.stock_today({{other_venue}})`),
      Q('ids', `select jsonb_build_object('t', {{t_id}}, 'log', {{d_log}}, 'gi', {{d_gi}}, 'count', {{c_id}})`),
    ]);
    type Today = {
      business_date: string;
      transfers: Array<{ transfer_id: string; from: string; to: string; moved_by_name: string; lines: Array<Record<string, unknown>> }> | null;
      logs: Array<{ delivery_id: string; location: string; source: string; received_by_name: string; lines: Array<Record<string, unknown>> }> | null;
      driver_deliveries_waiting: number | null;
      counts: Array<{ count_id: string; location: string; status: string; counted_by_name: string; lines: Array<Record<string, unknown>> }> | null;
    };
    const ids = ok<{ t: string; log: string; gi: string; count: string }>(r, 'ids');
    const today = (who: string) => ok<Today>(r, `today_${who}`);
    const sections = (who: string) => {
      const t = today(who);
      return ['transfers', 'logs', 'driver_deliveries_waiting', 'counts'].filter((k) => t[k as keyof Today] !== null);
    };
    expect(sections('wtr')).toEqual(['transfers']);
    expect(sections('hb')).toEqual(['logs', 'driver_deliveries_waiting']);
    expect(sections('desk')).toEqual(['logs', 'driver_deliveries_waiting']);
    expect(sections('cashier')).toEqual(['logs', 'driver_deliveries_waiting']);
    expect(sections('chef')).toEqual(['counts']);
    expect(sections('hc')).toEqual(['logs', 'driver_deliveries_waiting', 'counts']);
    for (const who of ['manager', 'owner']) expect(sections(who), who).toEqual(['transfers', 'logs', 'driver_deliveries_waiting', 'counts']);
    expect(today('wtr').business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const move = today('wtr').transfers!.find((t) => t.transfer_id === ids.t)!;
    expect(move).toMatchObject({ from: 'cafe', to: 'bakery', moved_by_name: 'SR wtr' });
    expect(move.lines).toEqual([expect.objectContaining({ name_en: 'SR beans', unit: 'g', qty: 50 })]);

    // The day's deliveries, staff logs and Goods in both, cut to the kinds the
    // caller may log; no supplier, no note, no cost.
    const logsOf = (who: string) => Object.fromEntries(today(who).logs!.filter((d) => [ids.log, ids.gi].includes(d.delivery_id))
      .map((d) => [d.delivery_id === ids.log ? 'log' : 'gi', d]));
    const hb = logsOf('hb');
    expect(hb.log).toMatchObject({ location: 'cafe', source: 'staff_log', received_by_name: 'SR hb' });
    expect(hb.gi!.lines.map((l) => l.name_en)).toEqual(['SR beans']);
    const desk = logsOf('desk');
    expect(Object.keys(desk)).toEqual(['gi']);
    expect(desk.gi!.lines.map((l) => l.name_en)).toEqual(['SR ball']);
    expect(logsOf('cashier').gi!.lines.map((l) => l.name_en).sort()).toEqual(['SR ball', 'SR beans']);
    expect(Object.keys(hb.gi!).sort()).toEqual(['delivery_id', 'lines', 'location', 'received_at', 'received_by_name', 'source']);
    expect(JSON.stringify(today('manager').logs)).not.toMatch(/SR Mill|paid cash|a note/);

    const waiting = Number(ok(r, 'waiting_before')) + 1;
    for (const who of ['hb', 'desk', 'cashier', 'hc', 'manager']) expect(today(who).driver_deliveries_waiting, who).toBe(waiting);

    // The phone counts: counted quantities only.
    const count = today('chef').counts!.find((c) => c.count_id === ids.count)!;
    expect(count).toMatchObject({ location: 'bakery', status: 'waiting', counted_by_name: 'SR hc' });
    expect(count.lines).toEqual([{ ingredient_id: expect.any(String), name_en: 'SR beans', name_ar: 'مادة beans', unit: 'g', counted_qty: 45 }]);

    for (const who of ['wtr', 'hb', 'hc', 'chef', 'desk', 'cashier', 'manager', 'owner']) {
      expect(moneyKeys(today(who)), who).toEqual([]);
      expect(JSON.stringify(today(who)), who).not.toMatch(/theoretical|variance|"note"|supplier/);
    }
    for (const who of [...Object.keys(denied), 'prep']) expect(refused(r, `deny_${who}`), who).toBe('FORBIDDEN');
    expect(refused(r, 'far')).toBe('FORBIDDEN');
  });
});
