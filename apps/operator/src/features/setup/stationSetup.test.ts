import { describe, expect, it } from 'vitest';
import { stationRegex } from '@touch/core/schemas/mutations';
import {
  STATION_ID_RE,
  canSaveAnyway,
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

const kdsDetails: DetailsState = {
  step: 'details',
  mode: 'kds',
  stationId: 'KDS-01',
  code: 'ABCDEFGHJK',
  host: '',
  showAdvanced: false,
};

describe('station id helpers', () => {
  it('mirrors the canonical station pattern', () => {
    expect(STATION_ID_RE.source).toBe(stationRegex.source);
  });
  it('suggests one id per mode and normalises typing', () => {
    expect(suggestStationId('till')).toBe('TILL-01');
    expect(suggestStationId('desk')).toBe('DESK-01');
    expect(suggestStationId('kds')).toBe('KDS-01');
    expect(normaliseStationId('till 2')).toBe('TILL-2');
    expect(normaliseStationId('kds_bar!')).toBe('KDS-BAR');
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

  it('kds: the code is normalised as typed and confirm starts the scan', () => {
    const s = run([{ type: 'chooseMode', mode: 'kds' }, { type: 'code', value: 'ab1o-i l2xy zz' }]);
    expect((s as DetailsState).code).toBe('AB10112XYZ');
    expect(detailsValidity(s as DetailsState).code).toBe(true);
    expect(run([{ type: 'confirm' }], s).step).toBe('scanning');
    const short = run([{ type: 'code', value: 'ABC' }, { type: 'confirm' }], s);
    expect(short.step).toBe('details');
  });

  it('scan: one till saves straight away with that host', () => {
    const s = run(
      [{ type: 'confirm' }, { type: 'scanResult', result: { status: 'found', tills: ['192.168.4.10'] } }],
      kdsDetails,
    );
    expect(s.step).toBe('saving');
    expect((s as { request: unknown }).request).toEqual({
      stationId: 'KDS-01',
      mode: 'kds',
      tillHost: '192.168.4.10',
      pairingCode: 'ABCDEFGHJK',
    });
  });

  it('scan: several tills ask which one; picking saves', () => {
    const s = run(
      [{ type: 'confirm' }, { type: 'scanResult', result: { status: 'found', tills: ['10.0.0.2', '10.0.0.3'] } }],
      kdsDetails,
    );
    expect(s).toMatchObject({ step: 'choose', tills: ['10.0.0.2', '10.0.0.3'] });
    const picked = setupReducer(s, { type: 'pickTill', host: '10.0.0.3' });
    expect(picked).toMatchObject({ step: 'saving', request: { tillHost: '10.0.0.3' } });
  });

  it('scan: a refused code is reported and cleared on retry', () => {
    const s = run(
      [{ type: 'confirm' }, { type: 'scanResult', result: { status: 'bad-code', candidates: ['10.0.0.2'] } }],
      kdsDetails,
    );
    expect(s).toMatchObject({ step: 'notFound', reason: 'bad-code' });
    expect(canSaveAnyway(s)).toBe(false);
    expect(setupReducer(s, { type: 'retry' })).toMatchObject({ step: 'details', code: '' });
  });

  it('scan: nothing found is none without an address, unreachable with one (and may be saved anyway)', () => {
    const none = run([{ type: 'confirm' }, { type: 'scanResult', result: { status: 'none' } }], kdsDetails);
    expect(none).toMatchObject({ step: 'notFound', reason: 'none' });
    expect(canSaveAnyway(none)).toBe(false);

    const withHost = { ...kdsDetails, host: '192.168.4.10', showAdvanced: true };
    const unreachable = run([{ type: 'confirm' }, { type: 'scanResult', result: { status: 'none' } }], withHost);
    expect(unreachable).toMatchObject({ step: 'notFound', reason: 'unreachable' });
    expect(canSaveAnyway(unreachable)).toBe(true);
    expect(setupReducer(unreachable, { type: 'saveAnyway' })).toMatchObject({
      step: 'saving',
      request: { tillHost: '192.168.4.10', pairingCode: 'ABCDEFGHJK' },
    });
    expect(run([{ type: 'confirm' }, { type: 'scanResult', result: { status: 'no-lan' } }], kdsDetails)).toMatchObject({
      step: 'notFound',
      reason: 'no-lan',
    });
  });

  it('a bad address blocks confirm; back from the scan returns to the form', () => {
    const bad = { ...kdsDetails, host: '300.1.1.1' };
    expect(detailsValidity(bad).host).toBe(false);
    expect(setupReducer(bad, { type: 'confirm' }).step).toBe('details');
    expect(setupReducer({ step: 'scanning', details: kdsDetails }, { type: 'back' })).toBe(kdsDetails);
  });

  it('a failed save can be retried or abandoned', () => {
    const saving: SetupState = { step: 'saving', details: kdsDetails, request: requestFor(kdsDetails, '10.0.0.2') };
    const failed = setupReducer(saving, { type: 'saveFailed', error: 'write-failed' });
    expect(failed).toMatchObject({ step: 'failed', error: 'write-failed' });
    expect(setupReducer(failed, { type: 'retry' })).toBe(kdsDetails);
    expect(setupReducer(failed, { type: 'back' })).toEqual({ step: 'mode' });
  });

  it('requestFor drops the kds-only fields for a till or desk', () => {
    expect(requestFor({ ...kdsDetails, mode: 'till', stationId: 'TILL-01' })).toEqual({ stationId: 'TILL-01', mode: 'till' });
  });
});
