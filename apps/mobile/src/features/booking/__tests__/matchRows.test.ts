import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { myMatchRowFixture } from '../../../test/fixtures';
import type { MySeat } from '../../matches/logic';
import { matchLineOf, matchPillStatus, matchShareOf } from '../matchRows';

/**
 * An open match drawn as a My Reservations row (docs/design/open-matches/
 * guest.md §4.16): the pill is the nearest booking word, the line is the
 * guest's §4.15 state with the party's share.
 */

const T = makeT('en');
const CTX = { t: T, locale: 'en' as const, timezone: 'Asia/Baghdad' };

const seat = (over: Partial<MySeat> = {}): MySeat => ({
  seatId: 's-1',
  seatNo: 1,
  kind: 'account',
  status: 'in',
  endReason: null,
  shareIqd: 10000,
  requestId: null,
  ticketStatus: 'in_use',
  ...over,
});

describe('matchPillStatus', () => {
  it('wears the booking pill that means the same thing', () => {
    expect(matchPillStatus('booked')).toBe('confirmed');
    expect(matchPillStatus('checkedIn')).toBe('arrived');
    expect(matchPillStatus('played')).toBe('completed');
    expect(matchPillStatus('noShow')).toBe('no_show');
  });

  it('reads every other ending as cancelled, and a live match as pending', () => {
    for (const s of ['bumped', 'expired', 'noCourt', 'left', 'refilled', 'declined', 'unknown'] as const) {
      expect(matchPillStatus(s)).toBe('cancelled');
    }
    expect(matchPillStatus('in')).toBe('pending');
    expect(matchPillStatus('requested')).toBe('pending');
  });
});

describe('matchLineOf', () => {
  it("is the guest's state line", () => {
    // A filling match at 3/4 (row 6): "You're in · waiting for 1 more player · fills by …".
    const line = matchLineOf(myMatchRowFixture(), CTX);
    expect(line.startsWith("You're in · waiting for")).toBe(true);
    expect(line).toContain('1 more player');
  });

  it("adds the party's share on a booked match: the own seat and the friends still in", () => {
    const row = myMatchRowFixture({
      status: 'booked',
      seatsTaken: 4,
      mySeats: [seat(), seat({ seatId: 's-2', seatNo: 2, kind: 'friend' }), seat({ seatId: 's-3', seatNo: 3, kind: 'friend', status: 'left' })],
    });
    expect(matchShareOf(row)).toBe(20000);
    expect(matchLineOf(row, CTX)).toContain(T('matches.states.booked'));
  });

  it('has no share without a seat', () => {
    expect(matchShareOf(myMatchRowFixture({ mySeats: [] }))).toBeNull();
  });
});
