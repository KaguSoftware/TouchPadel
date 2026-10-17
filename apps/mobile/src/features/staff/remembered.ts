/**
 * The choices a staff page remembers on this phone (`tp.staffChoices`): which
 * store, which filter (Sait, 2026-10-17). One map per install, not per
 * account, like askDismissed.ts and for its reason: a key named by the
 * account's uuid would be a durable record of the account and would have to
 * join the deletion purge list. "Bakery" is a preference about this phone.
 *
 * Read once per launch and held in memory; an unreadable store costs the
 * page's default, never a crash. Which value wins is rememberedLogic.ts.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../../lib/telemetry';
import { openingChoice, parseChoices } from './rememberedLogic';

export const STAFF_CHOICES_KEY = 'tp.staffChoices';

/** undefined = not read yet. */
let choices: Record<string, string> | undefined;
let reading = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load() {
  if (choices !== undefined || reading) return;
  reading = true;
  AsyncStorage.getItem(STAFF_CHOICES_KEY)
    .then((raw) => {
      if (choices === undefined) choices = parseChoices(raw);
    })
    .catch((error) => {
      captureException(error, { label: 'staffChoices.read' });
      if (choices === undefined) choices = {};
    })
    .finally(() => {
      reading = false;
      emit();
    });
}

const read = () => choices;

function remember(key: string, value: string) {
  choices = { ...(choices ?? {}), [key]: value };
  emit();
  AsyncStorage.setItem(STAFF_CHOICES_KEY, JSON.stringify(choices)).catch((error) =>
    captureException(error, { label: 'staffChoices.write' }),
  );
}

/**
 * `[value, set]` for one remembered choice. `key` names it (`stock.store`);
 * `fromLink` is the page's `?filter=`-style param, which wins when it is one
 * of `allowed`. Until the store is read the page shows `fallback`.
 */
export function useRememberedChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  fromLink?: string | null,
): [T, (value: T) => void] {
  useEffect(load, []);
  const all = useSyncExternalStore(subscribe, read, read);
  // What the person picks on this visit beats the link that opened the page.
  const [picked, setPicked] = useState<T | null>(null);
  const value =
    picked && allowed.includes(picked)
      ? picked
      : openingChoice(allowed, fallback, all?.[key], fromLink);
  const set = useCallback(
    (v: T) => {
      setPicked(v);
      remember(key, v);
    },
    [key],
  );
  return [value, set];
}

/**
 * Tests only: start from `seed` as if the store had been read (a fresh phone
 * when left out), so no render waits on, or inherits from, another's choice.
 */
export function __resetStaffChoices(seed: Record<string, string> = {}): void {
  choices = { ...seed };
  reading = false;
}
