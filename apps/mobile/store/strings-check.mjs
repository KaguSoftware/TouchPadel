/**
 * Verify that the store screenshots only say what the app says.
 *
 *   node store/strings-check.mjs      (pnpm --filter @touch/mobile run store:strings-check)
 *
 * 1. COPY. Every in-phone string in frames.mjs — each `t` value whose key is
 *    NOT in `DATA_KEYS` — must equal a value in that locale's catalog
 *    (`packages/i18n/src/catalogs/{en,ar}.ts`), with the catalog's
 *    `{placeholders}` treated as wildcards. A screenshot that shows copy the app
 *    no longer ships fails here instead of in App Review.
 *
 * 2. PALETTE. Every hex in tokens.mjs `dark` / `brand` / `lightGreens` must
 *    equal the same key in `apps/mobile/src/theme/tokens.ts`.
 *
 * The catalogs are TypeScript. They are loaded by transpiling each file with
 * the repo's own `typescript` (types erased, nothing else) and importing the
 * result — the `ws` operator namespace is stubbed out, since no mobile screen
 * uses it and it would drag a dozen more files in.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DATA_KEYS, LOCALES } from './frames.mjs';
import { dark, brand, lightGreens } from './tokens.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = path.resolve(HERE, '..', '..', '..');
const CATALOGS = path.join(REPO, 'packages', 'i18n', 'src', 'catalogs');
const TOKENS_TS = path.join(REPO, 'apps', 'mobile', 'src', 'theme', 'tokens.ts');

const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadCatalog(locale) {
  const src = await fs.readFile(path.join(CATALOGS, `${locale}.ts`), 'utf8');
  const stubbed = src.replace(/^import\s+(?!type\b)[^;]*from\s+'\.\/ws';?\s*$/m, (line) => {
    const name = line.match(/\{\s*(\w+)\s*\}/)?.[1] ?? 'ws';
    return `const ${name} = {};`;
  });
  const { outputText } = ts.transpileModule(stubbed, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  const catalog = mod[locale];
  if (!catalog) throw new Error(`catalogs/${locale}.ts exports no \`${locale}\``);
  return catalog;
}

function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push({ key, value: v });
    else if (v && typeof v === 'object') flatten(v, key, out);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 'Open now · {hours}' → /^Open now · (.{1,40}?)$/. A placeholder stands in for a
 * VALUE — a count, a time, a name — so it is capped at 40 characters; otherwise
 * a bare template like 'Free cancellation until {when}.' would match any
 * sentence that happens to start the same way.
 */
const matcher = (value) =>
  new RegExp(`^${value.split(/\{\w+\}/).map(escapeRe).join('([\\s\\S]{1,40}?)')}$`, 'u');

function checkCopy(locale, conf, catalog, problems) {
  const entries = flatten(catalog).map((e) => ({ ...e, re: matcher(e.value) }));
  let checked = 0;
  for (const [key, value] of Object.entries(conf.t)) {
    if (DATA_KEYS.has(key)) continue;
    if (typeof value !== 'string') {
      problems.push(`${locale}.${key}: not a string — add it to DATA_KEYS if it is data`);
      continue;
    }
    checked += 1;
    const hit = entries.find((e) => e.re.test(value));
    if (!hit) problems.push(`${locale}.${key}: ${JSON.stringify(value)} matches no catalog value`);
  }
  for (const key of DATA_KEYS) {
    if (!(key in conf.t)) problems.push(`${locale}: DATA_KEYS lists "${key}" but t has no such key`);
  }
  return checked;
}

async function checkPalette(problems) {
  const src = await fs.readFile(TOKENS_TS, 'utf8');
  const block = (start) => {
    const i = src.indexOf(start);
    if (i === -1) throw new Error(`tokens.ts: cannot find "${start}"`);
    const body = src.slice(i, src.indexOf('\n  }', i) === -1 ? undefined : src.indexOf('\n  }', i));
    return Object.fromEntries([...body.matchAll(/^\s*(\w+):\s*'(#[0-9A-Fa-f]{6,8})'/gm)].map((m) => [m[1], m[2]]));
  };
  const blockUntil = (start, end) => {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i);
    if (i === -1 || j === -1) throw new Error(`tokens.ts: cannot find "${start}"`);
    return Object.fromEntries(
      [...src.slice(i, j).matchAll(/^\s*(\w+):\s*'(#[0-9A-Fa-f]{6,8})'/gm)].map((m) => [m[1], m[2]]),
    );
  };
  const sets = [
    ['dark', dark, block('  dark: {')],
    ['lightGreens', lightGreens, block('  light: {')],
    ['brand', brand, blockUntil('export const brand = {', '} as const;')],
  ];
  let checked = 0;
  for (const [name, ours, theirs] of sets) {
    for (const [key, hex] of Object.entries(ours)) {
      checked += 1;
      if (!theirs[key]) problems.push(`tokens.mjs ${name}.${key}: no such key in tokens.ts`);
      else if (theirs[key].toUpperCase() !== hex.toUpperCase())
        problems.push(`tokens.mjs ${name}.${key} is ${hex}, tokens.ts has ${theirs[key]}`);
    }
  }
  return checked;
}

async function main() {
  const problems = [];
  let strings = 0;
  for (const [locale, conf] of Object.entries(LOCALES)) {
    strings += checkCopy(locale, conf, await loadCatalog(locale), problems);
  }
  const colours = await checkPalette(problems);

  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s) in the store screenshot pack\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `✓ ${strings} in-phone strings match the catalogs (${DATA_KEYS.size} data keys per locale skipped)\n` +
      `✓ ${colours} palette values match src/theme/tokens.ts`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
