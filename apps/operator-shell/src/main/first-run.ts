import * as fs from 'node:fs';
import { app } from 'electron';
import type { StationSetupRequest, StationSetupResult } from '../ipc-channels';
import { mintPairingCode } from './pairing-code';
import { StationExistsError, stationFilePath, writeStation, type StationFile } from './station';

/** Long enough for the IPC reply to reach the renderer (quitApp uses 50 ms). */
export const RELAUNCH_DELAY_MS = 150;

/**
 * First-run completion: the setup screen's answer becomes station.json, then
 * the process restarts so `app.whenReady` re-decides everything it decided
 * from the file once — kiosk flags, LAN server/client, the station closure.
 *
 * A till mints its own pairing code here and keeps it as lan_psk; a kitchen
 * screen brings the till it found and the code that opened it. The desk needs
 * neither. Refuses outright when a file already exists: an already-configured
 * station never gets re-pointed from the renderer.
 *
 * `app.relaunch()` only spawns the new process once this one exits, and
 * `app.exit()` releases the single-instance lock immediately, so the relaunched
 * copy always wins the lock.
 */
export function completeFirstRun(
  req: StationSetupRequest,
  deps: { mint?: () => string; relaunch?: () => void } = {},
): StationSetupResult {
  if (fs.existsSync(stationFilePath())) return { ok: false, error: 'already-configured' };
  const mint = deps.mint ?? mintPairingCode;
  const file: StationFile = { station_id: req.stationId, mode: req.mode };
  if (req.mode === 'till') file.lan_psk = mint();
  if (req.mode === 'kds') {
    file.till_host = req.tillHost;
    file.lan_psk = req.pairingCode;
  }
  try {
    writeStation(file);
  } catch (error) {
    if (error instanceof StationExistsError) return { ok: false, error: 'already-configured' };
    console.error('[station] first-run write failed:', error instanceof Error ? error.message : String(error));
    return { ok: false, error: 'write-failed' };
  }
  console.log('[station] first run complete:', req.mode, req.stationId, '- relaunching');
  const relaunch =
    deps.relaunch ??
    (() => {
      app.relaunch();
      app.exit(0);
    });
  setTimeout(relaunch, RELAUNCH_DELAY_MS);
  return { ok: true };
}
