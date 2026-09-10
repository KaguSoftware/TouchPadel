import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { signOut } from '../api';

/**
 * SEC-21 — signing out must take the push token with it.
 *
 * The token is a live capability: whoever holds it can push a notification to
 * this handset. Left on the row after sign-out, the next person to use a shared
 * phone keeps receiving the previous guest's booking reminders.
 *
 * Two properties, and the second is the one that is easy to get wrong: the
 * clear has to happen BEFORE auth.signOut(), because profiles_update_own is
 * `id = auth.uid()` and there is no uid left afterwards.
 */

interface Recorded {
  order: string[];
  updates: Record<string, unknown>[];
  eqIds: string[];
}

function fakeClient(opts: { uid?: string | null; updateFails?: boolean } = {}) {
  const rec: Recorded = { order: [], updates: [], eqIds: [] };
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.uid === null ? null : { id: opts.uid ?? 'guest-1' } } })),
      signOut: vi.fn(async () => {
        rec.order.push('signOut');
        return { error: null };
      }),
    },
    from: vi.fn(() => ({
      update: (payload: Record<string, unknown>) => {
        rec.order.push('update');
        rec.updates.push(payload);
        return {
          eq: async (_col: string, id: string) => {
            rec.eqIds.push(id);
            if (opts.updateFails) throw new Error('network');
            return { error: null };
          },
        };
      },
    })),
  } as unknown as SupabaseClient;
  return { client, rec };
}

describe('signOut clears the push token', () => {
  it('nulls expo_push_token for the signed-in guest, then signs out', async () => {
    const { client, rec } = fakeClient({ uid: 'guest-1' });

    await signOut(client);

    expect(rec.updates).toEqual([{ expo_push_token: null }]);
    expect(rec.eqIds).toEqual(['guest-1']);
    // Order matters: the update needs the guest's own JWT.
    expect(rec.order).toEqual(['update', 'signOut']);
  });

  it('still signs out when clearing the token fails', async () => {
    // A network hiccup must not strand somebody signed in on a shared phone.
    const { client, rec } = fakeClient({ uid: 'guest-1', updateFails: true });

    await expect(signOut(client)).resolves.toBeUndefined();
    expect(rec.order).toEqual(['update', 'signOut']);
  });

  it('signs out cleanly when there is no user to clear', async () => {
    const { client, rec } = fakeClient({ uid: null });

    await signOut(client);

    expect(rec.updates).toEqual([]);
    expect(rec.order).toEqual(['signOut']);
  });
});
