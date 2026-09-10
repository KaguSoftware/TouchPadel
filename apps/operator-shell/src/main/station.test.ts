import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, __calls, __resetUserData } from 'electron';
import { RELAUNCH_DELAY_MS, completeFirstRun } from './first-run';
import { StationExistsError, loadStation, resetStationCache, stationFilePath, writeStation } from './station';

// station.json is written exactly once per machine. These tests pin the three
// readings (missing, valid, broken) and the one write path the first-run
// screen goes through — including the relaunch that makes the write take effect.

beforeEach(() => {
  __resetUserData();
  resetStationCache();
});

afterEach(() => {
  resetStationCache();
});

describe('loadStation', () => {
  it('a missing file is first run: unconfigured, dev defaults, no error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = loadStation();
    expect(s).toMatchObject({ stationId: 'TILL1', mode: 'till', configured: false, appVersion: '0.0.0-test' });
    expect(s.configError).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('a broken file is a broken install: configured, with the error, never first run', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const file = stationFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    const s = loadStation();
    expect(s.configured).toBe(true);
    expect(s.configError).toBeTruthy();
    expect(s.mode).toBe('till');
  });

  it('reads a kitchen screen file back in camelCase', () => {
    writeStation({ station_id: 'KDS-01', mode: 'kds', till_host: '192.168.4.10', lan_psk: 'ABCDEFGHJK' });
    expect(loadStation()).toMatchObject({
      stationId: 'KDS-01',
      mode: 'kds',
      tillHost: '192.168.4.10',
      lanPsk: 'ABCDEFGHJK',
      configured: true,
    });
  });

  it('caches until reset', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadStation().configured).toBe(false);
    writeStation({ station_id: 'DESK-01', mode: 'desk' });
    // writeStation resets the cache itself.
    expect(loadStation().configured).toBe(true);
    expect(loadStation().stationId).toBe('DESK-01');
  });
});

describe('writeStation', () => {
  it('refuses to overwrite and leaves no temp file behind', () => {
    writeStation({ station_id: 'TILL-01', mode: 'till', lan_psk: 'ABCDEFGHJK' });
    expect(() => writeStation({ station_id: 'TILL-02', mode: 'till' })).toThrow(StationExistsError);
    const dir = path.dirname(stationFilePath());
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(stationFilePath(), 'utf8')).station_id).toBe('TILL-01');
  });
});

describe('completeFirstRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it('a till mints its pairing code and relaunches', () => {
    const result = completeFirstRun({ stationId: 'TILL-01', mode: 'till' }, { mint: () => 'ABCDEFGHJK' });
    expect(result).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(stationFilePath(), 'utf8'))).toEqual({
      station_id: 'TILL-01',
      mode: 'till',
      lan_psk: 'ABCDEFGHJK',
    });
    expect(__calls).toEqual([]);
    vi.advanceTimersByTime(RELAUNCH_DELAY_MS);
    expect(__calls).toEqual(['relaunch', 'exit:0']);
  });

  it('a kitchen screen keeps the till it found and the code that opened it', () => {
    const result = completeFirstRun(
      { stationId: 'KDS-01', mode: 'kds', tillHost: '192.168.4.10', pairingCode: 'ABCDEFGHJK' },
      { relaunch: () => {} },
    );
    expect(result).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(stationFilePath(), 'utf8'))).toEqual({
      station_id: 'KDS-01',
      mode: 'kds',
      till_host: '192.168.4.10',
      lan_psk: 'ABCDEFGHJK',
    });
  });

  it('a desk carries neither host nor key', () => {
    completeFirstRun({ stationId: 'DESK-01', mode: 'desk' }, { relaunch: () => {} });
    expect(JSON.parse(fs.readFileSync(stationFilePath(), 'utf8'))).toEqual({ station_id: 'DESK-01', mode: 'desk' });
  });

  it('refuses once a file exists and never relaunches', () => {
    completeFirstRun({ stationId: 'TILL-01', mode: 'till' }, { relaunch: () => {} });
    const again = completeFirstRun({ stationId: 'TILL-02', mode: 'till' });
    expect(again).toEqual({ ok: false, error: 'already-configured' });
    vi.advanceTimersByTime(RELAUNCH_DELAY_MS * 2);
    expect(__calls).toEqual([]);
    expect(app.isPackaged).toBe(false);
  });
});
