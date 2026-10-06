#!/usr/bin/env node
/**
 * Click depth — fails when any button needs more clicks than the limit to reach
 * from its app's home screen.
 *
 * Two targets, configured in click-depth.config.json:
 *
 *   operator  a real breadth-first Playwright crawl of the staff SPA, signed in
 *             as the seeded owner on the LOCAL Supabase stack (never hosted).
 *             Needs the built app served (see `baseUrl`) and a STORAGE_STATE
 *             produced by scripts/click-depth/operator-auth.mjs.
 *   mobile    a static route-graph check over apps/mobile (Expo has no web
 *             target, so nothing can click it in a browser).
 *
 *   node scripts/click-depth.mjs                    # every target
 *   node scripts/click-depth.mjs --target mobile    # one target
 *
 * Exit 0 when every target passes, 1 on any violation or crawl failure.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { report } from './click-depth/report.mjs';

const CONFIG = fileURLToPath(new URL('../click-depth.config.json', import.meta.url));
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));

const argv = process.argv.slice(2);
const only = argv.includes('--target') ? argv[argv.indexOf('--target') + 1] : undefined;
const names = Object.keys(config.targets).filter((n) => !only || n === only);
if (names.length === 0) {
  console.log(`FAIL  no target named "${only}" in click-depth.config.json`);
  process.exit(1);
}

const RUNNERS = {
  crawl: async () => (await import('./click-depth/operator-crawl.mjs')).crawlTarget,
  static: async () => (await import('./click-depth/mobile-graph.mjs')).analyseMobile,
};

let ok = true;
for (const name of names) {
  const cfg = config.targets[name];
  const run = await RUNNERS[cfg.kind]();
  try {
    ok = report(name, cfg, await run(name, cfg)) && ok;
  } catch (err) {
    console.log(`FAIL  [${name}] the check itself failed: ${err?.stack ?? err}`);
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
