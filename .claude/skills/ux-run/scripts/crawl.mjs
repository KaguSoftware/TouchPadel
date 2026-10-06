#!/usr/bin/env node
/**
 * ux-run crawl: one breadth-first Playwright crawl of apps/web per viewport, recording
 * everything the checks judge. It writes test-results/ux-run/snapshot.json.
 *
 * Why a crawl and not a route list: the site's depth and size problems live in sheets,
 * dialogs, accordions and tabs as well as pages (the phone header sheet, the café item
 * sheet and basket). Clicking is the only way to find them.
 *
 * Model (adapted from the abandoned operator click-depth crawler)
 *   - A STATE is a pathname plus the set of element keys a person could press there. Two
 *     click paths that end in the same pathname and key set are one state, visited once.
 *     crawl.volatile controls (the café FABs, which show or hide with scroll direction) are
 *     recorded but left out of the state id, so scroll position never mints a new state.
 *   - Roots: cfg.startPath is the click-depth root (depth 0; an element visible on it,
 *     anywhere after scrolling, costs 1 click). cfg.seedPaths are pages the site does not
 *     link (staff download page, payment return, 404, the /ar pass). They are crawled as
 *     extra roots for the size and consistency checks only, in their own scope, so a seed
 *     never makes a page look shallower than it is from home.
 *   - States are revisited by REPLAYING their click path in a fresh browser context
 *     (cookies, localStorage and the basket all start clean), never by "going back".
 *     Escape / history.back() is tried first to save a replay, and it only counts when
 *     the state id matches again.
 *   - Opening a sheet, dialog, accordion or tab is a click that leads to a new state.
 *   - Expansion stops at maxDepth (the larger of click-depth's maxClicks and the staff
 *     exception's), but states AT that depth are still recorded, so an element first
 *     seen there is recorded at maxDepth + 1 and the violation is caught.
 *
 * Pruning (each one stated, so a reader can judge the numbers)
 *   - A same-origin link is expanded once per (scope, URL); a button once per
 *     (scope, pathname, layer, key). Toggles are not combined with each other.
 *   - cfg.groups: a repeated list (menu items, category pills) shares one key; only
 *     `sample` members are pressed. Every member is still recorded for the size checks.
 *   - cfg.neverClick, disabled controls, external links, form fields: recorded, not pressed.
 *   - cfg.crawl.maxStates / maxMinutes end the crawl early with a NOTE listing what was dropped.
 *
 * Settling: DOM quiet for settleQuietMs (MutationObserver; canvas ignored) with none of the
 * page's own document/script/fetch requests in flight, capped. Never networkidle (dev HMR
 * and realtime sockets keep the network busy).
 *
 * SAFETY: every request whose host is not in network.allowedHosts is aborted and listed; a
 * request to a network.fatalHosts host (*.supabase.co, posthog) ends the run with FAIL.
 * The context runs with reducedMotion 'reduce' so [data-reveal] blocks are visible and
 * rects are stable.
 *
 *   node .claude/skills/ux-run/scripts/crawl.mjs [--viewport desktop]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { effectiveCheckConfig, isMain, loadConfig, OUT_DIR, staffMatcher } from './lib/config.mjs';
import { pageProbe } from './lib/page-probe.mjs';

export class FatalError extends Error {}
class ReplayError extends Error {}

const hash = (v) => createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 12);

export async function crawl(cfg, { only = null, log = (m) => console.error(m) } = {}) {
  const c = cfg.crawl;
  const clickCfg = effectiveCheckConfig(cfg, 'click-depth', { maxClicks: 3 });
  const staffClick = cfg.staffExceptions?.['click-depth']?.maxClicks ?? 0;
  const maxDepth = Math.max(clickCfg.maxClicks, staffClick);
  const isStaff = staffMatcher(cfg);
  const allowed = new Set(cfg.network.allowedHosts);
  const fatal = cfg.network.fatalHosts.map((s) => new RegExp(s, 'i'));
  // Local writes the crawl must never make (neverClick should already stop them; this is the
  // net under it). Matched requests to the local stack are aborted and reported as WARN.
  const wg = cfg.network.localWriteGuard ?? {};
  const writeRpc = wg.rpc ? new RegExp(wg.rpc) : null;
  const writePath = wg.paths ? new RegExp(wg.paths) : null;
  const localApi = new Set((cfg.network.localApiHosts ?? []).map((h) => h.toLowerCase()));
  const localWrite = (req) => {
    const u = new URL(req.url());
    if (!localApi.has(u.host.toLowerCase())) return null;
    const method = req.method();
    const rpc = /^\/rest\/v1\/rpc\/([\w]+)/.exec(u.pathname)?.[1];
    if (rpc) return writeRpc && writeRpc.test(rpc) ? `rpc ${rpc}` : null;
    if (/^\/rest\/v1\//.test(u.pathname) && !['GET', 'HEAD', 'OPTIONS'].includes(method)) return `${method} ${u.pathname}`;
    if (writePath && method !== 'GET' && method !== 'OPTIONS' && writePath.test(u.pathname)) return `${method} ${u.pathname}`;
    return null;
  };
  const ds = cfg.designSystem;
  const tokens = Object.fromEntries(
    Object.entries(ds.families).map(([fam, f]) => [
      fam,
      {
        lengths: [...f.tokens.radius, ...f.tokens.fontSize, ...f.tokens.space, ...(f.minTargetToken ? [f.minTargetToken] : [])],
        colors: Object.values(f.tokens.colors),
        fonts: f.tokens.font ?? [],
      },
    ]),
  );
  const probeArgs = {
    selectors: c.selectors,
    recordOnly: c.recordOnly,
    volatile: c.volatile ?? [],
    srOnly: c.srOnly,
    neverSel: cfg.neverClick.selectors,
    neverText: cfg.neverClick.text,
    keyBySelector: cfg.keyBySelector,
    groups: cfg.groups,
    cards: cfg.cards,
    tokens,
  };
  const shotsDir = path.join(OUT_DIR, 'shots');
  if (!only) rmSync(shotsDir, { recursive: true, force: true }); // no stale shots from an older crawl
  const started = Date.now();
  const browser = await chromium.launch();
  const result = { meta: { startedAt: new Date(started).toISOString(), baseUrl: cfg.baseUrl, startPath: cfg.startPath, maxDepth }, viewports: {} };
  try {
    for (const vp of cfg.viewports) {
      if (only && !only.includes(vp.id)) continue;
      log(`ux-run crawl [${vp.id} ${vp.width}x${vp.height}] starting`);
      result.viewports[vp.id] = await crawlViewport(vp);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  result.meta.finishedAt = new Date().toISOString();
  result.meta.seconds = Math.round((Date.now() - started) / 1000);
  return result;

  async function crawlViewport(vp) {
    const t0 = Date.now();
    const deadline = t0 + c.maxMinutes * 60_000;
    const notes = [];
    const blocked = new Map();
    const writes = new Map(); // "rpc create_guest_order" -> {n, where}
    const consoleErrors = new Map();
    // A request to a fatal host fails the run wherever it happens (a lazy image during a
    // screenshot, a goBack reload, the last child of a batch), not only after a press.
    const fatalHost = () => [...blocked.keys()].find((h) => fatal.some((re) => re.test(h))) ?? null;
    const assertNoFatal = () => {
      const bad = fatalHost();
      if (bad) {
        throw new FatalError(
          `the page tried to reach ${bad}. The server is not on the local stack (or analytics is on). ` +
            'Stop it and restart with scripts/serve.mjs; never audit against the hosted project.',
        );
      }
    };
    const roots = [
      { id: 'home', path: cfg.startPath, kind: 'start', expand: maxDepth, scope: 'start' },
      ...(cfg.seedPaths ?? []).map((s) => ({ id: s.path, path: s.path, kind: 'seed', expand: s.expand ?? 0, stayOnPath: !!s.stayOnPath, why: s.why, scope: s.path })),
    ];
    let replays = 0;

    async function newContext() {
      const context = await browser.newContext({
        baseURL: cfg.baseUrl,
        locale: 'en-US',
        viewport: { width: vp.width, height: vp.height },
        isMobile: !!vp.isMobile,
        hasTouch: !!vp.hasTouch,
        deviceScaleFactor: vp.deviceScaleFactor ?? 1,
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        acceptDownloads: false,
      });
      const base = new URL(cfg.baseUrl);
      await context.addCookies((cfg.cookies ?? []).map((k) => ({ name: k.name, value: k.value, domain: base.hostname, path: '/' })));
      await context.addInitScript(installPageHooks);
      const attempts = [];
      await context.route('**/*', (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const w = localWrite(req);
        if (w) {
          let where = '?';
          try {
            where = new URL(req.frame().url()).pathname;
          } catch {
            /* detached frame */
          }
          const rec = writes.get(w) ?? { n: 0, where };
          rec.n++;
          writes.set(w, rec);
          return route.abort('blockedbyclient');
        }
        if (u.protocol === 'data:' || u.protocol === 'blob:' || allowed.has(u.host)) return route.continue();
        attempts.push(u.hostname);
        blocked.set(u.hostname, (blocked.get(u.hostname) ?? 0) + 1);
        return route.abort('blockedbyclient');
      });
      await context.routeWebSocket(
        (u) => !allowed.has(u.host),
        (ws) => {
          const h = new URL(ws.url()).hostname;
          attempts.push(h);
          blocked.set(h, (blocked.get(h) ?? 0) + 1);
          ws.close();
        },
      );
      return { context, attempts };
    }

    function checkFatal() {
      assertNoFatal();
    }

    async function openRoot(root) {
      const { context, attempts } = await newContext();
      const page = await context.newPage();
      page.on('dialog', (d) => void d.dismiss().catch(() => {}));
      page.on('pageerror', (e) => {
        const k = `pageerror: ${String(e.message).split('\n')[0].slice(0, 140)}`;
        consoleErrors.set(k, (consoleErrors.get(k) ?? 0) + 1);
      });
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m
          .text()
          .split('\n')[0]
          .replace(/%[cs]/g, '')
          .replace(/\s*(background|color|font-weight|border-radius):[^]*$/, '')
          .trim()
          .slice(0, 140);
        if (/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(text)) return;
        const k = `console: ${text}`;
        consoleErrors.set(k, (consoleErrors.get(k) ?? 0) + 1);
      });
      const session = { context, page, attempts, inflight: trackRequests(page), root };
      try {
        await page.goto(root.path, { waitUntil: 'domcontentloaded', timeout: c.loadCapMs });
        await settle(session, c.loadCapMs, true);
        checkFatal(session);
        return session;
      } catch (err) {
        await context.close().catch(() => {});
        throw err;
      }
    }

    async function probe(page, full) {
      return page.evaluate(pageProbe, { ...probeArgs, full });
    }

    // A disabled control is part of the state (an enabled basket button is a different screen).
    const stateIdOf = (root, snap) =>
      `${root.scope}\n${snap.pathname}\n${[...new Set(snap.elements.filter((e) => !e.volatile).map((e) => (e.disabled ? `${e.key} (disabled)` : e.key)))].sort().join('\n')}`;

    async function press(session, step) {
      const snap = await probe(session.page, false);
      const el = snap.elements.find((e) => e.clickId === step.clickId);
      if (!el) throw new ReplayError(`"${step.key}" not found on ${snap.pathname}`);
      const handle = await session.page.evaluateHandle((i) => window.__uxEls[i], el.domIndex);
      const before = session.page.url();
      try {
        await handle.asElement().click({ timeout: c.clickTimeoutMs });
      } catch (err) {
        throw new ReplayError(`"${step.key}" could not be clicked (${String(err.message).split('\n')[0]})`);
      } finally {
        await handle.dispose().catch(() => {});
      }
      await session.page.waitForTimeout(80);
      // A navigation gets the page-load budget (compile + hydrate), a toggle the click budget.
      await settle(session, session.page.url() !== before ? c.loadCapMs : c.settleCapMs, false);
      checkFatal(session);
    }

    async function replay(root, steps) {
      replays++;
      const session = await openRoot(root);
      try {
        for (const step of steps) await press(session, step);
        const snap = await probe(session.page, false);
        session.at = stateIdOf(root, snap);
        session.atPath = snap.rawPath;
        return session;
      } catch (err) {
        await session.context.close().catch(() => {});
        throw err;
      }
    }

    async function stepBack(session, child) {
      if (stateIdOf(session.root, child) === session.at) return true;
      if (child.rawPath !== session.atPath) await session.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      else await session.page.keyboard.press('Escape');
      await settle(session, c.settleCapMs, false);
      return stateIdOf(session.root, await probe(session.page, false)) === session.at;
    }

    // Full data per state id, captured by the first worker to stand on that state.
    const fullById = new Map();
    let shots = 0;
    const shotTaken = new Set();
    async function capture(session, light) {
      const id = stateIdOf(session.root, light);
      if (fullById.has(id)) return;
      fullById.set(id, null);
      const full = await probe(session.page, true);
      let shot = null;
      const shotKey = `${session.root.scope}|${full.pathname}|${full.layer}`;
      if (c.screenshots && !shotTaken.has(shotKey) && shots < 80) {
        shotTaken.add(shotKey);
        shots++;
        const name = `${vp.id}/${shotKey.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 90) || 'root'}.png`;
        mkdirSync(path.join(shotsDir, vp.id), { recursive: true });
        await session.page.screenshot({ path: path.join(shotsDir, name), fullPage: full.layer === 'page', scale: 'css', timeout: 15_000 }).catch(() => {});
        shot = `shots/${name}`;
      }
      fullById.set(id, { ...full, shot });
    }

    async function expand(task) {
      const out = [];
      let session = null;
      let here = false;
      try {
        for (const child of task.children) {
          if (Date.now() > deadline) {
            out.push({ skipped: true });
            continue;
          }
          for (let attempt = 0; ; attempt++) {
            try {
              if (!here) {
                await session?.context.close().catch(() => {});
                session = null;
                session = await replay(task.root, task.steps);
                here = true;
              }
              here = false;
              await press(session, child);
              const snap = await probe(session.page, false);
              await capture(session, snap);
              out.push({ snap });
              here = await stepBack(session, snap);
              break;
            } catch (err) {
              if (err instanceof FatalError) throw err;
              here = false;
              if (attempt >= 1) {
                out.push({ error: err });
                break;
              }
            }
          }
        }
      } finally {
        await session?.context.close().catch(() => {});
      }
      assertNoFatal();
      return out;
    }

    // ---- BFS ---------------------------------------------------------------
    const states = new Map(); // stateId -> state record
    const elements = {}; // fp -> element record
    const cards = {}; // fp -> card record
    const tokScopes = {}; // global id -> {family, values}
    const tokIds = new Map();
    const cssSets = {}; // id -> normalised selectors live on that page (see page-probe)
    const cssIds = new Map();
    const cssIdOf = (list) => {
      if (!list) return null;
      const sig = hash(list);
      if (!cssIds.has(sig)) {
        cssIds.set(sig, `css#${sig}`);
        cssSets[`css#${sig}`] = list;
      }
      return cssIds.get(sig);
    };
    const defined = {};
    const expanded = new Set();
    const dropped = [];
    let budgetHit = null;

    const describe = (task) => `[${task.root.id}] ${task.steps.map((s) => s.key).join(' > ') || '(root)'}`;

    function remapTok(full) {
      const map = {};
      for (const [localId, sc] of Object.entries(full.tokScopes ?? {})) {
        const sig = JSON.stringify(sc);
        if (!tokIds.has(sig)) {
          const gid = `${sc.family}#${tokIds.size}`;
          tokIds.set(sig, gid);
          tokScopes[gid] = sc;
        }
        map[localId] = tokIds.get(sig);
      }
      return (id) => (id ? map[id] ?? null : null);
    }

    function record(task, snap, depth) {
      const id = stateIdOf(task.root, snap);
      if (states.has(id)) return [];
      const full = fullById.get(id);
      const stateNo = states.size;
      const st = {
        n: stateNo,
        root: task.root.id,
        rootKind: task.root.kind,
        depth,
        path: task.steps.map((s) => s.key),
        url: snap.rawPath,
        pathname: snap.pathname,
        layer: snap.layer,
        title: snap.title,
        staff: isStaff(snap.rawPath.split('?')[0]),
        elements: [],
        cards: [],
        overlay: full?.overlay ?? snap.overlay ?? null,
        shot: full?.shot ?? null,
        partial: !full,
      };
      if (full) {
        const tok = remapTok(full);
        const css = cssIdOf(full.cssSelectors);
        const seenFp = new Set();
        for (const e of full.elements) {
          const { domIndex, clickId, ...rec } = e;
          rec.tok = tok(rec.tok);
          rec.css = css;
          const fp = hash(rec);
          elements[fp] ??= rec;
          if (!seenFp.has(fp)) st.elements.push(fp);
          seenFp.add(fp);
        }
        for (const k of full.cards) {
          const rec = { ...k, tok: tok(k.tok), css };
          const fp = hash(rec);
          cards[fp] ??= rec;
          if (!st.cards.includes(fp)) st.cards.push(fp);
        }
        for (const [fam, names] of Object.entries(full.defined ?? {})) {
          defined[fam] = [...new Set([...(defined[fam] ?? []), ...names])].sort();
        }
      } else {
        notes.push(`state ${describe(task)} recorded without measurements (full probe missing)`);
        for (const e of snap.elements) {
          const { domIndex, clickId, ...rec } = e;
          const fp = hash(rec);
          elements[fp] ??= rec;
          st.elements.push(fp);
        }
      }
      states.set(id, st);
      if (depth >= task.root.expand) return [];

      const children = [];
      const seenClick = new Set();
      for (const el of snap.elements) {
        if (seenClick.has(el.clickId)) continue;
        seenClick.add(el.clickId);
        if (!el.clickable) continue;
        if (task.root.stayOnPath && el.href) continue;
        const memo = el.href ? `${task.root.scope}|link|${el.href}` : `${task.root.scope}|${snap.pathname}|${snap.layer}|${el.clickId}`;
        if (expanded.has(memo)) continue;
        expanded.add(memo);
        children.push({ clickId: el.clickId, key: el.key });
      }
      return children;
    }

    const batches = (task, children) => {
      const out = [];
      for (let i = 0; i < children.length; i += c.batchSize) out.push({ root: task.root, steps: task.steps, children: children.slice(i, i + c.batchSize) });
      return out;
    };

    // Depth 0: the roots.
    const rootTasks = roots.map((root) => ({ root, steps: [] }));
    // A root that fails to load (a cold dev compile past loadCapMs, say) is retried once,
    // then becomes a NOTE; only a FatalError aborts the crawl.
    const rootSnaps = await pool(rootTasks, c.concurrency, async (task) => {
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        let session = null;
        try {
          session = await openRoot(task.root);
          const snap = await probe(session.page, false);
          await capture(session, snap);
          return { snap };
        } catch (err) {
          if (err instanceof FatalError) throw err;
          lastErr = err;
        } finally {
          await session?.context.close().catch(() => {});
          assertNoFatal();
        }
      }
      return { error: lastErr };
    });
    const startIdx = rootTasks.findIndex((t) => t.root.kind === 'start');
    if (startIdx >= 0 && rootSnaps[startIdx].error) {
      // Without the start page there is no click-depth and no baseline: a failed run, not a NOTE.
      throw new Error(`the start page ${cfg.startPath} failed to load twice: ${rootSnaps[startIdx].error.message.split('\n')[0]}`);
    }
    let frontier = [];
    rootTasks.forEach((task, i) => {
      if (rootSnaps[i].error) notes.push(`root ${task.root.path} failed to load: ${rootSnaps[i].error.message.split('\n')[0]}`);
      else frontier.push(...batches(task, record(task, rootSnaps[i].snap, 0)));
    });
    log(`  depth 0: ${roots.length} roots, ${states.size} states, ${frontier.reduce((n, b) => n + b.children.length, 0)} clicks queued (${s(t0)})`);

    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
      const t1 = Date.now();
      let queued = frontier.reduce((n, b) => n + b.children.length, 0);
      if (states.size + queued > c.maxStates) {
        budgetHit ??= `maxStates (${c.maxStates}) reached at depth ${depth}`;
        let room = Math.max(0, c.maxStates - states.size);
        frontier = frontier.filter((b) => {
          if (room <= 0) {
            b.children.forEach((ch) => dropped.push(describe({ ...b, steps: [...b.steps, ch] })));
            return false;
          }
          b.children.slice(room).forEach((ch) => dropped.push(describe({ ...b, steps: [...b.steps, ch] })));
          b.children = b.children.slice(0, room);
          room -= b.children.length;
          return true;
        });
        queued = frontier.reduce((n, b) => n + b.children.length, 0);
      }
      const before = states.size;
      const results = await pool(frontier, c.concurrency, expand);
      const next = [];
      results.forEach((batch, i) => {
        const parent = frontier[i];
        batch.forEach((res, j) => {
          const task = { root: parent.root, steps: [...parent.steps, parent.children[j]] };
          if (res.skipped) {
            budgetHit ??= `maxMinutes (${c.maxMinutes}) reached at depth ${depth}`;
            dropped.push(describe(task));
            return;
          }
          if (res.error) {
            notes.push(`could not reach ${describe(task)}: ${res.error.message}`);
            return;
          }
          next.push(...batches(task, record(task, res.snap, depth)));
        });
      });
      log(`  depth ${depth}: ${queued} clicks -> ${states.size - before} new states (${s(t1)})`);
      frontier = next;
      assertNoFatal();
    }
    assertNoFatal();

    if (budgetHit) {
      notes.unshift(
        `crawl budget hit: ${budgetHit}; ${dropped.length} click(s) NOT visited: ${dropped.slice(0, 15).join(' | ')}${dropped.length > 15 ? ` | … ${dropped.length - 15} more` : ''}`,
      );
    }
    for (const [h, n] of [...blocked].sort()) notes.push(`aborted ${n} request(s) to non-local host ${h}`);
    const blockedWrites = [...writes].sort().map(([w, r]) => `${w} on ${r.where}${r.n > 1 ? ` (x${r.n})` : ''}`);
    for (const [k, n] of [...consoleErrors].sort()) notes.push(`browser ${k}${n > 1 ? ` (x${n})` : ''}`);
    const overlays = [...states.values()].filter((st) => st.overlay);
    if (overlays.length) notes.push(`Next dev error overlay seen on ${overlays.length} state(s), e.g. ${overlays[0].pathname}: ${overlays[0].overlay}`);

    // Stable state order: by root order, depth, then path.
    const rootOrder = new Map(roots.map((r, i) => [r.id, i]));
    const list = [...states.values()].sort(
      (x, y) => rootOrder.get(x.root) - rootOrder.get(y.root) || x.depth - y.depth || x.path.join('>').localeCompare(y.path.join('>')) || x.url.localeCompare(y.url),
    );
    list.forEach((st, i) => (st.n = i));
    return {
      viewport: vp,
      roots: roots.map(({ id, path: p, kind, expand: e, why }) => ({ id, path: p, kind, expand: e, why: why ?? null })),
      states: list,
      elements,
      cards,
      tokScopes,
      cssSets,
      defined,
      notes,
      blockedWrites,
      stats: { states: list.length, replays, seconds: Math.round((Date.now() - t0) / 1000), budgetHit },
    };
  }
}

