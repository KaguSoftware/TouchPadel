/**
 * Migration safety gate — Security Layer 1, Block 2 "Migrations" (SEC-02).
 *
 * WHY THIS IS NOT THE OBVIOUS DROP-ONLY RULE
 *
 * The rule everyone writes first fails on DROP TABLE / DROP COLUMN / TRUNCATE.
 * On this repository it lands green and catches nothing, because the real
 * hazard here is not destruction, it is LOCKING:
 *
 *   * 0 of 52 `create index` statements use CONCURRENTLY. A plain CREATE INDEX
 *     takes a SHARE lock for the whole build — every write to that table blocks
 *     until it finishes.
 *   * Most `add constraint` statements omit NOT VALID. Each takes
 *     ACCESS EXCLUSIVE and then scans the entire table to validate.
 *
 * There is exactly one Supabase project and it is the venue's live database
 * (D1). A lock taken at 19:00 on a Friday does not corrupt anything — it simply
 * stops the till taking money until it clears. That is the outage this gate
 * exists to prevent, and a drop-only rule does not see it.
 *
 * SCOPED TO CHANGED FILES, ON PURPOSE
 *
 * The 52 non-concurrent indexes and the existing constraint sites are already
 * applied to the live database. They cannot be rewritten — a migration is
 * immutable once it has run. A whole-directory scan would therefore turn `main`
 * permanently red on history, and a permanently red gate is weakened or deleted
 * within a day. So: grandfather what is committed, guard what arrives. The
 * comparison is against the merge base, so only migrations the pull request
 * actually adds or edits are judged.
 *
 * ESCAPE HATCH
 *
 * Some of these are genuinely unavoidable — CREATE INDEX CONCURRENTLY cannot run
 * inside a transaction block, and Supabase wraps each migration in one, so a
 * concurrent index needs its own migration and a deliberate decision. Put
 * `MIGRATION-RISK-ACCEPTED: <reason>` in the PR body (or set the env var of the
 * same name) and the gate reports the findings without failing. The reason is
 * recorded in the PR, which is the point: the risk is accepted by a person, in
 * writing, rather than by nobody.
 *
 * Usage:
 *   node scripts/check-migrations.mjs                  # vs origin/main
 *   node scripts/check-migrations.mjs --base=HEAD~1
 *   node scripts/check-migrations.mjs --all            # audit the whole dir
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MIG_DIR = 'packages/db/supabase/migrations';

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const baseArg = args.find((a) => a.startsWith('--base='));

const git = (a, opts = {}) =>
  execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }).trim();

/** The PR body carries the waiver in CI; the env var is the local equivalent. */
const acceptance =
  process.env.MIGRATION_RISK_ACCEPTED ??
  (process.env.PR_BODY ?? '').match(/MIGRATION-RISK-ACCEPTED:\s*(.+)/i)?.[1] ??
  null;

// ---- which migrations are we judging? ---------------------------------------

