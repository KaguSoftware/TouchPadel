/**
 * Whether this phone's user has read and accepted the AI notice (`tp.assistantAiOk`): before the
 * first question, the assistant says its answers are written by AI and that what is typed (and, for
 * the owner's assistant, the business figures it reads) goes to an outside AI provider, the one the
 * Privacy Policy names. App Review 5.1.2(i) wants that said, and agreed to, before anything is sent.
 *
 * One flag per install, like `freeMode.ts`: it never names anyone and needs no place on the deletion
 * purge list. Read once per launch and held in memory. Until it is read the screen waits; an
 * unreadable store reads as "not accepted", so the notice shows again rather than being skipped.
 */
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../../lib/telemetry';

export const AI_CONSENT_KEY = 'tp.assistantAiOk';

/** undefined = not read yet. */
let ok: boolean | undefined;
let reading = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadAiConsent(): void {
  if (ok !== undefined || reading) return;
  reading = true;
  AsyncStorage.getItem(AI_CONSENT_KEY)
    .then((v) => {
      if (ok === undefined) ok = v === '1';
    })
    .catch((error) => {
      captureException(error, { label: 'assistant.aiConsent.read' });
      if (ok === undefined) ok = false;
    })
    .finally(() => {
      reading = false;
      emit();
    });
}

const read = () => ok;

/** `undefined` until read, then whether the AI notice was accepted on this phone. */
export function useAiConsent(): boolean | undefined {
  useEffect(loadAiConsent, []);
  return useSyncExternalStore(subscribe, read, read);
}

export function acceptAiConsent(): void {
  ok = true;
  emit();
  AsyncStorage.setItem(AI_CONSENT_KEY, '1').catch((error) =>
    captureException(error, { label: 'assistant.aiConsent.write' }),
  );
}

/** Tests only: set or forget the in-memory answer. */
export function __setAiConsent(value: boolean | undefined): void {
  ok = value;
  reading = false;
  emit();
}
