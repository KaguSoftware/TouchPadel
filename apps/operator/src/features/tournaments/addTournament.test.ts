import { describe, expect, it } from 'vitest';
import { addTournamentTarget } from './addTournament';

describe('addTournamentTarget', () => {
  it('sends the court desk to the start form on /tasks', () => {
    expect(addTournamentTarget('court_desk')).toEqual({
      to: '/tasks',
      search: { start: 'tournament' },
    });
  });

  it('sends a manager or owner to the start form on /protocols', () => {
    expect(addTournamentTarget('manager')).toEqual({
      to: '/protocols',
      search: { start: 'tournament' },
    });
    expect(addTournamentTarget('owner')).toEqual({
      to: '/protocols',
      search: { start: 'tournament' },
    });
  });

  it('gives no button to a role that may not start one', () => {
    expect(addTournamentTarget('cashier')).toBeNull();
    expect(addTournamentTarget(undefined)).toBeNull();
  });
});
