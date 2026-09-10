#!/usr/bin/env node
/**
 * Copy the brand faces from their canonical home into the places each bundler
 * can actually reach.
 *
 *   packages/ui/fonts/lama/woff2  →  apps/web/public/fonts/lama       (Next.js)
 *                                 →  apps/operator/public/fonts/lama  (Vite)
 *   packages/ui/fonts/lama/ttf    →  apps/mobile/assets/fonts         (Metro/expo-font)
 *
 * The copies are COMMITTED, not generated at build time: Next has no asset
 * copy step of its own, Metro will not follow a workspace package for a binary
 * asset under pnpm's symlinked layout, and a font that only exists after a
 * predev hook is a font that is missing in CI. `--check` re-verifies the copies
 * byte for byte and exits non-zero on drift, so a face updated in one place and
 * not the others fails the build instead of shipping two typefaces.
 *
 *   pnpm fonts:sync    copy
 *   pnpm fonts:check   verify (CI)
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'packages/ui/fonts/lama');

/** [source subdir, extension, destinations…] */
const ROUTES = [
  ['woff2', '.woff2', ['apps/web/public/fonts/lama', 'apps/operator/public/fonts/lama']],
  ['ttf', '.ttf', ['apps/mobile/assets/fonts']],
];

const check = process.argv.includes('--check');
const digest = (buf) => createHash('sha256').update(buf).digest('hex');

let copied = 0;
const drift = [];

/** subdir → the faces found there, listed up front so the formats can be compared. */
const listings = new Map();
for (const [subdir, ext] of ROUTES) {
  const srcDir = join(SRC, subdir);
  const files = (await readdir(srcDir)).filter((f) => f.endsWith(ext)).sort();
  if (files.length === 0) throw new Error(`no ${ext} faces in ${relative(ROOT, srcDir)}`);
  listings.set(subdir, files);
}

// A weight is only really in the family once every format carries it: the web
// surfaces reach for the woff2 and Metro for the ttf, so a face dropped into one
// canonical subdir and not the other leaves the family a weight thinner on mobile
// than on web. Every per-format copy below would still be byte-perfect in that
// state, so this comparison is the only thing standing between a half-added
// weight and a merge.
const byFormat = ROUTES.map(([subdir, ext]) => [
  subdir,
  ext,
  new Set(listings.get(subdir).map((f) => f.slice(0, -ext.length))),
]);
const everyFace = [...new Set(byFormat.flatMap(([, , stems]) => [...stems]))].sort();
for (const [subdir, ext, stems] of byFormat) {
  for (const stem of everyFace) {
    if (stems.has(stem)) continue;
    drift.push(
      `${relative(ROOT, join(SRC, subdir, stem + ext))} is missing — ${stem} exists in another format`,
    );
  }
}

for (const [subdir, ext, destDirs] of ROUTES) {
  const srcDir = join(SRC, subdir);
  const files = listings.get(subdir);

  for (const destDir of destDirs) {
    const absDest = join(ROOT, destDir);
    if (!check) await mkdir(absDest, { recursive: true });

    // Stale faces are drift too: a renamed weight left behind in one app is
    // still served, and something will eventually reference it.
    const present = new Set(
      (await readdir(absDest).catch(() => [])).filter((f) => f.endsWith(ext)),
    );

    for (const file of files) {
      const from = join(srcDir, file);
      const to = join(absDest, file);
      const want = await readFile(from);
      present.delete(file);
      const have = await readFile(to).catch(() => null);
      if (have && digest(have) === digest(want)) continue;
      if (check) {
        drift.push(
          `${relative(ROOT, to)} ${have ? 'differs from' : 'is missing next to'} ${relative(ROOT, from)}`,
        );
        continue;
      }
      await writeFile(to, want);
      copied += 1;
    }

    for (const stale of present) {
      drift.push(
        `${relative(ROOT, join(absDest, stale))} is not in ${relative(ROOT, srcDir)} — delete it`,
      );
    }
  }
}

if (check) {
  if (drift.length > 0) {
    console.error('Brand fonts are out of sync with packages/ui/fonts/lama:');
    for (const line of drift) console.error(`  • ${line}`);
    console.error('\nRun `pnpm fonts:sync` and commit the result.');
    process.exit(1);
  }
  console.log('Brand fonts in sync.');
} else {
  if (drift.length > 0) for (const line of drift) console.warn(`  ! ${line}`);
  console.log(`Brand fonts synced (${copied} file${copied === 1 ? '' : 's'} written).`);
}
