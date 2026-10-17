/**
 * The tournament plan being started, shared by its step pages. Each step is a
 * page of its own on the stack (so the native back goes back a step), and the
 * pages are siblings, not parent and child: the plan lives here, named by the
 * `plan` param the type card minted. It is memory only and goes when the start
 * lands; a plan left half-done is forgotten with the app.
 */
import { useSyncExternalStore } from 'react';
import { emptyPlan, type FieldIssue, type PlanState, type TournamentVariant } from '@touch/core';

export interface TournamentDraft {
  plan: PlanState;
  /** What the validator or the server said, each shown on its own step's page. */
  issues: FieldIssue[];
  /** The day the courts step shows (null until the venue's hours are read). */
  day: string | null;
  /** One start is one intent until it lands (§6.4). */
  intent: string;
}

const drafts = new Map<string, TournamentDraft>();
const listeners = new Set<() => void>();

export function newPlanId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function ensure(id: string, variant: TournamentVariant): TournamentDraft {
  let d = drafts.get(id);
  if (!d) {
    d = { plan: emptyPlan(variant), issues: [], day: null, intent: `start:tournament:${id}` };
    drafts.set(id, d);
  }
  return d;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTournamentDraft(id: string, variant: TournamentVariant): TournamentDraft {
  return useSyncExternalStore(subscribe, () => ensure(id, variant));
}

export function updateDraft(
  id: string,
  variant: TournamentVariant,
  patch: Partial<Omit<TournamentDraft, 'plan'>> & { plan?: Partial<PlanState> },
): void {
  const d = ensure(id, variant);
  drafts.set(id, { ...d, ...patch, plan: patch.plan ? { ...d.plan, ...patch.plan } : d.plan });
  for (const l of listeners) l();
}

export function dropDraft(id: string): void {
  drafts.delete(id);
}
