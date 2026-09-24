import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NO STATION, TILL, DESK OR KITCHEN RPC ON THE STAFF PHONE
 * (build-contracts-2026-09-23 §6.7).
 *
 * The database cannot tell a phone session from a station session: breaks,
 * cover and the heartbeat guard with "any staff" (0156), and the kitchen list
 * admits a bar or kitchen phone, so `set_ticket_status` and `kitchen_board`
 * would answer one. Nothing on the server stops a staff page calling them;
 * this does. It reads every file of the staff area (src/features/staff/**,
 * app/staff*.tsx; tests excluded) and fails on a string literal naming any of
 * the RPCs below, bare or schema-qualified.
 *
 * The manager-only public writers are here too: the phone's price, promotion,
 * rate and new-item changes go through the protocols, never the menu and
 * price writers, so their codes (ITEM_IN_RELEASE, PRICE_VIA_PROTOCOL,
 * ITEM_VIA_RELEASE, LAUNCH_VIA_PROTOCOL) cannot reach the phone (§3).
 */
const FORBIDDEN = {
  station: [
    'heartbeat',
    'break_status',
    'start_break',
    'end_break',
    'cover_station',
    'verify_own_pin',
    'verify_manager_pin',
    'consume_pin_grant',
  ],
  kitchen: ['set_ticket_status', 'set_order_item_ready', 'kitchen_board'],
  till: [
    'open_tab',
    'till_add_items',
    'settle_tab',
    'settle_zero_tab',
    'cancel_tab',
    'refund',
    'void_after_send',
    'apply_discount',
    'override_price',
    'apply_best_promotion',
    'merge_tabs',
    'split_by_item',
    'split_evenly',
    'record_drawer_open',
    'open_day',
    'close_day',
    'ack_waiter_call',
    'resolve_waiter_call',
    'record_waste',
    'booking_bill',
  ],
  desk: [
    'staff_create_reservation',
    'move_reservation',
    'extend_reservation',
    'mark_reservation',
    'cancel_reservation',
    'create_series',
    'cancel_series',
  ],
  managerWriters: [
    'record_production',
    'receive_delivery',
    'upsert_variant',
    'upsert_retail_variant',
    'upsert_menu_item',
    'upsert_modifier',
    'upsert_promotion',
    'set_promotion_enabled',
    'generate_promo_code',
    'upsert_rate_rule',
    'set_cafe_setting',
    'set_cafe_settings',
  ],
} as const;

const NAMES = new Set<string>(Object.values(FORBIDDEN).flat());

/**
 * The string literals of a TypeScript source, comments skipped: a scanner, not
 * a regex, so an apostrophe or a backtick in a comment can neither hide a real
 * literal nor invent one. A template literal counts by its text between
 * substitutions.
 */
export function stringLiterals(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (c === '/' && next === '*') {
      i = source.indexOf('*/', i + 2);
      if (i < 0) break;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\') {
          text += source[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (c === '`' && source[j] === '$' && source[j + 1] === '{') {
          // A substitution ends this piece; the rest of the template is another.
          out.push(text);
          text = '';
          let depth = 1;
          j += 2;
          while (j < source.length && depth > 0) {
            if (source[j] === '{') depth++;
            else if (source[j] === '}') depth--;
            j++;
          }
          continue;
        }
        text += source[j];
        j++;
      }
      out.push(text);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** The forbidden RPC a literal names (`'heartbeat'`, `'app.heartbeat'`), or null. */
export function forbiddenName(literal: string): string | null {
  const name = literal.trim().replace(/^app\./, '');
  return NAMES.has(name) ? name : null;
}

const SRC = join(__dirname, '..');
const APP = join(__dirname, '..', '..', '..', '..', 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') walk(p, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = [
  ...walk(SRC),
  ...readdirSync(APP)
    .filter((name) => /^staff.*\.tsx$/.test(name))
    .map((name) => join(APP, name)),
];

describe('the staff area names no station, till, desk or kitchen RPC', () => {
  it('reads the files it means to check', () => {
    // A moved directory would otherwise make the next test pass on nothing.
    const rel = files.map((f) => relative(join(SRC, '..', '..', '..'), f).split(sep).join('/'));
    expect(rel).toContain('src/features/staff/api.ts');
    expect(rel).toContain('app/staff.tsx');
    expect(rel).toContain('app/staff-request.tsx');
  });

  it('finds none', () => {
    const found: string[] = [];
    for (const file of files) {
      for (const literal of stringLiterals(readFileSync(file, 'utf8'))) {
        const name = forbiddenName(literal);
        if (name) found.push(`${relative(SRC, file)}: '${literal}'`);
      }
    }
    expect(found, 'a staff page may not call these; see the file header').toEqual([]);
  });

  it('catches a literal however it is written, and nothing in a comment', () => {
    const source = [
      "await rpc('set_ticket_status', {});",
      'call("app.kitchen_board")',
      'const fn = `upsert_variant`;',
      "// 'heartbeat' in a comment is not a call",
      "/* the phone's 'start_break' is prose */",
      "rpc('record_batch'); rpc('submit_step');",
    ].join('\n');
    const names = stringLiterals(source).map(forbiddenName).filter(Boolean);
    expect(names).toEqual(['set_ticket_status', 'kitchen_board', 'upsert_variant']);
  });

  it('reads a template literal around its substitutions', () => {
    expect(stringLiterals('const k = `staff.${name}:x`;')).toEqual(['staff.', ':x']);
  });
});
