/**
 * The complete-profile form, kept outside any one screen. Its two steps are two
 * screens on the stack (so the native back button, the iOS swipe and Android's
 * back step back with no code of ours, as in create-account), and they share
 * this draft. The first step clears it when it leaves the stack.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from '@touch/i18n';
import type { GenderValue } from '../../components/GenderPicker';
import type { AgeBand } from '../playProfile/logic';
import { DEFAULT_ISO } from '../profile/phone';

export interface CompleteProfileDraft {
  initialised: boolean;
  /** The guest typed a name: stop following the row. */
  nameTouched: boolean;
  firstName: string;
  lastName: string;
  iso: string;
  national: string;
  /** null until the row is read: the app language decides. */
  lang: Locale | null;
  gender: GenderValue | null;
  band: AgeBand | null;
  birthDate: string | null;
  agreed: boolean;
  /** A save is under way or done: the profile refetch must not auto-continue. */
  skipped: boolean;
  /** What the first step runs once the last step has saved and popped. */
  continuation: { to: 'continue' | 'back'; lang: Locale } | null;
}

const initial = (): CompleteProfileDraft => ({
  initialised: false,
  nameTouched: false,
  firstName: '',
  lastName: '',
  iso: DEFAULT_ISO,
  national: '',
  lang: null,
  gender: null,
  band: null,
  birthDate: null,
  agreed: false,
  skipped: false,
  continuation: null,
});

let draft: CompleteProfileDraft = initial();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function resetCompleteProfileDraft(): void {
  draft = initial();
  emit();
}

export function getCompleteProfileDraft(): CompleteProfileDraft {
  return draft;
}

export function patchCompleteProfileDraft(patch: Partial<CompleteProfileDraft>): void {
  draft = { ...draft, ...patch };
  emit();
}

/** `[value, setter]` for one field, shaped like useState. */
export function useCompleteDraftField<K extends keyof CompleteProfileDraft>(
  key: K,
): [
  CompleteProfileDraft[K],
  (next: CompleteProfileDraft[K] | ((prev: CompleteProfileDraft[K]) => CompleteProfileDraft[K])) => void,
] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => draft[key],
    () => draft[key],
  );
  const set = useCallback(
    (
      next: CompleteProfileDraft[K] | ((prev: CompleteProfileDraft[K]) => CompleteProfileDraft[K]),
    ) => {
      const v =
        typeof next === 'function'
          ? (next as (p: CompleteProfileDraft[K]) => CompleteProfileDraft[K])(draft[key])
          : next;
      patchCompleteProfileDraft({ [key]: v } as Partial<CompleteProfileDraft>);
    },
    [key],
  );
  return [value, set];
}
