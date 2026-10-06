/**
 * Types for lock-order.mjs, so tests/lock-order-matches.test.ts imports it
 * under `strict` without `allowJs` (same arrangement as fn-signatures.d.mts).
 */
export interface CatalogFunction {
  name: string;
  src: string;
}
export interface CatalogTrigger {
  /** The table (schema public) the trigger is on. */
  tbl: string;
  /** The trigger function's name (schema app). */
  fn: string;
  /** A constraint trigger INITIALLY DEFERRED (pg_trigger.tginitdeferred): walked at commit. */
  deferred?: boolean;
}
export type LockEvent = { lock: string } | { call: string } | { write: string };

export const ORDER: string[];
export const ADVISORY: { fn: string; lock: string }[];
export const ONCE_PER_SEQUENCE: Set<string>;
export const SHARE_RANKED: Set<string>;
export const SKIP_LOCKED_UNEMITTED: Set<string>;
export const SERVICE_WALK: string[];
export const BALANCE_TABLES: string[];
export const STATUS_ONLY_RESERVATION_WRITERS: Set<string>;

export interface Walker {
  byName: Map<string, string>;
  trgByTable: Map<string, string[]>;
  events(src: string): LockEvent[];
  sequence(name: string, stack?: string[], tail?: string[] | null): string[];
  timeline(name: string, stack?: string[], tail?: string[] | null): ({ lock: string } | { balanceWrite: string })[];
}

export function createWalker(catalog: { fns: CatalogFunction[]; triggers: CatalogTrigger[] }): Walker;
export function oncePerSequence(seq: string[]): string[];
export function printedSequence(walker: Walker, name: string): string[];
export function analyse(input: {
  fns: CatalogFunction[];
  triggers: CatalogTrigger[];
  callable: string[];
  show?: string[];
}): {
  order: string[];
  walked: string[];
  rows: { fn: string; seq: string[] }[];
  violations: string[];
  shown: { fn: string; found: boolean; seq: string[] }[];
};
