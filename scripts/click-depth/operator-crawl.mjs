/**
 * Click depth, operator target — a breadth-first Playwright crawl of the staff SPA.
 *
 * Why a real crawl and not a route table: the operator's depth problems live in
 * dialogs, drawers, tabs, rail sections and "More" menus, none of which are
 * routes. Only clicking finds them. The crawl signs in as the seeded owner (the
 * role that can enter every workspace) on the LOCAL stack and answers one
 * question per button: what is the fewest clicks from a workspace's home screen
 * to a screen where it can be pressed?
 *
 * Model
 *   - A STATE is what the page shows after a click path: its pathname plus the
 *     set of element keys a person could press there. Two paths that end in the
 *     same pathname + key set are the same state, visited once.
 *   - Every cfg.startStates entry is a depth-0 root (one per owner workspace):
 *     switching workspace costs no click, by the owner's decision, so an
 *     element's cost is its minimum over all roots. An element visible on a
 *     root costs 1; one first seen in a state d clicks deep costs d + 1.
 *   - Opening a modal, a dropdown or a tab is just a click whose result is a
 *     new state.
 *   - States are revisited by REPLAYING their click path in a fresh browser
 *     context (STORAGE_STATE + the root's localStorage), never by "going back":
 *     an SPA has too much in-memory state for back to mean the same screen.
 *
 * Pruning (each one stated, so a reader can judge what the numbers mean)
 *   - Links: an internal <a href> lands on the same screen wherever it was
 *     clicked, so each (root, target URL) is expanded once.
 *   - Buttons: a click on key K, on pathname P, in the same top layer (the page,
 *     or one specific dialog and its content) leads to the same state, so each
 *     (root, P, layer, K) is expanded once. In-page toggles (tabs, accordions,
 *     filters) are therefore not combined with each other: what each one
 *     reveals is reached through the shallowest single path to it.
 *   - Repeated rows: duplicate keys in one state are one logical button (every
 *     "Edit" in a table opens the same dialog); the first is clicked.
 *   - cfg.neverClick: anything that writes or ends the session is RECORDED at
 *     its cost but never pressed.
 *   - cfg.maxStates / cfg.maxMinutes end the crawl early, always with a NOTE
 *     that lists what was dropped.
 *
 * Settling: after a load or a click the crawl waits until the DOM has been
 * quiet for cfg.settleQuietMs (canvas mutations ignored — the live floor's
 * three.js scene animates forever), no app/API request is in flight and no
 * skeleton is showing, capped at cfg.settleCapMs. Never networkidle: realtime
 * websockets and polling keep the network busy for as long as the page lives.
 *
 * SAFETY: every request whose host is not localhost/127.0.0.1 is aborted and
 * counted; a root load that so much as tries a *.supabase.co host throws (that
 * build is pointed at the hosted project). Writes are avoided by neverClick,
 * and window.print/window.open/confirm are neutralised.
 */
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { assertLocal, startTillHeartbeat } from './operator-auth.mjs';

const DEFAULTS = {
  selectors: [
    'button',
    'a[href]',
    '[role=button]',
    '[role=menuitem]',
    '[role=tab]',
    '[role=combobox]',
    '[role=option]',
    '[role=switch]',
    '[role=checkbox]',
    '[role=menuitemradio]',
    '[role=menuitemcheckbox]',
    'summary',
  ],
  concurrency: 4,
  maxStates: 3000,
  maxMinutes: 14,
  viewport: { width: 1440, height: 900 },
  settleQuietMs: 350,
  settleCapMs: 3000,
  loadCapMs: 15000,
  clickTimeoutMs: 4000,
  batchSize: 8,
  repeatMin: 6,
  repeatClick: 1,
  memoAcrossWorkspaces: true,
  neverClickSubmit: true,
  neverClickKinds: ['danger'],
  neverClickDialogKinds: ['primary', 'danger'],
};

const isLocalHost = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

