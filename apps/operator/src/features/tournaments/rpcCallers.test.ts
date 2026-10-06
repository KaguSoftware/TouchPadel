import { describe, expect, it } from 'vitest';

// Tournaments (build contracts §1.6, §1.11): every tournament RPC the operator
// calls is called as `appRpc('<name>', …)` with the literal name, because the
// assistant map finds operator callers by `(?:appRpc|\.rpc)\(\s*'<name>'`
// (packages/db/scripts/build-assistant-map.mjs). A type argument
// (`appRpc<T>('<name>'`) hides the caller from that pattern; cast instead.

const SOURCES = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The tournament RPCs the operator calls (the guest pair, register and withdraw, are the phone's). */
const TOURNAMENT_RPCS = [
  // Reads.
  'desk_tournament_detail',
  'desk_tournaments',
  // Lifecycle.
  'set_tournaments_enabled',
  'tournament_add_entry',
  'tournament_cancel',
  'tournament_mark_no_show',
  'tournament_publish',
  'tournament_remove_entry',
  // Play.
  'tournament_score',
  'tournament_set_rounds',
  // Money.
  'tournament_settle',
] as const;

const MAP_CALLER = /(?:appRpc|\.rpc)\(\s*'([a-z0-9_]+)'/g;
const TYPED_CALL = /appRpc<[^(']*?>\(\s*'([a-z0-9_]+)'/g;

function namesMatching(pattern: RegExp): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [file, src] of Object.entries(SOURCES)) {
    for (const m of src.matchAll(pattern)) out.set(m[1]!, [...(out.get(m[1]!) ?? []), file]);
  }
  return out;
}

describe('tournament RPC callers (the assistant map)', () => {
  it('reads the operator source', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });

  it('calls no tournament RPC with a type argument', () => {
    const typed = namesMatching(TYPED_CALL);
    expect(TOURNAMENT_RPCS.filter((name) => typed.has(name))).toEqual([]);
  });

  it("finds a caller for every tournament RPC with the map's own pattern", () => {
    const found = namesMatching(MAP_CALLER);
    expect(TOURNAMENT_RPCS.filter((name) => !found.has(name))).toEqual([]);
  });

  it('sends every argument of each write, nulls included (the coaching bug f5c61e4d)', () => {
    const all = Object.values(SOURCES).join('\n');
    const args: Record<string, readonly string[]> = {
      tournament_mark_no_show: ['p_entry_id', 'p_substitute_entry_id', 'p_substitute_guest_id'],
      tournament_score: [
        'p_match_id',
        'p_points_a',
        'p_points_b',
        'p_expected_revision',
        'p_reason',
      ],
      tournament_settle: [
        'p_entry_id',
        'p_method',
        'p_expected_owed_iqd',
        'p_tendered_iqd',
        'p_idempotency_key',
        'p_device_id',
      ],
      tournament_set_rounds: ['p_tournament_id', 'p_payload', 'p_idempotency_key'],
      tournament_publish: ['p_run_id', 'p_settings', 'p_idempotency_key'],
      desk_tournaments: ['p_venue_id', 'p_from', 'p_to'],
    };
    for (const [name, keys] of Object.entries(args)) {
      const at = all.indexOf(`appRpc('${name}', {`);
      expect(at, name).toBeGreaterThan(-1);
      const call = all.slice(at, all.indexOf('}', at));
      for (const k of keys) expect(call, `${name} ${k}`).toContain(k);
    }
  });
});
