#!/usr/bin/env node
/**
 * ux-run: crawl apps/web (served by scripts/serve.mjs on the LOCAL stack) and run every
 * UX check against the snapshot, printing one report.
 *
 * Why one runner with auto-discovered checks: Majed keeps adding checks. A check is a doc
 * in checks/<id>.md (fixed header, see checks/_TEMPLATE.md) plus, when it can be measured,
 * an analyser in scripts/checks/<id>.mjs exporting
 *   default { id, defaults?, run(snapshot, cfg, ctx) -> findings[] | { findings, info } }
 * Nothing else is edited to add one. A doc without an analyser is a doc-only check: the
 * runner lists it and Claude carries it out by reading the doc, the code and the screenshots.
 *
 *   node .claude/skills/ux-run/scripts/run.mjs [--check id ...] [--no-crawl] [--viewport desktop,phone]
 *
 * Exit: 0 no error-severity finding, 1 errors found (the normal audit outcome), 2 the run
 * itself failed (server not ours or not local, crawl tripped the hosted-host guard, an
 * analyser failed to load, crashed or returned the wrong shape). The other checks still run
 * and print when one analyser fails; its section says CRASH.
 * Writes test-results/ux-run/{snapshot.json, findings.json, report.txt, shots/}. report.txt
 * and findings.json are deleted at start, so a failed run never leaves the previous report
 * behind; the first report line carries this run's timestamp.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileMatchers, effectiveCheckConfig, isMain, loadConfig, matchesAny, OUT_DIR, SKILL_DIR } from './lib/config.mjs';
import { buildSourceIndex } from './lib/source-index.mjs';
import { screenOf, tokensOf, uniqueCards, uniqueElements } from './lib/analysis.mjs';
import { REPO_ROOT } from './lib/config.mjs';

const lines = [];
const out = (s = '') => {
  lines.push(s);
  console.log(s);
};
const RUN_AT = new Date().toISOString();
const REPORT = path.join(OUT_DIR, 'report.txt');
const FINDINGS = path.join(OUT_DIR, 'findings.json');

/** The run itself failed: say so, leave a report that says so (never a stale one), exit 2. */
function fail(msg) {
  out(`FAIL  ${msg}`);
  out(`RESULT  run failed at ${RUN_AT} (exit 2): no audit result. Stop the server and report this line; do not relay an older report.`);
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(REPORT, `${lines.join('\n')}\n`);
  } catch {
    /* best effort */
  }
  process.exit(2);
}

/** One-line error: the message plus the first stack frame, paths relative to the skill. */
function brief(err) {
  const text = String(err?.stack ?? err);
  const [head, ...frames] = text.split('\n');
  const frame = frames.find((f) => f.includes('/scripts/checks/')) ?? frames.find((f) => /\bat\b/.test(f));
  const where = frame ? ` (${frame.trim().replace(/^at\s+/, '').replace(/file:\/\/[^ )]*?\/\.claude\/skills\/ux-run\//g, '').replace(/^.*\((.*)\)$/, '$1')})` : '';
  return `${head}${where}`;
}

/** A finding as every analyser must return it. */
function badFinding(f) {
  if (!f || typeof f !== 'object') return 'a finding is not an object';
  for (const k of ['key', 'message', 'severity', 'viewport']) if (typeof f[k] !== 'string') return `finding.${k} is not a string (${JSON.stringify(f).slice(0, 120)})`;
  if (!['error', 'warn'].includes(f.severity)) return `finding.severity "${f.severity}" is not error|warn`;
  return null;
}

function args() {
  const a = process.argv.slice(2);
  const checks = [];
  let viewports = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--check') checks.push(...a[++i].split(','));
    else if (a[i] === '--viewport') viewports = a[++i].split(',');
  }
  return { checks, viewports, noCrawl: a.includes('--no-crawl') };
}

/** Parse the `---` header of a check doc into a flat object (scalars and [a, b] lists). */
export function parseHeader(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const h = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
    h[kv[1]] = v;
  }
  return h;
}

