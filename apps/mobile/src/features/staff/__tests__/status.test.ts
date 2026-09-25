import { describe, expect, it } from 'vitest';
import {
  GUEST_STATUS,
  NO_SESSION,
  PENDING,
  REVOKED,
  isStaffArea,
  nextStaffStatus,
  parseStaffHint,
  serializeStaffHint,
  type StaffRead,
  type StaffStatus,
  type StaffStatusInput,
} from '../status';
import { guestTabsGate, staffGate } from '../gate';
import { pickVenueId, showsVenuePicker, staffVenueKey } from '../venue';

/**
 * The staff status machine (build-contracts-2026-09-23 §6.5), row by row of
 * its table, and the gates that render it. The hard requirement: a guest's
 * session reads `guest` at every step, so the guest app is unchanged.
 */

const UID = 'u-1';
const VENUE = 'c0000000-0000-4000-8000-000000000001';
const row = (patch: Record<string, unknown> = {}) => ({
  id: UID,
  display_name: 'Sara',
  role: 'head_chef',
  is_active: true,
  ...patch,
});
const success = (r: Record<string, unknown> | null, venueIds: string[] = [VENUE]): StaffRead => ({
  state: 'success',
  data: { row: r, venueIds },
});
const input = (patch: Partial<StaffStatusInput>): StaffStatusInput => ({
  uid: UID,
  restoring: false,
  hintUid: null,
  holdStaff: false,
  read: { state: 'pending' },
  ...patch,
});
const STAFF: StaffStatus = {
  kind: 'staff',
  staff: { id: UID, displayName: 'Sara', role: 'head_chef' },
  venues: [VENUE],
};

