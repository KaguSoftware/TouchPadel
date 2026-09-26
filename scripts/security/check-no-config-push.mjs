/**
 * `supabase config push` gate — S10 (Phase 2, Milestone 0).
 *
 * THE RULE. Nothing in this repository runs `supabase config push`. Not a
 * workflow, not a script, not an npm script anybody can type by tab-completion.
 *
 * WHY. `packages/db/supabase/config.toml` describes the LOCAL stack and nothing
 * else: an enabled placeholder Twilio block, `enable_signup = true` for phone,
 * a local `site_url`, and an `[auth.sms.test_otp]` number that GoTrue answers
 * without sending anything. The HOSTED project's auth is dashboard-managed on
 * purpose — the Phone provider and the Send SMS hook stay off until
 * `docs/client/phone-otp-activation.md` is executed, and the dashboard is where
 * that decision is recorded.
 *
 * `config push` collapses the two. It was run against the client's project on
 * 2026-08-24, and it overwrote the hosted auth configuration with the local one
 * — including the committed test-OTP pair, which made a public credential a
 * working sign-in for a real-format number on a live project
 * (docs/security/security-audit-2026-09-13.md:191, finding M8). S10 moved the
 * code out of the file; this gate is the other half, because an `env()`
 * reference that resolves at push time is no safer than the literal was.
 *
 * NO ALLOWLIST, deliberately. There is no legitimate `config push` in this
 * repository, so there is nothing an exemption could be for — and an allowlist
 * is how the next one gets in with a reason that sounds fine in a diff.
 * `docs/**` is out of scope: prose has to be able to name the command in order
 * to forbid it, as this header does.
 *
 * WHAT COUNTS AS A HIT. Three shapes, none of them line-bound any more:
 *   1. `supabase … config push` on one logical line, where a logical line is
 *      the shell's: lines ending in `\` are joined, and a YAML `run: |` (or
 *      `run: >`) block is one string.
 *   2. `supabase config \` + newline + `push` — the split spelled out, in case
 *      a joiner is ever bypassed.
 *   3. The bare words `config push` anywhere, so `CMD="config push"` followed
 *      by `supabase $CMD` is caught at the assignment. `config-push` (the npm
 *      script name of this gate) is not the words.
 * Whole-line comments are still skipped: check-config-env.mjs's header names the
 * command in order to forbid it.
 *
 * Usage:  node scripts/security/check-no-config-push.mjs   (exit 1 on violation)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Where an executable `config push` could actually live. */
export const GLOBS = [
  '.github/workflows/*',
  '.github/actions/**/*.yml',
  '.github/actions/**/*.yaml',
  '.husky/**',
  'Makefile',
  'justfile',
  'scripts/*',
  'scripts/**/*',
  'packages/*/scripts/*',
  'packages/*/scripts/**/*',
  'apps/*/scripts/*',
  'apps/*/scripts/**/*',
  'package.json',
  '**/package.json',
];

/**
 * `supabase … config push`, with anything in between on the same logical line —
 * `pnpm exec supabase`, `npx supabase --workdir packages/db config push`,
 * `supabase config push --linked`. Line-bounded so it cannot wander; the caller
 * has already joined continuations, so a `\`-split command is one line here.
 */
export const CONFIG_PUSH = /\bsupabase\b[^\n]*\bconfig\s+push\b/;
/** `supabase config \` + newline + `push`, before any joining. */
export const CONFIG_PUSH_SPLIT = /\bsupabase\s+config\s*\\?\s*\n\s*push\b/;
/**
 * The two words, anywhere: a variable holding them is a command in waiting.
 * `git config push.default` is the one innocent spelling, hence the lookahead.
 */
export const CONFIG_PUSH_LITERAL = /\bconfig\s+push\b(?!\.)/;

/** A whole-line comment in JS/TS (`//`, `*`, `/*`), YAML or shell (`#`). */
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*|#)/;
/** This file says the words in order to forbid them. */
const SELF = 'scripts/security/check-no-config-push.mjs';