export async function discoverChecks() {
  const docsDir = path.join(SKILL_DIR, 'checks');
  const anaDir = path.join(SKILL_DIR, 'scripts/checks');
  const docs = readdirSync(docsDir).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
  const analysers = existsSync(anaDir) ? readdirSync(anaDir).filter((f) => f.endsWith('.mjs')).sort() : [];
  const checks = [];
  const problems = [];
  for (const f of docs) {
    const header = parseHeader(readFileSync(path.join(docsDir, f), 'utf8'));
    const id = header?.id ?? f.replace(/\.md$/, '');
    if (!header) problems.push(`checks/${f} has no --- header (see checks/_TEMPLATE.md)`);
    if (header && header.id !== f.replace(/\.md$/, '')) problems.push(`checks/${f}: header id "${header.id}" does not match the file name`);
    const file = path.join(anaDir, `${id}.mjs`);
    let analyser = null;
    let loadError = null;
    if (existsSync(file)) {
      try {
        analyser = (await import(pathToFileURL(file).href)).default;
        if (analyser?.id !== id || typeof analyser.run !== 'function') {
          loadError = `scripts/checks/${id}.mjs must export default { id: '${id}', run() }`;
          analyser = null;
        }
      } catch (err) {
        loadError = `scripts/checks/${id}.mjs failed to load: ${brief(err)}`;
      }
    }
    checks.push({ id, title: header?.title ?? id, header, analyser, loadError, doc: `checks/${f}` });
  }
  for (const f of analysers) {
    const id = f.replace(/\.mjs$/, '');
    if (!docs.includes(`${id}.md`)) problems.push(`scripts/checks/${f} has no checks/${id}.md (every check needs its doc)`);
  }
  return { checks, problems };
}

async function preflightServer(cfg) {
  const pidFile = path.join(OUT_DIR, 'server.json');
  if (!existsSync(pidFile)) {
    throw new Error(`no ux-run server recorded. Start one with "node .claude/skills/ux-run/scripts/serve.mjs start" (never reuse another server: it may be on the hosted env).`);
  }
  const { pid } = JSON.parse(readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid, 0);
  } catch {
    throw new Error(`the recorded ux-run server (pid ${pid}) is not running; start it again with serve.mjs start`);
  }
  const { verifyLocal } = await import('./serve.mjs');
  const res = await fetch(cfg.baseUrl + cfg.server.readyPath, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  if (res.status !== 200) throw new Error(`${cfg.baseUrl}${cfg.server.readyPath} answered ${res.status}`);
  const bad = await verifyLocal(res);
  if (bad) throw new Error(bad);
}

