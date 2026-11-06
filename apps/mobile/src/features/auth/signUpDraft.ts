/**
 * The create-account form, kept outside any one screen. Each step of sign-up
 * is its own screen on the stack (so the native back button, the iOS swipe and
 * Android's back all step back for free), and the steps share this draft. The
 * first step clears it when it leaves the stack.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from '@touch/i18n';
import type { GenderValue } from '../../components/GenderPicker';
import { DEFAULT_ISO } from '../profile/phone';

export type FieldErrors = {
  firstName?: string;
  lastName?: string;
  gender?: string;
  ageBand?: string;
  email?: string;
  phone?: string;
  password?: string;
};

export interface SignUpDraft {
  firstName: string;
  lastName: string;
  gender: GenderValue | null;
  /** `YYYY-MM-DD`. */
  birthDate: string | null;
  email: string;
  iso: string;
  national: string;
  password: string;
  /** null until chosen: the app language decides. */
  preferredLang: Locale | null;
  agreed: boolean;
  /** The code was asked for: a session may land under the first step. */
  registering: boolean;
  fieldErrors: FieldErrors;
  error: string | null;
}

const initial = (): SignUpDraft => ({
  firstName: '',
  lastName: '',
  gender: null,
  birthDate: null,
  email: '',
  iso: DEFAULT_ISO,
  national: '',
  password: '',
  preferredLang: null,
  agreed: false,
  registering: false,
  fieldErrors: {},
  error: null,
});

let draft: SignUpDraft = initial();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function resetSignUpDraft(): void {
  draft = initial();
  emit();
}

export function patchSignUpDraft(patch: Partial<SignUpDraft>): void {
  draft = { ...draft, ...patch };
  emit();
}

/** `[value, setter]` for one field, shaped like useState (the setter takes an updater too). */
export function useDraftField<K extends keyof SignUpDraft>(
  key: K,
): [SignUpDraft[K], (next: SignUpDraft[K] | ((prev: SignUpDraft[K]) => SignUpDraft[K])) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => draft[key],
    () => draft[key],
  );
  const set = useCallback(
    (next: SignUpDraft[K] | ((prev: SignUpDraft[K]) => SignUpDraft[K])) => {
      const v =
        typeof next === 'function'
          ? (next as (p: SignUpDraft[K]) => SignUpDraft[K])(draft[key])
          : next;
      patchSignUpDraft({ [key]: v } as Partial<SignUpDraft>);
    },
    [key],
  );
  return [value, set];
}