const s = (t) => `${((Date.now() - t) / 1000).toFixed(0)}s`;

/** Run `fn` over `items` with at most `n` in flight; results keep item order. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  let fatalErr = null;
  async function worker() {
    while (next < items.length && !fatalErr) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        fatalErr = err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (fatalErr) throw fatalErr;
  return out;
}

function trackRequests(page) {
  const live = new Set();
  const counted = (req) => ['document', 'script', 'fetch', 'xhr', 'stylesheet'].includes(req.resourceType()) && !/webpack-hmr|turbopack-hmr|__nextjs/.test(req.url());
  page.on('request', (r) => counted(r) && live.add(r));
  page.on('requestfinished', (r) => live.delete(r));
  page.on('requestfailed', (r) => live.delete(r));
  return live;
}

/** DOM quiet for settleQuietMs, nothing of ours in flight, the document hydrated. Capped. */
async function settle(session, capMs, firstLoad) {
  const { page, inflight } = session;
  const cfg = settle.cfg;
  const startedAt = Date.now();
  await page.waitForTimeout(firstLoad ? 250 : 60);
  while (Date.now() - startedAt < capMs) {
    const quiet = await page
      .evaluate(
        ({ q, markers }) =>
          document.readyState !== 'loading' &&
          performance.now() - (window.__uxLastMutation ?? 0) >= q &&
          // Every new document waits for its hydration marker (a click can be a full
          // navigation, and pre-hydration markup differs: EventsTicket's aria-disabled).
          (markers.some((m) => document.querySelector(m)) || performance.now() > 8000),
        { q: cfg.settleQuietMs, markers: cfg.hydrationMarkers },
      )
      .catch(() => false);
    if (quiet && inflight.size === 0) return;
    await page.waitForTimeout(60);
  }
}

