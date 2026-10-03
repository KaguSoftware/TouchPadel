import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));

import { AppRpcError } from '../../lib/appRpc';
import {
  entryActions,
  entryMoney,
  isLiveAdoptedBlock,
  refundsDue,
  refusedSetting,
  sortEntries,
  substitutes,
  tournamentErrorKey,
  tournamentsByReservation,
} from './tournamentLogic';
import type { TourEntry } from './tournamentPayloads';

// The tournament screens' words and small rules (tournaments build contracts §1.3, §1.9).

const err = (code: string, detail?: string) => new AppRpcError(code, code, undefined, detail);

const entry = (over: Partial<TourEntry>): TourEntry => ({
  entry_id: 'e',
  guest_id: 'g',
  full_name: 'P',
  phone: null,
  status: 'registered',
  seed_no: null,
  waitlist_position: null,
  added_by_kind: 'guest',
  owed_iqd: 0,
  net_paid_iqd: 0,
  refund_due_iqd: 0,
  substitute_for: null,
  ...over,
});

describe('tournamentErrorKey', () => {
  it('names the detail of each code this lane words', () => {
    expect(tournamentErrorKey(err('TOURNAMENT_ROUNDS_INVALID', 'stale'))).toBe(
      'ws.tournaments.errors.rounds.stale',
    );
    expect(tournamentErrorKey(err('TOURNAMENT_SCORE_REFUSED', 'locked'))).toBe(
      'ws.tournaments.errors.score.locked',
    );
    expect(tournamentErrorKey(err('TOURNAMENT_NOT_OPEN', 'cutoff'))).toBe(
      'ws.tournaments.errors.notOpen.cutoff',
    );
    expect(tournamentErrorKey(err('TOURNAMENT_PUBLISH_REFUSED', 'fee_not_approved'))).toBe(
      'ws.tournaments.publish.refused.fee_not_approved',
    );
    expect(tournamentErrorKey(err('TOURNAMENT_PUBLISH_REFUSED', 'settings:rounds'))).toBe(
      'ws.tournaments.publish.refused.settings',
    );
    expect(tournamentErrorKey(err('TOURNAMENT_NOT_PAYABLE', 'nothing_owed'))).toBe(
      'ws.tournaments.pay.notPayable.nothing_owed',
    );
    expect(tournamentErrorKey(err('INVALID_ARGUMENT', 'p_payload'))).toBe(
      'ws.tournaments.errors.rounds.payload',
    );
  });

  it('falls back to the shared catalogue for a code or detail it does not word', () => {
    expect(tournamentErrorKey(err('TOURNAMENT_FULL'))).toBe('op.errors.TOURNAMENT_FULL');
    expect(tournamentErrorKey(err('TOURNAMENT_VIA_EVENTS'))).toBe(
      'op.errors.TOURNAMENT_VIA_EVENTS',
    );
    expect(tournamentErrorKey(err('TOURNAMENT_ROUNDS_INVALID', 'new_thing'))).toBe(
      'op.errors.TOURNAMENT_ROUNDS_INVALID',
    );
  });

  it('reads the settings key a publish refusal names', () => {
    expect(refusedSetting(err('TOURNAMENT_PUBLISH_REFUSED', 'settings:points_target'))).toBe(
      'points_target',
    );
    expect(refusedSetting(err('TOURNAMENT_PUBLISH_REFUSED', 'no_blocks'))).toBeNull();
  });
});

describe('the calendar overlay', () => {
  it('maps each adopted block to its tournament, and a live one is what the guard trigger holds', () => {
    const map = tournamentsByReservation({
      tournaments_enabled: true,
      server_now: null,
      tournaments: [
        {
          id: 't1',
          name_en: 'Cup',
          name_ar: 'كأس',
          status: 'running',
          format: 'americano',
          category: 'open',
          starts_at: 'a',
          ends_at: 'b',
          registered: 8,
          waitlisted: 0,
          max_entries: 16,
          blocks: [
            { reservation_id: 'r1', court_id: 'c1', start_at: 'a', end_at: 'b' },
            { reservation_id: 'r2', court_id: 'c2', start_at: 'a', end_at: 'b' },
          ],
        },
      ],
    });
    expect([...map.keys()]).toEqual(['r1', 'r2']);
    expect(isLiveAdoptedBlock(map.get('r1'))).toBe(true);
    expect(isLiveAdoptedBlock({ ...map.get('r1')!, status: 'finished' })).toBe(false);
    expect(tournamentsByReservation(null).size).toBe(0);
  });
});

describe('entries', () => {
  it('sorts registered by seed, then the waitlist by position, then the rest', () => {
    const rows = sortEntries([
      entry({ entry_id: 'w2', status: 'waitlisted', waitlist_position: 2 }),
      entry({ entry_id: 'x', status: 'withdrawn' }),
      entry({ entry_id: 'r2', seed_no: 2 }),
      entry({ entry_id: 'w1', status: 'waitlisted', waitlist_position: 1 }),
      entry({ entry_id: 'r1', seed_no: 1 }),
    ]);
    expect(rows.map((e) => e.entry_id)).toEqual(['r1', 'r2', 'w1', 'w2', 'x']);
    expect(substitutes({ entries: rows }).map((e) => e.entry_id)).toEqual(['w1', 'w2']);
  });

  it('says owed, refund due, paid or no fee', () => {
    expect(entryMoney(entry({ owed_iqd: 25000 }), 25000)).toEqual({ kind: 'owed', amount: 25000 });
    expect(entryMoney(entry({ refund_due_iqd: 25000, net_paid_iqd: 25000 }), 25000)).toEqual({
      kind: 'refund',
      amount: 25000,
    });
    expect(entryMoney(entry({ net_paid_iqd: 25000 }), 25000)).toEqual({ kind: 'paid' });
    expect(entryMoney(entry({}), 0)).toEqual({ kind: 'none' });
    expect(
      refundsDue({
        entries: [entry({ entry_id: 'a', refund_due_iqd: 5 }), entry({ entry_id: 'b' })],
      }).map((e) => e.entry_id),
    ).toEqual(['a']);
  });

  it('offers remove while open or closed, no-show while closed or running, pay on what is owed', () => {
    const can = { add: true, set_rounds: true, score: true, cancel: true, settle: true };
    const caps = { run: true, pay: true };
    const owing = entry({ owed_iqd: 10 });
    expect(entryActions(owing, { status: 'open', can, entry_fee_iqd: 10 }, caps)).toMatchObject({
      pay: true,
      remove: true,
      noShow: false,
    });
    expect(entryActions(owing, { status: 'running', can, entry_fee_iqd: 10 }, caps)).toMatchObject({
      remove: false,
      noShow: true,
    });
    expect(
      entryActions(owing, { status: 'running', can, entry_fee_iqd: 10 }, { run: false, pay: true }),
    ).toMatchObject({ pay: true, noShow: false });
    expect(
      entryActions(
        entry({ status: 'waitlisted' }),
        { status: 'closed', can, entry_fee_iqd: 0 },
        caps,
      ),
    ).toMatchObject({ promote: true, noShow: false });
  });
});
