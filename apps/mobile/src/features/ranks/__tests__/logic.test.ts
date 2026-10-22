import { describe, expect, it, vi } from 'vitest';
import {
  buildScore,
  levelName,
  levelProgress,
  normaliseUsername,
  parseBoard,
  parseMyRanks,
  playerLabel,
  playersReady,
  splitPodium,
  type BoardRow,
} from '../logic';
import { answerResult, fetchBoard, findPlayer, reportGame } from '../api';

/** The leaderboard's phone rules (migration 0364): the server's numbers, read and shown, never made. */

const row = (rank: number, over: Partial<BoardRow> = {}): BoardRow => ({
  rank,
  name: `P${rank}`,
  points: 30 - rank,
  level: { nameEn: 'Rookie', nameAr: 'مبتدئ', minPoints: 0 },
  mine: false,
  ...over,
});

describe('parsing', () => {
  it('a board switched off is just that', () => {
    expect(parseBoard({ enabled: false })).toEqual({ enabled: false });
    expect(parseBoard(null)).toEqual({ enabled: false });
  });

  it('reads the board rows and drops a row without a rank', () => {
    const b = parseBoard({
      enabled: true,
      period: 'quarter',
      size: 10,
      rows: [
        { rank: 1, name: 'Sara M.', points: 9, level: { name_en: 'Rising', name_ar: 'صاعد', min_points: 20 }, mine: true },
        { name: 'nobody' },
      ],
    });
    expect(b).toMatchObject({ enabled: true, period: 'quarter', size: 10 });
    if (!b.enabled) throw new Error('expected on');
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ rank: 1, name: 'Sara M.', points: 9, mine: true });
    expect(b.rows[0]?.level).toEqual({ nameEn: 'Rising', nameAr: 'صاعد', minPoints: 20 });
  });

  it('reads the guest page, a missing rank as null and an unknown period as month', () => {
    const m = parseMyRanks({
      enabled: true,
      period: 'weekly',
      points: 0,
      lifetime: 0,
      rank: null,
      level: { name_en: 'Rookie', name_ar: 'مبتدئ', min_points: 0 },
      next_level: null,
      rules: { win: 3, loss: 0, draw: 1, report_hours: 24, reports: false },
      results: [{ id: 'r1', played_at: '2026-10-01T10:00:00Z', status: 'odd', outcome: 'won', us: [null], them: [] }],
      to_report: [{ reservation_id: 'rv', start_at: '2026-10-01T10:00:00Z', court: { name_en: 'Court 1' } }],
      recent: [{ username: 'sara', name: 'Sara M.' }, { name: 'no username' }],
    });
    if (!m.enabled) throw new Error('expected on');
    expect(m.period).toBe('month');
    expect(m.rank).toBeNull();
    expect(m.nextLevel).toBeNull();
    expect(m.rules).toEqual({ win: 3, loss: 0, draw: 1, reportHours: 24, reports: false });
    expect(m.results[0]).toMatchObject({ id: 'r1', status: 'pending', outcome: 'won', us: [null] });
    expect(m.toReport[0]).toMatchObject({ reservationId: 'rv', courtEn: 'Court 1', courtAr: 'Court 1' });
    expect(m.recent).toEqual([{ username: 'sara', name: 'Sara M.' }]);
  });
});