/** Runs before any app script: analytics off, popups neutralised, mutation clock. */
function installPageHooks() {
  try {
    localStorage.setItem('tp-analytics', 'off');
  } catch {
    /* storage blocked */
  }
  window.print = () => {};
  window.open = () => null;
  window.__uxLastMutation = 0;
  const start = () => {
    new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (!t || t.closest?.('canvas') || t.tagName === 'NEXTJS-PORTAL') continue;
        window.__uxLastMutation = performance.now();
        return;
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

export async function runCrawl(cfg, opts = {}) {
  settle.cfg = cfg.crawl;
  const snap = await crawl(cfg, opts);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'snapshot.json'), JSON.stringify(snap));
  return snap;
}

if (isMain(import.meta.url)) {
  const cfg = loadConfig();
  const i = process.argv.indexOf('--viewport');
  const only = i > 0 ? process.argv[i + 1].split(',') : null;
  try {
    const snap = await runCrawl(cfg, { only });
    for (const [id, v] of Object.entries(snap.viewports)) {
      console.log(`PASS  crawl [${id}] ${v.stats.states} states, ${Object.keys(v.elements).length} element records, ${Object.keys(v.cards).length} card records in ${v.stats.seconds}s`);
      for (const n of v.notes) console.log(`NOTE  [${id}] ${n}`);
    }
  } catch (err) {
    console.log(`FAIL  crawl: ${err.message}`);
    process.exit(2);
  }
}
