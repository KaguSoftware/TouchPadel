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
 *   • THE CONSENT SCREEN (app/accept-terms.tsx). Everyone else whose recorded
 *     version is not CURRENT_TERMS_VERSION: Apple and Google sign-ups,
 *     desk-created accounts, accounts from before 0153, and every guest after a
 *     version bump. Not at launch (owner, 2026-10-10): where an action needs
 *     the terms. Review asks before a court booking (termsCheck); open
 *     matches, lessons, tournaments and tickets are refused TERMS_REQUIRED by
 *     the server and their screens open it.
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
 * before the consent screen closes: Review still reading the old row would
 * send the guest straight back to it.
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
 *   'ask'     not accepted: the consent screen is shown where it is needed
 *             (termsCheck below), never pushed at launch
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

/**
 * Whether an action that needs the terms (a court booking at Review) may go
 * ahead: 'ok' accepted, or ticked at sign-up for this version (the gate records
 * it); 'ask' open the consent screen first; 'unknown' not loaded yet, so read
 * it before deciding. Never 'ok' on a row that has not loaded: that is how an
 * action would slip past the terms.
 */
export type TermsCheck = 'ok' | 'ask' | 'unknown';

export function termsCheck(
  consent: ConsentRow | null | undefined,
  userMetadata: Record<string, unknown> | null | undefined,
  current: string = CURRENT_TERMS_VERSION,
): TermsCheck {
  if (consent === undefined) return 'unknown';
  // No row is an anonymous café session: it cannot book, and the server says so.
  if (consent === null) return 'ok';
  return consentAction(consent, userMetadata, current) === 'ask' ? 'ask' : 'ok';
}

/** How close to the bottom counts as "read to the end" (a fling rarely lands on 0). */
export const READ_TO_END_SLACK = 24;

/**
 * Whether the guest has scrolled the Terms and Privacy text on the consent
 * screen to its end, which unlocks the agree checkbox. Text that fits without
 * scrolling (a tall screen, large type turned down) counts as read once it has
 * been measured; nothing counts before it has.
 */
export function readToEnd(m: { offsetY: number; viewportHeight: number; contentHeight: number }): boolean {
  if (m.viewportHeight <= 0 || m.contentHeight <= 0) return false;
  return m.offsetY + m.viewportHeight >= m.contentHeight - READ_TO_END_SLACK;
}
