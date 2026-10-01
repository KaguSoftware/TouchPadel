/**
 * The lock-order walker behind scripts/check-lock-order.mjs, pure: no database,
 * no process. The script reads the catalog (every app function body, every
 * trigger) through the stack's container and hands it here; the fixture test
 * (tests/lock-order-matches.test.ts) hands it synthetic bodies. See the script
 * for why the invariant is structural and what each rule catches.
 *
 * Open matches (0260, docs/design/open-matches/db.md §2.6) taught it three
 * things:
 *   * two advisory keys beside app.lock_court(): app.lock_match_money()
 *     (match_money_advisory, R19) and app.lock_match_venue()
 *     (match_venue_advisory, the branch mutex). pg_try_advisory_xact_lock is
 *     never emitted: it never waits;
 *   * once per sequence: a blocking body only ever holds one branch's mutex and
 *     one match's money lock, so a later occurrence of either key in the same
 *     sequence is a re-grant, not a new lock. Without this the reservation
 *     trigger expanded under any L2 body reads as match_tickets -> mutex;
 *   * a service-role walk list (contracts §1.4, R8): functions no client can
 *     call but that take the same locks, walked as if they were callable.
 *     Names not created yet are skipped;
 *   * a locking sub-select closed by its parenthesis (`... for update) x`,
 *     ticket_pick's shape) is a lock too. It was invisible before, which also
 *     hid wave 5's stock_batches locks in consume_fefo_at and its callers
 *     (all in order: no sequence broke when they appeared).
 */

/** The declared total order. Adding a table here is a deliberate act. */
export const ORDER = [
  'day_sessions',
  'match_money_advisory', // app.lock_match_money() -- 0260 (R19): a match's seat money
  'tabs',
  'orders',
  'order_items',
  'tickets',
  'payments',
  'till_shifts', // wave 5: the stamp trigger (SHARE), close_day and the shift close (FOR UPDATE)
  'refunds',
  'stock_batches',
  'court_advisory', // app.lock_court() -- 0042
  'reservations',
  'match_venue_advisory', // app.lock_match_venue() -- 0260: the branch mutex of open matches
  'match_tickets', // 0260: open-match tickets, FOR UPDATE, always in id order
];

/** Advisory locks: a call to `app.<fn>(` is a lock on `lock`, never a call to expand. */
export const ADVISORY = [
  { fn: 'lock_court', lock: 'court_advisory' },
  { fn: 'lock_match_money', lock: 'match_money_advisory' },
  { fn: 'lock_match_venue', lock: 'match_venue_advisory' },
];

/** Keys a blocking body holds at most once: a later occurrence is dropped (db.md §2.6 rule 3). */
export const ONCE_PER_SEQUENCE = new Set(['match_venue_advisory', 'match_money_advisory']);

/**
 * Service-role functions walked as if client-callable (contracts §1.4 + R8).
 * `booking_payments` stays out of ORDER: deposit rows are locked before the
 * mutex, ticket rows only after match_tickets, and no body locks both kinds.
 */
export const SERVICE_WALK = [
  'match_sweep',
  'deposit_apply',
  'ticket_settle_success',
  'ticket_refund_deleted',
  'tickets_cash_out',
  'expire_stale_holds', // 0268: no longer granted to clients; the tp_hold_sweep cron still takes its row locks
];

/**
 * Every table app.tab_net_paid() reads. Anything that writes one of these
 * changes a tab's balance, and settle_tab plus all three REQUIRES_REFUND
 * guards read that balance while holding `tabs ... for update` on the
 * assumption it cannot move. So writing these REQUIRES holding the tab lock —
 * this is rule 2, and it is what catches a missing lock rather than an
 * inverted one. 0043's app.refund wrote refunds while holding only payments.
 */
export const BALANCE_TABLES = ['payments', 'refunds'];

/**
 * Reservation writers that do NOT need app.lock_court(). Each mutates `status`
 * by primary key and never touches court_id or start_at/end_at, so it cannot
 * create a new overlap: the exclusion constraint conflicts on (court_id, period)
 * pairs, and a row that already satisfied it still does after a status change.
 * Three of these LEAVE the constrained set outright (its predicate is
 * status in ('pending','confirmed','arrived')); confirm_booking moves between
 * two members of it. This is 0042's own stated exemption, made explicit --
 * adding a name here asserts the function never moves a reservation in time or
 * across courts.
 */
export const STATUS_ONLY_RESERVATION_WRITERS = new Set([
  'cancel_reservation', // -> cancelled: leaves the constrained set
  'expire_stale_holds', // -> expired:   leaves it
  'release_hold', // -> expired:   leaves it (0058, guest hand-back)
  'mark_reservation', // -> arrived / no_show / completed
  'confirm_booking', // pending -> confirmed: same period, same court
  'cancel_series', // -> cancelled, one app.cancel_reservation per row (0066): leaves it
]);

