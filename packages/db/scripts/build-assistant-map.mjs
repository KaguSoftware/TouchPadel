#!/usr/bin/env node
/**
 * The owner assistant's SYSTEM MAP — text facts about the venue's software,
 * generated from the code so they cannot drift (plan §3.2, contracts "Lane B").
 *
 * Writes three files:
 *   fixtures/assistant-map.json                      the map (committed; the
 *                                                    staleness test regenerates
 *                                                    it in memory and diffs)
 *   supabase/functions/_shared/assistant/map.json    the EDGE copy: the same
 *                                                    chunks minus `doc` (1.9 MB
 *                                                    of repo prose the edge
 *                                                    never reads directly) plus
 *                                                    a `compact` string field;
 *                                                    `describe`/`page_lookup`
 *                                                    and `{mode:'map'}` read it.
 *                                                    Docs reach the index through
 *                                                    scripts/assistant-index-map.mjs,
 *                                                    which posts them.
 *   fixtures/assistant-map-compact.md                pages, rules and tool
 *                                                    names — the part Lane C
 *                                                    embeds in the cached
 *                                                    system prefix (≤ 60 KB)
 *
 * Sources, one per chunk kind:
 *   page     ROUTE_ROLES + SUB_ROUTES (apps/operator/src/lib/auth.tsx), the
 *            rail rows in lib/workspaces.ts, and the hand-written sentence per
 *            route in docs/design/assistant/pages.md. A route with no sentence
 *            FAILS the run: a page the assistant cannot describe is a page the
 *            owner cannot be pointed to.
 *   nav      every rail row with its EN and AR label (ws.shell.nav.*)
 *   rpc      the tool catalog, packages/core/src/assistant/tools.ts
 *   action   every client-callable app.* function that is NOT a tool: its
 *            signature, guard, audit actions, error codes, and the operator
 *            files that call it
 *   table    every table and view, with its columns and `comment on` text
 *   column   every column that carries a comment
 *   setting  venue_settings columns and cafe_settings keys
 *   enum     every `create type … as enum`
 *   label    the op.* and ws.* catalog strings, EN and AR, grouped by screen
 *   rule     docs/design/assistant/rules.md, one `##` section each
 *   system   edge functions (header comments) and pg_cron jobs
 *   doc      docs/**, the root *.md files and packages/db/README.md, split by
 *            `##` and capped at 2,000 characters
 *
 * Everything here is regex over source. That is deliberate: the script runs
 * on a pull request with no database, like check-rpc-registry.mjs. The one
 * import is the catalog itself, which Node loads natively (erasable TS only).
 *
 * Usage:
 *   node scripts/build-assistant-map.mjs
 *   node scripts/build-assistant-map.mjs --check   # regenerate in memory, diff, exit 1 when stale
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const DB = path.resolve(import.meta.dirname, '..');
export const ROOT = path.resolve(DB, '../..');
export const PATHS = {
  migrations: path.join(DB, 'supabase/migrations'),
  functions: path.join(DB, 'supabase/functions'),
  configToml: path.join(DB, 'supabase/config.toml'),
  catalog: path.join(ROOT, 'packages/core/src/assistant/tools.ts'),
  auth: path.join(ROOT, 'apps/operator/src/lib/auth.tsx'),
  workspaces: path.join(ROOT, 'apps/operator/src/lib/workspaces.ts'),
  settingsTs: path.join(ROOT, 'apps/operator/src/lib/settings.ts'),
  operatorSrc: path.join(ROOT, 'apps/operator/src'),
  i18n: path.join(ROOT, 'packages/i18n/src/catalogs'),
  pages: path.join(ROOT, 'docs/design/assistant/pages.md'),
  rules: path.join(ROOT, 'docs/design/assistant/rules.md'),
  docsDir: path.join(ROOT, 'docs'),
  coverage: path.join(DB, 'fixtures/assistant-coverage.json'),
  mapJson: path.join(DB, 'fixtures/assistant-map.json'),
  mapCopy: path.join(DB, 'supabase/functions/_shared/assistant/map.json'),
  compact: path.join(DB, 'fixtures/assistant-map-compact.md'),
};

/** Chunk kinds, in the order the plan lists them (also the sort order). */
export const CHUNK_KINDS = ['page', 'nav', 'rpc', 'action', 'table', 'column', 'setting', 'enum', 'label', 'rule', 'system', 'doc'];
export const DOC_CHUNK_CAP = 2000;
export const COMPACT_BYTE_TARGET = 60 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const sqlLiteral = (lit) =>
  [...lit.matchAll(/'((?:[^']|'')*)'/g)]
    .map((m) => m[1].replace(/''/g, "'"))
    .join('');

/** Index of the char that closes the paren opened at `open` (which must be `(`). */
function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') {
      // a line comment: an apostrophe in "owner's" is not a string literal
      const nl = text.indexOf('\n', i);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (c === "'") {
      // skip a string literal
      i++;
      while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on commas that sit at parenthesis depth 0 and outside string literals. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      cur += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function walkMd(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkMd(abs, out);
    else if (name.endsWith('.md')) out.push(abs);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migrations → tables, views, columns, comments, functions, enums, cron
// ─────────────────────────────────────────────────────────────────────────────
export function readMigrations(dir = PATHS.migrations) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const m = /^\d{8}(\d{6})_/.exec(file);
      const number = m ? String(parseInt(m[1], 10)).padStart(4, '0') : file;
      return { file, number, sql: readFileSync(path.join(dir, file), 'utf8') };
    });
}

const CONSTRAINT_START = /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i;

function parseColumnItems(bodyText) {
  // Pull inline `-- comments` off each line first (they may contain commas),
  // remembering which column line they sat on.
  const inline = new Map();
  const codeLines = [];
  let lastCol = null;
  for (const raw of bodyText.split('\n')) {
    const idx = raw.indexOf('--');
    const code = idx >= 0 ? raw.slice(0, idx) : raw;
    const comment = idx >= 0 ? raw.slice(idx + 2).trim() : '';
    const colm = /^\s*([a-z_][a-z0-9_]*)\s+\S/.exec(code);
    if (colm && !CONSTRAINT_START.test(code.trim())) lastCol = colm[1];
    if (comment && lastCol) inline.set(lastCol, inline.has(lastCol) ? `${inline.get(lastCol)} ${comment}` : comment);
    codeLines.push(code);
  }
  const columns = [];
  for (const item of splitTopLevel(codeLines.join('\n'))) {
    const t = squash(item);
    if (!t || CONSTRAINT_START.test(t)) continue;
    const m = /^([a-z_][a-z0-9_]*)\s+(.+)$/i.exec(t);
    if (!m) continue;
    columns.push({ name: m[1], definition: m[2], comment: inline.get(m[1]) ?? null });
  }
  return columns;
}

