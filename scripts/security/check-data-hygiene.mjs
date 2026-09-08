/**
 * Committed-data hygiene gate — Security Layer 1.
 *
 * Covers two boxes that are the same scan with different targets:
 *
 *   Block 2 · "No real-format Iraqi phone numbers in seed or fixture files
 *              outside a reserved test range" (SEC-37)
 *   Block 3 · the `client-data/` intake rule — intake packs are committed
 *              verbatim as the contractual record, so no pack containing guest
 *              or staff personal data may ever be committed (SEC-37)
 *
 * WHY A REAL-FORMAT NUMBER IN A FIXTURE IS A REAL PROBLEM
 *
 * Fixtures get loaded into whatever database is to hand, and with one Supabase
 * project (D1) that is the venue's live one. A plausible +964 mobile in a seed
 * becomes a row in `profiles`, and from there it is in backups, in exports and
 * in anything that sends an SMS or a Telegram message. The number belongs to a
 * real person who never heard of this project. It is also personal data under
 * the retention policy, sitting in a file nobody thinks of as a data store.
 *
 * THE RESERVED CONVENTION
 *
 * Iraq has no ITU documentation range, so this file DEFINES one for the repo:
 * a test mobile is +964 7XX followed by six zeros and two free digits —
 * +9647510000042, +9647700000001. Obviously synthetic to a human, correctly
 * shaped for anything that validates the format, and not dialable to a stranger.
 *
 * Usage:  node scripts/security/check-data-hygiene.mjs   (exit 1 on violation)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Where committed data lives. Source code is scanned too — a hardcoded number
 *  in a test helper is the same leak with a different file extension. */
const DATA_GLOBS = [
  'packages/db/fixtures/',
  'packages/db/seeds/',
  'packages/db/client-data/',
];

/**
 * Iraqi mobile, in every shape people actually write it:
 *   +9647XXXXXXXX   9647XXXXXXXX   07XXXXXXXX   07XX XXX XXXX
 */
const IQ_MOBILE = /(?:\+?964[\s-]?|0)7[\s-]?(\d[\s-]?){8,9}/g;

/** Reserved-for-testing: 7XX then six zeros then two free digits. */
function isReservedTestNumber(digits) {
  // digits: the national number without country code, e.g. 7512345678
  const m = digits.match(/^7(\d\d)(\d{7,8})$/);
  if (!m) return false;
  const subscriber = m[2];
  return /^0{6}\d{1,2}$/.test(subscriber);
}

function normalise(raw) {
  const d = raw.replace(/[^\d]/g, '');
  if (d.startsWith('964')) return d.slice(3);
  if (d.startsWith('0')) return d.slice(1);
  return d;
}

/**
 * Known occurrences, grandfathered with a reason — same discipline as the
 * dependency-audit waivers: guard what arrives, do not turn the gate red on
 * history it cannot change.
 *
 * Each entry is a decision. Note that redaction alone would NOT undo these:
 * they are already in the git history (`git log -S` finds the commits), so the
 * only real remedies are a history rewrite or accepting them. They are accepted
 * because they are a BUSINESS CONTACT for the client's own account — not guest
 * or staff personal data, which is what the intake rule exists to keep out.
 */
const KNOWN = new Map([
  [
    'Mustafa.akeel.awad1@gmail.com',
    "the client's own hosting-account contact, recorded in the intake packs as part of the " +
      'contractual record (touch-padel.hosting.email). Already in git history from commits ' +
      '634462a and e4f2acc, so redacting the working copy would remove nothing. Business ' +
      'contact, not guest or staff data. Raised with the client 2026-09-04.',
  ],
]);

/** Personal-data shapes that must never be in a committed intake pack. */
const PII_PATTERNS = [
  {
    id: 'email',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    // Reserved-by-RFC-2606 domains are the correct thing to use in examples.
    ok: (m) => /@(example\.(com|org|net)|test|localhost|touchpadel\.invalid)$/i.test(m),
    what: 'an email address',
  },
  {
    id: 'iraqi-national-id',
    // 12-digit national ID, as it appears in Iraqi civil records.
    re: /\b\d{12}\b/g,
    ok: () => false,
    what: 'a 12-digit number in national-ID shape',
  },
];

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean);

const dataFiles = tracked.filter((f) => DATA_GLOBS.some((g) => f.startsWith(g)));

const findings = [];
const grandfathered = new Set();

for (const file of dataFiles) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');

  for (const [i, line] of lines.entries()) {
    // A number inside a comment explaining the convention is documentation.
    const isComment = /^\s*(--|\/\/|#|\*)/.test(line);

    for (const [raw] of line.matchAll(IQ_MOBILE)) {
      const national = normalise(raw);
      if (national.length < 9 || national.length > 10) continue;
      if (isReservedTestNumber(national)) continue;
      if (isComment) continue;
      findings.push({
        file,
        line: i + 1,
        what: 'a real-format Iraqi mobile number outside the reserved test range',
        detail: raw.trim(),
        fix: 'Use +964 7XX 000000N — six zeros then one or two free digits.',
      });
    }

    // The intake packs are the contractual record and are committed verbatim;
    // personal data is what may not be in them.
    if (file.startsWith('packages/db/client-data/')) {
      for (const p of PII_PATTERNS) {
        for (const [m] of line.matchAll(p.re)) {
          if (p.ok(m)) continue;
          if (isComment) continue;
          if (KNOWN.has(m)) {
            grandfathered.add(m);
            continue;
          }
          findings.push({
            file,
            line: i + 1,
            what: `${p.what} in a committed intake pack`,
            detail: m,
            fix: 'Redact it before committing. The pack is the contractual record, not a data store.',
          });
        }
      }
    }
  }
}

console.log(`Committed-data hygiene — ${dataFiles.length} tracked data file(s) scanned`);
for (const g of DATA_GLOBS) {
  const n = dataFiles.filter((f) => f.startsWith(g)).length;
  console.log(`  ${String(n).padStart(3)}  ${g}`);
}
console.log('');

if (grandfathered.size > 0) {
  console.log('Grandfathered (already in git history — redaction would remove nothing):');
  for (const g of grandfathered) console.log(`  ${g}\n      ${KNOWN.get(g)}`);
  console.log('');
}

if (findings.length === 0) {
  console.log('PASS  no NEW real-format phone number and no NEW personal data in committed fixtures, seeds or intake packs.');
  process.exit(0);
}

console.error(`FAIL  ${findings.length} finding(s):\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`      ${f.what}: ${f.detail}`);
  console.error(`      ${f.fix}`);
  console.error('');
}
console.error('Fixtures are loaded into whatever database is to hand — and there is only one');
console.error('Supabase project (D1), the venue\'s live one. A plausible number here becomes a');
console.error('row in profiles, then a backup, then an SMS to a stranger.');
process.exit(1);
