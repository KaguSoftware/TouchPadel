/**
 * Verify the listing copy against App Store Connect's field limits.
 *
 *   node store/copy-check.mjs
 *
 * `docs/store/app-store-listing.md` states a character count in every field
 * heading — `### Subtitle — 29 / 30`. Those numbers are the kind of thing that
 * is right the day it is written and wrong a week later, and a field that is
 * silently over the limit gets TRUNCATED by Apple rather than rejected, so
 * nobody finds out until the listing is live and the sentence stops mid-word.
 *
 * This reads the heading, recounts the fenced block under it, and fails on
 * either a stale number or a real overflow.
 *
 * Counting is by Unicode code point (`[...str].length`), which is what Apple
 * counts. `str.length` would count an Arabic string correctly but would count
 * an emoji or any astral character twice.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DOC = path.resolve(HERE, '..', '..', '..', 'docs', 'store', 'app-store-listing.md');

/** Apple's hard limits, by the field name as it appears in App Store Connect. */
const LIMITS = {
  'App Name': 30,
  Subtitle: 30,
  'Promotional Text': 170,
  Description: 4000,
  Keywords: 100,
  "What's New": 4000,
  Copyright: 100,
};

const count = (s) => [...s].length;

/**
 * `### Subtitle — 29 / 30` followed by a ```-fenced block.
 * Both numbers allow thousands separators — the limits go up to 4,000 and the
 * doc writes them the way a person reads them.
 */
const HEADING = /^### (.+?)(?: — ([\d,]+) \/ ([\d,]+))?\s*$/gm;

const num = (s) => Number(String(s).replace(/,/g, ''));

async function main() {
  // Normalised to LF: the doc is edited on Windows and lands CRLF, which would
  // otherwise defeat every `\n` in the patterns below — silently, by matching
  // nothing at all rather than by erroring.
  const md = (await fs.readFile(DOC, 'utf8')).replace(/\r\n/g, '\n');
  const problems = [];
  const fixes = [];
  let checked = 0;

  for (const m of md.matchAll(HEADING)) {
    const [, rawName, statedRaw, limitRaw] = m;
    const name = rawName.replace(/\s*\(.*\)\s*$/, '').trim();
    const limit = LIMITS[name];
    if (!limit) continue; // URLs, prose sections — nothing to count

    // The first fenced block after this heading is the field's value.
    const after = md.slice(m.index + m[0].length);
    const block = after.match(/```\n([\s\S]*?)\n```/);
    if (!block) {
      problems.push(`${name}: heading has no fenced value block under it`);
      continue;
    }

    checked += 1;
    const actual = count(block[1]);
    const stated = statedRaw ? num(statedRaw) : null;

    if (actual > limit) {
      problems.push(`${name}: ${actual} characters, OVER the ${limit} limit by ${actual - limit}`);
      continue;
    }
    if (limitRaw && num(limitRaw) !== limit) {
      problems.push(`${name}: heading claims a limit of ${limitRaw}, Apple's is ${limit}`);
    }
    if (stated !== null && stated !== actual) {
      fixes.push({ heading: m[0].trim(), name, stated, actual, limit });
    }
  }

  if (checked === 0) {
    console.error(`No countable fields found in ${DOC} — has the heading format changed?`);
    process.exit(1);
  }

  for (const f of fixes) {
    problems.push(
      `${f.name}: heading says ${f.stated}, actual is ${f.actual} — fix the heading to "${f.name} — ${f.actual} / ${f.limit}"`,
    );
  }

  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s) in docs/store/app-store-listing.md\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(`✓ ${checked} listing fields — all within Apple's limits, all counts accurate`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