export function inventorySchema(migrations = readMigrations()) {
  /** name → { schema, name, columns:[{name, definition, comment}], comment, migration } */
  const tables = new Map();
  const views = new Map();
  const columnComments = new Map(); // "table.column" → text
  const typeComments = new Map();
  const functionComments = new Map();

  const key = (schema, name) => (schema && schema !== 'public' ? `${schema}.${name}` : name);

  for (const { number, sql } of migrations) {
    // create table
    for (const m of sql.matchAll(/^\s*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:([a-z_]+)\.)?([a-z_][a-z0-9_]*)\s*\(/gim)) {
      const open = m.index + m[0].length - 1;
      const close = closingParen(sql, open);
      if (close < 0) continue;
      const name = key(m[1], m[2]);
      tables.set(name, {
        schema: m[1] ?? 'public',
        name,
        columns: parseColumnItems(sql.slice(open + 1, close)),
        comment: null,
        migration: number,
      });
    }
    // alter table … add column / drop column
    for (const m of sql.matchAll(/^\s*alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:([a-z_]+)\.)?([a-z_][a-z0-9_]*)\b([^;]*);/gim)) {
      const name = key(m[1], m[2]);
      const t = tables.get(name);
      if (!t) continue;
      for (const seg of splitTopLevel(m[3])) {
        const add = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+([\s\S]*)$/i.exec(seg.replace(/--[^\n]*/g, (c) => `\u0000${c.slice(2).trim()}`));
        if (add) {
          const [def, ...notes] = add[2].split('\u0000');
          const existing = t.columns.find((c) => c.name === add[1]);
          const col = { name: add[1], definition: squash(def), comment: notes.length ? squash(notes.join(' ')) : null, added_in: number };
          if (existing) Object.assign(existing, col);
          else t.columns.push(col);
          continue;
        }
        const drop = /drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/i.exec(seg);
        if (drop) t.columns = t.columns.filter((c) => c.name !== drop[1]);
      }
    }
    // create view (last definition wins)
    for (const m of sql.matchAll(/^\s*create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z_][a-z0-9_]*)\b([\s\S]*?);/gim)) {
      views.set(m[1], { name: m[1], sql: squash(m[2].replace(/--[^\n]*/g, '')), comment: null, migration: number });
    }
    for (const m of sql.matchAll(/^\s*drop\s+view\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gim)) {
      // a later `create view` in the same file re-adds it; only drop when nothing follows
      const later = new RegExp(`create\\s+(?:or\\s+replace\\s+)?view\\s+(?:public\\.)?${m[1]}\\b`, 'i');
      if (!later.test(sql.slice(m.index + m[0].length))) views.delete(m[1]);
    }
    // comments
    for (const m of sql.matchAll(/^\s*comment\s+on\s+(table|column|view|type|function)\s+([a-z_][a-z0-9_.]*)(\([^)]*\))?\s+is\s+((?:\s*'(?:[^']|'')*')+)\s*;/gim)) {
      const what = m[1].toLowerCase();
      const target = m[2].replace(/^public\./, '');
      const text = sqlLiteral(m[4]);
      if (what === 'table') {
        if (tables.has(target)) tables.get(target).comment = text;
        else if (views.has(target)) views.get(target).comment = text;
      } else if (what === 'view') {
        if (views.has(target)) views.get(target).comment = text;
      } else if (what === 'column') columnComments.set(target, text);
      else if (what === 'type') typeComments.set(target, text);
      else if (what === 'function') functionComments.set(target.replace(/^app\./, ''), text);
    }
  }
  for (const [ref, text] of columnComments) {
    const dot = ref.lastIndexOf('.');
    const t = tables.get(ref.slice(0, dot));
    const col = t?.columns.find((c) => c.name === ref.slice(dot + 1));
    if (col) col.comment = text;
  }
  return { tables, views, columnComments, typeComments, functionComments };
}

export function inventoryFunctions(migrations = readMigrations()) {
  /** name → { name, roles:Set, clientCallable, signature, returns, definedIn, guard, audits, raises } */
  const fns = new Map();
  const get = (name) => {
    if (!fns.has(name)) fns.set(name, { name, roles: new Set(), signature: null, returns: null, definedIn: null, guard: null, audits: [], raises: [] });
    return fns.get(name);
  };
  for (const { number, sql } of migrations) {
    for (const m of sql.matchAll(/^\s*create\s+(?:or\s+replace\s+)?function\s+app\.([a-z_][a-z0-9_]*)\s*\(/gim)) {
      const open = m.index + m[0].length - 1;
      const close = closingParen(sql, open);
      if (close < 0) continue;
      const f = get(m[1]);
      f.signature = squash(sql.slice(open + 1, close).replace(/--[^\n]*/g, ''));
      const after = sql.slice(close + 1, close + 400);
      const ret = /returns\s+([\s\S]*?)\s+(?:language|as\s+\$)/i.exec(after);
      f.returns = ret ? squash(ret[1]) : null;
      f.definedIn = number;
      const tag = /\bas\s+\$([a-z0-9_]*)\$/i.exec(sql.slice(close));
      if (tag) {
        const start = close + tag.index + tag[0].length;
        const end = sql.indexOf(`$${tag[1]}$`, start);
        const body = end > start ? sql.slice(start, end) : '';
        f.guard = guardOf(body);
        f.audits = [...new Set([...body.matchAll(/app\.write_audit\(\s*'([a-z_.]+)'/g)].map((x) => x[1]))];
        f.raises = [...new Set([...body.matchAll(/raise\s+exception\s+'([A-Z][A-Z0-9_]*)'/g)].map((x) => x[1]))];
      }
    }
    for (const m of sql.matchAll(/grant\s+execute\s+on\s+function\s+app\.([a-z0-9_]+)\s*\(([^)]*)\)\s*to\s+([a-z_,\s]+);/gi)) {
      const f = get(m[1].toLowerCase());
      for (const r of m[3].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) f.roles.add(r);
    }
  }
  for (const f of fns.values()) f.clientCallable = f.roles.has('anon') || f.roles.has('authenticated');
  return fns;
}

function guardOf(body) {
  const staff = /if\s+not\s+app\.is_staff\(([^)]*)\)/i.exec(body);
  if (staff) return `staff role in (${staff[1].replace(/'/g, '').replace(/\s+/g, ' ').trim()})`;
  const g = /perform\s+app\.(analytics_guard|reports_guard)\(([^)]*)\)/i.exec(body);
  if (g) return g[1] === 'analytics_guard' ? 'owner only (app.analytics_guard)' : g[2].trim() === 'true' ? 'owner only (app.reports_guard)' : 'manager or owner (app.reports_guard)';
  if (/if\s+app\.staff_role\(\)\s+is\s+null/i.test(body)) return 'any active staff row';
  if (/app\.verify_manager_pin\(/i.test(body)) return 'manager or owner PIN';
  if (/auth\.uid\(\)\s+is\s+null/i.test(body)) return 'a signed-in session';
  return null;
}

