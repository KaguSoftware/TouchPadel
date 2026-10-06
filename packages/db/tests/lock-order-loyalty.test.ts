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
 *   * the gate over the local stack (stack-gated): it passes, and settle_tab and refund end in
 *     loyalty_accounts.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyse, createWalker, printedSequence } from '../scripts/lib/lock-order.mjs';
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
  });
});
