import { describe, expect, it } from 'vitest';

// operator.md §5.1: every open-match RPC is called as `appRpc('<name>', …)`
// with the literal name, because the assistant map finds operator callers by
// `(?:appRpc|\.rpc)\(\s*'<name>'` (packages/db/scripts/build-assistant-map.mjs).
// A type argument (`appRpc<T>('<name>'`) hides the caller from that pattern and
// leaves the RPC's chunk with no route; cast the result instead.

const SOURCES = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The open-match RPCs the operator calls (0253–0265, operator.md §5.6–§5.7). */
const MATCH_RPCS = [
  'day_close_online',
  'desk_add_seat',
  'desk_call_off_short',
  'desk_cancel_match',
  'desk_match_detail',
  'desk_match_states',
  'desk_open_matches',
  'desk_remove_seat',
  'desk_start_match',
  'guest_tickets',
  'mark_match_seats',
  'match_link_payment',
  'match_reports_open',
  'match_seat_settle',
  'match_seat_write_off',
  'match_settings',
  'report_matches',
  'resolve_match_report',
  'set_match_ban',
  'set_match_settings',
  'staff_set_customer_gender',
  'ticket_cashout',
] as const;

/** The assistant map's caller pattern, as build-assistant-map.mjs has it. */
const MAP_CALLER = /(?:appRpc|\.rpc)\(\s*'([a-z0-9_]+)'/g;
/** A call the map cannot see: a type argument between `appRpc` and `(`. */
const TYPED_CALL = /appRpc<[^(']*?>\(\s*'([a-z0-9_]+)'/g;

function namesMatching(pattern: RegExp): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [file, src] of Object.entries(SOURCES)) {
    for (const m of src.matchAll(pattern)) out.set(m[1]!, [...(out.get(m[1]!) ?? []), file]);
  }
  return out;
}

describe('open-match RPC callers (§5.1, the assistant map)', () => {
  it('reads the operator source', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });

  it('calls no open-match RPC with a type argument', () => {
    const typed = namesMatching(TYPED_CALL);
    const hidden = MATCH_RPCS.filter((name) => typed.has(name)).map((name) => `${name}: ${typed.get(name)!.join(', ')}`);
    expect(hidden).toEqual([]);
  });

  it("finds a caller for every open-match RPC with the map's own pattern", () => {
    const found = namesMatching(MAP_CALLER);
    expect(MATCH_RPCS.filter((name) => !found.has(name))).toEqual([]);
  });
});
