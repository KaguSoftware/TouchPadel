/**
 * The newest app.delete_my_account body still deletes the account's loyalty card (c47, the
 * review of 0303–0306). Stackless: it reads the migration files, not the database.
 *
 * Every re-issue starts from the latest body (packages/db/CLAUDE.md, "Re-issue a function only
 * from its latest body"). 0306 added `delete from loyalty_cards` (the card's TOTP secret) to the
 * 0290 body; a later re-issue copied from 0290 or 0264 would silently drop it, and no other gate
 * would notice. This test fails first.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(import.meta.dirname, '../supabase/migrations');

/** The body of the last `create [or replace] function app.<name>(` across the migrations, in file order. */
function latestBody(name: string): { file: string; body: string } {
  const head = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+app\.${name}\s*\(`,
    'gi',
  );
  let found: { file: string; body: string } | null = null;
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const src = readFileSync(path.join(DIR, file), 'utf8');
    for (const m of src.matchAll(head)) {
      const from = m.index ?? 0;
      // The body runs from the header to its closing dollar tag (`end $tag$;`).
      const tag = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(src.slice(from));
      if (!tag) continue;
      const open = from + tag.index + tag[0].length;
      const close = src.indexOf(tag[1]!, open);
      found = { file, body: src.slice(from, close < 0 ? undefined : close) };
    }
  }
  if (!found) throw new Error(`no body for app.${name}`);
  return found;
}

describe('the newest delete_my_account body (c47)', () => {
  it("deletes the account's loyalty card", () => {
    const { file, body } = latestBody('delete_my_account');
    expect(body, file).toMatch(/delete\s+from\s+loyalty_cards\s+where\s+profile_id\s*=\s*v_uid/i);
  });

  it('is found in a file at or after 0306, the one that added the card delete', () => {
    const { file } = latestBody('delete_my_account');
    expect(Number(/^\d{10}(\d{4})_/.exec(file)?.[1])).toBeGreaterThanOrEqual(306);
  });
});
