import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { memberToken } from '@touch/core/loyalty';
import { appRpc } from '@/lib/appRpc';
import { readMemberCard, readMyLoyalty } from './account';

/**
 * The café's "earn points" link (loyalty build contracts §1.3 `link_guest_session`, plan
 * §5.2). Two sessions share one browser: the café's anonymous table session (the default
 * `sb-*` cookie) and the member's account (`sb-tp-account`). The account client reads the
 * member card and computes the current token; the CAFÉ client sends it, so the server ties
 * the caller's live guest session to the member, and the settled tab earns for them
 * (`app.tab_customer`).
 *
 * Linked once per guest session and account: the result is kept for the page's life and in
 * sessionStorage, so a reload asks for the balance again but never re-links.
 */

type Client = SupabaseClient<Database>;

export type GuestLink =
  | { status: 'signed-out' }
  /** Loyalty is switched off (`my_loyalty.enabled`): nothing to offer, the chip hides. */
  | { status: 'off' }
  | { status: 'linked'; name: string; balance: number | null }
  | { status: 'failed' };

const inFlight = new Map<string, Promise<GuestLink>>();

const STORAGE_PREFIX = 'tp-earn-linked:';

function remembered(key: string): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function remember(key: string, name: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, name);
  } catch {
    // Private mode or blocked storage: the page-life map still holds it.
  }
}

/**
 * Link the café session `guestSessionId` to the signed-in member, once. Never throws: a
 * failure is `failed` (the chip offers a quiet retry), and the café flow never waits on it.
 */
export function linkGuestSessionOnce(
  cafe: Client,
  account: Client,
  guestSessionId: string,
  nowMs: () => number = Date.now,
): Promise<GuestLink> {
  return (async (): Promise<GuestLink> => {
    const { data } = await account.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      // Signed out: offer sign-in only while the programme is on (app.loyalty_public, anon).
      // An unreadable switch counts as on, so a failed read never hides the way in.
      const { data: pub } = await appRpc(cafe, 'loyalty_public');
      const enabled = (pub as { enabled?: boolean } | null)?.enabled;
      return enabled === false ? { status: 'off' } : { status: 'signed-out' };
    }

    const key = `${guestSessionId}:${userId}`;
    const running = inFlight.get(key);
    if (running) return running;

    const p = (async (): Promise<GuestLink> => {
      const loyalty = await readMyLoyalty(account);
      if (loyalty && loyalty.enabled === false) return { status: 'off' };
      const balance = loyalty ? loyalty.balance : null;

      const known = remembered(key);
      if (known !== null) return { status: 'linked', name: known, balance };

      const card = await readMemberCard(account);
      if (!card) return { status: 'failed' };
      const { token } = memberToken(card, nowMs());
      const { data: linked, error } = await appRpc(cafe, 'link_guest_session', {
        p_member_token: token,
      });
      // 0308 (c3): a token the server refuses is answered {linked: false} (so the try is counted),
      // never raised.
      if (error || !linked || (linked as { linked?: unknown }).linked !== true) {
        return { status: 'failed' };
      }
      const name = (linked as { display_name?: unknown }).display_name;
      const display = typeof name === 'string' ? name : '';
      remember(key, display);
      return { status: 'linked', name: display, balance };
    })().catch((): GuestLink => ({ status: 'failed' }));

    inFlight.set(key, p);
    // Only a link that worked is kept for the page's life, so a retry really retries.
    void p.then((r) => {
      if (r.status !== 'linked') inFlight.delete(key);
    });
    return p;
  })().catch((): GuestLink => ({ status: 'failed' }));
}

/** Test seam: forget every link of this page. */
export function __resetGuestLinksForTests(): void {
  inFlight.clear();
}