function resolveBase() {
  if (baseArg) return baseArg.split('=')[1];
  // On a PR, GITHUB_BASE_REF names the target branch. Locally, origin/main.
  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    'origin/main',
    'main',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      git(['rev-parse', '--verify', '--quiet', c], { stdio: ['ignore', 'pipe', 'ignore'] });
      return c;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

let files;
if (ALL) {
  files = git(['ls-files', MIG_DIR]).split('\n').filter((f) => f.endsWith('.sql'));
} else {
  const base = resolveBase();
  if (!base) {
    console.error('FAIL  cannot resolve a merge base (no origin/main, no --base=).');
    console.error('      A shallow clone will do this — CI needs fetch-depth: 0 or an explicit --base.');
    process.exit(1);
  }
  let range;
  try {
    range = git(['merge-base', base, 'HEAD']);
  } catch {
    range = base;
  }
  files = git(['diff', '--name-only', '--diff-filter=ACMR', range, '--', MIG_DIR])
    .split('\n')
    .filter((f) => f.endsWith('.sql'));
}
files = files.filter(Boolean);

/**
 * Every NEW migration must open with the lock/statement timeouts.
 *
 * This is the live-migration procedure from Block 3, enforced rather than
 * written down. Without `lock_timeout`, an ALTER TABLE that queues behind a
 * long-running Realtime transaction waits FOREVER — and every query that
 * arrives after it queues behind the ALTER. One blocked statement becomes the
 * whole till frozen mid-service, and it stays frozen until someone finds the
 * session and kills it.
 *
 * With `lock_timeout = '3s'` the migration gives up instead, the push fails
 * loudly, and the venue keeps trading. Failing a deploy is recoverable; a
 * frozen till during service is not.
 *
 * `statement_timeout = '60s'` is the same argument for the statement itself
 * once it HAS the lock — a validating scan on a table that grew is bounded.
 *
 * Checked against the PARSED STATEMENTS, not the first N bytes of the file: the
 * property that matters is "the timeouts are set before anything takes a lock",
 * and a migration with a long explanatory header is a good migration, not a
 * violation. (The first version of this rule used a byte window and failed on
 * exactly that — 0069, whose header is the documentation for a relocation of
 * btree_gist.)
 */
const TIMEOUT_PREAMBLE = {
  // A non-zero duration. `0` and `'0'` mean "no timeout" in Postgres, which is
  // the default this rule exists to override.
  lock: /set\s+lock_timeout\s*=\s*'?(?!0'?\s*;)\d+\s*(ms|s|min)?'?/i,
  statement: /set\s+statement_timeout\s*=\s*'?(?!0'?\s*;)\d+\s*(ms|s|min)?'?/i,
};

// ---- the rules ---------------------------------------------------------------

/**
 * Statement-level rules. Each carries the OUTAGE it causes, not just the smell —
 * a reviewer who understands the consequence makes a better decision than one
 * reading "unsafe DDL".
 */
const RULES = [
  {
    id: 'index-not-concurrent',
    // CREATE INDEX ... but not CONCURRENTLY. `create unique index` included.
    test: (s) => /^create\s+(unique\s+)?index\b/i.test(s) && !/\bconcurrently\b/i.test(s),
    severity: 'block',
    what: 'CREATE INDEX without CONCURRENTLY',
    why:
      'Takes a SHARE lock on the table for the entire build: every INSERT and UPDATE\n' +
      '        blocks until it completes. On a table the till writes to, that is the till\n' +
      '        frozen mid-service.\n' +
      '        FIX: CREATE INDEX CONCURRENTLY, in its OWN migration file — it cannot run\n' +
      '        inside a transaction block, and Supabase wraps each migration in one.',
  },
  {
    id: 'constraint-validating',
    // ADD CONSTRAINT that will validate immediately. NOT VALID makes it cheap.
    test: (s) =>
      /\badd\s+constraint\b/i.test(s) &&
      !/\bnot\s+valid\b/i.test(s) &&
      // A constraint added in the same statement that CREATEs the table has no
      // existing rows to scan, so it is free.
      !/^create\s+table\b/i.test(s),
    severity: 'block',
    what: 'ADD CONSTRAINT without NOT VALID',
    why:
      'Takes ACCESS EXCLUSIVE — which blocks even SELECT — and then scans every\n' +
      '        existing row to validate before releasing it.\n' +
      '        FIX: the two-step pattern already used elsewhere in this repo:\n' +
      '          ALTER TABLE t ADD CONSTRAINT c ... NOT VALID;   -- instant, brief lock\n' +
      '          ALTER TABLE t VALIDATE CONSTRAINT c;            -- slow, but only SHARE UPDATE EXCLUSIVE',
  },
  {
    id: 'column-type-change',
    test: (s) => /\balter\s+column\b[\s\S]*\b(type|set\s+data\s+type)\b/i.test(s),
    severity: 'block',
    what: 'ALTER COLUMN ... TYPE',
    why:
      'Rewrites the entire table under ACCESS EXCLUSIVE, and invalidates every\n' +
      '        dependent view, index and function.\n' +
      '        FIX: add a new column, backfill in batches, swap, drop the old one later.',
  },
  {
    id: 'drop-table',
    test: (s) => /^drop\s+table\b/i.test(s),
    severity: 'block',
    what: 'DROP TABLE',
    why: 'Irreversible against live guest data, and there is no staging rehearsal (D1).',
  },
  {
    id: 'drop-column',
    test: (s) => /\bdrop\s+column\b/i.test(s),
    severity: 'block',
    what: 'DROP COLUMN',
    why:
      'Irreversible, and it breaks any client still deployed against the old shape —\n' +
      '        the venue PC and the guest phones do not update in lockstep with the DB.',
  },
  {
    id: 'truncate',
    test: (s) => /^truncate\b/i.test(s),
    severity: 'block',
    what: 'TRUNCATE',
    why: 'Deletes every row and cannot be rolled back once committed. Never correct in a migration.',
  },
  {
    id: 'not-null-direct',
    test: (s) => /\balter\s+column\b[\s\S]*\bset\s+not\s+null\b/i.test(s),
    severity: 'block',
    what: 'SET NOT NULL',
    why:
      'Full table scan under ACCESS EXCLUSIVE.\n' +
      '        FIX: add a CHECK (col IS NOT NULL) NOT VALID, VALIDATE it, then SET NOT NULL —\n' +
      '        Postgres 12+ uses the validated CHECK and skips the scan.',
  },
];

