/**
 * The tool catalog and the dispatcher must never disagree (plan §3.1, §8).
 *
 * Pure: reads the catalog module and the migration text, no stack needed.
 *
 *   * every rpc name in DISPATCHED_RPCS has a `when '<name>' then` branch in
 *     app.assistant_run_tool, and every branch is in the catalog;
 *   * every COUNTABLE_TOOL_NAMES entry has a branch in app.assistant_count;
 *   * no tool names a person-money report or a per-coach pay input, and 0297
 *     deletes the coaching money columns from table_read (C-28, DB-45);
 *   * the edge-function copy of tools.ts is byte-identical to the core one
 *     (Deno cannot import a workspace package, so the copy is pinned here).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ASSISTANT_TOOLS, DISPATCHED_RPCS, COUNTABLE_TOOL_NAMES } from '../../core/src/assistant/tools';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(HERE, '../supabase/migrations/20260920000109_assistant_dispatcher.sql');
const CORE_TOOLS = path.resolve(HERE, '../../core/src/assistant/tools.ts');
const EDGE_TOOLS = path.resolve(HERE, '../supabase/functions/_shared/assistant/tools.ts');

/** The `when '<name>' then` labels inside one dollar-quoted function body. */
function caseLabels(sql: string, tag: string): string[] {
  const open = sql.indexOf(`as $${tag}$`);
  const close = sql.indexOf(`$${tag}$;`, open + 1);
  expect(open, `body ${tag} not found`).toBeGreaterThan(-1);
  expect(close, `body ${tag} not closed`).toBeGreaterThan(open);
  const body = sql.slice(open, close);
  return [...body.matchAll(/^\s*when '([a-z_]+)' then/gm)].map((m) => m[1] as string);
}

describe('assistant catalog ↔ dispatcher', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('DISPATCHED_RPCS equals the case list of app.assistant_run_tool', () => {
    const branches = caseLabels(sql, 'assistant_run_tool_0109');
    expect(new Set(branches).size).toBe(branches.length); // no duplicate branch
    expect([...branches].sort()).toEqual([...DISPATCHED_RPCS].sort());
  });

  it('every countable tool has a branch in app.assistant_count', () => {
    const branches = new Set(caseLabels(sql, 'assistant_count_0109'));
    for (const name of COUNTABLE_TOOL_NAMES) expect(branches, name).toContain(name);
    // and nothing is counted that the catalog does not call a list tool
    for (const b of branches) expect(COUNTABLE_TOOL_NAMES, b).toContain(b);
  });

  it('no tool names a person-money report (coaching C-28, R42)', () => {
    // The coach statements and the lessons report are money about a named
    // coach: managers read them in the operator, the assistant never does
    // (check-analytics-payload.mjs PERSON_MONEY_REPORTS).
    for (const rpc of ['report_coach_statements', 'report_lessons']) {
      expect(ASSISTANT_TOOLS.map((t) => t.rpc), rpc).not.toContain(rpc);
      expect(DISPATCHED_RPCS as readonly string[], rpc).not.toContain(rpc);
    }
  });

  it('no tool names a per-coach pay input, and 0297 takes them out of table_read (C-28, D1, DB-45)', () => {
    // Aggregates (lessonRevenue, owedToCoaches) stay; a column that rebuilds
    // one coach's pay never reaches the model. The stack half of this gate is
    // coaching-schema.test.ts (0297, DB-45), which reads the live allowlist.
    const pattern = /share_bp|coach_?(share|iqd)/i;
    for (const t of ASSISTANT_TOOLS) expect(JSON.stringify(t), t.name).not.toMatch(pattern);
    const grants = readFileSync(
      path.resolve(HERE, '../supabase/migrations/20261002000297_coaching_privacy_grants.sql'),
      'utf8',
    );
    const del = grants.slice(grants.indexOf('delete from app.assistant_readable_columns'));
    expect(del.slice(0, del.indexOf(';'))).toMatch(
      /table_name in \('lessons', 'courses'\)\s+and column_name in \('price_iqd', 'court_share_iqd', 'coach_share_bp'\)\)\s+or \(table_name = 'venue_settings' and column_name = 'coach_share_bp'\)/,
    );
  });

  it('rpc names are unique across tools and only rpc-backed tools dispatch', () => {
    const rpcs = ASSISTANT_TOOLS.filter((t) => t.rpc).map((t) => t.rpc);
    expect(new Set(rpcs).size).toBe(rpcs.length);
    expect(rpcs.length).toBe(DISPATCHED_RPCS.length);
    // `posthog` is the one aggregate served by the edge function itself (it
    // forwards to analytics-posthog as the owner); everything else without an
    // rpc is knowledge or meta.
    for (const t of ASSISTANT_TOOLS.filter((t) => !t.rpc && t.name !== 'posthog')) expect(['knowledge', 'meta']).toContain(t.kind);
    expect(ASSISTANT_TOOLS.find((t) => t.name === 'posthog')?.kind).toBe('aggregate');
  });

  it('the edge-function copy of tools.ts is byte-identical to the core module', () => {
    const a = readFileSync(CORE_TOOLS);
    const b = readFileSync(EDGE_TOOLS);
    expect(a.equals(b), 'packages/db/supabase/functions/_shared/assistant/tools.ts drifted from packages/core/src/assistant/tools.ts').toBe(true);
  });
});
