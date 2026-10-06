import { vi } from 'vitest';
import type { MemberCard, MyLoyalty } from '@touch/core/loyalty';

/**
 * A fake account client for the loyalty web tests (/account, the café chip): the auth calls
 * the page makes and `schema('app').rpc` for `my_member_card`, `my_loyalty` and
 * `link_guest_session`. Never a live Supabase.
 */

/** The RFC 6238 test secret ("12345678901234567890") in base32, a 30 s step. */
export const TEST_CARD: MemberCard = {
  member_code: '8F3K2QXM',
  secret_b32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  step: 30,
};

export function testLoyalty(over: Partial<MyLoyalty> = {}): MyLoyalty {
  return {
    enabled: true,
    balance: 1250,
    lifetime: 2000,
    points_12m: 800,
    tier: { id: 't0', name_en: 'Member', name_ar: 'عضو', multiplier: 1 },
    next_tier: {
      id: 't1',
      name_en: 'Gold',
      name_ar: 'ذهبي',
      multiplier: 1.5,
      min_points_12m: 1000,
    },
    point_value_iqd: 50,
    min_redeem_points: 100,
    history: [
      {
        id: 'h1',
        kind: 'earn',
        delta: 40,
        venue_id: null,
        created_at: '2026-10-01T12:00:00Z',
        note: null,
      },
      {
        id: 'h2',
        kind: 'redeem',
        delta: -100,
        venue_id: null,
        created_at: '2026-10-02T12:00:00Z',
        note: null,
      },
    ],
    rewards: [
      {
        id: 'r1',
        name_en: 'Free coffee',
        name_ar: 'قهوة مجانية',
        cost_points: 300,
        kind: 'item',
        iqd_off: null,
      },
    ],
    ...over,
  };
}

export interface FakeUser {
  id: string;
  phone?: string;
  user_metadata?: Record<string, unknown>;
}

type RpcAnswer = { data: unknown; error: { message: string } | null };

export function fakeAccountClient(
  opts: {
    user?: FakeUser | null;
    signInError?: string;
    rpc?: Record<string, RpcAnswer>;
  } = {},
) {
  let user = opts.user ?? null;
  const listeners = new Set<(event: string, session: unknown) => void>();
  const session = () => (user ? { user } : null);
  const rpc = vi.fn(async (fn: string): Promise<RpcAnswer> => {
    const answer = opts.rpc?.[fn];
    if (answer) return answer;
    if (fn === 'my_member_card') return { data: TEST_CARD, error: null };
    if (fn === 'my_loyalty') return { data: testLoyalty(), error: null };
    return { data: null, error: { message: 'NOT_MOCKED' } };
  });
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      }),
      signInWithPassword: vi.fn(async () => {
        if (opts.signInError) return { data: null, error: { message: opts.signInError } };
        user = { id: 'u1', phone: '9647701234567', user_metadata: { given_name: 'Sara' } };
        for (const cb of listeners) cb('SIGNED_IN', session());
        return { data: { session: session() }, error: null };
      }),
      signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => {
        user = null;
        for (const cb of listeners) cb('SIGNED_OUT', null);
        return { error: null };
      }),
    },
    schema: vi.fn(() => ({ rpc })),
  };
  return { client, rpc };
}