/**
 * Split a file into logical lines: [{ line, text }] where `line` is the
 * 1-based number of the first physical line. Whole-line comments are dropped
 * first (so a comment between two halves of a continuation does not break the
 * join). Then:
 *   - a line ending in `\` is joined with the next by a space;
 *   - a YAML `run: |` / `run: >` scalar swallows every following line that is
 *     indented deeper than the `run:` key (blank lines included), joined by
 *     newlines, so the block is one string.
 */
export function logicalLines(text) {
  const raw = text.split('\n');
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const line = raw[i];
    if (COMMENT_LINE.test(line)) {
      i += 1;
      continue;
    }
    const start = i + 1;
    const block = /^(\s*)(?:-\s+)?run:\s*[|>][-+]?\s*$/.exec(line);
    if (block) {
      const indent = block[1].length;
      const body = [line];
      i += 1;
      while (i < raw.length) {
        const next = raw[i];
        const nextIndent = next.search(/\S|$/);
        if (next.trim() !== '' && nextIndent <= indent) break;
        if (!COMMENT_LINE.test(next)) body.push(next);
        i += 1;
      }
      // One string, with the shell's own continuations joined as well: a
      // `\`-split command inside the block is one command to the shell.
      out.push({ line: start, text: body.join('\n').replace(/\\[ \t]*\n[ \t]*/g, ' ') });
      continue;
    }
    let joined = line;
    while (/\\\s*$/.test(joined) && i + 1 < raw.length) {
      i += 1;
      if (COMMENT_LINE.test(raw[i])) {
        // keep the trailing backslash so the join continues past the comment
        continue;
      }
      joined = joined.replace(/\\\s*$/, ' ') + raw[i];
    }
    out.push({ line: start, text: joined });
    i += 1;
  }
  return out;
}

/** Every hit in one file's text: [{ where, text }]. Exported for the tests. */
export function findConfigPush(text) {
  const hits = [];
  for (const { line, text: logical } of logicalLines(text)) {
    if (CONFIG_PUSH.test(logical) || CONFIG_PUSH_SPLIT.test(logical) || CONFIG_PUSH_LITERAL.test(logical)) {
      hits.push({ where: `:${line}`, text: logical.trim().replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 120) });
    }
  }
  return hits;
}

// Importable for the unit test of the matchers; the sweep runs only as a script.
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const files = execFileSync('git', ['ls-files', '-z', '--', ...GLOBS], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter((f, idx, all) => all.indexOf(f) === idx)
    .filter((f) => f !== SELF)
    .filter((f) => !f.startsWith('docs/'));

  const violations = [];

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // a directory entry, a submodule, or a binary we cannot read
    }
    if (!/config\s+push/.test(text) && !/config\s*\\?\s*\n\s*push/.test(text)) continue;

    // A package.json is judged on its `scripts` block only: a dependency name or
    // a description that happens to contain the words is not a command.
    if (/(?:^|\/)package\.json$/.test(file)) {
      let scripts;
      try {
        scripts = JSON.parse(text).scripts ?? {};
      } catch {
        continue;
      }
      for (const [name, cmd] of Object.entries(scripts)) {
        if (typeof cmd === 'string' && (CONFIG_PUSH.test(cmd) || CONFIG_PUSH_LITERAL.test(cmd))) {
          violations.push({ file, where: `scripts.${name}`, text: cmd.trim().slice(0, 120) });
        }
      }
      continue;
    }

    for (const hit of findConfigPush(text)) violations.push({ file, ...hit });
  }

  if (violations.length === 0) {
    console.log(`PASS  nothing runs \`supabase config push\` (${files.length} tracked files).`);
    process.exit(0);
  }

  console.error('FAIL  `supabase config push` found:\n');
  for (const v of violations) {
    console.error(`  ${v.file}${v.where}`);
    console.error(`      ${v.text}\n`);
  }
  console.error(
    'packages/db/supabase/config.toml describes the LOCAL stack; hosted auth is\n' +
      'dashboard-managed. A `config push` overwrote it once\n' +
      '(docs/security/security-audit-2026-09-13.md:191) and pushed a committed\n' +
      "test-OTP pair to the client's project. Change the hosted settings in the\n" +
      'dashboard and record them in docs/client/phone-otp-activation.md instead.',
  );
  process.exit(1);
}
