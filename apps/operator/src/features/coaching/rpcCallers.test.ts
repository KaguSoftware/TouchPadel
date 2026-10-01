import { describe, expect, it } from 'vitest';

// coaching operator.md §5.1: every coaching RPC is called as `appRpc('<name>', …)`
// with the literal name, because the assistant map finds operator callers by
// `(?:appRpc|\.rpc)\(\s*'<name>'` (packages/db/scripts/build-assistant-map.mjs).
// A type argument (`appRpc<T>('<name>'`) hides the caller from that pattern and
// leaves the RPC's chunk with no route; cast the result instead.

const SOURCES = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The coaching RPCs the operator calls (operator.md §5.6–§5.7, R75). */
const COACHING_RPCS = [
  // Reads (§5.6).
  'coach_slots',
  'coach_statement_detail',
  'coaches_admin',
  'coaching_settings',
  'customer_lessons',
  'desk_lesson_detail',
  'desk_lessons',
  'lesson_refunds_due',
  'report_coach_statements',
  'report_lessons',
  // Desk writes.
  'desk_add_student',
  'desk_book_lesson',
  'desk_cancel_course',
  'desk_cancel_enrolment',
  'desk_cancel_lesson',
  'desk_create_course',
  'desk_create_group',
  'desk_mark_attendance',
  'desk_move_lesson_court',
  'desk_reschedule_session',
  'lesson_settle',
  // Refunds Qi can't take (R75).
  'lesson_blocked_refund_record',
  // Setup writes.
  'add_coach_time_off',
  'cancel_coach_time_off',
  'coach_promote',
  'coach_update',
  'set_coach_branches',
  'set_coach_hours',
  'set_coach_lesson_types',
  'set_coach_price',
  'set_coach_status',
  'set_coaching_settings',
  'upsert_lesson_type',
  // Statements.
  'coach_statement_approve',
  'coach_statement_mark_paid',
  'coach_statement_refresh',
  'coach_statement_void',
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

describe('coaching RPC callers (§5.1, the assistant map)', () => {
  it('reads the operator source', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });

  it('calls no coaching RPC with a type argument', () => {
    const typed = namesMatching(TYPED_CALL);
    const hidden = COACHING_RPCS.filter((name) => typed.has(name)).map(
      (name) => `${name}: ${typed.get(name)!.join(', ')}`,
    );
    expect(hidden).toEqual([]);
  });

  it("finds a caller for every coaching RPC with the map's own pattern", () => {
    const found = namesMatching(MAP_CALLER);
    expect(COACHING_RPCS.filter((name) => !found.has(name))).toEqual([]);
  });
});
