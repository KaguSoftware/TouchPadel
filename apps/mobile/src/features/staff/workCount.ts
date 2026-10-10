/**
 * The number on Today's Work alerts button (owner, 2026-10-10): what is
 * waiting on the person on the work alerts page (app/staff-work.tsx). That is
 * today's unfinished checklists, the submissions they decide and their own
 * open steps. What they sent and what was decided are news, not work, so they
 * are on the page but not in the count.
 */
import type { MyProtocolWork } from '@touch/core';
import { checklistTodos, type ChecklistsToday } from './checklists/logic';

export function waitingCount(
  lists: ChecklistsToday | null | undefined,
  work: MyProtocolWork | null | undefined,
  now: Date = new Date(),
): number {
  const checklists = checklistTodos(lists, now).length;
  return checklists + (work ? work.to_decide.length + work.todo.length : 0);
}