describe('shared rules', () => {
  it('stands the first three as a podium does: second, first, third', () => {
    const rows = [row(1), row(2), row(3), row(4), row(5)];
    const { podium, rest } = splitPodium(rows);
    expect(podium.map((r) => r?.rank)).toEqual([2, 1, 3]);
    expect(rest.map((r) => r.rank)).toEqual([4, 5]);
    expect(splitPodium([row(1)]).podium).toEqual([null, rows[0], null]);
  });

  it('measures the way to the next level, and says when there is none', () => {
    const level = { nameEn: 'Rising', nameAr: 'صاعد', minPoints: 20 };
    const next = { nameEn: 'Contender', nameAr: 'منافس', minPoints: 60 };
    expect(levelProgress(40, level, next)).toEqual({ fraction: 0.5, toNext: 20 });
    expect(levelProgress(10, level, next)).toEqual({ fraction: 0, toNext: 50 });
    expect(levelProgress(500, level, null)).toEqual({ fraction: 1, toNext: null });
  });

  it('names a level in the reading language, falling back to the other', () => {
    const l = { nameEn: 'Elite', nameAr: null, minPoints: 150 };
    expect(levelName(l, 'ar')).toBe('Elite');
    expect(levelName({ ...l, nameAr: 'نخبة' }, 'ar')).toBe('نخبة');
    expect(levelName(null, 'en')).toBeNull();
  });

  it('builds the score the server takes, or says it is half typed', () => {
    expect(buildScore([['6', '4'], ['7', '5'], ['', '']])).toBe('6-4, 7-5');
    expect(buildScore([['', ''], ['', '']])).toBeNull();
    expect(buildScore([['06', '4']])).toBe('6-4');
    expect(buildScore([['6', '']])).toBe('invalid');
    expect(buildScore([['a', '4']])).toBe('invalid');
    expect(buildScore([['100', '4']])).toBe('invalid');
  });

  it('folds a username as the server does', () => {
    expect(normaliseUsername('  @@Sara.M ')).toBe('sara.m');
  });

  it('wants three different players, none of them the guest', () => {
    expect(playersReady(['a', 'b', 'c'], 'me')).toBe('ready');
    expect(playersReady(['a', '', 'c'], 'me')).toBe('missing');
    expect(playersReady(['a', '@A', 'c'], 'me')).toBe('repeat');
    expect(playersReady(['me', 'b', 'c'], 'Me')).toBe('repeat');
  });

  it('labels a player by name, else by username, else not at all', () => {
    expect(playerLabel({ name: 'Sara M.', username: 'sara', former: false, me: false })).toBe('Sara M.');
    expect(playerLabel({ name: null, username: 'sara', former: false, me: false })).toBe('@sara');
    expect(playerLabel(null)).toBeNull();
  });
});

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(function (this: unknown) {
    expect(this).toBe(client.app);
    return Promise.resolve(result);
  });
  const app = { rpc };
  const client = { schema: vi.fn(() => app), app };
  return client;
}

describe('the calls', () => {
  it('reads the board on the app schema with no argument', async () => {
    const client = rpcClient({ data: { enabled: false }, error: null });
    expect(await fetchBoard(client as never)).toEqual({ enabled: false });
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(client.app.rpc).toHaveBeenCalledWith('ranks_board');
  });

  it('looks a username up folded, and reads a miss as null', async () => {
    const client = rpcClient({ data: null, error: null });
    expect(await findPlayer(client as never, '@Sara')).toBeNull();
    expect(client.app.rpc).toHaveBeenCalledWith('ranks_find_player', { p_username: 'sara' });
  });

  it('sends every report argument, the score as null when there is none', async () => {
    const client = rpcClient({ data: {}, error: null });
    await reportGame(client as never, {
      reservationId: 'rv',
      partner: '@Noor',
      opponent1: 'Sara',
      opponent2: 'ali',
      won: false,
      score: null,
    });
    expect(client.app.rpc).toHaveBeenCalledWith('ranks_report', {
      p_reservation_id: 'rv',
      p_partner: 'noor',
      p_opponent1: 'sara',
      p_opponent2: 'ali',
      p_won: false,
      p_score: null,
    });
  });

  it('throws a refusal as it came', async () => {
    const err = { code: 'P0001', message: 'RANKS_RESULT_CLOSED' };
    const client = rpcClient({ data: null, error: err });
    await expect(answerResult(client as never, 'r1', true)).rejects.toBe(err);
  });
});