const rank = (t) => ORDER.indexOf(t);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The walker over one catalog.
 *   fns       [{ name, src }]   every function body of schema app (the longest
 *                               body wins for an overloaded name, as before)
 *   triggers  [{ tbl, fn }]     every non-internal trigger on schema public
 */
export function createWalker({ fns, triggers }) {
  const byName = new Map();
  for (const f of fns) {
    const prev = byName.get(f.name);
    if (!prev || f.src.length > prev.length) byName.set(f.name, f.src);
  }
  // Triggers matter: trg_refund_restock and trg_ticket_consume take stock_batches
  // locks without ever appearing as a call in the RPC body.
  const trgByTable = new Map();
  for (const t of triggers) {
    if (!trgByTable.has(t.tbl)) trgByTable.set(t.tbl, []);
    trgByTable.get(t.tbl).push(t.fn);
  }
  // The alias and write regexes are anchored right after `from|join|update\s+`
  // (and `insert into|update|delete from\s+`), so `match_tickets` never reads
  // as the KDS `tickets`: the table name must start where the keyword ends.
  const TBL = ORDER.join('|');
  const WRITABLE = [...new Set([...trgByTable.keys(), ...ORDER])].join('|');
  const advisoryRe = new RegExp(String.raw`\bapp\.(${ADVISORY.map((a) => escape(a.fn)).join('|')})\s*\(`, 'gi');
  const advisoryLock = new Map(ADVISORY.map((a) => [a.fn, a.lock]));

  /** alias -> table for one statement, so `FOR UPDATE OF t` resolves correctly. */
  function aliases(stmt) {
    const m = new Map();
    const re = new RegExp(String.raw`\b(?:from|join|update)\s+(${TBL})\b(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?`, 'gi');
    const kw = ['where', 'set', 'on', 'for', 'join', 'left', 'inner', 'using', 'order', 'group', 'returning', 'into', 'values', 'limit'];
    for (const mm of stmt.matchAll(re)) {
      const tbl = mm[1].toLowerCase();
      const al = mm[2]?.toLowerCase();
      if (al && !kw.includes(al)) m.set(al, tbl);
      m.set(tbl, tbl);
    }
    return m;
  }

  /**
   * Ordered lock/call/write events of one body. Statement-by-statement: a regex
   * allowed to span statements both invents locks (matching a later FOR UPDATE
   * against an earlier unlocked read) and swallows real ones.
   */
  function events(src) {
    const out = [];
    // Strip `--` line comments FIRST. Without this the guard reads prose as code:
    // 0042's own comment "every guard below still runs against the FOR UPDATE read"
    // registered as a FOR UPDATE on the reservations in the same statement, which
    // is a lock that does not exist. Comments must never be able to invent locks
    // -- nor, worse, to satisfy a rule.
    const code = src.replace(/--[^\n]*/g, '');
    for (const stmt of code.split(';')) {
      // `(?=[\s)]|$)`: a locking sub-select ends `for update)` (0260's
      // ticket_pick, wave 5's consume_fefo_at). Until 0260 the lookahead took
      // whitespace only, and those locks were invisible to the gate.
      const lockM = /\bfor\s+(?:no\s+key\s+)?update(\s+of\s+([a-z_,\s]+?))?(?=[\s)]|$)/i.exec(stmt);
      if (lockM) {
        const al = aliases(stmt);
        if (lockM[2]) {
          for (const a of lockM[2].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
            const t = al.get(a);
            if (t) out.push({ lock: t });
          }
        } else {
          // A bare FOR UPDATE locks every base relation in the FROM list.
          for (const t of new Set([...al.values()])) out.push({ lock: t });
        }
      }
      // app.lock_court() takes pg_advisory_xact_lock on the court -- a real lock
      // with no FOR UPDATE to match on, so it was invisible to this guard until
      // 0048. That is exactly why every line of 0042's fix went unguarded by the
      // script written to protect it. The two open-match keys (0260) are the
      // same shape. pg_try_advisory_xact_lock is not emitted: it never waits.
      for (const m of stmt.matchAll(advisoryRe)) out.push({ lock: advisoryLock.get(m[1].toLowerCase()) });
      for (const m of stmt.matchAll(/\bapp\.([a-z_][a-z0-9_]*)\s*\(/gi)) {
        if (advisoryLock.has(m[1].toLowerCase())) continue; // already emitted as a lock
        out.push({ call: m[1].toLowerCase() });
      }
      const wr = new RegExp(String.raw`\b(?:insert\s+into|update|delete\s+from)\s+(${WRITABLE})\b`, 'gi');
      for (const m of stmt.matchAll(wr)) out.push({ write: m[1].toLowerCase() });
    }
    return out;
  }

  /** Full lock sequence, expanding helper calls and trigger bodies in place. */
  function sequence(name, stack = []) {
    if (stack.includes(name)) return []; // recursion guard
    const src = byName.get(name);
    if (!src) return [];
    const seq = [];
    for (const ev of events(src)) {
      if (ev.lock) seq.push(ev.lock);
      else if (ev.call && byName.has(ev.call)) seq.push(...sequence(ev.call, [...stack, name]));
      else if (ev.write) {
        for (const fn of trgByTable.get(ev.write) ?? []) {
          if (byName.has(fn)) seq.push(...sequence(fn, [...stack, name]));
        }
      }
    }
    return seq;
  }

  /** Ordered locks AND balance-writes, so rule 2 can see which came first. */
  function timeline(name, stack = []) {
    if (stack.includes(name)) return [];
    const src = byName.get(name);
    if (!src) return [];
    const out = [];
    for (const ev of events(src)) {
      if (ev.lock) out.push({ lock: ev.lock });
      else if (ev.call && byName.has(ev.call)) out.push(...timeline(ev.call, [...stack, name]));
      else if (ev.write) {
        if (BALANCE_TABLES.includes(ev.write)) out.push({ balanceWrite: ev.write });
        for (const fn of trgByTable.get(ev.write) ?? []) {
          if (byName.has(fn)) out.push(...timeline(fn, [...stack, name]));
        }
      }
    }
    return out;
  }

  return { byName, trgByTable, events, sequence, timeline };
}

