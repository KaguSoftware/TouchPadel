/**
 * One table's order in the making, as every order page after the tables reads
 * it: the table (from the floor read), this phone's draft for it, and the tab
 * it goes on. The draft's own choice wins; before there is one, the table's
 * only tab, or a new tab when it has none (logic.ts initialTarget). A chosen
 * tab the till has since closed is dropped, and `tabGone` says so.
 */
import { useCallback } from 'react';
import { updateDraft, useDraft } from './drafts';
import { initialTarget, validTarget, type Draft } from './logic';
import { useFloor } from './parts';

export function useTableOrder(venue: string, tableId: string) {
  const floor = useFloor(venue);
  const table = floor.data?.tables.find((t) => t.id === tableId) ?? null;
  const draft = useDraft(tableId);
  const start = table ? initialTarget(table) : null;
  const chosen = draft ? draft.target : start;
  const target = table ? validTarget(chosen, table) : chosen;
  const tabGone = draft?.target?.kind === 'tab' && table !== null && target === null;
  const update = useCallback(
    (change: (d: Draft) => Draft) => updateDraft(tableId, change, start),
    [tableId, start],
  );
  return { floor, table, draft, target, tabGone, update };
}
