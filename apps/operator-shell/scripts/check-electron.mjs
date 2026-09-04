/**
 * Electron hardening regression lock — Security Layer 1, Block 2 (SEC-30).
 *
 * The shell is already hardened: `contextIsolation: true`, `nodeIntegration:
 * false`, `sandbox: true`, a single-file preload bundle, `will-navigate` and
 * `will-redirect` blocked, `setWindowOpenHandler` filtered to https, and
 * `will-attach-webview` denied. (Security Layer 1 lists `sandbox: false` as an
 * open TODO — that is stale; it landed with the esbuild preload bundle.)
 *
 * So this gate does not FIX anything. It stops the hardening being undone,
 * which is a different and more durable job. Every one of these settings has a
 * plausible-sounding reason to be flipped during a debugging session —
 * "contextIsolation was breaking my import", "webSecurity blocks the local
 * file" — and each flip is a one-word diff that reads as harmless in review.
 *
 * What each one costs, on a venue PC nobody administers:
 *
 *   nodeIntegration: true      the renderer gets `require`. An XSS in the
 *                              operator UI becomes arbitrary code on the till.
 *   contextIsolation: false    the preload shares a JS context with the page,
 *                              so page script can reach through `window.touch`
 *                              into the durable queue, the PIN cache and the
 *                              printer.
 *   sandbox: false             the renderer process loses OS-level confinement.
 *   webSecurity: false         same-origin policy off — the renderer can read
 *                              any origin's responses, including the database.
 *   @electron/remote           hands the renderer main-process objects directly;
 *                              it exists to undo exactly this boundary.
 *
 * Scanned as source text rather than by importing the module, because the
 * config is inside a function that needs a real Electron runtime to call.
 *
 * Usage:  node scripts/check-electron.mjs      (exit 1 on any violation)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const APP = path.resolve(import.meta.dirname, '..');
const SRC = path.join(APP, 'src');

const FORBIDDEN = [
  {
    id: 'nodeIntegration',
    re: /\bnodeIntegration\s*:\s*true\b/,
    why: 'gives the renderer `require` — an XSS in the operator UI becomes code execution on the till',
  },
  {
    id: 'contextIsolation',
    re: /\bcontextIsolation\s*:\s*false\b/,
    why: 'lets page script reach through the preload into the durable queue, the PIN cache and the printer',
  },
  {
    id: 'sandbox',
    re: /\bsandbox\s*:\s*false\b/,
    why: 'removes OS-level confinement from the renderer process',
  },
  {
    id: 'webSecurity',
    re: /\bwebSecurity\s*:\s*false\b/,
    why: 'disables the same-origin policy — the renderer can read any origin it can reach',
  },
  {
    id: 'allowRunningInsecureContent',
    re: /\ballowRunningInsecureContent\s*:\s*true\b/,
    why: 'permits http subresources inside the packaged app',
  },
  {
    id: 'experimentalFeatures',
    re: /\bexperimentalFeatures\s*:\s*true\b/,
    why: 'enables unshipped Chromium features that have not been through a security review',
  },
  {
    id: '@electron/remote',
    re: /['"`]@electron\/remote['"`]/,
    why: 'hands main-process objects to the renderer; it exists to undo the context boundary',
  },
];

/**
 * Settings that must be PRESENT. A missing `sandbox` is not the same as
 * `sandbox: false` in the source — but it is the same at runtime once someone
 * deletes the line, and a gate that only looks for `false` would not notice.
 */
const REQUIRED = [
  {
    id: 'contextIsolation: true',
    re: /\bcontextIsolation\s*:\s*true\b/,
    why: 'the boundary between page script and the preload bridge',
  },
  {
    id: 'sandbox: true',
    re: /\bsandbox\s*:\s*true\b/,
    why: 'OS-level renderer confinement; possible since the preload became a single bundle',
  },
  {
    id: 'nodeIntegration: false',
    re: /\bnodeIntegration\s*:\s*false\b/,
    why: 'explicit is better than defaulted — the default has changed across Electron majors',
  },
];

/** Navigation handlers that must remain wired. */
const NAV_GUARDS = [
  { id: "will-navigate", re: /['"`]will-navigate['"`]/, why: 'stops the top-level frame moving to remote content with the preload attached' },
  { id: 'setWindowOpenHandler', re: /\bsetWindowOpenHandler\b/, why: 'filters what is handed to the OS protocol handler via shell.openExternal' },
  { id: 'will-attach-webview', re: /['"`]will-attach-webview['"`]/, why: 'a <webview> carries its own preload and its own privileges' },
];

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) yield p;
  }
}

const files = [...walk(SRC)].filter((f) => !/\.test\.[cm]?tsx?$/.test(f));
const sources = files.map((f) => ({ file: path.relative(APP, f), text: readFileSync(f, 'utf8') }));
// The BrowserWindow config lives in main/; preload and renderer never set it.
const mainSources = sources.filter((s) => s.file.includes(`main${path.sep}`) || s.file.includes('main/'));
const joined = mainSources.map((s) => s.text).join('\n');

const violations = [];
for (const { file, text } of sources) {
  for (const rule of FORBIDDEN) {
    const lines = text.split('\n');
    for (const [i, line] of lines.entries()) {
      // A rule name inside a comment is documentation, not configuration.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (rule.re.test(line)) violations.push({ kind: 'forbidden', rule, file, line: i + 1, text: line.trim() });
    }
  }
}

const missing = [];
for (const rule of [...REQUIRED, ...NAV_GUARDS]) {
  if (!rule.re.test(joined)) missing.push(rule);
}

console.log(`Electron hardening lock — ${sources.length} source files, ${mainSources.length} in main/`);
console.log('');

if (violations.length === 0 && missing.length === 0) {
  console.log('PASS  hardening intact:');
  for (const r of REQUIRED) console.log(`        ${r.id}`);
  for (const r of NAV_GUARDS) console.log(`        ${r.id} wired`);
  process.exit(0);
}

if (violations.length > 0) {
  console.error(`FAIL  ${violations.length} forbidden Electron setting(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.rule.id}`);
    console.error(`      ${v.file}:${v.line}   ${v.text}`);
    console.error(`      ${v.rule.why}`);
    console.error('');
  }
}

if (missing.length > 0) {
  console.error(`FAIL  ${missing.length} required hardening setting(s) MISSING from main/:\n`);
  for (const m of missing) {
    console.error(`  ${m.id}`);
    console.error(`      ${m.why}`);
    console.error('');
  }
  console.error('A deleted line is as dangerous as an inverted one — Electron defaults have');
  console.error('changed across majors, so every one of these must be stated explicitly.');
}

process.exit(1);
