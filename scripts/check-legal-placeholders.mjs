#!/usr/bin/env node
/**
 * Legal placeholders — lists every `[FILL: …]` still in the published legal copy.
 *
 * The Privacy Policy, Terms of Service and delete-account pages
 * (packages/i18n/src/catalogs/legal.{en,ar}.ts) name the operating company, its
 * registration, address, privacy email, the court city and the supervision age.
 * Those facts come from the client, so they ship as `[FILL: …]` placeholders
 * until docs/legal/LEGAL-DETAILS-TO-FILL.md is completed.
 *
 * Default: prints what is left and exits 0, so the pages can deploy while the
 * details are gathered. LEGAL_STRICT=1 (or --strict) exits 1 while anything
 * remains — run it that way before any App Store / Google Play submission:
 *
 *   LEGAL_STRICT=1 node scripts/check-legal-placeholders.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILES = ['legal.en.ts', 'legal.ar.ts'].map((name) =>
  fileURLToPath(new URL(`../packages/i18n/src/catalogs/${name}`, import.meta.url)),
);
const strict = process.env.LEGAL_STRICT === '1' || process.argv.includes('--strict');

const found = [];
for (const file of FILES) {
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      // Comments describe the marker; only string values count.
      if (/^\s*(\*|\/\/)/.test(line)) return;
      for (const m of line.matchAll(/\[FILL:[^\]]*\]/g)) {
        found.push(`${file.split(/[\\/]/).slice(-1)[0]}:${i + 1}  ${m[0]}`);
      }
    });
}

if (found.length === 0) {
  console.log('PASS  no [FILL: …] placeholders left in the legal copy.');
  process.exit(0);
}

const head = strict ? 'FAIL' : 'WARN';
console.log(`${head}  ${found.length} legal placeholder(s) still to fill (docs/legal/LEGAL-DETAILS-TO-FILL.md):`);
for (const f of found) console.log(`        ${f}`);
if (strict) {
  console.log('\n      The public legal pages would name no company. Fill them before a store submission.');
  process.exit(1);
}
console.log('\n      Not blocking (set LEGAL_STRICT=1 to make it block).');