/** Drop every later occurrence of a once-per-sequence key (db.md §2.6 rule 3). */
export function oncePerSequence(seq) {
  const seen = new Set();
  return seq.filter((t) => {
    if (!ONCE_PER_SEQUENCE.has(t)) return true;
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/** What the gate prints for a function: once-per-sequence, then adjacent repeats folded. */
export function printedSequence(walker, name) {
  const seq = oncePerSequence(walker.sequence(name));
  return seq.filter((t, i) => i === 0 || t !== seq[i - 1]);
}

/**
 * The whole gate over one catalog. `callable` is every definer function a
 * client role can execute; the service-role walk list is added to it (names
 * the catalog does not have are skipped). Returns the printed rows (functions
 * with at least one lock), every violation, and the sequences asked for with
 * `show` (internal functions, for the fixture test and by hand).
 */
export function analyse({ fns, triggers, callable, show = [] }) {
  const walker = createWalker({ fns, triggers });
  const walked = [...new Set([...callable, ...SERVICE_WALK.filter((n) => walker.byName.has(n))])].sort();
  const violations = [];
  const rows = [];
  for (const fn of walked) {
    const compact = printedSequence(walker, fn);

    // Rule 1 — no inversion of the declared order.
    for (let i = 1; i < compact.length; i++) {
      if (rank(compact[i - 1]) > rank(compact[i])) {
        violations.push(
          `  ${fn}: takes ${compact[i - 1]} before ${compact[i]}\n` +
            `      full sequence: ${compact.join(' -> ')}\n` +
            `      -> inverted order; two such functions deadlock (40P01) under contention.`,
        );
      }
    }

    // Rule 2 — a balance write requires the tab lock, taken beforehand.
    const tl = walker.timeline(fn);
    const firstTabLock = tl.findIndex((e) => e.lock === 'tabs');
    const firstBalance = tl.findIndex((e) => e.balanceWrite);
    if (firstBalance >= 0 && (firstTabLock < 0 || firstTabLock > firstBalance)) {
      violations.push(
        `  ${fn}: writes ${tl[firstBalance].balanceWrite} ` +
          (firstTabLock < 0 ? 'without ever locking tabs' : 'before locking tabs') +
          `\n      -> app.tab_net_paid() can then move under settle_tab and under every\n` +
          `         REQUIRES_REFUND guard, all of which read it holding the tab lock.`,
      );
    }

    // Rule 3 — 0042's invariant, previously unguarded (0048/H5). Every writer of
    // the reservations exclusion window must serialize on the court FIRST. Taking
    // the row lock without it means two writers can enter the GiST exclusion check
    // concurrently, which is the raw 40P01 that 0042 was written to eliminate; and
    // it is how move/extend came to lock the court they PEEKED rather than the one
    // they write.
    const firstCourtLock = compact.indexOf('court_advisory');
    const firstResLock = compact.indexOf('reservations');
    if (!STATUS_ONLY_RESERVATION_WRITERS.has(fn) && firstResLock >= 0 && (firstCourtLock < 0 || firstCourtLock > firstResLock)) {
      violations.push(
        `  ${fn}: locks reservations ` +
          (firstCourtLock < 0 ? 'without ever calling app.lock_court()' : 'before app.lock_court()') +
          `\n      full sequence: ${compact.join(' -> ')}` +
          `\n      -> the exclusion window is then entered unserialized; two such writers\n` +
          `         deadlock in the GiST check (40P01), the failure 0042 removed.`,
      );
    }

    if (compact.length) rows.push({ fn, seq: compact });
  }
  const shown = show.map((fn) => ({ fn, found: walker.byName.has(fn), seq: printedSequence(walker, fn) }));
  return { order: ORDER, walked, rows, violations, shown };
}
