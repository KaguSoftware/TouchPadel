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
 * Usage:  node scripts/security/check-no-config-push.mjs   (exit 1 on violation)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Where an executable `config push` could actually live. */
const GLOBS = [
  '.github/workflows/*',
  'scripts/*',
  'scripts/**/*',
  'packages/*/scripts/*',
  'packages/*/scripts/**/*',
  'apps/*/scripts/*',
  'apps/*/scripts/**/*',
  'package.json',
  'packages/*/package.json',
  'apps/*/package.json',
];

/**
 * `supabase … config push`, with anything in between on the same line —
 * `pnpm exec supabase`, `npx supabase --workdir packages/db config push`,
 * `supabase config push --linked`. Line-bounded so it cannot wander.
 */
const CONFIG_PUSH = /\bsupabase\b[^\n]*\bconfig\s+push\b/;

/** A whole-line comment in JS/TS (`//`, `*`, `/*`), YAML or shell (`#`). */
const COMMENT_LINE = /^\s*(?:\/\/|\*|\/\*|#)/;
/** This file says the words in order to forbid them. */
const SELF = 'scripts/security/check-no-config-push.mjs';

const files = execFileSync('git', ['ls-files', '-z', '--', ...GLOBS], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean)
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
  if (!/config\s+push/.test(text)) continue;

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
      if (typeof cmd === 'string' && CONFIG_PUSH.test(cmd)) {
        violations.push({ file, where: `scripts.${name}`, text: cmd.trim().slice(0, 120) });
      }
    }
    continue;
  }

  for (const [i, line] of text.split('\n').entries()) {
    // A comment that names the command in order to forbid it is not a command:
    // check-config-env.mjs's header does exactly that, and so does this file.
    // Only whole-line comments are skipped; a trailing comment after a real
    // command still leaves the command on the line.
    if (COMMENT_LINE.test(line)) continue;
    if (CONFIG_PUSH.test(line)) {
      violations.push({ file, where: `:${i + 1}`, text: line.trim().slice(0, 120) });
    }
  }
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