export async function crawlTarget(name, cfg) {
  const opts = { ...DEFAULTS, ...cfg };
  const storagePath = process.env.STORAGE_STATE;
  if (!storagePath || !existsSync(storagePath)) {
    throw new Error(
      'STORAGE_STATE must name the owner session file. Make one with ' +
        '`node scripts/click-depth/operator-auth.mjs` (against the served build) and pass ' +
        'STORAGE_STATE=test-results/click-depth/owner.json.',
    );
  }
  assertLocal(opts.baseUrl);
  if (!opts.startStates?.length) throw new Error(`targets.${name}.startStates is empty`);

  const storageState = JSON.parse(readFileSync(storagePath, 'utf8'));
  const neverClick = (opts.neverClick ?? []).map((s) => new RegExp(s, 'i'));
  const blocked = new Map(); // external host -> aborted request count
  const notes = [];
  const started = Date.now();
  const deadline = started + opts.maxMinutes * 60_000;
  const log = (msg) => console.error(`click-depth [${name}] ${msg}`);
  const trace = process.env.CLICK_DEPTH_TRACE === '1';
  let replays = 0;

  // A stale till beat flips the venue to degraded mid-crawl, and every screen
  // grows a banner: keep the beats fresh for as long as the crawl runs.
  const stopBeat = startTillHeartbeat();
  const browser = await chromium.launch();

  /** Fresh context for one root, with every non-local request aborted. */
  async function newContext(root) {
    const context = await browser.newContext({
      storageState,
      locale: 'en-US',
      viewport: opts.viewport,
      reducedMotion: 'reduce',
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    const ls = { ...(root.localStorage ?? {}), 'touch-operator-locale': 'en' };
    await context.addInitScript(installPageHooks, ls);
    const attempts = [];
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'data:' || url.protocol === 'blob:' || isLocalHost(url.hostname)) return route.continue();
      attempts.push(url.hostname);
      blocked.set(url.hostname, (blocked.get(url.hostname) ?? 0) + 1);
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket(
      (url) => !isLocalHost(url.hostname),
      (ws) => {
        const host = new URL(ws.url()).hostname;
        attempts.push(host);
        blocked.set(host, (blocked.get(host) ?? 0) + 1);
        ws.close();
      },
    );
    return { context, attempts };
  }

  /** Open a root in a fresh context and wait for it to settle. */
  async function openRoot(rootIndex) {
    const root = opts.startStates[rootIndex];
    const { context, attempts } = await newContext(root);
    const page = await context.newPage();
    page.on('dialog', (d) => void d.dismiss().catch(() => {}));
    const session = { context, page, inflight: trackRequests(page), quietMs: opts.settleQuietMs };
    try {
      await page.goto(new URL(root.path ?? opts.startPath, opts.baseUrl).href, { waitUntil: 'domcontentloaded' });
      await settle(session, opts.loadCapMs, true);
      const hosted = attempts.find((h) => /\.supabase\.(co|in)$/.test(h));
      if (hosted) {
        throw new FatalError(
          `the served operator build tried to reach ${hosted} on first load. It was built against the ` +
            'HOSTED project: rebuild with VITE_SUPABASE_URL=http://127.0.0.1:54321 (see operator-auth.mjs).',
        );
      }
      return session;
    } catch (err) {
      await context.close().catch(() => {});
      throw err;
    }
  }

  /** Press the first element with this clickId on the current screen, then settle. */
  async function press(session, step) {
    const snap = await snapshot(session.page, opts.selectors);
    const el = snap.elements.find((e) => e.clickId === step.clickId);
    if (!el) throw new ReplayError(`"${step.key}" not on ${snap.pathname}`);
    const handle = await session.page.evaluateHandle((i) => window.__cdEls[i], el.domIndex);
    try {
      await handle.asElement().click({ timeout: opts.clickTimeoutMs });
    } catch (err) {
      throw new ReplayError(`"${step.key}" could not be clicked (${String(err.message).split('\n')[0]})`);
    } finally {
      await handle.dispose().catch(() => {});
    }
    await settle(session, opts.settleCapMs, false);
  }

  /** A fresh context standing on the state `steps` leads to. */
  async function replay(rootIndex, steps) {
    replays++;
    const session = await openRoot(rootIndex);
    try {
      for (const step of steps) await press(session, step);
      const snap = await snapshot(session.page, opts.selectors);
      session.at = stateIdOf(snap);
      session.atPath = snap.rawPath;
      return session;
    } catch (err) {
      await session.context.close().catch(() => {});
      throw err;
    }
  }

  /**
   * After a child click, try to get back to the parent without a replay:
   * history.back() when the click navigated, Escape when it opened something
   * on the same screen. It only counts when the screen's state id matches the
   * parent's again, so a step back that lands anywhere else costs a replay,
   * never a wrong answer.
   */
  async function stepBack(session, child) {
    if (stateIdOf(child) === session.at) return true;
    if (child.rawPath !== session.atPath) await session.page.evaluate(() => history.back());
    else await session.page.keyboard.press('Escape');
    await settle(session, opts.settleCapMs, false);
    return stateIdOf(await snapshot(session.page, opts.selectors)) === session.at;
  }

  /**
   * One unit of work: stand on a parent state and press each of its children
   * in turn. A replay happens only when the session is not (or no longer) on
   * the parent; a failed child is retried once from a fresh replay.
   */
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
        if (trace) log(`visit ${describe({ ...task, steps: [...task.steps, child] }, opts)}`);
        for (let attempt = 0; ; attempt++) {
          try {
            if (!here) {
              await session?.context.close().catch(() => {});
              session = null;
              session = await replay(task.rootIndex, task.steps);
              here = true;
            }
            here = false;
            await press(session, child);
            const snap = await snapshot(session.page, opts.selectors);
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
    return out;
  }

  // ---- BFS -----------------------------------------------------------------
  const states = new Map(); // stateId -> depth
  const elements = new Map(); // key -> { cost, path }
  const expanded = new Set(); // memo keys already queued (see Pruning)
  const dropped = [];
  let budgetHit = null;

  /**
   * Record one visited state at `depth` and return the clicks worth trying
   * from it (as child steps), or [] when it was seen before.
   */
  function record(task, snap, depth, counters) {
    const id = stateIdOf(snap);
    if (states.has(id)) return [];
    states.set(id, depth);
    counters.fresh++;

    const prefix = `[${opts.startStates[task.rootIndex].name}]`;
    const trail = task.steps.map((s, n) => (n === 0 ? `${prefix} ${s.key}` : s.key));
    for (const el of snap.elements) {
      const prev = elements.get(el.key);
      if (prev && prev.cost <= depth + 1) continue;
      if (!prev) counters.newEls++;
      elements.set(el.key, { cost: depth + 1, path: trail.length ? [...trail, el.key] : [`${prefix} ${el.key}`] });
    }
    if (depth >= opts.maxClicks) return [];

    // Repeated siblings (one structure, many rows) are a list: press only the
    // first `repeatClick` of each. Links and tabs are never folded — every
    // link is its own destination (and memoised by URL), every tab its own panel.
    const unique = [];
    const seen = new Set();
    for (const el of snap.elements) {
      if (seen.has(el.clickId)) continue;
      seen.add(el.clickId);
      unique.push(el);
    }
    const groupSize = new Map();
    for (const el of unique) if (el.foldable) groupSize.set(el.sig, (groupSize.get(el.sig) ?? 0) + 1);
    const pressedInGroup = new Map();

    const children = [];
    for (const el of unique) {
      if (!el.clickable) continue;
      if (neverClick.some((re) => re.test(el.key) || re.test(el.label))) continue;
      // A form's submit, a destructive button anywhere, and a dialog's
      // committing button: each writes, so each is recorded, not pressed.
      if (opts.neverClickSubmit && el.submit) continue;
      if (el.kind && opts.neverClickKinds.includes(el.kind)) continue;
      if (el.inLayer && el.kind && opts.neverClickDialogKinds.includes(el.kind)) continue;
      if (el.foldable && groupSize.get(el.sig) >= opts.repeatMin) {
        const n = pressedInGroup.get(el.sig) ?? 0;
        if (n >= opts.repeatClick) continue;
        pressedInGroup.set(el.sig, n + 1);
      }
      const scope = opts.memoAcrossWorkspaces ? '*' : task.rootIndex;
      const memo = el.href ? `${scope}|link|${el.href}` : `${scope}|${snap.pathname}|${snap.layer}|${el.clickId}`;
      if (expanded.has(memo)) continue;
      expanded.add(memo);
      children.push({ clickId: el.clickId, key: el.key });
    }
    return children;
  }

  /** Children of one parent, cut into batches so the pool stays balanced. */
  function batches(task, children) {
    const out = [];
    for (let i = 0; i < children.length; i += opts.batchSize) {
      out.push({ rootIndex: task.rootIndex, steps: task.steps, children: children.slice(i, i + opts.batchSize) });
    }
    return out;
  }

  try {
    // Depth 0: the roots themselves.
    let t0 = Date.now();
    const counters = { fresh: 0, newEls: 0 };
    const roots = opts.startStates.map((_, rootIndex) => ({ rootIndex, steps: [] }));
    const rootSnaps = await pool(roots, opts.concurrency, async (task) => {
      const session = await openRoot(task.rootIndex);
      try {
        return await snapshot(session.page, opts.selectors);
      } finally {
        await session.context.close().catch(() => {});
      }
    });
    let frontier = [];
    roots.forEach((task, i) => frontier.push(...batches(task, record(task, rootSnaps[i], 0, counters))));
    log(`depth 0: ${roots.length} roots, ${counters.newEls} elements, ${frontier.reduce((n, b) => n + b.children.length, 0)} clicks queued (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

    for (let depth = 1; depth <= opts.maxClicks && frontier.length; depth++) {
      t0 = Date.now();
      let queued = frontier.reduce((n, b) => n + b.children.length, 0);
      if (states.size + queued > opts.maxStates) {
        budgetHit ??= `maxStates (${opts.maxStates}) reached at depth ${depth}`;
        let room = Math.max(0, opts.maxStates - states.size);
        frontier = frontier.filter((b) => {
          if (room <= 0) {
            b.children.forEach((c) => dropped.push(describe({ ...b, steps: [...b.steps, c] }, opts)));
            return false;
          }
          b.children.slice(room).forEach((c) => dropped.push(describe({ ...b, steps: [...b.steps, c] }, opts)));
          b.children = b.children.slice(0, room);
          room -= b.children.length;
          return true;
        });
        queued = frontier.reduce((n, b) => n + b.children.length, 0);
      }
      const results = await pool(frontier, opts.concurrency, expand);
      const counters = { fresh: 0, newEls: 0 };
      const next = [];
      results.forEach((batch, i) => {
        const parent = frontier[i];
        batch.forEach((res, j) => {
          const task = { rootIndex: parent.rootIndex, steps: [...parent.steps, parent.children[j]] };
          if (res.skipped) {
            budgetHit ??= `maxMinutes (${opts.maxMinutes}) reached at depth ${depth}`;
            return dropped.push(describe(task, opts));
          }
          if (res.error) return notes.push(`dropped ${describe(task, opts)}: ${res.error.message}`);
          next.push(...batches(task, record(task, res.snap, depth, counters)));
        });
      });
      log(
        `depth ${depth}: ${queued} clicks -> ${counters.fresh} new states, ${counters.newEls} new elements ` +
          `(${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
      frontier = next;
    }
  } finally {
    stopBeat();
    await browser.close().catch(() => {});
  }

  if (budgetHit) {
    notes.unshift(
      `crawl budget hit: ${budgetHit}; ${dropped.length} state(s) NOT visited, so anything only behind them is ` +
        `unmeasured: ${dropped.slice(0, 25).join(' | ')}${dropped.length > 25 ? ` | … ${dropped.length - 25} more` : ''}`,
    );
  }
  for (const [host, n] of [...blocked].sort()) notes.push(`aborted ${n} request(s) to external host ${host}`);
  notes.push(
    `crawled ${states.size} states in ${((Date.now() - started) / 60_000).toFixed(1)} min ` +
      `(${replays} replays, concurrency ${opts.concurrency}, maxClicks ${opts.maxClicks})`,
  );

  return {
    elements: [...elements].map(([key, v]) => ({ key, cost: v.cost, path: v.path })),
    screens: states.size,
    notes,
  };
}

class ReplayError extends Error {}
/** A state is its pathname plus the set of keys a person could press there. */
function stateIdOf(snap) {
  return `${snap.pathname}\n${[...new Set(snap.elements.map((e) => e.key))].sort().join('\n')}`;
}

class FatalError extends Error {}

function describe(task, opts) {
  const root = `[${opts.startStates[task.rootIndex].name}]`;
  return task.steps.length ? `${root} ${task.steps.map((s) => s.key).join(' > ')}` : root;
}

/** Run `fn` over `items` with at most `n` in flight; results keep item order. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  let fatal = null;
  async function worker() {
    while (next < items.length && !fatal) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        fatal = err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (fatal) throw fatal;
  return out;
}

/** Count the page's own HTTP traffic (documents, scripts, fetch/xhr) still in flight. */
function trackRequests(page) {
  const live = new Set();
  const counted = (req) => ['document', 'script', 'fetch', 'xhr', 'stylesheet'].includes(req.resourceType());
  page.on('request', (r) => counted(r) && live.add(r));
  page.on('requestfinished', (r) => live.delete(r));
  page.on('requestfailed', (r) => live.delete(r));
  return live;
}

/**
 * Wait for: DOM quiet for settleQuietMs, nothing in flight, no skeleton, the
 * app mounted. Capped, because some screens tick (clocks, countdowns) for ever.
 */
async function settle(session, capMs, firstLoad) {
  const { page, inflight, quietMs } = session;
  const startedAt = Date.now();
  // A route change re-renders after the click returns; give it a frame first.
  await page.waitForTimeout(firstLoad ? 300 : 50);
  while (Date.now() - startedAt < capMs) {
    const quiet = await page
      .evaluate(
        (q) =>
          document.readyState !== 'loading' &&
          performance.now() - (window.__cdLastMutation ?? 0) >= q &&
          !document.querySelector('.tp-skel') &&
          !!document.querySelector('#root > *'),
        quietMs,
      )
      .catch(() => false);
    if (quiet && inflight.size === 0) return;
    await page.waitForTimeout(60);
  }
}

/** Runs in every page before any app script: storage, stubs, mutation clock. */
function installPageHooks(ls) {
  try {
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
  window.print = () => {};
  window.open = () => null;
  window.__cdLastMutation = 0;
  const start = () => {
    new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (!t || t.closest?.('canvas')) continue;
        window.__cdLastMutation = performance.now();
        return;
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

/**
 * Everything a person could press right now, in DOM order, with stable keys.
 * Stashes the elements on window.__cdEls so the caller can click one by index.
 */
function snapshot(page, selectors) {
  return page.evaluate((sel) => {
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const norm = (s, max = 60) => {
      const out = String(s ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(UUID, ':id')
        // A figure is one token whatever its size or sign ("+12,500.5" and
        // "-3" both read :n), so a changed total does not re-key its button.
        .replace(/[+\-\u2212]?\d[\d,.]*%?/g, ':n');
      return out.length > max ? `${out.slice(0, max - 1)}…` : out;
    };
    const normPath = (p) => p.replace(UUID, ':id').replace(/\d+/g, ':n');
    const hash = (s) => {
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return (h >>> 0).toString(36);
    };
    const vw = innerWidth;
    const vh = innerHeight;

    /** Visible text without screen-reader-only copy or aria-hidden decoration (badge counts). */
    const visibleText = (el) => {
      let out = '';
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) out += child.data;
          else if (child.nodeType === 1) {
            if (child.classList.contains('tp-sr-only') || child.getAttribute('aria-hidden') === 'true') continue;
            if (child.tagName === 'SVG' || child.tagName === 'svg' || child.tagName === 'STYLE') continue;
            walk(child);
            if (getComputedStyle(child).display === 'block') out += ' ';
          }
        }
      };
      walk(el);
      return out;
    };
    const byIds = (ids) =>
      ids
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => visibleText(n))
        .join(' ');
    const role = (el) => el.getAttribute('role') || el.tagName.toLowerCase();
    const labelOf = (el) => {
      const r = role(el);
      if (el.getAttribute('aria-labelledby')) {
        const t = byIds(el.getAttribute('aria-labelledby'));
        if (t.trim()) return t;
      }
      if (el.getAttribute('aria-label')?.trim()) return el.getAttribute('aria-label');
      // A dropdown's text is its CURRENT VALUE; its name is its field label.
      if (r === 'combobox' || r === 'switch' || r === 'checkbox') {
        const lab = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
        if (lab) return visibleText(lab);
      }
      const text = visibleText(el);
      if (text.trim()) return text;
      return el.getAttribute('title') || el.textContent || el.querySelector('img[alt]')?.alt || '';
    };

    // The top-most layer that covers the viewport (a modal's backdrop, a lock,
    // a full-screen sheet). With one present, only what is inside it, or
    // physically above it, can be pressed.
    const coverOf = (x, y) => {
      let found = null;
      for (let n = document.elementFromPoint(x, y); n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).position !== 'fixed') continue;
        const b = n.getBoundingClientRect();
        if (b.width >= vw * 0.9 && b.height >= vh * 0.9) found = n;
      }
      return found;
    };
    const votes = new Map();
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
      const c = coverOf(vw * fx, vh * fy);
      if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
    }
    const cover = [...votes].sort((a, b) => b[1] - a[1]).find(([, n]) => n >= 3)?.[0] ?? null;
    const coverLabel = cover
      ? norm(
          cover.getAttribute('aria-label') ||
            (cover.getAttribute('aria-labelledby') && byIds(cover.getAttribute('aria-labelledby'))) ||
            cover.querySelector('h1,h2,h3')?.textContent ||
            cover.getAttribute('role') ||
            'overlay',
        )
      : null;

    const part = (n) =>
      n
        ? `${n.tagName}.${[...n.classList].sort().join('.')}` +
          ['role', 'data-kind', 'data-size', 'data-tone', 'data-state', 'aria-haspopup'].map((a) => n.getAttribute(a) ?? '').join('|')
        : '';
    const sigOf = (el, testid) =>
      [part(el), part(el.parentElement), part(el.parentElement?.parentElement), testid,
        [...el.querySelectorAll('*')].slice(0, 16).map((c) => c.tagName).join(',')].join('>');

    const hitOk = (el, r) => {
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    };

    const els = [];
    const out = [];
    for (const el of document.querySelectorAll(sel.join(','))) {
      if (el.closest('[inert],[aria-hidden="true"]')) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset[disabled]')) continue;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue; // sr-only skip links and friends
      if (getComputedStyle(el).pointerEvents === 'none') continue;
      if (cover && !cover.contains(el) && !el.closest('[data-menu-portal]') && !hitOk(el, r)) continue;

      const tag = el.tagName.toLowerCase();
      let href = null;
      let clickable = true;
      if (tag === 'a') {
        const raw = el.getAttribute('href');
        const u = new URL(el.href, location.href);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') clickable = false; // mailto:, tel:, blob:
        else if (u.origin !== location.origin) continue; // external: not this app's button
        else if (el.target === '_blank' || el.hasAttribute('download')) clickable = false;
        else if (raw?.startsWith('#')) clickable = false; // in-page anchor
        href = clickable ? normPath(u.pathname + u.search) : normPath(raw ?? '');
      }
      const label = norm(labelOf(el));
      const testid = el.getAttribute('data-testid');
      const kind = el.getAttribute('role') && tag !== 'a' ? el.getAttribute('role') : tag;
      const key = testid ? norm(testid, 120) : `${kind}:${label || '(unlabelled)'}${href ? ` ${href}` : ''}`;
      // Same testid on two different buttons (one per row, say): click each
      // distinct label once, but keep one key for the cost table.
      const clickId = testid ? `${key}|${label}` : key;
      els.push(el);
      out.push({
        key,
        label,
        clickId,
        href: clickable ? href : null,
        clickable,
        domIndex: els.length - 1,
        // What the never-click rules beyond the regexes look at.
        kind: el.getAttribute('data-kind'),
        submit: tag === 'button' && el.type === 'submit' && !!el.form,
        inLayer: !!cover && cover.contains(el),
        // Structure without text: rows of one list share it (see record()).
        sig: sigOf(el, testid ? norm(testid, 120) : ''),
        foldable: tag !== 'a' && kind !== 'tab',
      });
    }
    window.__cdEls = els;
    return {
      pathname: normPath(location.pathname),
      rawPath: location.pathname + location.search,
      // A dialog layer is named by its title AND its content, so step 2 of a
      // wizard is not mistaken for step 1 (both share the title).
      layer: cover ? `${coverLabel}#${hash(out.filter((e) => cover.contains(els[e.domIndex])).map((e) => e.key).sort().join('|'))}` : 'page',
      elements: out,
    };
  }, selectors);
}