/**
 * DROP POLICY is only safe when the same file puts one back. A migration that
 * drops a policy and forgets to recreate it silently opens the table to every
 * role holding the table grant — which is what RLS was standing in front of.
 */
function unpairedDropPolicy(statements) {
  const dropped = new Map();
  for (const { text, line } of statements) {
    const d = text.match(/^drop\s+policy\s+(?:if\s+exists\s+)?"?([\w.]+)"?\s+on\s+"?([\w.]+)"?/i);
    if (d) dropped.set(`${d[2]}.${d[1]}`.toLowerCase(), line);
    const c = text.match(/^create\s+policy\s+"?([\w.]+)"?\s+on\s+"?([\w.]+)"?/i);
    if (c) dropped.delete(`${c[2]}.${c[1]}`.toLowerCase());
  }
  return [...dropped.entries()];
}

/**
 * Split SQL into statements, tracking line numbers, with string literals,
 * dollar-quoted function bodies and comments removed first. Without the
 * dollar-quote handling every `create function` body would be shredded into
 * fragments and matched as if it were DDL.
 */
function statements(sql) {
  const out = [];
  let buf = '';
  let startLine = 1;
  let line = 1;
  let i = 0;
  let dollarTag = null;

  const flush = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    if (text) out.push({ text, line: startLine });
    buf = '';
  };

  while (i < sql.length) {
    const ch = sql[i];

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      if (ch === '\n') line += 1;
      i += 1;
      continue;
    }

    // line comment
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    // block comment
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    // single-quoted string
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        if (sql[i] === '\n') line += 1;
        i += 1;
      }
      buf += " '' ";
      continue;
    }
    // dollar-quoted body: $$ ... $$ or $tag$ ... $tag$
    const dq = ch === '$' ? sql.slice(i).match(/^\$[A-Za-z_]*\$/) : null;
    if (dq) {
      dollarTag = dq[0];
      i += dq[0].length;
      buf += ' $body$ ';
      continue;
    }

    if (ch === ';') {
      flush();
      i += 1;
      startLine = line;
      continue;
    }

    if (ch === '\n') { line += 1; if (!buf.trim()) startLine = line; }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

// ---- run ---------------------------------------------------------------------

const findings = [];

