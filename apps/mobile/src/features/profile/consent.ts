/**
 * Terms of Service / Privacy Policy consent (migration 0153).
 *
 * The record is profiles.terms_version + terms_accepted_at, written only by
 * app.accept_terms with the server clock. Two ways in:
 *
 *   • SIGN-UP. The consent switch on app/sign-up.tsx must be on to submit, and
 *     the accepted version rides in the sign-up metadata (`terms_version`). No
 *     session exists yet at that moment (the phone code or the email link comes
 *     first), so nothing can be recorded then; once the session lands, the gate
 *     sees the metadata and records it WITHOUT asking again.
 *   • THE GATE (app/accept-terms.tsx). Everyone else whose recorded version is
 *     not CURRENT_TERMS_VERSION: Apple and Google sign-ups, desk-created
 *     accounts, accounts from before 0153, and every guest after a version bump.
 *
 * Pure: takes the client, no React Native imports (vitest runs it in node).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { CURRENT_TERMS_VERSION } from '@touch/core';

type Client = SupabaseClient<Database>;

export interface ConsentRow {
  terms_version: string | null;
  terms_accepted_at: string | null;
}

export async function fetchOwnConsent(client: Client, uid: string): Promise<ConsentRow | null> {
  const { data, error } = await client
    .from('profiles')
    .select('terms_version, terms_accepted_at')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  return data as ConsentRow | null;
}

/**
 * Returns the row as it now stands, so the caller can put it in the cache
 * before the consent screen closes: a gate still reading the old row would
 * present the screen a second time.
 */
export async function acceptTerms(client: Client, version: string = CURRENT_TERMS_VERSION): Promise<ConsentRow> {
  const { data, error } = await client.schema('app').rpc('accept_terms', { p_version: version });
  if (error) throw error;
  const at = (data as { terms_accepted_at?: string } | null)?.terms_accepted_at;
  return { terms_version: version, terms_accepted_at: at ?? new Date().toISOString() };
}

/**
 *   'none'    nothing to do: accepted already, or not known yet (a profile
 *             that has not loaded must never flash the gate)
 *   'record'  the guest ticked the switch at sign-up for THIS version; record it
 *   'ask'     show the consent screen
 */
export type ConsentAction = 'none' | 'record' | 'ask';

export function consentAction(
  consent: ConsentRow | null | undefined,
  userMetadata: Record<string, unknown> | null | undefined,
  current: string = CURRENT_TERMS_VERSION,
): ConsentAction {
  if (!consent) return 'none';
  if (consent.terms_version === current) return 'none';
  if (userMetadata?.terms_version === current) return 'record';
  return 'ask';
}

/** How long a dispatched push may take to show up on the navigation stack. */
export const GATE_PUSH_SETTLE_MS = 2_000;

/**
 * Whether the gate should push the consent screen now. Once per ask: routes
 * change several times around a sign-in before a pushed modal lands, and
 * pushing on each of them stacked two or three copies, so the guest accepted
 * the terms two or three times. So nothing is pushed while the screen is
 * already on the stack, or while a push is still on its way to it
 * (`pushedAt` within GATE_PUSH_SETTLE_MS). A screen that has left the stack
 * while the account is still asked (Android's back button, a later replace)
 * is pushed again.
 */
export function shouldPushGate(args: {
  action: ConsentAction;
  onExemptScreen: boolean;
  inStack: boolean;
  pushedAt: number | null;
  now: number;
}): boolean {
  const { action, onExemptScreen, inStack, pushedAt, now } = args;
  if (action !== 'ask' || onExemptScreen || inStack) return false;
  return pushedAt === null || now - pushedAt > GATE_PUSH_SETTLE_MS;
}

interface NavState {
  routes?: readonly { name: string; state?: NavState }[];
}

/** Whether a route by this name is anywhere in the navigation tree. */
export function stackHas(state: NavState | null | undefined, name: string): boolean {
  return (state?.routes ?? []).some((route) => route.name === name || stackHas(route.state, name));
}
