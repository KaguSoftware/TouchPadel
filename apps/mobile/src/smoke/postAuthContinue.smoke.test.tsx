/**
 * The post-auth continuation (features/booking/usePostAuthContinue.ts) with
 * the booking gate in front of both intents: a pending slot first, then an
 * open-match intent that ends in a court booking (owner, 2026-09-29). A
 * missing phone stops either at complete-profile and a phone nobody has
 * verified at /phone-sign-in, both in continue mode with the intent kept;
 * once the gate passes the slot is held (Review, with 0252's hold warning)
 * and the match intent's screen opens. The list is browsing and opens as it is.
 *
 * Not a route case. A probe presses `continueAfterAuth` as sign-in,
 * complete-profile and verify-otp call it; the account the gate reads
 * (`auth.getUser` and the `profiles` row) and the hold's RPC are stubbed per
 * case on the global supabase mock (jest.setup.ts).
 */
import { Pressable } from 'react-native';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { TEST_VENUE_ID, courtFixture, profileFixture, type ProfileFixture } from '../test/fixtures';
import { supabase } from '../lib/supabase';
import { usePostAuthContinue } from '../features/booking/usePostAuthContinue';
import { clearPendingSlot, getPendingSlot, setPendingSlot } from '../features/booking/pendingSlot';
import {
  clearPendingJoin,
  getPendingJoin,
  pendingJoinHref,
  setPendingJoin,
  type PendingJoin,
} from '../features/matches/pendingJoin';

function Probe() {
  const { continueAfterAuth } = usePostAuthContinue();
  return <Pressable testID="probe.continue" onPress={continueAfterAuth} />;
}

const UID = '00000000-0000-4000-8000-00000000beef';
const VERIFIED = { id: UID, phone: '9647700000000', phone_confirmed_at: '2026-01-01T00:00:00.000Z' };
const UNVERIFIED = { id: UID, phone: '', phone_confirmed_at: null };
const PHONE = profileFixture().phone;

const START_AT = '2026-10-02T17:00:00.000Z';
const START: PendingJoin = {
  kind: 'start',
  venueId: TEST_VENUE_ID,
  courtId: courtFixture().id,
  startAt: START_AT,
  durationMin: 90,
  priceIqd: 40000,
};
const SLOT = {
  courtId: courtFixture().id,
  startAt: START_AT,
  durationMin: 90,
  priceIqd: 40000,
  courtNameEn: 'Court One',
  courtNameAr: 'الملعب الأول',
};

/** The account the gate reads: its auth user and its `profiles` row. */
function account(user: Record<string, unknown>, profile: ProfileFixture | null = profileFixture()) {
  const getUser = jest
    .spyOn(supabase.auth, 'getUser')
    .mockResolvedValue({ data: { user }, error: null } as never);
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = () => query;
  query.maybeSingle = () => Promise.resolve({ data: profile, error: null });
  jest.spyOn(supabase, 'from').mockReturnValue(query as never);
  return getUser;
}

/** `app.hold_slot` answering with a hold (the global mock has no `schema`). */
function holdAnswers(result: Record<string, unknown>) {
  Object.assign(supabase, {
    schema: () => ({ rpc: () => Promise.resolve({ data: result, error: null }) }),
  });
}

function run() {
  const screen = renderRoute(Probe, { session: 'in' });
  fireEvent.press(screen.getByTestId('probe.continue'));
  return screen;
}

const replaces = () => routerState.calls.filter((c) => c.method === 'replace');

afterEach(() => {
  jest.restoreAllMocks();
  delete (supabase as { schema?: unknown }).schema;
  clearPendingJoin();
  clearPendingSlot();
});

describe('the continuation after sign-in or a verified code', () => {
  it('holds a pending slot first and lands on Review, hold warning and all', async () => {
    account(VERIFIED);
    holdAnswers({
      reservation_id: 'r1',
      hold_expires_at: '2026-10-02T16:10:00.000Z',
      price_iqd: 40000,
      hold_warning: true,
    });
    setPendingSlot(SLOT);
    setPendingJoin(START);
    const screen = run();
    try {
      await waitFor(() => expect(replaces()).toHaveLength(1));
      expect(replaces()[0]).toEqual({
        method: 'replace',
        arg: {
          pathname: '/review',
          params: expect.objectContaining({ holdId: 'r1', startAt: START_AT, holdWarning: '1' }),
        },
      });
      await waitFor(() => expect(getPendingSlot()).toBeNull());
      // The slot outranks the match intent, which is not opened.
      expect(getPendingJoin()).toEqual(START);
    } finally {
      screen.unmount();
    }
  });

  it('sends a pending slot on an unverified phone to the code, the slot kept', async () => {
    account(UNVERIFIED);
    setPendingSlot(SLOT);
    const screen = run();
    try {
      await waitFor(() =>
        expect(replaces()).toEqual([
          {
            method: 'replace',
            arg: { pathname: '/phone-sign-in', params: { returnTo: 'continue', phone: PHONE } },
          },
        ]),
      );
      expect(getPendingSlot()).toEqual(SLOT);
    } finally {
      screen.unmount();
    }
  });

  it.each<PendingJoin>([
    START,
    { kind: 'slot', venueId: TEST_VENUE_ID, startAt: START_AT },
    { kind: 'link', token: 'tok' },
  ])('sends a pending $kind on an unverified phone to the code, the intent kept', async (intent) => {
    account(UNVERIFIED);
    setPendingJoin(intent);
    const screen = run();
    try {
      await waitFor(() =>
        expect(replaces()).toEqual([
          {
            method: 'replace',
            arg: { pathname: '/phone-sign-in', params: { returnTo: 'continue', phone: PHONE } },
          },
        ]),
      );
      expect(getPendingJoin()).toEqual(intent);
    } finally {
      screen.unmount();
    }
  });

  it('opens a pending start once the phone is verified, and forgets it', async () => {
    account(VERIFIED);
    setPendingJoin(START);
    const screen = run();
    try {
      await waitFor(() =>
        expect(replaces()).toEqual([{ method: 'replace', arg: pendingJoinHref(START) }]),
      );
      expect(getPendingJoin()).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('sends a pending join with no phone to complete-profile, the join kept', async () => {
    account(UNVERIFIED, profileFixture({ phone: null }));
    const join: PendingJoin = { kind: 'slot', venueId: TEST_VENUE_ID, startAt: START_AT };
    setPendingJoin(join);
    const screen = run();
    try {
      await waitFor(() =>
        expect(replaces()).toEqual([
          { method: 'replace', arg: { pathname: '/complete-profile', params: { returnTo: 'continue' } } },
        ]),
      );
      expect(getPendingJoin()).toEqual(join);
    } finally {
      screen.unmount();
    }
  });

  it('opens the list as it is, without reading the gate', async () => {
    const getUser = account(UNVERIFIED);
    const list: PendingJoin = { kind: 'list', venueId: TEST_VENUE_ID, date: '2026-10-02' };
    setPendingJoin(list);
    const screen = run();
    try {
      await waitFor(() =>
        expect(replaces()).toEqual([{ method: 'replace', arg: pendingJoinHref(list) }]),
      );
      expect(getUser).not.toHaveBeenCalled();
      expect(getPendingJoin()).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});
