import { describe, expect, it } from 'vitest';
import { stationRegex } from '@touch/core/schemas/mutations';
import {
  STATION_ID_RE,
  detailsValidity,
  initialSetupState,
  normaliseStationId,
  requestFor,
  setupReducer,
  suggestStationId,
  type DetailsState,
  type SetupAction,
  type SetupState,
} from './stationSetup';

function run(actions: SetupAction[], from: SetupState = initialSetupState): SetupState {
  return actions.reduce(setupReducer, from);
}

describe('station id helpers', () => {
  it('mirrors the canonical station pattern', () => {
    expect(STATION_ID_RE.source).toBe(stationRegex.source);
  });
  it('suggests one id per mode and normalises typing', () => {
    expect(suggestStationId('till')).toBe('TILL-01');
    expect(suggestStationId('desk')).toBe('DESK-01');
    expect(suggestStationId('shop')).toBe('SHOP-01');
    expect(normaliseStationId('till 2')).toBe('TILL-2');
    expect(normaliseStationId('desk_bar!')).toBe('DESK-BAR');
  });
});

describe('setupReducer', () => {
  it('till: choose, keep the suggested id, confirm → saving with id + mode only', () => {
    const s = run([{ type: 'chooseMode', mode: 'till' }, { type: 'confirm' }]);
    expect(s.step).toBe('saving');
    expect((s as { request: unknown }).request).toEqual({ stationId: 'TILL-01', mode: 'till' });
  });

  it('refuses to confirm an invalid id and reports which field is wrong', () => {
    const s = run([{ type: 'chooseMode', mode: 'desk' }, { type: 'stationId', value: '-desk' }, { type: 'confirm' }]);
    expect(s.step).toBe('details');
    expect(detailsValidity(s as DetailsState).stationId).toBe(false);
  });

  it('a failed save is retried as the same save, or abandoned', () => {
    const details: DetailsState = { step: 'details', mode: 'till', stationId: 'TILL-01' };
    const saving: SetupState = { step: 'saving', details, request: requestFor(details) };
    const failed = setupReducer(saving, { type: 'saveFailed', error: 'write-failed' });
    expect(failed).toMatchObject({ step: 'failed', error: 'write-failed' });
    expect(setupReducer(failed, { type: 'retry' })).toEqual(saving);
    expect(setupReducer(failed, { type: 'back' })).toEqual({ step: 'mode' });
    // Already set up: retrying cannot help, the screen says to restart.
    const configured = setupReducer(saving, { type: 'saveFailed', error: 'already-configured' });
    expect(setupReducer(configured, { type: 'retry' })).toBe(configured);
  });
});
