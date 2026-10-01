/**
 * Which guide steps a person has ticked "I know this" on, kept on this station
 * per staff member: `touch-operator-guide:<staff.id>` holds a JSON array of
 * step ids (`cashier.pay.cash`, …). Station-local on purpose: it is a learning
 * aid, not a record, and nothing else reads it.
 *
 * Every access is wrapped (the house pattern in lib/workspaces.ts): private
 * mode, a full quota or a hand-edited value must never stop the dialog from
 * opening. Bad JSON, a non-array and non-string entries all read as nothing
 * ticked.
 */

export const GUIDE_STORAGE_PREFIX = 'touch-operator-guide:';

export function guideStorageKey(staffId: string): string {
  return `${GUIDE_STORAGE_PREFIX}${staffId}`;
}

/**
 * The ticked step ids. With `known`, ids that are not (or no longer) a step of
 * any guide are dropped, so a step renamed in a later build does not count.
 */
export function loadLearned(staffId: string, known?: ReadonlySet<string>): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(guideStorageKey(staffId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const ids = parsed.filter((id): id is string => typeof id === 'string' && (!known || known.has(id)));
    return new Set(ids);
  } catch {
    return new Set();
  }
}

export function saveLearned(staffId: string, learned: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(guideStorageKey(staffId), JSON.stringify([...learned].sort()));
  } catch {
    /* private mode or full: the ticks last until the dialog closes */
  }
}

/** Tick or untick one step; returns the new set (the input is not changed). */
export function toggleLearned(learned: ReadonlySet<string>, stepId: string, on: boolean): Set<string> {
  const next = new Set(learned);
  if (on) next.add(stepId);
  else next.delete(stepId);
  return next;
}

/**
 * "Start over" for one workspace: drops every id under `prefix` (`cashier.`)
 * and keeps the others, so starting the till's guide again leaves what the
 * same person learned at the desk. Returns what is left.
 */
export function clearLearned(staffId: string, prefix: string): Set<string> {
  const kept = new Set([...loadLearned(staffId)].filter((id) => !id.startsWith(prefix)));
  try {
    if (kept.size === 0) globalThis.localStorage?.removeItem(guideStorageKey(staffId));
    else globalThis.localStorage?.setItem(guideStorageKey(staffId), JSON.stringify([...kept].sort()));
  } catch {
    /* as saveLearned */
  }
  return kept;
}
