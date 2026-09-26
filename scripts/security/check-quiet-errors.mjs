/**
 * Quiet-error gate — SEC-36.
 *
 * THE RULE. A guest must never see the server's own words. No stack trace, no
 * raw Postgres error, no constraint name, no "user 4412 not found" that
 * confirms which accounts exist. The guest gets the same generic sentence
 * whether the account exists or not; the full error goes to the tracker.
 *
 * WHY A GATE RATHER THAN A REVIEW. All three clients already have a mapper that
 * turns a server code into an i18n key and falls back to a generic message
 * (`mapErrorToKey`, `rpcErrorKey`, `errorToMessageKey`). The rule is not at
 * risk from those; it is at risk from the NEXT screen, where
 *
 *     catch (e) { setError(e.message) }
 *
 * is what error handling looks like everywhere else in the world, reads as
 * diligent in review, and quietly puts `duplicate key value violates unique
 * constraint "reservations_court_id_starts_at_key"` on a phone. That is one
 * line, in one screen, added by anybody, and no test fails. This gate is the
 * only thing that would notice.
 *
 * WHAT IT JUDGES. The two GUEST-facing clients only:
 *
 *   apps/mobile   the guest's phone app
 *   apps/web      the café's QR ordering surface
 *
 * apps/operator is deliberately OUT OF SCOPE. It is a staff terminal behind the
 * till, its audience already has a role in the venue, and it shows the raw error
 * on purpose in one place — CrashScreen.tsx's collapsed <details>, which exists
 * so a manager can read a fault to somebody on the phone. Extending a
 * guest-privacy rule over a staff debugging affordance would mean deleting the
 * affordance, and it protects nobody: a cashier who can read the error can also
 * read the orders. If that call is ever revisited, add 'apps/operator' to ROOTS.
 *
 * WHAT COUNTS AS A VIOLATION. Reaching into a caught error for its own text and
 * putting that text somewhere a user sees it — state, a toast, or JSX. The
 * shapes below are the ones that actually occur; this is a tripwire on the
 * common mistake, not a proof of absence, and it says so in its output.
 *
 * WHAT IS ALLOWED, and why the gate has to know: telemetry MUST capture the
 * whole error — that is the other half of the rule ("the full error goes to the
 * tracker") — and the mappers must READ `.message` to find the code in it. Both
 * are exempted by path, and each exemption names the file rather than a
 * pattern, so a new module cannot inherit one by being called something
 * similar.
 *
 * MUTATION-TESTED 2026-09-09, both directions — a gate that has only ever been
 * seen to pass is indistinguishable from one that matches nothing:
 *
 *   setError((err as Error).message)   -> caught [state]
 *   toast(error.message)               -> caught [toast]
 *   <p>{error.message}</p>             -> caught [jsx]
 *   String(error)                      -> caught [stringify]
 *   removing the __DEV__ guard from app/_layout.tsx:103 -> caught [jsx]
 *
 * The FIRST version of the state pattern missed the cast form outright, which
 * is the shape that actually occurs in TypeScript. It was found by the mutation
 * run, not by review.
 *
 * Usage:  node scripts/security/check-quiet-errors.mjs   (exit 1 on violation)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Guest-facing clients only — see the header for why the operator is not here. */
const ROOTS = ['apps/mobile/', 'apps/web/'];

/**
 * Files that may touch a raw error's text, each with the reason.
 *
 * EXACT paths, never prefixes or globs: an exemption is a hole in the rule, and
 * a hole that a new file can fall into by being named `errors2.ts` is not a
 * decision anybody made.
 */
const ALLOWED = new Map([
  // The tracker half of the rule. These exist to serialise the whole error.
  ['apps/mobile/src/lib/telemetry.ts', 'the tracker — capturing the full error IS the rule'],
  // The mappers. They read .message to find the raise-code inside it, and
  // return an i18n KEY. Reading is what they are for; they never return text.
  ['apps/mobile/src/features/booking/errors.ts', 'the mapper: reads .message, returns a MessageKey'],
  ['apps/mobile/src/lib/network.ts', 'transport-failure detection: matches on .message, returns a boolean'],
  ['apps/web/src/lib/appRpc.ts', 'the mapper: reads .message, returns a MessageKey'],
  ['apps/web/src/components/cafe/submitGuestOrder.ts', 'reads .message to extract the raise-code; returns a code, never text'],
]);

/**
 * The shapes that put a server string in front of a person.
 *
 * Each is deliberately narrow and anchored to a SINK — a state setter, a toast,
 * or JSX interpolation. A broad `/\.message/` would fire on every mapper and
 * every log line, and a gate that cries wolf is one that gets deleted (the
 * argument check-migrations.mjs makes in its own header).
 */