for (const file of files) {
  const abs = path.join(ROOT, file);
  if (!existsSync(abs)) continue;
  const sql = readFileSync(abs, 'utf8');
  const stmts = statements(sql);

  for (const { text, line } of stmts) {
    for (const rule of RULES) {
      if (rule.test(text)) {
        findings.push({ file, line, rule, snippet: text.slice(0, 110) });
      }
    }
  }

  // Only NEW migrations are held to the preamble. The 68 already applied
  // cannot be edited — a migration is immutable once it has run.
  if (!ALL) {
    // The RAW text up to the first statement that is not a SET. Raw, because
    // the parser blanks string literals — `set lock_timeout = '3s'` arrives here
    // as `set lock_timeout = ''`, and the VALUE is exactly what needs checking:
    // `set lock_timeout = 0` means "wait forever", which is the thing this rule
    // exists to prevent and would otherwise pass as "a lock_timeout is set".
    const firstNonSet = stmts.find((st) => !/^set\s+/i.test(st.text));
    const head = firstNonSet
      ? sql.split('\n').slice(0, firstNonSet.line).join('\n')
      : sql;
    const missing = [];
    if (!TIMEOUT_PREAMBLE.lock.test(head)) missing.push('lock_timeout');
    if (!TIMEOUT_PREAMBLE.statement.test(head)) missing.push('statement_timeout');
    if (missing.length > 0 && stmts.length > 0) {
      findings.push({
        file,
        line: 1,
        rule: {
          id: 'missing-timeout-preamble',
          what: `migration does not set ${missing.join(' and ')}`,
          why:
            'Without lock_timeout an ALTER TABLE that queues behind a long Realtime transaction\n' +
            '        waits forever, and every query arriving after it queues behind the ALTER — the\n' +
            '        till freezes mid-service and stays frozen until someone finds and kills the\n' +
            '        session. A failed deploy is recoverable; that is not.\n' +
            '        FIX: begin the migration with\n' +
            "          set lock_timeout = '3s';\n" +
            "          set statement_timeout = '60s';",
        },
        snippet: '(top of file)',
      });
    }
  }

  for (const [key, line] of unpairedDropPolicy(stmts)) {
    findings.push({
      file,
      line,
      rule: {
        id: 'unpaired-drop-policy',
        what: `DROP POLICY with no matching CREATE POLICY (${key})`,
        why:
          'The table keeps RLS enabled but loses the rule that was filtering it. Whether\n' +
          '        that closes the table or opens it depends on what other policies remain —\n' +
          '        either way it is not what the author meant.\n' +
          '        FIX: recreate the policy in the same migration.',
      },
      snippet: `drop policy ${key}`,
    });
  }
}

// ---- report ------------------------------------------------------------------

const scope = ALL ? 'ALL migrations' : `${files.length} changed migration file(s)`;
console.log(`Migration safety gate — scope: ${scope}`);
for (const f of files) console.log(`  ${f}`);
if (files.length === 0) {
  console.log('\nPASS  no migration files changed.');
  process.exit(0);
}
console.log('');

if (findings.length === 0) {
  console.log('PASS  no lock-taking or destructive DDL in the changed migrations.');
  process.exit(0);
}

const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.rule.id)) byRule.set(f.rule.id, { rule: f.rule, sites: [] });
  byRule.get(f.rule.id).sites.push(f);
}

const label = acceptance ? 'ACCEPTED' : 'FAIL';
console.error(`${label}  ${findings.length} risky statement(s) in the changed migrations:\n`);
for (const { rule, sites } of byRule.values()) {
  console.error(`  ${rule.what}  (${sites.length} site${sites.length === 1 ? '' : 's'})`);
  console.error(`        ${rule.why}`);
  for (const s of sites.slice(0, 6)) {
    console.error(`        ${s.file}:${s.line}`);
    console.error(`            ${s.snippet}`);
  }
  if (sites.length > 6) console.error(`        … and ${sites.length - 6} more`);
  console.error('');
}

if (acceptance) {
  console.log(`Accepted in writing: ${acceptance}`);
  console.log('Reported, not blocked. The reason above is the record.');
  process.exit(0);
}

console.error('If a statement here is genuinely necessary — a CONCURRENT index must live in its own');
console.error('migration, for instance — put this line in the pull request body:');
console.error('');
console.error('    MIGRATION-RISK-ACCEPTED: <why this is safe to run against the live venue database>');
console.error('');
console.error('There is one Supabase project and it is the venue\'s live database (D1). A lock taken');
console.error('during service does not corrupt anything; it stops the till taking money until it clears.');
process.exit(1);
