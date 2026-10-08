/**
 * One pass of the shop desk's supplier price watch (0322): every due link,
 * one at a time, a short pause between two pages. The network, the clock and
 * the pause come in as ports, so the node test beside this file runs a pass
 * without a shell, a server or real time (the release-review "ports" pattern).
 *
 * A pass is single-flight per renderer: a second start while one runs (a
 * remount, the hourly timer catching a slow pass) returns at once.
 *
 * A report the server refuses for that one watch (`skipRefusal`) does not end
 * the pass: the refused watch keeps its old check time, so it sorts first
 * every hour and would otherwise stop every link behind it from being read.
 * The first such refusal is thrown once the rest are read. Any other failure
 * (offline, no RPC, signed out) ends the pass at once.
 */
import type { SupplierPageResult } from '../../../ipc/bridge';
import { PAGE_GAP_MS, crawlOrder, pageOutcome, reportArgs, type PriceWatchRow } from './priceWatchLogic';

export interface CrawlPorts {
  listWatches(): Promise<PriceWatchRow[]>;
  fetchPage(url: string): Promise<SupplierPageResult>;
  report(args: ReturnType<typeof reportArgs>): Promise<unknown>;
  sleep(ms: number): Promise<void>;
  now(): Date;
  /** Checked before every page: the shop desk signed out, went offline or unmounted. */
  stopped(): boolean;
  /** True for a refusal about this one watch (a bad value, another branch's size). */
  skipRefusal(error: unknown): boolean;
}

export type PassResult =
  | { ran: false }
  /** `reported`: pages whose read reached the server; `stoppedEarly`: the pass ended before its last page. */
  | { ran: true; reported: number; stoppedEarly: boolean };

let running = false;

export async function runCrawlPass(ports: CrawlPorts): Promise<PassResult> {
  if (running) return { ran: false };
  running = true;
  let reported = 0;
  let refused: { error: unknown } | null = null;
  try {
    const due = crawlOrder(await ports.listWatches(), ports.now());
    for (let i = 0; i < due.length; i++) {
      if (ports.stopped()) return { ran: true, reported, stoppedEarly: true };
      if (i > 0) await ports.sleep(PAGE_GAP_MS);
      if (ports.stopped()) return { ran: true, reported, stoppedEarly: true };
      const watch = due[i]!;
      const outcome = pageOutcome(await ports.fetchPage(watch.url), watch.url);
      // Not a shop desk, or no shell: the server hears nothing, the pass ends.
      if (outcome.kind === 'stop') return { ran: true, reported, stoppedEarly: true };
      try {
        await ports.report(reportArgs(watch, outcome));
        reported++;
      } catch (error) {
        if (!ports.skipRefusal(error)) throw error;
        refused ??= { error };
      }
    }
    if (refused) throw refused.error;
    return { ran: true, reported, stoppedEarly: false };
  } finally {
    running = false;
  }
}
