import type { Session } from '@supabase/supabase-js';

/**
 * The session the mocked `AuthProvider` hands out, in a mutable holder.
 *
 * Same reasoning as `routerState.ts` next door: `src/features/auth/context` is
 * mocked once in jest.setup.ts, because the gates import it at module scope,
 * and the answers it gives have to be steerable per case — `bookings` renders
 * a signed-out pitch or a list depending on exactly this.
 *
 * The fixture is the SMALLEST session the app actually reads: a user id, an
 * access token for `realtime.setAuth`, and a `user.phone` (empty by default,
 * which is what the Profile tab's "verify your number" row keys off). It is
 * cast rather than fully built — a real `Session` carries two dozen fields
 * this app never touches, and spelling them out would be fiction with more
 * words.
 */
export interface AuthState {
  session: Session | null;
}

export const authState: AuthState = { session: null };

export const TEST_SESSION = {
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4102444800,
  user: {
    id: '00000000-0000-4000-8000-00000000beef',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'guest@example.test',
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  },
} as unknown as Session;

/**
 * The same account with the profile fixture's number confirmed by a code: the
 * booking gate's `complete` (`bookingGateState`). TEST_SESSION's empty phone
 * is `unverified` against any profile that has one.
 */
export const TEST_VERIFIED_SESSION = {
  ...TEST_SESSION,
  user: { ...TEST_SESSION.user, phone: '9647700000000', phone_confirmed_at: '2026-01-01T00:00:00.000Z' },
} as unknown as Session;

export function setTestSession(mode: 'in' | 'out' | 'verified'): void {
  authState.session = mode === 'in' ? TEST_SESSION : mode === 'verified' ? TEST_VERIFIED_SESSION : null;
}
