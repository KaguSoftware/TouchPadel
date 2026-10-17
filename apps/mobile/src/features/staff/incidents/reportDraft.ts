/**
 * The incident report being written, shared by its step pages. Each step is a
 * page of its own on the stack (so the native back goes back a step, as the
 * tournament start's do), and the pages are siblings: the report lives here,
 * named by the `draft` param the first page minted. Memory only; it goes when
 * the report is sent, and one left half-written is forgotten with the app.
 */
import { useSyncExternalStore } from 'react';
import type { AttachedPhoto } from '../../../components/PhotoButton';
import { emptyIncidentDraft, type IncidentDraft, type IncidentField, type WhenChoice } from './logic';

export interface ReportDraft {
  draft: IncidentDraft;
  /** The photos as attached (their paths go in `draft.photos` when it is sent). */
  photos: AttachedPhoto[];
  /** Which "When" card is picked; a quick one is counted back from `openedAt`. */
  whenChoice: WhenChoice;
  /** When the report was opened: the quick times' "now", and the picker's window. */
  openedAt: number;
  /**
   * The fields that were missing an answer when Next or Send was pressed. Only
   * these speak, and each falls silent once answered (the operator's rule).
   */
  flagged: IncidentField[];
  /** One report is one intent until it lands. */
  intent: string;
}

const drafts = new Map<string, ReportDraft>();
const listeners = new Set<() => void>();

export function newReportId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function ensure(id: string): ReportDraft {
  let d = drafts.get(id);
  if (!d) {
    const now = Date.now();
    d = { draft: emptyIncidentDraft(now), photos: [], whenChoice: 'now', openedAt: now, flagged: [], intent: `incident.submit:${id}` };
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

export function useReportDraft(id: string): ReportDraft {
  return useSyncExternalStore(subscribe, () => ensure(id));
}

export function updateReport(id: string, patch: Partial<Omit<ReportDraft, 'draft'>> & { draft?: Partial<IncidentDraft> }): void {
  const d = ensure(id);
  drafts.set(id, { ...d, ...patch, draft: patch.draft ? { ...d.draft, ...patch.draft } : d.draft });
  for (const l of listeners) l();
}

export function dropReport(id: string): void {
  drafts.delete(id);
}
