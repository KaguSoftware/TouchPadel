import { describe, expect, it } from 'vitest';
import type { DepositSettings } from './depositApi';
import {
  DEPOSIT_SERVER_FIELD,
  bpToWholePercent,
  depositDraftErrors,
  depositPatch,
  draftFromDeposit,
  minutesToSeconds,
  percentToBp,
  secondsToWholeMinutes,
  type DepositDraft,
} from './depositSettingsLogic';

const SAVED: DepositSettings = {
  venue_id: 'v1',
  deposit_mode: 'off',
  deposit_percent_bp: 5000,
  deposit_min_iqd: 10000,
  deposit_max_iqd: null,
  deposit_window_seconds: 900,
  deposit_forfeit_no_show: true,
};

const draft = (over: Partial<DepositDraft> = {}): DepositDraft => ({ ...draftFromDeposit(SAVED), ...over });

describe('unit conversion', () => {
  it('percent ↔ basis points', () => {
    expect(percentToBp(50)).toBe(5000);
    expect(percentToBp(1)).toBe(100);
    expect(percentToBp(100)).toBe(10000);
    expect(bpToWholePercent(5000)).toBe(50);
    expect(bpToWholePercent(3333)).toBe(33);
  });

  it('minutes ↔ seconds', () => {
    expect(minutesToSeconds(15)).toBe(900);
    expect(minutesToSeconds(2)).toBe(120);
    expect(minutesToSeconds(30)).toBe(1800);
    expect(secondsToWholeMinutes(900)).toBe(15);
  });
});

describe('draftFromDeposit', () => {
  it('shows each rule in the unit it is typed in, and no cap as an empty field', () => {
    expect(draftFromDeposit(SAVED)).toEqual({
      mode: 'off',
      percent: '50',
      minIqd: '10000',
      maxIqd: '',
      windowMinutes: '15',
      forfeitNoShow: true,
    });
    expect(draftFromDeposit({ ...SAVED, deposit_max_iqd: 30000 }).maxIqd).toBe('30000');
  });
});

describe('depositPatch', () => {
  it('is empty when nothing changed', () => {
    expect(depositPatch(SAVED, draft())).toEqual({});
  });

  it('sends only the changed keys, in the server units', () => {
    expect(depositPatch(SAVED, draft({ mode: 'optional' }))).toEqual({ deposit_mode: 'optional' });
    expect(depositPatch(SAVED, draft({ percent: '30' }))).toEqual({ deposit_percent_bp: 3000 });
    expect(depositPatch(SAVED, draft({ windowMinutes: '10' }))).toEqual({ deposit_window_seconds: 600 });
    expect(depositPatch(SAVED, draft({ minIqd: '5000', forfeitNoShow: false }))).toEqual({ deposit_min_iqd: 5000, deposit_forfeit_no_show: false });
  });

  it('a typed cap is a number; clearing it sends null', () => {
    expect(depositPatch(SAVED, draft({ maxIqd: '25000' }))).toEqual({ deposit_max_iqd: 25000 });
    const capped = { ...SAVED, deposit_max_iqd: 25000 };
    expect(depositPatch(capped, { ...draftFromDeposit(capped), maxIqd: '  ' })).toEqual({ deposit_max_iqd: null });
    expect(depositPatch(capped, draftFromDeposit(capped))).toEqual({});
  });

  it('leaves a value the form cannot show exactly alone until that field is edited', () => {
    const odd = { ...SAVED, deposit_percent_bp: 3333, deposit_window_seconds: 150 };
    expect(depositPatch(odd, draftFromDeposit(odd))).toEqual({});
    expect(depositPatch(odd, { ...draftFromDeposit(odd), percent: '34' })).toEqual({ deposit_percent_bp: 3400 });
  });
});

describe('depositDraftErrors', () => {
  it('accepts the shipped defaults', () => {
    expect(depositDraftErrors(draft())).toEqual({});
  });

  it('holds each number to the bounds the server enforces', () => {
    expect(depositDraftErrors(draft({ percent: '0' })).percent).toBe('range');
    expect(depositDraftErrors(draft({ percent: '101' })).percent).toBe('range');
    expect(depositDraftErrors(draft({ percent: '' })).percent).toBe('wholeNumber');
    expect(depositDraftErrors(draft({ windowMinutes: '1' })).windowMinutes).toBe('range');
    expect(depositDraftErrors(draft({ windowMinutes: '31' })).windowMinutes).toBe('range');
    expect(depositDraftErrors(draft({ windowMinutes: '30' })).windowMinutes).toBeUndefined();
    expect(depositDraftErrors(draft({ minIqd: '10000001' })).minIqd).toBe('range');
    expect(depositDraftErrors(draft({ minIqd: '0' })).minIqd).toBeUndefined();
  });

  it('a cap may be empty, never below the minimum', () => {
    expect(depositDraftErrors(draft({ maxIqd: '' })).maxIqd).toBeUndefined();
    expect(depositDraftErrors(draft({ maxIqd: '9000' })).maxIqd).toBe('maxBelowMin');
    expect(depositDraftErrors(draft({ maxIqd: '10000' })).maxIqd).toBeUndefined();
    expect(depositDraftErrors(draft({ maxIqd: '1.5' })).maxIqd).toBe('wholeNumber');
    // 0242 takes a cap of 1..10,000,000 or none; a zero cap is not "no cap".
    expect(depositDraftErrors(draft({ minIqd: '0', maxIqd: '0' })).maxIqd).toBe('range');
  });
});

describe('DEPOSIT_SERVER_FIELD', () => {
  it('names a form field for every key the server may refuse', () => {
    for (const key of Object.keys(SAVED).filter((k) => k !== 'venue_id')) {
      expect(DEPOSIT_SERVER_FIELD[key], key).toBeDefined();
    }
  });
});
