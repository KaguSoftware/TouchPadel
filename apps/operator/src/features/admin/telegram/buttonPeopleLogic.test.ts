import { describe, expect, it } from 'vitest';
import { refusedTappers, type TapRow } from './buttonPeopleLogic';

const tap = (over: Partial<TapRow>): TapRow => ({
  at: '2026-09-17T10:00:00Z',
  tg_user_id: 111,
  tg_first_name: 'Ali',
  tg_username: 'ali',
  result: 'refused',
  detail: 'not_allowlisted',
  ...over,
});

describe('refusedTappers', () => {
  it('lists each person refused for not being allowed, once, with their latest try', () => {
    const out = refusedTappers(
      [tap({ at: '2026-09-17T09:00:00Z' }), tap({ at: '2026-09-17T11:00:00Z' }), tap({ tg_user_id: 222, tg_first_name: 'Sara', tg_username: null })],
      [],
    );
    expect(out).toEqual([
      { tgUserId: 111, firstName: 'Ali', username: 'ali', lastAt: '2026-09-17T11:00:00Z' },
      { tgUserId: 222, firstName: 'Sara', username: null, lastAt: '2026-09-17T10:00:00Z' },
    ]);
  });

  it('leaves out people already allowed, applied taps and other refusals', () => {
    const out = refusedTappers(
      [
        tap({ tg_user_id: 111 }),
        tap({ tg_user_id: 333, result: 'applied', detail: null }),
        tap({ tg_user_id: 444, detail: 'wrong_chat' }),
        tap({ tg_user_id: 555, detail: 'void_not_authorized' }),
      ],
      [111],
    );
    expect(out).toEqual([]);
  });
});
