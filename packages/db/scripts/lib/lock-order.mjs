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
 *
 * Coaching (coaching_tables, docs/design/coaching/db.md §2.5; build contracts §1.4, R6,
 * R33, R64) taught it two more:
 *   * the coach mutex, app.lock_coach() (coach_advisory), ranked after
 *     match_money_advisory and before tabs, once per sequence: no path takes
 *     two coaches' keys and a lesson's coach never changes. app.try_lock_coach
 *     (the sweep's later coaches) is never emitted: it never waits. lessons,
 *     courses, lesson_enrolments, lesson_attendance, lesson_strikes and
 *     coach_statements stay out of ORDER, like booking_payments: the coach
 *     mutex serialises every change to them;
 *   * `FOR UPDATE ... SKIP LOCKED` on reservations never waits (R64, D-25), so
 *     it is not emitted, for the reason pg_try_advisory_xact_lock is not: the
 *     statement that ends a held lesson's court hold
 *     (`update reservations ... where id in (select ... for update skip
 *     locked)`, lesson_court_release) takes no lock that can wait, and no
 *     coaching name joins STATUS_ONLY_RESERVATION_WRITERS (R33). Every other
 *     skip locked (match_tickets in 0264, the outboxes) is emitted as before.
 *     The service-role walk gains lesson_sweep, lesson_settle_success,
 *     lesson_payment_prepare and coach_statements_draft (skipped until each
 *     exists).
 *
 * 0290 (the coaching review, DB-03/DB-04) added no rank. The coaches row (FOR
 * UPDATE in coach_update and delete_my_account) and the profiles row (FOR
 * SHARE in coach_promote) stay out of ORDER, like lessons: the coach mutex
 * serialises the writers, and the one unmutexed writer, delete_my_account,
 * takes profile then coach, the order coach_promote reads them in.
 * price_promo_apply_internal takes the coach mutex before its lesson_types
 * row (unranked) on a coach_price change: a booking holds the mutex and then
 * a key share on lesson_types through its foreign key, so the type first
 * would deadlock with it. The walk cannot follow the protocol hook dispatch,
 * so lock-order-coaching.test.ts pins it with --show.
 *
 * 0291 (the coaching review, DB-11) ranks one row: `venues`. Every lesson
 * insert (app.lesson_create_internal) takes its branch row FOR KEY SHARE and
 * refuses a branch that is no longer open, so a lesson never lands at a
 * branch close_branch (venues FOR UPDATE) has just closed: whichever comes
 * second sees the other's result. app.lesson_lock_branch_courts, which every
 * creating body calls first, takes the same key share right after the
 * courts, so `venues` sits between `court_advisory` and `reservations`, once
 * per sequence: a lesson body only ever touches one branch, and
 * lesson_create_internal's own key share (after match_expire_holds, whose
 * update the walk expands into the reservations trigger's mutex and
 * tickets) is a re-grant of the same row. A share lock (`for share`,
 * `for key share`) is emitted only for a table in SHARE_RANKED; every other
 * share lock stays invisible, as before. open_branch and close_branch take
 * the row FOR UPDATE and nothing ranked after it.
 *
 * Tournaments (0310, c42) rank two tables, between the coach mutex and tabs:
 * `tournaments` then `tournament_entries`. Every tournament body takes its
 * tournament row first (FOR UPDATE, or FOR SHARE in tournament_settle, so
 * tournaments joins SHARE_RANKED), then its entries in id order, then tabs,
 * courts and reservations; nothing takes a tournament after a tab or a court.
 * tournament_sweep visits many tournaments in one transaction, but takes
 * each row `FOR UPDATE SKIP LOCKED`, which never waits: like a skip-locked
 * reservations row it is not emitted (SKIP_LOCKED_UNEMITTED), so a later
 * tournament after an earlier one's entries is no inversion.
 * tournament_rounds and tournament_matches stay unranked: they are only ever
 * written under the tournament row.
 *
 * Loyalty (0308, 0309) ranks `promotions` after tabs (apply_best_promotion
 * locks its candidates in id order under the tab) and two advisory keys:
 * app.lock_loyalty_attempts (loyalty_attempts_advisory, after promotions:
 * the member-token throttle, taken under the tab in loyalty_redeem) and
 * app.lock_loyalty_gifts (loyalty_gift_advisory, just before
 * loyalty_accounts: loyalty_adjust's 24-hour gift sums). Each is once per
 * sequence: a body takes one helper call, whose keys (caller then code,
 * manager then profile) are always in that order.
 */

/** The declared total order. Adding a table here is a deliberate act. */
export const ORDER = [
  'day_sessions',
  'match_money_advisory', // app.lock_match_money() -- 0260 (R19): a match's seat money
  'coach_advisory', // app.lock_coach() -- coaching_tables (R6): a coach's lessons, enrolments and statements
  'tournaments', // 0310 (c42): a tournament row, FOR UPDATE (FOR SHARE in tournament_settle), before its entries, tabs and courts
  'tournament_entries', // 0310 (c42): a tournament's entries, in id order, after the tournament row
  'tabs',
  'promotions', // 0309 (c15): apply_best_promotion locks the chosen promotion FOR UPDATE after the tab, before re-reading its limits
  'loyalty_attempts_advisory', // app.lock_loyalty_attempts() -- 0308 (c3): the member-token throttle, caller then code
  'orders',
  'order_items',
  'tickets',
  'payments',
  'till_shifts', // wave 5: the stamp trigger (SHARE), close_day and the shift close (FOR UPDATE)
  'refunds',
  'stock_batches',
  'court_advisory', // app.lock_court() -- 0042
  'venues', // 0291 (DB-11): a lesson body's branch row FOR KEY SHARE, once per sequence; open/close_branch FOR UPDATE
  'reservations',
  'match_venue_advisory', // app.lock_match_venue() -- 0260: the branch mutex of open matches
  'match_tickets', // 0260: open-match tickets, FOR UPDATE, always in id order
  'loyalty_gift_advisory', // app.lock_loyalty_gifts() -- 0308 (c17): a manager's 24-hour gift sums, manager then profile
  'loyalty_accounts', // 0305: a member's cached balance, FOR UPDATE, last (earn/clawback run deferred, at commit)
];

/**
 * Tables whose share locks (`for share`, `for key share`) are ranked too: a
 * key share waits behind a FOR UPDATE of the same row, so it can deadlock
 * (0291, DB-11). Every other share lock is left out, as it always was.
 */
export const SHARE_RANKED = new Set(['venues', 'tournaments']);

/**
 * Tables whose `FOR UPDATE ... SKIP LOCKED` is not emitted: it never waits
 * (coaching R64 for reservations; 0310 for tournaments, the sweep's rows).
 * Every other skip locked (match_tickets in 0264, the outboxes) prints as before.
 */
export const SKIP_LOCKED_UNEMITTED = new Set(['reservations', 'tournaments']);

/** Advisory locks: a call to `app.<fn>(` is a lock on `lock`, never a call to expand. */
export const ADVISORY = [
  { fn: 'lock_court', lock: 'court_advisory' },
  { fn: 'lock_match_money', lock: 'match_money_advisory' },
  { fn: 'lock_match_venue', lock: 'match_venue_advisory' },
  { fn: 'lock_coach', lock: 'coach_advisory' }, // coaching_tables; try_lock_coach is never emitted (it never waits)
  { fn: 'lock_loyalty_attempts', lock: 'loyalty_attempts_advisory' }, // 0308 (c3)
  { fn: 'lock_loyalty_gifts', lock: 'loyalty_gift_advisory' }, // 0308 (c17)
];

/**
 * Keys a blocking body holds at most once: a later occurrence is dropped
 * (open-matches db.md §2.6 rule 3; coaching db.md §2.5 item 3). 0291: the
 * branch's venues row too (a lesson body locks one branch's row, then takes
 * it again in app.lesson_create_internal).
 */
export const ONCE_PER_SEQUENCE = new Set([
  'match_venue_advisory',
  'match_money_advisory',
  'coach_advisory',
  'venues',
  'loyalty_attempts_advisory',
  'loyalty_gift_advisory',
]);

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
  // Coaching (R33; listed in the coaching_tables commit, walked once each exists):
  'lesson_sweep', // the lesson_sweep migration, the tp_lesson_sweep cron
  'lesson_settle_success', // lesson_online_payment, under deposit_apply's lesson arm
  'lesson_payment_prepare', // lesson_online_payment, lesson-begin
  'coach_statements_draft', // the coach_statements migration, the tp_coach_statements cron
  // Tournaments (M7; walked once tournaments_lifecycle exists):
  'tournament_sweep', // the tp_tournament_sweep cron: the cut-off cancel releases courts
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
 *   triggers  [{ tbl, fn, deferred? }]  every non-internal trigger on schema public;
 *                               deferred = a constraint trigger INITIALLY DEFERRED
 *
 * Loyalty (0305) taught it deferral: a constraint trigger declared
 * INITIALLY DEFERRED (tabs_loyalty_earn, refunds_loyalty_clawback) runs at
 * COMMIT, after every statement of the outermost body, not where its row is
 * written. Expanding it in place made settle_tab read tabs -> loyalty_accounts
 * -> stock_batches, an inversion that cannot happen. So a deferred trigger's
 * body is queued and walked at the END of the top-level sequence (and of the
 * timeline), once per trigger function, after everything the body itself
 * takes. A non-deferred trigger is still expanded in place, as before.
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
  const deferredFns = new Set();
  for (const t of triggers) {
    if (!trgByTable.has(t.tbl)) trgByTable.set(t.tbl, []);
    trgByTable.get(t.tbl).push(t.fn);
    if (t.deferred) deferredFns.add(t.fn);
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
      // 0291 (DB-11): a share lock on a SHARE_RANKED table (venues) is a lock too.
      const shareM = lockM ? null : /\bfor\s+(?:key\s+)?share(\s+of\s+([a-z_,\s]+?))?(?=[\s)]|$)/i.exec(stmt);
      if (shareM) {
        const al = aliases(stmt);
        const named = shareM[2]
          ? shareM[2].split(',').map((x) => al.get(x.trim().toLowerCase())).filter(Boolean)
          : [...new Set(al.values())];
        for (const t of named) if (SHARE_RANKED.has(t)) out.push({ lock: t });
      }
      if (lockM) {
        const al = aliases(stmt);
        // Coaching (coaching_tables, R64, D-25): a reservations row taken SKIP LOCKED is
        // never waited for, like pg_try_advisory_xact_lock below, so it is not
        // emitted. Only reservations: every other skip locked (match_tickets,
        // the outboxes) prints as it always did.
        const skipLocked = /^\s+skip\s+locked\b/i.test(stmt.slice(lockM.index + lockM[0].length));
        const emit = (t) => {
          if (!(skipLocked && SKIP_LOCKED_UNEMITTED.has(t))) out.push({ lock: t });
        };
        if (lockM[2]) {
          for (const a of lockM[2].split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
            const t = al.get(a);
            if (t) emit(t);
          }
        } else {
          // A bare FOR UPDATE locks every base relation in the FROM list.
          for (const t of new Set([...al.values()])) emit(t);
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

  /**
   * Walk the deferred trigger bodies a top-level walk queued, at its end: each
   * trigger function once (it fires per row, but its locks are the same), and
   * a deferred trigger queued while walking another runs after it, as at commit.
   */
  function drainDeferred(name, tail, walk) {
    const out = [];
    const done = new Set();
    while (tail.length) {
      const fn = tail.shift();
      if (done.has(fn)) continue;
      done.add(fn);
      out.push(...walk(fn, [name], tail));
    }
    return out;
  }

  /**
   * Full lock sequence, expanding helper calls and immediate trigger bodies in
   * place; deferred trigger bodies go at the end (see createWalker).
   */
  function sequence(name, stack = [], tail = null) {
    if (stack.includes(name)) return []; // recursion guard
    const src = byName.get(name);
    if (!src) return [];
    const top = tail === null;
    const queue = top ? [] : tail;
    const seq = [];
    for (const ev of events(src)) {
      if (ev.lock) seq.push(ev.lock);
      else if (ev.call && byName.has(ev.call)) seq.push(...sequence(ev.call, [...stack, name], queue));
      else if (ev.write) {
        for (const fn of trgByTable.get(ev.write) ?? []) {
          if (!byName.has(fn)) continue;
          if (deferredFns.has(fn)) queue.push(fn);
          else seq.push(...sequence(fn, [...stack, name], queue));
        }
      }
    }
    if (top) seq.push(...drainDeferred(name, queue, sequence));
    return seq;
  }

  /** Ordered locks AND balance-writes, so rule 2 can see which came first. */
  function timeline(name, stack = [], tail = null) {
    if (stack.includes(name)) return [];
    const src = byName.get(name);
    if (!src) return [];
    const top = tail === null;
    const queue = top ? [] : tail;
    const out = [];
    for (const ev of events(src)) {
      if (ev.lock) out.push({ lock: ev.lock });
      else if (ev.call && byName.has(ev.call)) out.push(...timeline(ev.call, [...stack, name], queue));
      else if (ev.write) {
        if (BALANCE_TABLES.includes(ev.write)) out.push({ balanceWrite: ev.write });
        for (const fn of trgByTable.get(ev.write) ?? []) {
          if (!byName.has(fn)) continue;
          if (deferredFns.has(fn)) queue.push(fn);
          else out.push(...timeline(fn, [...stack, name], queue));
        }
      }
    }
    if (top) out.push(...drainDeferred(name, queue, timeline));
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