/**
 * An expression that reads a caught error's own text.
 *
 * `[^;\n]{0,40}?` between the identifier and the field is what makes this work
 * on real TypeScript: the shape is almost never a bare `err.message`, it is
 * `(err as Error).message`, `(e as PostgrestError)?.message`, or
 * `(error as { message?: string }).message`. The first version of this gate
 * matched only `[\w.?]*` and therefore missed EVERY cast — it passed the tree
 * and passed its own mutant, which is the exact failure mode SEC-36 exists to
 * stop being repeated (a gate that greps for a name an unused import satisfies,
 * macbook-docker-checks.md §4). Lazy and line-bounded so it cannot wander into
 * an unrelated statement.
 */
const ERR_TEXT = String.raw`\b(?:err|error|ex|e)\b[^;\n]{0,40}?\.(?:message|details|hint|stack)\b`;

const PATTERNS = [
  {
    id: 'state',
    // setError(e.message) / setError((err as Error).message) / setLoadError(...)
    re: new RegExp(String.raw`\bset[A-Z]\w*\([^;\n]{0,30}?` + ERR_TEXT, 'i'),
    why: 'puts the server\u2019s own words into UI state',
  },
  {
    id: 'toast',
    re: new RegExp(
      String.raw`\b(?:toast|alert|Alert\.alert|notify|showError)\s*\([^;\n]{0,60}?` + ERR_TEXT,
      'i',
    ),
    why: 'shows the server\u2019s own words in a toast or alert',
  },
  {
    id: 'jsx',
    // {error.message} / {(err as Error).message} / {err?.message ?? "..."} in JSX
    re: new RegExp(String.raw`\{[^{}\n]{0,40}?` + ERR_TEXT + String.raw`[^{}\n]{0,40}?\}`, 'i'),
    why: 'renders the server\u2019s own words directly',
  },
  {
    id: 'stringify',
    re: /\b(?:String|JSON\.stringify)\(\s*(?:err|error|ex)\s*\)/,
    why: 'serialises the whole error object into a string that reaches the UI',
  },
];

/** Line-level opt-out, for the case the patterns cannot see. Must carry a reason. */
const WAIVER = /QUIET-ERROR-OK:\s*\S/;

/**
 * A debug line that cannot reach a shipped build.
 *
 * `__DEV__` is not an ordinary boolean: Metro replaces it with the literal
 * `false` when bundling a release and the branch is then dead-code eliminated,
 * so the string is not merely hidden in production — it is not in the binary.
 * That is a build-time guarantee, which is a stronger thing than a waiver, so
 * the gate recognises it rather than making every such line carry a comment.
 *
 * Narrow on purpose: the guard has to be on the SAME LINE as the sink. A
 * `__DEV__` check three lines above is a promise about control flow that this
 * gate cannot verify, and it would be the obvious way to smuggle a violation
 * past a rule that accepted it.
 */
const DEV_ONLY = /\b__DEV__\b\s*(?:\?|&&)/;

const files = execFileSync('git', ['ls-files', '-z', ...ROOTS], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean)
  .filter((f) => /\.(?:ts|tsx)$/.test(f))
  // Tests assert on error text on purpose; they are not a user surface.
  .filter((f) => !/(?:^|\/)__tests__\//.test(f) && !/\.test\.tsx?$/.test(f));

/** Strip comments so a doc block explaining the rule cannot trip it. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const violations = [];
const usedExemptions = new Set();

for (const file of files) {
  if (ALLOWED.has(file)) {
    usedExemptions.add(file);
    continue;
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!/\.(?:message|details|hint|stack)\b|String\(|JSON\.stringify\(/.test(text)) continue;

  const lines = stripComments(text).split('\n');
  for (const [i, line] of lines.entries()) {
    if (WAIVER.test(line) || DEV_ONLY.test(line)) continue;
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        violations.push({ file, line: i + 1, why: p.why, id: p.id, text: line.trim().slice(0, 120) });
        break;
      }
    }
  }
}

// An exemption for a file that no longer exists is stale, and a stale exemption
// is a hole nobody is watching. Fail on it the same as a violation.
const stale = [...ALLOWED.keys()].filter((f) => !usedExemptions.has(f));

if (violations.length === 0 && stale.length === 0) {
  console.log(
    `PASS  no guest-facing screen renders a raw server error ` +
      `(${files.length} files, ${ALLOWED.size} documented exemptions).`,
  );
  console.log(
    '      Tripwire on the common shapes, not a proof of absence — the rule is in\n' +
      '      docs/security/security-general.md (SEC-36) and the PR checklist.',
  );
  process.exit(0);
}

if (violations.length > 0) {
  console.error('FAIL  guest-facing code putting a raw server error in front of a person:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.id}] ${v.why}`);
    console.error(`      ${v.text}`);
  }
  console.error(
    '\nMap the error to an i18n key instead — mapErrorToKey (mobile) / rpcErrorKey (web) —\n' +
      'and send the original to the tracker with captureException. If this line genuinely\n' +
      'shows no server text, append a comment "QUIET-ERROR-OK: <reason>".',
  );
}

if (stale.length > 0) {
  console.error('\nFAIL  stale exemptions in ALLOWED — these files no longer exist:\n');
  for (const f of stale) console.error(`  ${f}`);
  console.error('\nRemove them: an exemption nobody can see is a hole nobody is watching.');
}

process.exit(1);
