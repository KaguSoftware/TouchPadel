import { describe, expect, it } from 'vitest';
import { courtUsageFromError, durationsValid, moveAmongShown, toggleDuration } from './courtsLogic';
import { AppRpcError } from '../../../lib/appRpc';

describe('toggleDuration', () => {
  it('adds, removes and keeps the list sorted', () => {
    expect(toggleDuration([60, 90], 45)).toEqual([45, 60, 90]);
    expect(toggleDuration([45, 60, 90], 60)).toEqual([45, 90]);
  });
});

describe('durationsValid', () => {
  it('mirrors the 0062 contract: non-empty, 30-300, 15-minute steps', () => {
    expect(durationsValid([60, 90])).toBe(true);
    expect(durationsValid([])).toBe(false);
    expect(durationsValid([20])).toBe(false);
    expect(durationsValid([65])).toBe(false);
    expect(durationsValid([330])).toBe(false);
  });
});

describe('courtUsageFromError', () => {
  it('reads the counts app.delete_court puts in the refusal detail', () => {
    const err = new AppRpcError(
      'COURT_IN_USE',
      'COURT_IN_USE',
      'deactivate the court instead',
      '{"reservations": 12, "series": 2, "rate_rules": 3}',
    );
    expect(courtUsageFromError(err)).toEqual({ reservations: 12, series: 2, rate_rules: 3 });
  });

  it('is null for anything that is not that refusal', () => {
    expect(courtUsageFromError(new AppRpcError('FORBIDDEN', 'FORBIDDEN'))).toBeNull();
    expect(courtUsageFromError(new AppRpcError('COURT_NOT_FOUND', 'COURT_NOT_FOUND'))).toBeNull();
    expect(courtUsageFromError(new Error('boom'))).toBeNull();
    expect(courtUsageFromError(null)).toBeNull();
  });

  it('still refuses when the detail is missing or unreadable', () => {
    // The operator needs the refusal and the deactivate far more than they need
    // the numbers; throwing here would show them neither.
    const zero = { reservations: 0, series: 0, rate_rules: 0 };
    expect(courtUsageFromError(new AppRpcError('COURT_IN_USE', 'COURT_IN_USE'))).toEqual(zero);
    expect(courtUsageFromError(new AppRpcError('COURT_IN_USE', 'x', undefined, 'not json'))).toEqual(zero);
    expect(courtUsageFromError(new AppRpcError('COURT_IN_USE', 'x', undefined, '{"reservations":"?"}'))).toEqual(zero);
  });
});

describe('moveAmongShown', () => {
  const all = ['a', 'off1', 'b', 'off2', 'c'];
  const shown = ['a', 'b', 'c'];

  it('swaps with the neighbour the owner can SEE, leaving folded courts where they were', () => {
    expect(moveAmongShown(all, shown, 'b', -1)).toEqual(['b', 'off1', 'a', 'off2', 'c']);
    expect(moveAmongShown(all, shown, 'b', 1)).toEqual(['a', 'off1', 'c', 'off2', 'b']);
  });

  it('is the plain adjacent swap when nothing is folded', () => {
    expect(moveAmongShown(shown, shown, 'a', 1)).toEqual(['b', 'a', 'c']);
  });

  it('goes nowhere past either end or for an unknown court', () => {
    expect(moveAmongShown(all, shown, 'a', -1)).toBeNull();
    expect(moveAmongShown(all, shown, 'c', 1)).toBeNull();
    expect(moveAmongShown(all, shown, 'zz', 1)).toBeNull();
  });
});