describe('nextStaffStatus: §6.5, row by row', () => {
  it('no session → none, whatever came before', () => {
    expect(nextStaffStatus(STAFF, UID, input({ uid: null }))).toEqual(NO_SESSION);
  });

  it('the stored session still restoring on a hinted phone → pending, so the guest tabs never mount', () => {
    expect(nextStaffStatus(NO_SESSION, null, input({ uid: null, restoring: true, hintUid: UID }))).toEqual(PENDING);
    // …and the uid that arrives keeps it pending while its row is read.
    expect(nextStaffStatus(PENDING, null, input({ hintUid: UID }))).toEqual(PENDING);
    // No hint (every guest phone), or the restore found no session: none, as before.
    expect(nextStaffStatus(NO_SESSION, null, input({ uid: null, restoring: true }))).toEqual(NO_SESSION);
    expect(nextStaffStatus(PENDING, null, input({ uid: null, restoring: false, hintUid: UID }))).toEqual(NO_SESSION);
  });

  it('read in flight with a hint for this uid → pending', () => {
    expect(nextStaffStatus(NO_SESSION, null, input({ hintUid: UID }))).toEqual(PENDING);
  });

  it('read in flight with no hint, or another uid’s → guest (a guest’s cold start is untouched)', () => {
    expect(nextStaffStatus(NO_SESSION, null, input({}))).toEqual(GUEST_STATUS);
    expect(nextStaffStatus(NO_SESSION, null, input({ hintUid: 'someone-else' }))).toEqual(GUEST_STATUS);
  });

  it('read errored → previous; a pending stays pending', () => {
    expect(nextStaffStatus(STAFF, UID, input({ read: { state: 'error' } }))).toBe(STAFF);
    expect(nextStaffStatus(PENDING, UID, input({ hintUid: UID, read: { state: 'error' } }))).toEqual(PENDING);
    expect(nextStaffStatus(GUEST_STATUS, UID, input({ read: { state: 'error' } }))).toEqual(GUEST_STATUS);
  });

  it('an errored first read falls back to what the hint says, never to another account’s status', () => {
    expect(nextStaffStatus(STAFF, 'someone-else', input({ read: { state: 'error' } }))).toEqual(GUEST_STATUS);
    expect(nextStaffStatus(NO_SESSION, null, input({ hintUid: UID, read: { state: 'error' } }))).toEqual(PENDING);
  });

  it('no row, no hint → guest (every guest session reads this)', () => {
    expect(nextStaffStatus(NO_SESSION, null, input({ read: success(null) }))).toEqual(GUEST_STATUS);
  });

  it('no row, hint for this uid → revoked', () => {
    expect(nextStaffStatus(PENDING, UID, input({ hintUid: UID, read: success(null) }))).toEqual(REVOKED);
  });

  it('keeps revoked once the hint is cleared, for the rest of the session', () => {
    expect(nextStaffStatus(REVOKED, UID, input({ hintUid: null, read: success(null) }))).toEqual(REVOKED);
  });

  it('a switched-off row → revoked, hint or not', () => {
    expect(nextStaffStatus(NO_SESSION, null, input({ read: success(row({ is_active: false })) }))).toEqual(REVOKED);
  });

  it('an active row with a role this build does not know → unsupported, not revoked', () => {
    expect(nextStaffStatus(NO_SESSION, null, input({ read: success(row({ role: 'sommelier' })) }))).toEqual({
      kind: 'unsupported',
      role: 'sommelier',
    });
  });

  it('an active row with a known role → staff, with its venues', () => {
    expect(nextStaffStatus(NO_SESSION, null, input({ read: success(row()) }))).toEqual(STAFF);
  });

  it('keeps a staff answer while a read starts over from an empty cache', () => {
    expect(nextStaffStatus(STAFF, UID, input({ read: { state: 'pending' } }))).toBe(STAFF);
    // …but a guest answer does not survive a new hint.
    expect(nextStaffStatus(GUEST_STATUS, UID, input({ hintUid: UID }))).toEqual(PENDING);
  });

  it('holds an active row at guest while a social sign-in is being checked (§6.6)', () => {
    expect(nextStaffStatus(NO_SESSION, null, input({ holdStaff: true, read: success(row()) }))).toEqual(GUEST_STATUS);
    // A switched-off row is not held: it is no staff account to route anywhere.
    expect(
      nextStaffStatus(NO_SESSION, null, input({ holdStaff: true, read: success(row({ is_active: false })) })),
    ).toEqual(REVOKED);
  });

  it('places every kind in or out of the staff area', () => {
    expect(['none', 'guest', 'pending', 'staff', 'revoked', 'unsupported'].map((k) => isStaffArea(k as never))).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('the device hint', () => {
  it('round-trips', () => {
    expect(parseStaffHint(serializeStaffHint(UID))).toEqual({ uid: UID, surface: 'staff', v: 1 });
  });

  it('reads anything that is not exactly a hint as none', () => {
    for (const raw of [null, '', 'not json', '{}', '{"uid":"u","surface":"guest","v":1}', '{"uid":"","surface":"staff","v":1}', '{"uid":"u","surface":"staff","v":2}']) {
      expect(parseStaffHint(raw), String(raw)).toBeNull();
    }
  });
});

describe('staffGate', () => {
  it('sends a guest or a signed-out phone to the guest app, and waits on pending', () => {
    expect(staffGate(GUEST_STATUS)).toBe('redirect-guest');
    expect(staffGate(NO_SESSION)).toBe('redirect-guest');
    expect(staffGate(PENDING)).toBe('loading');
  });

  it('stops a switched-off or too-new account on its own screen', () => {
    expect(staffGate(REVOKED)).toBe('revoked');
    expect(staffGate({ kind: 'unsupported', role: 'sommelier' })).toBe('unsupported');
  });

  it('lets staff in, and sends a role a page is not for back to Today', () => {
    expect(staffGate(STAFF)).toBe('allow');
    expect(staffGate(STAFF, ['head_chef', 'chef', 'manager', 'owner'])).toBe('allow');
    expect(staffGate(STAFF, ['driver', 'manager', 'owner'])).toBe('redirect-staff-home');
  });
});

describe('guestTabsGate', () => {
  it('shows a guest and a signed-out phone the tabs, exactly as before', () => {
    expect(guestTabsGate(GUEST_STATUS)).toBe('tabs');
    expect(guestTabsGate(NO_SESSION)).toBe('tabs');
  });

  it('never mounts the tabs for the staff area', () => {
    expect(guestTabsGate(PENDING)).toBe('loading');
    expect(guestTabsGate(STAFF)).toBe('redirect-staff');
    expect(guestTabsGate(REVOKED)).toBe('redirect-staff');
    expect(guestTabsGate({ kind: 'unsupported', role: 'x' })).toBe('redirect-staff');
  });
});

describe('the venue', () => {
  it('keeps the remembered venue while it is still in the list, else the first', () => {
    expect(pickVenueId(['a', 'b'], 'b')).toBe('b');
    expect(pickVenueId(['a', 'b'], 'gone')).toBe('a');
    expect(pickVenueId(['a', 'b'], null)).toBe('a');
    expect(pickVenueId([], 'b')).toBeNull();
  });

  it('shows the picker only with more than one venue, and remembers the choice per account', () => {
    expect(showsVenuePicker(['a'])).toBe(false);
    expect(showsVenuePicker(['a', 'b'])).toBe(true);
    expect(staffVenueKey('u-1')).toBe('tp.staff-venue:u-1');
  });
});