export function inventoryEnums(migrations = readMigrations(), typeComments = new Map()) {
  const enums = new Map();
  for (const { number, sql } of migrations) {
    for (const m of sql.matchAll(/^\s*create\s+type\s+([a-z_][a-z0-9_]*)\s+as\s+enum\s*\(([^)]*)\)\s*;?([^\n]*)/gim)) {
      const values = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
      const note = /--\s*(.*)$/.exec(m[3]);
      enums.set(m[1], { name: m[1], values, note: note ? note[1].trim() : null, migration: number, comment: typeComments.get(m[1]) ?? null });
    }
    for (const m of sql.matchAll(/^\s*alter\s+type\s+([a-z_][a-z0-9_]*)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']*)'/gim)) {
      const e = enums.get(m[1]);
      if (e && !e.values.includes(m[2])) e.values.push(m[2]);
    }
  }
  return enums;
}

export function inventoryCron(migrations = readMigrations()) {
  /** name → { name, schedules:[{schedule, command, migration}] } */
  const jobs = new Map();
  for (const { number, sql } of migrations) {
    // The command is a plain literal or a dollar-quoted block ($tag$ … $tag$).
    for (const m of sql.matchAll(/cron\.schedule\(\s*'([a-z_][a-z0-9_]*)'\s*,\s*'([^']+)'\s*,\s*(?:'((?:[^']|'')*)'|\$([a-z_0-9]*)\$([\s\S]*?)\$\4\$)/g)) {
      if (!jobs.has(m[1])) jobs.set(m[1], { name: m[1], schedules: [] });
      const command = m[3] !== undefined ? m[3].replace(/''/g, "'") : squash(m[5]);
      jobs.get(m[1]).schedules.push({ schedule: m[2], command, migration: number });
    }
  }
  return jobs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge functions, routes, rail, catalogs, pages, rules, docs
// ─────────────────────────────────────────────────────────────────────────────
export function inventoryEdgeFunctions() {
  const toml = existsSync(PATHS.configToml) ? readFileSync(PATHS.configToml, 'utf8') : '';
  const out = new Map();
  for (const name of readdirSync(PATHS.functions).sort()) {
    const index = path.join(PATHS.functions, name, 'index.ts');
    if (name.startsWith('_') || !existsSync(index)) continue;
    const src = readFileSync(index, 'utf8');
    const header = /^\s*\/\*\*([\s\S]*?)\*\//.exec(src);
    const text = header
      ? header[1]
          .split('\n')
          .map((l) => l.replace(/^\s*\*\s?/, ''))
          .join('\n')
          .trim()
      : '';
    const vj = new RegExp(`\\[functions\\.${name}\\]\\s*\\n\\s*verify_jwt\\s*=\\s*(true|false)`).exec(toml);
    out.set(name, { name, header: text, verify_jwt: vj ? vj[1] === 'true' : null });
  }
  return out;
}

export function inventoryRoutes() {
  const src = readFileSync(PATHS.auth, 'utf8');
  const rolesBlock = /export const ROUTE_ROLES[^{]*\{([\s\S]*?)\n\};/.exec(src);
  const subBlock = /export const SUB_ROUTES\s*=\s*\{([\s\S]*?)\n\}/.exec(src);
  if (!rolesBlock || !subBlock) throw new Error('auth.tsx: could not find ROUTE_ROLES / SUB_ROUTES');
  const routeRoles = new Map();
  for (const m of rolesBlock[1].replace(/\/\/[^\n]*/g, '').matchAll(/'(\/[^']*)':\s*\[([^\]]*)\]/g)) {
    routeRoles.set(m[1], [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  }
  const subRoutes = new Map();
  for (const m of subBlock[1].replace(/\/\/[^\n]*/g, '').matchAll(/'(\/[a-z-]+)':\s*\[([^\]]*)\]/g)) {
    subRoutes.set(m[1], [...m[2].matchAll(/'(\/[^']+)'/g)].map((x) => x[1]));
  }
  return { routeRoles, subRoutes };
}

/** Longest ROUTE_ROLES prefix — the same rule auth.tsx applies. */
export function rolesForRoute(route, routeRoles) {
  let best;
  for (const key of routeRoles.keys()) {
    if (route === key || route.startsWith(`${key}/`)) if (best === undefined || key.length > best.length) best = key;
  }
  return best ? routeRoles.get(best) : [];
}

export function inventoryRail() {
  const src = readFileSync(PATHS.workspaces, 'utf8');
  const lists = new Map();
  for (const m of src.matchAll(/^const ([A-Z_]+): readonly NavItem\[\] = \[([\s\S]*?)\n\];/gm)) {
    const items = [];
    for (const it of m[2].replace(/\/\/[^\n]*/g, '').matchAll(/\{\s*to:\s*'([^']+)',\s*labelKey:\s*'([^']+)'([^}]*)\}/g)) {
      items.push({ to: it[1], labelKey: it[2], hidden: /hidden:\s*true/.test(it[3]) });
    }
    lists.set(m[1], items);
  }
  const sections = new Map(); // const name → { key, home, items }
  for (const m of src.matchAll(/\{\s*key:\s*'(\w+)',\s*home:\s*'([^']+)',\s*icon:\s*'\w+',\s*items:\s*([A-Z_]+)\s*\}/g)) {
    sections.set(m[1], { key: m[1], home: m[2], items: lists.get(m[3]) ?? [] });
  }
  const wsBlock = /export const WORKSPACES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!wsBlock) throw new Error('workspaces.ts: could not find WORKSPACES');
  const workspaces = [];
  for (const m of wsBlock[1].matchAll(/key:\s*'(\w+)',\s*home:\s*'([^']+)',\s*icon:\s*'\w+',\s*groups:\s*\[([\s\S]*?)\](?:,\s*sections:\s*(\w+))?/g)) {
    const groups = [];
    for (const g of m[3].matchAll(/labelKey:\s*(null|'(\w+)'),\s*items:\s*(\w+)/g)) {
      groups.push({ labelKey: g[2] ?? null, items: lists.get(g[3]) ?? [] });
    }
    const sectionKeys = m[4] ? [...(new RegExp(`const ${m[4]}[^=]*=\\s*\\[([\\s\\S]*?)\\];`).exec(src)?.[1] ?? '').matchAll(/key:\s*'(\w+)'/g)].map((x) => x[1]) : [];
    workspaces.push({ key: m[1], home: m[2], groups, sections: sectionKeys.map((k) => sections.get(k)).filter(Boolean) });
  }
  return { workspaces, sections: [...sections.values()] };
}

/**
 * A tolerant reader for the message catalogs: nested object literals with
 * string leaves. Returns [dotted.path, text] pairs. Arrays, template literals,
 * functions and multi-line strings are skipped on purpose — the catalogs are
 * data, and what the assistant needs is the words a screen shows.
 */
export function parseCatalog(src) {
  const out = [];
  const stack = [];
  let arrayDepth = 0;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
    if (arrayDepth > 0) {
      for (const c of line) if (c === '[') arrayDepth++; else if (c === ']') arrayDepth--;
      continue;
    }
    let m;
    if ((m = /^([A-Za-z0-9_]+):\s*\{\s*$/.exec(line))) {
      stack.push(m[1]);
    } else if ((m = /^([A-Za-z0-9_]+):\s*\{(.*)\},?\s*$/.exec(line))) {
      for (const leaf of m[2].matchAll(/([A-Za-z0-9_]+):\s*'((?:[^'\\]|\\.)*)'/g)) out.push([[...stack, m[1], leaf[1]].join('.'), leaf[2].replace(/\\'/g, "'")]);
    } else if ((m = /^([A-Za-z0-9_]+):\s*(['"])((?:(?!\2)[^\\]|\\.)*)\2\s*,?\s*(\/\/.*)?$/.exec(line))) {
      out.push([[...stack, m[1]].join('.'), m[3].replace(/\\(['"])/g, '$1')]);
    } else if (/^([A-Za-z0-9_]+):\s*\[/.test(line)) {
      for (const c of line) if (c === '[') arrayDepth++; else if (c === ']') arrayDepth--;
    } else if (/^\}\s*,?\s*$/.test(line) || /^\}\s*as const/.test(line)) {
      stack.pop();
    }
  }
  return out;
}

export function readPages(file = PATHS.pages) {
  const pages = new Map();
  if (!existsSync(file)) return pages;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^-\s+(\/\S*)\s+—\s+(.+\S)\s*$/.exec(line);
    if (m) pages.set(m[1], m[2]);
  }
  return pages;
}

export function readRules(file = PATHS.rules) {
  if (!existsSync(file)) return [];
  const rules = [];
  const parts = readFileSync(file, 'utf8').split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    rules.push({ title: part.slice(0, nl).trim(), body: part.slice(nl + 1).trim() });
  }
  return rules;
}

export function inventoryDocs() {
  const files = walkMd(PATHS.docsDir);
  for (const name of readdirSync(ROOT).sort()) if (name.endsWith('.md')) files.push(path.join(ROOT, name));
  const dbReadme = path.join(DB, 'README.md');
  if (existsSync(dbReadme)) files.push(dbReadme);
  return files.map(rel).sort();
}

export function readCoverageFixture(file = PATHS.coverage) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Where an RPC is called from in the operator app
// ─────────────────────────────────────────────────────────────────────────────
const FEATURE_ROUTE = {
  till: '/till', desk: '/desk', kds: '/kds', stock: '/stock', admin: '/admin', analytics: '/analytics', ops: '/ops',
  panel: '/panel', reports: '/reports', setup: '/setup', financial: '/financial', observation: '/observation',
  marketing: '/marketing', floor: '/ops', breaks: null,
};

function operatorRpcCallers() {
  /** rpc name → Set<relative file> */
  const callers = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const src = readFileSync(abs, 'utf8');
        for (const m of src.matchAll(/(?:appRpc|\.rpc)\(\s*'([a-z0-9_]+)'/g)) {
          if (!callers.has(m[1])) callers.set(m[1], new Set());
          callers.get(m[1]).add(rel(abs));
        }
      }
    }
  };
  walk(PATHS.operatorSrc);
  // The till's durable queue (lib/mutate.ts) maps mutation types to RPCs as `fn: 'name'`.
  const mutate = path.join(PATHS.operatorSrc, 'lib/mutate.ts');
  if (existsSync(mutate)) {
    for (const m of readFileSync(mutate, 'utf8').matchAll(/fn:\s*'([a-z0-9_]+)'/g)) {
      if (!callers.has(m[1])) callers.set(m[1], new Set());
      callers.get(m[1]).add('apps/operator/src/lib/mutate.ts (till queue)');
    }
  }
  return callers;
}

function routeOfFile(file) {
  const m = /apps\/operator\/src\/features\/([a-zA-Z]+)\//.exec(file);
  if (m) return FEATURE_ROUTE[m[1]] ?? null;
  const r = /apps\/operator\/src\/routes\/([a-z-]+)/.exec(file);
  return r ? `/${r[1]}` : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The map
// ─────────────────────────────────────────────────────────────────────────────
const LABEL_ROUTE_HINTS = {
  till: '/till', tabs: '/till/tabs', openTabs: '/till/tabs', drawer: '/till/drawer', payment: '/till',
  desk: '/desk', calendar: '/desk', today: '/desk/today', customers: '/desk/customers', series: '/desk/series/new', block: '/desk/block',
  kds: '/kds', ops: '/ops', overview: '/ops', panel: '/panel', analytics: '/analytics', reports: '/reports', revenue: '/reports/revenue',
  stock: '/stock', dayClose: '/admin/day-close', audit: '/admin/audit', staff: '/admin/staff', menu: '/admin/menu', rates: '/admin/rates',
  promotions: '/admin/promotions', settings: '/admin/settings', telegram: '/admin/telegram', qr: '/admin/qr', courts: '/admin/courts',
  hero: '/admin/hero', marketing: '/marketing', observation: '/observation', requests: '/observation/requests', financial: '/financial',
  setup: '/setup', hours: '/admin/hours', addons: '/admin/addons', suggested: '/admin/suggested', categories: '/admin/categories',
};
const CATALOG_FILE_ROUTE = { cashier: '/till', courtDesk: '/desk', prep: '/kds', manager: '/ops', owner: '/panel', reports: '/reports', analytics: '/analytics', shell: null, kit: null };

function labelChunks(lang) {
  const chunks = [];
  const emit = (fileLabel, prefix, pairs, defaultRoute) => {
    const groups = new Map();
    for (const [p, text] of pairs) {
      const segs = p.split('.');
      const group = segs.slice(0, Math.min(segs.length - 1, prefix.split('.').length + 1)).join('.');
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(`${segs.slice(group.split('.').length).join('.')}: ${text}`);
    }
    for (const [group, lines] of groups) {
      const second = group.split('.')[prefix.split('.').length] ?? '';
      const route = LABEL_ROUTE_HINTS[second] ?? defaultRoute;
      let part = 1;
      let buf = [];
      let size = 0;
      const flush = () => {
        if (!buf.length) return;
        chunks.push({ kind: 'label', ref: `label:${group}${part > 1 ? `#${part}` : ''}`, lang, title: `${group} (${fileLabel})`, body: buf.join('\n'), route });
        part++;
        buf = [];
        size = 0;
      };
      for (const l of lines) {
        if (size + l.length + 1 > DOC_CHUNK_CAP) flush();
        buf.push(l);
        size += l.length + 1;
      }
      flush();
    }
  };
  // op.* from catalogs/{en,ar}.ts
  const rootFile = path.join(PATHS.i18n, `${lang}.ts`);
  if (existsSync(rootFile)) {
    const pairs = parseCatalog(readFileSync(rootFile, 'utf8')).filter(([p]) => p.startsWith('op.'));
    emit(rel(rootFile), 'op', pairs, null);
  }
  // ws.<name>.* from catalogs/ws/<name>.<lang>.ts
  const wsDir = path.join(PATHS.i18n, 'ws');
  for (const f of readdirSync(wsDir).sort()) {
    const m = new RegExp(`^([a-zA-Z]+)\\.${lang}\\.ts$`).exec(f);
    if (!m) continue;
    const pairs = parseCatalog(readFileSync(path.join(wsDir, f), 'utf8')).map(([p, t]) => [`ws.${m[1]}.${p}`, t]);
    emit(rel(path.join(wsDir, f)), `ws.${m[1]}`, pairs, CATALOG_FILE_ROUTE[m[1]] ?? null);
  }
  return chunks;
}

function docChunks(excludedDocs) {
  const chunks = [];
  for (const file of inventoryDocs()) {
    if (excludedDocs.has(file)) continue;
    const text = readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
    const sections = text.split(/^(?=## )/m);
    let n = 0;
    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;
      const headingLine = trimmed.split('\n')[0];
      const heading = headingLine.replace(/^#+\s*/, '').trim();
      // cap: greedy paragraphs
      const paras = trimmed.split(/\n{2,}/);
      let buf = '';
      const flush = () => {
        if (!buf.trim()) return;
        n++;
        chunks.push({ kind: 'doc', ref: `doc:${file}#${n}`, lang: 'en', title: `${file} › ${heading}`, body: buf.trim(), route: null });
        buf = '';
      };
      for (const p of paras) {
        if (p.length > DOC_CHUNK_CAP) {
          flush();
          for (let i = 0; i < p.length; i += DOC_CHUNK_CAP) {
            buf = p.slice(i, i + DOC_CHUNK_CAP);
            flush();
          }
          continue;
        }
        if (buf.length + p.length + 2 > DOC_CHUNK_CAP) flush();
        buf += (buf ? '\n\n' : '') + p;
      }
      flush();
    }
  }
  return chunks;
}

function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function loadCatalog() {
  const mod = await import(pathToFileURL(PATHS.catalog).href);
  return mod;
}

/**
 * Build the map in memory. Throws when a route has no sentence in pages.md.
 * `catalog` lets a test pass the imported tools module; otherwise it is loaded
 * from packages/core.
 */
export async function buildMap({ catalog, sha } = {}) {
  const cat = catalog ?? (await loadCatalog());
  const migrations = readMigrations();
  const { tables, views, functionComments, typeComments } = inventorySchema(migrations);
  const fns = inventoryFunctions(migrations);
  const enums = inventoryEnums(migrations, typeComments);
  const cron = inventoryCron(migrations);
  const edge = inventoryEdgeFunctions();
  const { routeRoles, subRoutes } = inventoryRoutes();
  const rail = inventoryRail();
  const pages = readPages();
  const rules = readRules();
  const coverage = readCoverageFixture();
  const excludedDocs = new Set(Object.entries(coverage?.docs ?? {}).filter(([, v]) => String(v).startsWith('excluded')).map(([k]) => k));

  const shellEn = Object.fromEntries(parseCatalog(readFileSync(path.join(PATHS.i18n, 'ws/shell.en.ts'), 'utf8')));
  const shellAr = Object.fromEntries(parseCatalog(readFileSync(path.join(PATHS.i18n, 'ws/shell.ar.ts'), 'utf8')));
  const navEn = (k) => shellEn[`nav.${k}`] ?? k;
  const navAr = (k) => shellAr[`nav.${k}`] ?? null;
  const wsName = (k, lang) => (lang === 'ar' ? shellAr : shellEn)[`workspace.${k}`] ?? k;
  const secName = (k, lang) => (lang === 'ar' ? shellAr : shellEn)[`section.${k}`] ?? k;

  const chunks = [];

  // ── routes: inventory = ROUTE_ROLES ∪ SUB_ROUTES ∪ rail `to`s; pages.md may add more
  const routes = new Set([...routeRoles.keys(), ...[...subRoutes.values()].flat()]);
  const railByRoute = new Map(); // route → [{workspace, section, group, labelKey, hidden}]
  for (const ws of rail.workspaces) {
    for (const g of ws.groups) for (const it of g.items) {
      routes.add(it.to);
      if (!railByRoute.has(it.to)) railByRoute.set(it.to, []);
      railByRoute.get(it.to).push({ workspace: ws.key, section: null, group: g.labelKey, labelKey: it.labelKey, hidden: it.hidden });
    }
    for (const s of ws.sections) for (const it of s.items) {
      routes.add(it.to);
      if (!railByRoute.has(it.to)) railByRoute.set(it.to, []);
      railByRoute.get(it.to).push({ workspace: ws.key, section: s.key, group: null, labelKey: it.labelKey, hidden: it.hidden });
    }
  }
  const missing = [...routes].filter((r) => !pages.has(r)).sort();
  if (missing.length) {
    throw new Error(
      `pages.md has no sentence for ${missing.length} route(s):\n` +
        missing.map((r) => `  - ${r} — `).join('\n') +
        `\n  Add one line per route to ${rel(PATHS.pages)} (format: "- /route — sentence").`,
    );
  }
  const allPages = [...new Set([...routes, ...pages.keys()])].sort();
  const pageRoles = (route) => rolesForRoute(route, routeRoles);
  const pageWhere = (route, lang) =>
    (railByRoute.get(route) ?? []).map((r) => {
      const label = lang === 'ar' ? navAr(r.labelKey) ?? navEn(r.labelKey) : navEn(r.labelKey);
      const where = r.section ? `${wsName(r.workspace, lang)} › ${secName(r.section, lang)}` : wsName(r.workspace, lang);
      return `${where}: "${label}"${r.hidden ? (lang === 'ar' ? ' (غير مطبوع في الشريط)' : ' (not a printed rail row)') : ''}`;
    });

  for (const route of allPages) {
    const roles = pageRoles(route);
    const where = pageWhere(route, 'en');
    const labels = [...new Set((railByRoute.get(route) ?? []).map((r) => navEn(r.labelKey)))];
    const title = labels.length ? `${route} — ${labels.join(' / ')}` : route;
    const body = [
      pages.get(route),
      `Roles: ${roles.length ? roles.join(', ') : route === '/' ? 'any signed-in staff (it only redirects)' : 'no ROUTE_ROLES entry — the router denies it'}.`,
      where.length ? `Reached from: ${where.join('; ')}.` : 'Not a rail row: reached from inside another screen or by URL.',
    ].join('\n');
    chunks.push({ kind: 'page', ref: `page:${route}`, lang: 'en', title, body, route });
  }

  // ── nav: one per rail row (EN + AR), one per workspace and per section (EN + AR)
  for (const ws of rail.workspaces) {
    const rows = [];
    for (const g of ws.groups) for (const it of g.items) rows.push({ ...it, group: g.labelKey, section: null });
    for (const s of ws.sections) for (const it of s.items) rows.push({ ...it, group: null, section: s.key });
    for (const lang of ['en', 'ar']) {
      const nav = lang === 'ar' ? (k) => navAr(k) ?? navEn(k) : navEn;
      for (const r of rows) {
        const sect = r.section ? ` › ${secName(r.section, lang)}` : r.group ? ` › ${nav(r.group)}` : '';
        chunks.push({
          kind: 'nav',
          ref: `nav:${ws.key}:${r.section ?? '-'}:${r.to}`,
          lang,
          title: `${wsName(ws.key, lang)}${sect}: ${nav(r.labelKey)}`,
          body:
            lang === 'ar'
              ? `صف "${nav(r.labelKey)}" في مساحة "${wsName(ws.key, lang)}"${sect} يفتح ${r.to}.${r.hidden ? ' لا يُطبع في الشريط؛ يُفتح من داخل شاشة أخرى.' : ''} الاسم بالإنجليزية: "${navEn(r.labelKey)}". الأدوار: ${pageRoles(r.to).join(', ')}.`
              : `Rail row "${nav(r.labelKey)}" in the ${wsName(ws.key, lang)} workspace${sect} opens ${r.to}.${r.hidden ? ' Not printed on the rail; opened from inside another screen.' : ''} Arabic label: "${navAr(r.labelKey) ?? '—'}". Roles: ${pageRoles(r.to).join(', ')}.`,
          route: r.to,
        });
      }
      const visible = (items) => items.filter((i) => !i.hidden).map((i) => `${nav(i.labelKey)} → ${i.to}`);
      const wsBody = [
        lang === 'ar' ? `مساحة العمل "${wsName(ws.key, lang)}" تبدأ من ${ws.home}.` : `Workspace "${wsName(ws.key, lang)}" opens at ${ws.home}.`,
        ...ws.groups.map((g) => `${g.labelKey ? nav(g.labelKey) : lang === 'ar' ? 'الصفوف' : 'Rows'}: ${visible(g.items).join('; ')}`),
        ...(ws.sections.length ? [(lang === 'ar' ? 'الأقسام: ' : 'Sections: ') + ws.sections.map((s) => `${secName(s.key, lang)} → ${s.home}`).join('; ')] : []),
      ].join('\n');
      chunks.push({ kind: 'nav', ref: `nav:${ws.key}`, lang, title: `${lang === 'ar' ? 'مساحة العمل' : 'Workspace'}: ${wsName(ws.key, lang)}`, body: wsBody, route: ws.home });
      for (const s of ws.sections) {
        const lead = (lang === 'ar' ? shellAr : shellEn)[`sectionLead.${s.key}`];
        chunks.push({
          kind: 'nav',
          ref: `nav:${ws.key}:${s.key}`,
          lang,
          title: `${wsName(ws.key, lang)} › ${secName(s.key, lang)}`,
          body: [lead ?? '', `${lang === 'ar' ? 'الصفحة الرئيسية' : 'Home'}: ${s.home}`, `${lang === 'ar' ? 'الصفوف' : 'Rows'}: ${visible(s.items).join('; ')}`].filter(Boolean).join('\n'),
          route: s.home,
        });
      }
    }
  }

  // ── rpc: the catalog
  const toolByRpc = new Map(cat.ASSISTANT_TOOLS.filter((t) => t.rpc).map((t) => [t.rpc, t]));
  for (const t of cat.ASSISTANT_TOOLS) {
    const args = Object.entries(t.args).map(([n, a]) => `  ${n} (${a.type}${a.required ? ', required' : ''}${a.values ? `: ${a.values.join(' | ')}` : ''}${a.min !== undefined || a.max !== undefined ? ` ${a.min ?? ''}..${a.max ?? ''}` : ''}) — ${a.description}`);
    const body = [
      t.description,
      `Kind: ${t.kind}. Scope: ${t.scope}. ${t.core ? 'Always loaded.' : 'Loaded on demand.'}`,
      t.route ? `Same numbers on the page: ${t.route}.` : 'No page shows this directly.',
      t.rpc ? `Database function: app.${t.rpc} (through app.assistant_run_tool).` : 'Served by the assistant-chat edge function itself.',
      args.length ? `Arguments:\n${args.join('\n')}` : 'Arguments: none.',
      `Result: ${t.result.rows_path === null ? 'an object of aggregates (key/value lines)' : t.result.rows_path === '$' ? 'the result is itself the row array' : `rows under "${t.result.rows_path}"`}${t.result.id_keys?.length ? `; id columns ${t.result.id_keys.join(', ')} get handles` : ''}.`,
      t.kind === 'list' ? `List tool: paged, at most ${cat.LIST_ROW_CAP} rows per call, countable for the job estimator${t.chunk_rows ? ` (${t.chunk_rows} rows per job chunk)` : ''}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
    chunks.push({ kind: 'rpc', ref: `rpc:${t.name}`, lang: 'en', title: `tool ${t.name}`, body, route: t.route });
  }

  // ── action: client-callable functions that are not tools
  const callers = operatorRpcCallers();
  for (const f of [...fns.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!f.clientCallable || toolByRpc.has(f.name)) continue;
    const files = [...(callers.get(f.name) ?? [])].sort();
    const routesCalling = [...new Set(files.map(routeOfFile).filter(Boolean))].sort();
    const body = [
      functionComments.get(f.name) ?? '',
      `Signature: app.${f.name}(${f.signature ?? '…'})${f.returns ? ` returns ${f.returns}` : ''}.`,
      `Granted to: ${[...f.roles].sort().join(', ')}. Guard: ${f.guard ?? 'not detected by pattern — read the migration'}.`,
      f.audits.length ? `Audit actions written: ${f.audits.join(', ')}.` : 'Writes no audit row of its own (or via a helper).',
      f.raises.length ? `Error codes: ${f.raises.join(', ')}.` : '',
      files.length ? `Called from: ${files.join(', ')}${routesCalling.length ? ` (pages ${routesCalling.join(', ')})` : ''}.` : 'Not called directly by the operator app (edge function, guest app, queue or internal).',
      `Defined in migration ${f.definedIn ?? '?'} (last definition). The assistant cannot call this; it only explains it.`,
    ]
      .filter(Boolean)
      .join('\n');
    chunks.push({ kind: 'action', ref: `action:app.${f.name}`, lang: 'en', title: `app.${f.name}`, body, route: routesCalling[0] ?? null });
  }

  // ── table / column / setting
  const readable = (t) => t.columns.map((c) => `  ${c.name} ${c.definition}${c.comment ? ` — ${c.comment}` : ''}`).join('\n');
  for (const t of [...tables.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const body = [t.comment ?? '', `Created in migration ${t.migration}${t.schema !== 'public' ? ` (schema ${t.schema}, internal — never readable by the assistant)` : ''}.`, `Columns:\n${readable(t)}`].filter(Boolean).join('\n');
    chunks.push({ kind: 'table', ref: `table:${t.name}`, lang: 'en', title: `table ${t.name}`, body, route: null });
    for (const c of t.columns) {
      if (!c.comment || c.comment.length < 12) continue;
      chunks.push({ kind: 'column', ref: `column:${t.name}.${c.name}`, lang: 'en', title: `${t.name}.${c.name}`, body: `${c.definition}\n${c.comment}`, route: null });
    }
  }
  for (const v of [...views.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const body = [v.comment ?? '', `View, defined in migration ${v.migration}.`, `Definition: ${v.sql.slice(0, 1500)}${v.sql.length > 1500 ? ' …' : ''}`].filter(Boolean).join('\n');
    chunks.push({ kind: 'table', ref: `view:${v.name}`, lang: 'en', title: `view ${v.name}`, body, route: null });
  }
  const venue = tables.get('venue_settings');
  if (venue) {
    for (const c of venue.columns) {
      if (c.name === 'id') continue;
      chunks.push({ kind: 'setting', ref: `setting:venue_settings.${c.name}`, lang: 'en', title: `venue_settings.${c.name}`, body: `${c.definition}${c.comment ? `\n${c.comment}` : ''}\nOne row for the venue; read whole by the settings_read tool. Edited on /admin/settings and /admin/hours.`, route: '/admin/settings' });
    }
  }
  // cafe_settings keys: the LAST app.cafe_setting_specs() definition
  let specs = null;
  for (const { sql } of migrations) {
    for (const m of sql.matchAll(/create or replace function app\.cafe_setting_specs\(\)[\s\S]*?\$([a-z_0-9]*)\$([\s\S]*?)\$\1\$/g)) specs = m[2];
  }
  const settingsTs = existsSync(PATHS.settingsTs) ? readFileSync(PATHS.settingsTs, 'utf8') : '';
  if (specs) {
    for (const m of specs.matchAll(/\(\s*'([a-z_0-9]+)'\s*,\s*(true|false)\s*,\s*'([^']+)'\s*,\s*'([a-z_]+)'::staff_role\s*,\s*'((?:[^']|'')*)'::jsonb\s*\)/g)) {
      const doc = new RegExp(`/\\*\\*([^*]*)\\*/\\s*\\n\\s*${m[1]}:`).exec(settingsTs);
      chunks.push({
        kind: 'setting',
        ref: `setting:cafe_settings.${m[1]}`,
        lang: 'en',
        title: `cafe_settings.${m[1]}`,
        body: [`Shape ${m[3]}; default ${m[5].replace(/''/g, "'")}; ${m[2] === 'true' ? 'public (guests read it through cafe_settings_public)' : 'private (manager and owner only)'}; written by ${m[4]} or above through app.set_cafe_setting.`, doc ? squash(doc[1]) : ''].filter(Boolean).join('\n'),
        route: '/admin/settings',
      });
    }
  }

  // ── enum
  for (const e of [...enums.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    chunks.push({ kind: 'enum', ref: `enum:${e.name}`, lang: 'en', title: `enum ${e.name}`, body: [`Values: ${e.values.join(', ')}.`, e.comment ?? '', e.note ?? '', `Defined in migration ${e.migration}.`].filter(Boolean).join('\n'), route: null });
  }

  // ── label
  chunks.push(...labelChunks('en'), ...labelChunks('ar'));

  // ── rule
  for (const r of rules) {
    const slug = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    chunks.push({ kind: 'rule', ref: `rule:${slug}`, lang: 'en', title: r.title, body: r.body, route: null });
  }

  // ── system
  for (const e of edge.values()) {
    chunks.push({ kind: 'system', ref: `system:edge:${e.name}`, lang: 'en', title: `edge function ${e.name}`, body: [`verify_jwt = ${e.verify_jwt ?? 'unset'} (supabase/config.toml).`, e.header.slice(0, DOC_CHUNK_CAP)].join('\n'), route: null });
  }
  for (const j of cron.values()) {
    const seen = j.schedules.map((s) => `'${s.schedule}' (${s.migration})`).join(', ');
    const last = j.schedules[j.schedules.length - 1];
    chunks.push({ kind: 'system', ref: `system:cron:${j.name}`, lang: 'en', title: `cron job ${j.name}`, body: `Runs ${last.command}. Schedules seen in migrations, latest last: ${seen}. cron.schedule upserts by job name, so the latest definition that pg_cron accepts is live.`, route: null });
  }

  // ── doc
  chunks.push(...docChunks(excludedDocs));

  // deterministic order: kind (plan order) → ref → lang
  const kindIdx = new Map(CHUNK_KINDS.map((k, i) => [k, i]));
  chunks.sort((a, b) => kindIdx.get(a.kind) - kindIdx.get(b.kind) || a.ref.localeCompare(b.ref) || a.lang.localeCompare(b.lang));
  for (const c of chunks) if (!kindIdx.has(c.kind)) throw new Error(`unknown chunk kind ${c.kind}`);

  return { generated_from: sha ?? gitSha(), chunks, _pages: allPages, _routeRoles: routeRoles, _tools: cat.ASSISTANT_TOOLS };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact prefix — pages with routes and roles, the rules, the tool names
// ─────────────────────────────────────────────────────────────────────────────
export function renderCompact(map) {
  const pages = map.chunks.filter((c) => c.kind === 'page');
  const rules = map.chunks.filter((c) => c.kind === 'rule');
  const lines = [
    '# Touch Padel operator app — compact map',
    '',
    'Generated by packages/db/scripts/build-assistant-map.mjs; do not edit. Roles in brackets; rail location after the route.',
    '',
    '## Pages',
    '',
  ];
  for (const p of pages) {
    const roles = /^Roles: (.*)\.$/m.exec(p.body)?.[1] ?? '';
    const where = /^Reached from: (.*)\.$/m.exec(p.body)?.[1] ?? '';
    const sentence = p.body.split('\n')[0];
    lines.push(`- ${p.route} [${roles}]${where ? ` (${where})` : ''} — ${sentence}`);
  }
  lines.push('', '## Rules', '');
  for (const r of rules) lines.push(`### ${r.title}`, r.body, '');
  lines.push('## Tools', '', 'name — kind, scope, page with the same numbers', '');
  for (const t of map._tools ?? []) lines.push(`${t.name} — ${t.kind}, ${t.scope}${t.route ? `, ${t.route}` : ''}`);
  lines.push('');
  return lines.join('\n');
}

/** The committed shape: only what the fixture carries. */
export function serialize(map) {
  return `${JSON.stringify({ generated_from: map.generated_from, chunks: map.chunks }, null, 2)}\n`;
}

/** Chunk kinds the edge copy leaves out: indexed from the fixture by scripts/assistant-index-map.mjs instead. */
export const EDGE_EXCLUDED_KINDS = ['doc'];

/**
 * The edge copy: what `_shared/assistant/map.ts` imports. Same shape as the
 * fixture plus `compact`, minus the kinds above, so a function bundle carries
 * about a third of the bytes and the cached system prefix is read from one
 * field instead of being rebuilt at cold start.
 */
export function serializeEdge(map, compact) {
  return JSON.stringify(
    { generated_from: map.generated_from, compact, chunks: map.chunks.filter((c) => !EDGE_EXCLUDED_KINDS.includes(c.kind)) },
    null,
    0,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const check = process.argv.includes('--check');
  let map;
  try {
    map = await buildMap();
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    process.exit(1);
  }
  const json = serialize(map);
  const compact = renderCompact(map);

  const counts = {};
  for (const c of map.chunks) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  console.log('Assistant system map\n');
  for (const k of CHUNK_KINDS) console.log(`  ${k.padEnd(8)} ${String(counts[k] ?? 0).padStart(5)}`);
  console.log(`  ${'total'.padEnd(8)} ${String(map.chunks.length).padStart(5)}   (${map._pages.length} pages, ${map.chunks.filter((c) => c.lang === 'ar').length} Arabic chunks)`);
  console.log(`\n  map json     ${Buffer.byteLength(json).toLocaleString()} bytes`);
  const compactBytes = Buffer.byteLength(compact);
  console.log(`  compact md   ${compactBytes.toLocaleString()} bytes  (target ≤ ${COMPACT_BYTE_TARGET.toLocaleString()}; ~${Math.round(compactBytes / 4).toLocaleString()} tokens at 4 bytes/token)`);

  if (check) {
    const current = existsSync(PATHS.mapJson) ? readFileSync(PATHS.mapJson, 'utf8') : '';
    const same = JSON.stringify(JSON.parse(current || '{}').chunks) === JSON.stringify(map.chunks);
    if (!same) {
      console.error('\nFAIL  fixtures/assistant-map.json is stale. Run: pnpm --filter @touch/db assistant:map');
      process.exit(1);
    }
    console.log('\nPASS  fixture matches the code.');
    return;
  }

  mkdirSync(path.dirname(PATHS.mapCopy), { recursive: true });
  writeFileSync(PATHS.mapJson, json);
  writeFileSync(PATHS.mapCopy, serializeEdge(map, compact));
  writeFileSync(PATHS.compact, compact);
  console.log(`\n  wrote ${rel(PATHS.mapJson)}\n  wrote ${rel(PATHS.mapCopy)} (${Buffer.byteLength(serializeEdge(map, compact)).toLocaleString()} bytes, no doc chunks)\n  wrote ${rel(PATHS.compact)}`);
  if (compactBytes > COMPACT_BYTE_TARGET) {
    console.error(`\nFAIL  compact prefix is ${compactBytes} bytes, over the ${COMPACT_BYTE_TARGET}-byte target. Tighten renderCompact(), not the map.`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
