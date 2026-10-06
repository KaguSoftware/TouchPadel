/**
 * ux-run config loading, shared by serve, crawl and run.
 *
 * Why one loader: config.json holds every threshold, and the per-check blocks are merged
 * over each analyser's own `defaults`, so a new check can ship its defaults in its own
 * module and still be tuned from config.json without touching anything else.
 * Staff-screen exceptions are merged on top of a check's config only for findings on a
 * staff screen (see effectiveCheckConfig).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO_ROOT = path.resolve(SKILL_DIR, '../../..');
export const OUT_DIR = path.join(REPO_ROOT, 'test-results/ux-run');

export function loadConfig() {
  const cfg = JSON.parse(readFileSync(path.join(SKILL_DIR, 'config.json'), 'utf8'));
  const ds = JSON.parse(readFileSync(path.join(SKILL_DIR, 'design-system.json'), 'utf8'));
  cfg.designSystem = ds;
  cfg.baseUrl = `http://${cfg.server.host}:${cfg.server.port}`;
  return cfg;
}

export function isMain(metaUrl) {
  return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? deepMerge(a[k], v) : v;
  return out;
}

/** A check's config: analyser defaults < config.checks[id]; staff overrides on top when staff. */
export function effectiveCheckConfig(cfg, id, defaults = {}, staff = false) {
  const base = deepMerge(defaults, cfg.checks?.[id] ?? {});
  return staff ? deepMerge(base, cfg.staffExceptions?.[id] ?? {}) : base;
}

/** Exempt entries are exact keys or "/regex/flags" strings. */
export function compileMatchers(list = []) {
  return list.map((entry) => {
    const m = /^\/(.*)\/([a-z]*)$/.exec(entry);
    return m ? new RegExp(m[1], m[2]) : entry;
  });
}
export const matchesAny = (value, matchers) =>
  matchers.some((m) => (typeof m === 'string' ? m === value : m.test(value)));

/** Staff screen = pathname matches one of cfg.staffScreens (regex strings). */
export function staffMatcher(cfg) {
  const res = (cfg.staffScreens ?? []).map((s) => new RegExp(s));
  return (pathname) => res.some((re) => re.test(pathname));
}
