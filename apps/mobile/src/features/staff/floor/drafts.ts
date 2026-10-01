/**
 * The orders being built on this phone, one per table, kept while the waiter
 * moves between the order pages (the tables, a table's menu, an item's
 * options, the review) and between tables: going back to the tables and on
 * to another loses nothing. In memory only; a sent order clears its table's.
 *
 * A module store read through useSyncExternalStore, so each page renders the
 * same draft without a provider.
 */
import { useSyncExternalStore } from 'react';
import { emptyDraft, type Draft, type Target } from './logic';

const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDraft(tableId: string): Draft | null {
  return drafts.get(tableId) ?? null;
}

/** Change one table's draft, starting it (on `start`) when there is none. */
export function updateDraft(tableId: string, change: (d: Draft) => Draft, start: Target | null = null): void {
  const current = drafts.get(tableId) ?? emptyDraft(tableId, start);
  drafts.set(tableId, change(current));
  emit();
}

export function clearDraft(tableId: string): void {
  if (drafts.delete(tableId)) emit();
}

/** A new line's key: unique on this phone for as long as the app runs. */
let seq = 0;
export function newLineKey(): string {
  seq += 1;
  return `l${Date.now().toString(36)}${seq.toString(36)}`;
}

export function useDraft(tableId: string): Draft | null {
  return useSyncExternalStore(
    subscribe,
    () => drafts.get(tableId) ?? null,
    () => null,
  );
}

/** The tables with something waiting to be sent (a dot on the tables page). */
export function useDraftTables(): ReadonlySet<string> {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return new Set([...drafts.values()].filter((d) => d.lines.length > 0).map((d) => d.tableId));
}
