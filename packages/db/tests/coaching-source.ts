/**
 * Source-text pins for the coaching suites (plan "Coaching: make it bulletproof" TG-03, TG-04,
 * TG-05): the latest body of an `app.` function as the migrations define it, read the way
 * packages/db/CLAUDE.md says to find it ("Re-issue a function only from its latest body":
 * the last `create [or replace] function app.<name>(` across the migrations in file order).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.resolve(import.meta.dirname, '../supabase/migrations');

let cache: Array<{ file: string; src: string }> | null = null;
function files() {
  cache ??= readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, src: readFileSync(path.join(MIGRATIONS, file), 'utf8') }));
  return cache;
}

/** The latest body of app.<name> (between its dollar tags) and the file that holds it. */
export function latestBody(name: string): { file: string; body: string } {
  const head = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+app\\.${name}\\s*\\(`, 'gi');
  let found: { file: string; body: string } | null = null;
  for (const { file, src } of files()) {
    for (const m of src.matchAll(head)) {
      const rest = src.slice(m.index!);
      const tag = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest);
      if (!tag) continue;
      const open = tag.index + tag[0].length;
      const close = rest.indexOf(tag[1]!, open);
      if (close < 0) continue;
      found = { file, body: rest.slice(open, close) };
    }
  }
  if (!found) throw new Error(`no definition of app.${name} in the migrations`);
  return found;
}
