/**
 * The hiring start being filled in, shared by its step pages (hiringSteps.ts).
 * Each step is a page of its own on the stack, siblings rather than parent and
 * child, so the answers live here, named by the `plan` param the kind card
 * minted. Memory only, like tournamentDraft.ts: it goes when the start lands,
 * and a start left half-done is forgotten with the app.
 */
import { useSyncExternalStore } from 'react';
import type { FieldIssue } from '@touch/core';
import { emptyAnswers, type HiringAnswers } from './hiringSteps';

export interface HiringDraft {
  answers: HiringAnswers;
  /** The run's names; null until typed, which shows the one made from the role. */
  titleEn: string | null;
  titleAr: string | null;
  /** What the validator or the server said, each shown on its own step's page. */
  issues: FieldIssue[];
  /** One start is one intent until it lands (§6.4). */
  intent: string;
}

const drafts = new Map<string, HiringDraft>();
const listeners = new Set<() => void>();

function ensure(id: string): HiringDraft {
  let d = drafts.get(id);
  if (!d) {
    d = { answers: emptyAnswers(), titleEn: null, titleAr: null, issues: [], intent: `start:hiring:${id}` };
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

export function useHiringDraft(id: string): HiringDraft {
  return useSyncExternalStore(subscribe, () => ensure(id));
}

export function updateHiringDraft(
  id: string,
  patch: Partial<Omit<HiringDraft, 'answers'>> & { answers?: Partial<HiringAnswers> },
): void {
  const d = ensure(id);
  drafts.set(id, { ...d, ...patch, answers: patch.answers ? { ...d.answers, ...patch.answers } : d.answers });
  for (const l of listeners) l();
}

export function dropHiringDraft(id: string): void {
  drafts.delete(id);
}
