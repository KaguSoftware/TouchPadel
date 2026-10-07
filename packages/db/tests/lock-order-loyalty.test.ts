/**
 * The lock-order gate after the loyalty migrations (docs/design/loyalty/
 * build-contracts-2026-10-05.md; 0305, 0306).
 *
 * loyalty_accounts ranks LAST (scripts/lib/lock-order.mjs ORDER). The earn trigger on tabs and
 * the clawback trigger on refunds are constraint triggers INITIALLY DEFERRED: they run at commit,
 * after every lock the settling or refunding body took. The walker models that: a deferred
 * trigger body is walked at the end of the top-level sequence, an immediate one in place.
 * What is pinned here:
 *
 *   * the walker, pure: a deferred trigger's lock lands after the body's later locks, an
 *     immediate trigger's lock lands where its row is written (so the same body with the
 *     trigger NOT deferred is an inversion, and the gate still catches it);
 *   * the walker, pure (0308, 0309): promotions ranks after tabs; the throttle's advisory key
 *     (app.lock_loyalty_attempts) ranks after promotions and the gift key
 *     (app.lock_loyalty_gifts) just before loyalty_accounts, each once per sequence;
 *   * the gate over the local stack (stack-gated): it passes, settle_tab and refund end in
 *     loyalty_accounts, and the token and gift paths print the advisory keys where they rank.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADVISORY,
  analyse,
  createWalker,
  ONCE_PER_SEQUENCE,
  ORDER,
  printedSequence,
} from '../scripts/lib/lock-order.mjs';
import { stackAvailable } from './helpers';
import { dockerReachable } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

// ── synthetic bodies, shaped like the real ones ─────────────────────────────
// settle: the tab row, the status write that fires the earn trigger, then stock (as
// settle_tab's tail and refund's restock do).
const settle = `begin
  select * into t from tabs where id = p for update;
  update tabs set status = 'settled' where id = p;
  perform 1 from stock_batches where item_id = i order by id for update;
end`;
const loyalty_recompute = `begin perform 1 from loyalty_accounts where profile_id = p for update; end`;
const trg_loyalty_earn = `begin perform app.loyalty_recompute(new.customer_id); end`;
const fns = [
  { name: 'settle', src: settle },
  { name: 'loyalty_recompute', src: loyalty_recompute },
  { name: 'trg_loyalty_earn', src: trg_loyalty_earn },
];

describe('lock-order walker: deferred constraint triggers (loyalty 0305)', () => {
  it('walks a deferred trigger at the end of the sequence, after the body\'s own later locks', () => {
    const triggers = [{ tbl: 'tabs', fn: 'trg_loyalty_earn', deferred: true }];
    const w = createWalker({ fns, triggers });
    expect(printedSequence(w, 'settle')).toEqual(['tabs', 'stock_batches', 'loyalty_accounts']);
    expect(analyse({ fns, triggers, callable: ['settle'] }).violations).toEqual([]);
  });

  it('still expands an immediate trigger in place, so the same body is an inversion without deferral', () => {
    const triggers = [{ tbl: 'tabs', fn: 'trg_loyalty_earn' }];
    const w = createWalker({ fns, triggers });
    expect(printedSequence(w, 'settle')).toEqual(['tabs', 'loyalty_accounts', 'stock_batches']);
    const out = analyse({ fns, triggers, callable: ['settle'] });
    expect(out.violations.join('\n')).toContain('settle: takes loyalty_accounts before stock_batches');
  });

  it('walks a deferred trigger body once however many rows fire it', () => {
    const twice = `begin
      update tabs set status = 'settled' where id = a;
      update tabs set status = 'settled' where id = b;
      perform 1 from stock_batches where item_id = i for update;
    end`;
    const w = createWalker({
      fns: [...fns, { name: 'twice', src: twice }],
      triggers: [{ tbl: 'tabs', fn: 'trg_loyalty_earn', deferred: true }],
    });
    expect(w.sequence('twice')).toEqual(['stock_batches', 'loyalty_accounts']);
  });
});

describe('lock-order walker: the loyalty ranks (0308, 0309)', () => {
  const at = (t: string) => ORDER.indexOf(t);
  const lock_loyalty_attempts = `begin perform pg_advisory_xact_lock(hashtextextended('app.loyalty_attempts.uid:' || p, 0)); end`;
  const lock_loyalty_gifts = `begin perform pg_advisory_xact_lock(hashtextextended('app.loyalty_gifts.by:' || p, 0)); end`;
  const base = [
    ...fns,
    { name: 'lock_loyalty_attempts', src: lock_loyalty_attempts },
    { name: 'lock_loyalty_gifts', src: lock_loyalty_gifts },
  ];

  it('ranks promotions after tabs, the throttle key after promotions, the gift key just before loyalty_accounts', () => {
    expect(at('promotions')).toBe(at('tabs') + 1);
    expect(at('loyalty_attempts_advisory')).toBe(at('promotions') + 1);
    expect(at('loyalty_gift_advisory')).toBe(at('loyalty_accounts') - 1);
    expect(ADVISORY).toContainEqual({ fn: 'lock_loyalty_attempts', lock: 'loyalty_attempts_advisory' });
    expect(ADVISORY).toContainEqual({ fn: 'lock_loyalty_gifts', lock: 'loyalty_gift_advisory' });
    expect(ONCE_PER_SEQUENCE.has('loyalty_attempts_advisory')).toBe(true);
    expect(ONCE_PER_SEQUENCE.has('loyalty_gift_advisory')).toBe(true);
  });

  it('a redemption: the tab, then the throttle key, then the account', () => {
    const redeem = {
      name: 'redeem',
      src: `begin
        select * into t from tabs where id = p for update;
        perform app.lock_loyalty_attempts(u, c);
        perform app.loyalty_recompute(x);
      end`,
    };
    const w = createWalker({ fns: [...base, redeem], triggers: [] });
    expect(printedSequence(w, 'redeem')).toEqual(['tabs', 'loyalty_attempts_advisory', 'loyalty_accounts']);
    expect(analyse({ fns: [...base, redeem], triggers: [], callable: ['redeem'] }).violations).toEqual([]);
  });

  it('a tab taken after the throttle key is an inversion', () => {
    const bad = {
      name: 'bad',
      src: `begin
        perform app.lock_loyalty_attempts(u, c);
        select * into t from tabs where id = p for update;
      end`,
    };
    const out = analyse({ fns: [...base, bad], triggers: [], callable: ['bad'] });
    expect(out.violations.join('\n')).toContain('bad: takes loyalty_attempts_advisory before tabs');
  });

  it('a gift: the gift key, then the account; the account first is an inversion', () => {
    const gift = {
      name: 'gift',
      src: `begin
        perform app.lock_loyalty_gifts(m, p);
        perform 1 from loyalty_accounts where profile_id = p for update;
      end`,
    };
    const late = {
      name: 'late',
      src: `begin
        perform 1 from loyalty_accounts where profile_id = p for update;
        perform app.lock_loyalty_gifts(m, p);
      end`,
    };
    const all = [...base, gift, late];
    const out = analyse({ fns: all, triggers: [], callable: ['gift', 'late'] });
    expect(out.violations.join('\n')).not.toContain('gift:');
    expect(out.violations.join('\n')).toContain('late: takes loyalty_accounts before loyalty_gift_advisory');
  });
});

describe.skipIf(!docker)('lock-order gate over the local stack (loyalty)', () => {
  const run = () =>
    execFileSync('node', [path.resolve(import.meta.dirname, '../scripts/check-lock-order.mjs')], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

  it('passes, and the settling and refunding bodies end in loyalty_accounts', () => {
    const out = run();
    expect(out).toContain('no lock-order violations');
    const line = (fn: string) => out.split('\n').find((l) => new RegExp(`^\\s+${fn}\\s`).test(l)) ?? '';
    expect(line('settle_tab').trim().endsWith('loyalty_accounts')).toBe(true);
    expect(line('refund').trim().endsWith('loyalty_accounts')).toBe(true);
    // 0307 (c20): the owner's merge is walked too (through merge_profiles_internal) and takes
    // loyalty_accounts last, after every ranked row it re-points. Its profiles lock is FOR NO
    // KEY UPDATE (account-merge.test.ts pins the text), so a settle's deferred FK key share on
    // the profile never waits on it.
    expect(line('merge_accounts').trim().endsWith('loyalty_accounts')).toBe(true);
    // 0308 (c3, c17): the throttle key under the tab, the gift key before the account.
    const seq = (fn: string) => line(fn).trim().slice(fn.length).trim();
    expect(seq('loyalty_redeem')).toBe('tabs -> loyalty_attempts_advisory -> loyalty_accounts');
    expect(seq('loyalty_identify')).toBe('loyalty_attempts_advisory');
    expect(seq('link_guest_session')).toBe('loyalty_attempts_advisory');
    expect(seq('loyalty_adjust')).toBe('loyalty_gift_advisory -> loyalty_accounts');
    // 0309 (c15): the candidates after the tab.
    expect(seq('apply_best_promotion')).toBe('tabs -> promotions');
  });
});
