/**
 * Which assistant a person gets (owner call 2026-10-16): the paid one (Claude,
 * business data, scopes, a bill) or the free AI (Groq, pages and how-to only,
 * `assistant-free`). Staff only ever get the free one; the owner picks, and
 * the pick is kept per owner on this station. Pure, plus a tiny shared store
 * so the model switch inside the thread and the drawer around it agree.
 */

export type AssistantMode = 'paid' | 'free';

export const MODE_STORAGE_KEY = 'touch-assistant-mode-v1';

/** Who may use the paid assistant decides; for them the stored pick, else paid. */
export function resolveMode(canUsePaid: boolean, stored: AssistantMode | null): AssistantMode {
  if (!canUsePaid) return 'free';
  return stored ?? 'paid';
}

function isMode(v: unknown): v is AssistantMode {
  return v === 'paid' || v === 'free';
}

/** The pick of THIS owner, as stored: a pick saved by another owner on the station is not theirs. */
export function parseStoredMode(raw: string | null, ownerId: string): AssistantMode | null {
  if (!raw || !ownerId) return null;
  try {
    const parsed = JSON.parse(raw) as { owner?: unknown; mode?: unknown };
    return parsed.owner === ownerId && isMode(parsed.mode) ? parsed.mode : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The store: localStorage when it works, memory when it does not (private
// mode), and a listener set so every mounted reader re-renders on a change.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
let memory: { owner: string; mode: AssistantMode } | null = null;

export function loadMode(ownerId: string): AssistantMode | null {
  if (memory && memory.owner === ownerId) return memory.mode;
  try {
    return parseStoredMode(localStorage.getItem(MODE_STORAGE_KEY), ownerId);
  } catch {
    return null;
  }
}

export function saveMode(ownerId: string, mode: AssistantMode): void {
  memory = { owner: ownerId, mode };
  try {
    localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ owner: ownerId, mode }));
  } catch {
    /* private mode: memory holds it for this session */
  }
  for (const l of [...listeners]) l();
}

export function subscribeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: forget the in-memory pick. */
export function resetModeMemory(): void {
  memory = null;
}