async function dataProbes(cfg) {
  const p = cfg.dataProbes;
  if (!p?.probes?.length) return [];
  const { localAnonKey } = await import('./serve.mjs');
  const key = localAnonKey();
  const call = async (rpc, body) => {
    try {
      const res = await fetch(`${cfg.server.localSupabaseUrl}/rest/v1/rpc/${rpc}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Profile': p.schema, 'Accept-Profile': p.schema },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      let code = null;
      try {
        code = JSON.parse(text)?.code ?? null;
      } catch {
        /* not json */
      }
      return { status: res.status, code };
    } catch (err) {
      return { status: 0, code: err.message };
    }
  };
  const control = await call(p.control.rpc, p.control.args);
  const notes = [];
  if (control.code === 'PGRST202' || control.status === 0) {
    notes.push(`data probe control ${p.control.rpc} failed (${control.code ?? control.status}); data availability unknown`);
    return notes;
  }
  for (const pr of p.probes) {
    const r = await call(pr.rpc, pr.args);
    if (r.code === 'PGRST202') notes.push(`local DB has no ${p.schema}.${pr.rpc} (PGRST202 while ${p.control.rpc} answers): ${pr.affects} render their error/empty state, so those screens are under-audited. Apply the pending migrations to the local stack to audit them.`);
  }
  return notes;
}

async function main() {
  const t0 = Date.now();
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(REPORT, { force: true });
  rmSync(FINDINGS, { force: true });
  const cfg = loadConfig();
  const a = args();
  const { checks, problems } = await discoverChecks();
  const selected = a.checks.length ? checks.filter((c) => a.checks.includes(c.id)) : checks;
  if (a.checks.length && selected.length !== a.checks.length) {
    const known = checks.map((c) => c.id);
    fail(`unknown check(s): ${a.checks.filter((x) => !known.includes(x)).join(', ')} (known: ${known.join(', ')})`);
  }

  let snapshot;
  const notes = [];
  const snapPath = path.join(OUT_DIR, 'snapshot.json');
  if (a.noCrawl) {
    if (!existsSync(snapPath)) fail('--no-crawl but test-results/ux-run/snapshot.json does not exist; run once without it.');
    snapshot = JSON.parse(readFileSync(snapPath, 'utf8'));
    notes.push(`reused the snapshot from ${snapshot.meta.startedAt} (--no-crawl)`);
  } else {
    try {
      await preflightServer(cfg);
    } catch (err) {
      fail(err.message);
    }
    notes.push(...(await dataProbes(cfg)));
    const { runCrawl } = await import('./crawl.mjs');
    try {
      snapshot = await runCrawl(cfg, { only: a.viewports });
    } catch (err) {
      fail(`crawl aborted: ${err.message}`);
    }
    snapshot.meta.dataNotes = notes.slice();
    writeFileSync(snapPath, JSON.stringify(snapshot));
  }
  if (a.noCrawl && snapshot.meta.dataNotes) notes.push(...snapshot.meta.dataNotes);

  const source = buildSourceIndex(REPO_ROOT);
  // Attribute styles only to rules live on each element's page (see page-probe cssSelectors).
  source.setCssSets(Object.assign({}, ...Object.values(snapshot.viewports).map((v) => v.cssSets ?? {})));
  const definedUnion = {};
  for (const vp of Object.values(snapshot.viewports)) {
    for (const [fam, names] of Object.entries(vp.defined ?? {})) definedUnion[fam] = [...new Set([...(definedUnion[fam] ?? []), ...names])];
  }

  const results = [];
  for (const chk of selected) {
    if (chk.loadError) {
      results.push({ chk, crashed: chk.loadError, findings: [], info: [], exempted: 0 });
      continue;
    }
    if (!chk.analyser) {
      results.push({ chk, docOnly: true, findings: [], info: [], exempted: 0 });
      continue;
    }
    const defaults = chk.analyser.defaults ?? {};
    const ccfg = effectiveCheckConfig(cfg, chk.id, defaults, false);
    const ctx = {
      config: cfg,
      ds: cfg.designSystem,
      source,
      snapshotDefined: definedUnion,
      cfgFor: (staff) => effectiveCheckConfig(cfg, chk.id, defaults, staff),
      uniqueElements,
      uniqueCards,
      tokensOf,
      screenOf,
    };
    try {
      let res = await chk.analyser.run(snapshot, ccfg, ctx);
      if (Array.isArray(res)) res = { findings: res, info: [] };
      if (!res || !Array.isArray(res.findings)) throw new Error(`run() must return findings[] or { findings: [], info?: [] } (got ${res === null ? 'null' : typeof res}${res && typeof res === 'object' ? ` with keys ${Object.keys(res).join(',') || 'none'}` : ''})`);
      const info = res.info ?? [];
      if (!Array.isArray(info)) throw new Error('run().info must be an array of strings');
      for (const f of res.findings) {
        const bad = badFinding(f);
        if (bad) throw new Error(bad);
      }
      const exempt = compileMatchers([...(cfg.exempt?.[chk.id] ?? []), ...(ccfg.exempt && Array.isArray(ccfg.exempt) ? ccfg.exempt : [])]);
      const staffEx = cfg.staffExceptions?.[chk.id] ?? {};
      let exempted = 0;
      const kept = [];
      for (const f of res.findings) {
        if (matchesAny(f.key, exempt)) {
          exempted++;
          continue;
        }
        if (f.staff && staffEx.exempt === true) {
          exempted++;
          continue;
        }
        if (f.staff && staffEx.severity) f.severity = staffEx.severity;
        kept.push(f);
      }
      results.push({ chk, findings: kept, info, exempted });
    } catch (err) {
      results.push({ chk, crashed: `analyser ${chk.id} crashed: ${brief(err)}`, findings: [], info: [], exempted: 0 });
    }
  }

  // ---- report ----------------------------------------------------------------
  const vps = Object.entries(snapshot.viewports);
  const states = vps.reduce((n, [, v]) => n + v.states.length, 0);
  const screens = new Set(vps.flatMap(([, v]) => v.states.map((s) => s.pathname)));
  const elements = uniqueElements(snapshot);
  const elemKeys = new Set(elements.map((e) => e.rec.key));
  out(`UX RUN  ${RUN_AT}  apps/web @ ${snapshot.meta.baseUrl}  start ${snapshot.meta.startPath}  crawl depth ${snapshot.meta.maxDepth}`);
  out(`        viewports ${vps.map(([id, v]) => `${id} ${v.viewport.width}x${v.viewport.height} (${v.stats.states} states)`).join(', ')}`);
  out(`        ${elemKeys.size} distinct interactive elements on ${screens.size} pages (${states} screen states); crawl ${snapshot.meta.seconds}s`);
  for (const n of notes) out(`NOTE  ${n}`);
  for (const [id, v] of vps) for (const n of v.notes) out(`NOTE  [${id}] ${n}`);
  for (const p of problems) out(`WARN  ${p}`);
  for (const [id, v] of vps) {
    for (const w of v.blockedWrites ?? []) out(`WARN  [${id}] blocked a local WRITE: ${w}. Nothing was written; add the control that sent it to neverClick in config.json.`);
  }
  const staffScreens = [...new Set(vps.flatMap(([, v]) => v.states.filter((s) => s.staff).map((s) => s.pathname)))];
  if (staffScreens.length) out(`NOTE  staff screens (marked [staff], staffExceptions apply): ${staffScreens.join(', ')}`);
  for (const na of cfg.notAudited ?? []) out(`NOTE  not audited: ${na.path}: ${na.why}`);

  const tally = [];
  for (const r of results) {
    out('');
    out(`== ${r.chk.id} ${'='.repeat(Math.max(3, 70 - r.chk.id.length))}`);
    if (r.crashed) {
      out(`CRASH ${r.crashed}`);
      tally.push(`${r.chk.id} CRASH`);
      continue;
    }
    if (r.docOnly) {
      out(`DOC   no analyser: Claude runs this check by hand from ${r.chk.doc} (screenshots in test-results/ux-run/shots/).`);
      tally.push(`${r.chk.id} DOC`);
      continue;
    }
    // One line per finding; identical findings on both viewports merge into one line
    // (click-depth keeps one line per viewport: the path is the finding).
    const merged = new Map();
    for (const f of r.findings) {
      const k = r.chk.id === 'click-depth' ? `${f.viewport}|${f.key}` : `${f.severity}|${f.key}|${f.message}|${f.staff}`;
      const m = merged.get(k);
      if (m) m.viewports.push(f.viewport);
      else merged.set(k, { ...f, viewports: [f.viewport] });
    }
    const list = [...merged.values()].sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1) || x.key.localeCompare(y.key) || x.message.localeCompare(y.message));
    r.lines = list;
    const errs = list.filter((f) => f.severity === 'error');
    const warns = list.filter((f) => f.severity === 'warn');
    const verdict = errs.length ? 'FAIL' : warns.length ? 'WARN' : 'PASS';
    out(`${verdict.padEnd(5)} ${errs.length} error(s), ${warns.length} warning(s)${r.exempted ? `, ${r.exempted} exempt` : ''}`);
    for (const i of r.info) out(`      ${i}`);
    if (r.chk.id === 'click-depth') {
      for (const [id, v] of vps) {
        const fs = r.findings.filter((f) => f.viewport === id).sort((x, y) => y.evidence.cost - x.evidence.cost || x.key.localeCompare(y.key));
        if (!fs.length) continue;
        out(`  ${id} ${v.viewport.width}x${v.viewport.height}`);
        for (const f of fs) out(`    ${f.staff ? '[staff] ' : ''}${f.message}`);
      }
    } else {
      for (const f of list) {
        out(`  ${f.severity === 'error' ? 'error' : 'warn '} [${f.viewports.join('+')}] ${f.staff ? '[staff] ' : ''}${f.screen}`);
        out(`        ${f.message.startsWith(f.key) ? '' : `${f.key}: `}${f.message}`);
        if (f.source) out(`        -> ${f.source}`);
      }
    }
    tally.push(`${r.chk.id} ${verdict}${errs.length || warns.length ? ` (${errs.length}e/${warns.length}w)` : ''}`);
  }
  const allErr = results.reduce((n, r) => n + (r.lines ?? []).filter((f) => f.severity === 'error').length, 0);
  const allWarn = results.reduce((n, r) => n + (r.lines ?? []).filter((f) => f.severity === 'warn').length, 0);
  out('');
  out(`SUMMARY  ${tally.join(' | ')}`);
  out(`         ${allErr} error(s), ${allWarn} warning(s); ${elemKeys.size} interactive elements on ${screens.size} pages; ${uniqueCards(snapshot).length} card records; ${((Date.now() - t0) / 1000).toFixed(0)}s total`);
  out(`         raw data: test-results/ux-run/{snapshot.json,findings.json,report.txt,shots/}`);
  const crashed = results.filter((r) => r.crashed);
  const code = crashed.length ? 2 : allErr ? 1 : 0;
  out(
    `RESULT  exit ${code}: ${
      code === 2
        ? `run FAILED: ${crashed.map((r) => r.chk.id).join(', ')} did not run (CRASH above); the other checks' findings stand`
        : code === 1
          ? 'audit complete, error findings present (normal)'
          : 'audit complete, no error findings'
    }`,
  );

  writeFileSync(FINDINGS, JSON.stringify({ runAt: RUN_AT, meta: snapshot.meta, results: results.map((r) => ({ id: r.chk.id, docOnly: !!r.docOnly, crashed: r.crashed ?? null, exempted: r.exempted, info: r.info, findings: r.findings })) }, null, 2));
  writeFileSync(REPORT, `${lines.join('\n')}\n`);
  process.exit(code);
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    fail(`run.mjs crashed: ${brief(err)}`);
  }
}
