import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { StationInfo, StationMode } from '../ipc-channels';

// Station identity = the MACHINE's role, not the human (design-arch.md §2.1).
// station.json lives in userData (snake_case keys per design-arch §2.4; template:
// station.json.example at the package root). It is written exactly once, by
// one of: the first-run setup screen (completeFirstRun in main/index.ts), the
// CLI flags (bootstrapStationFromArgv), or a hand copy of the template.

export interface StationConfig extends StationInfo {
  /** Pre-shared key for the LAN KDS websocket (design-arch.md §2.4). */
  lanPsk?: string;
  /** Override for the LAN server bind address (default: first RFC1918 IPv4). */
  lanBind?: string;
  /** Thermal receipt printer (network/JetDirect). Absent = on-screen bill only. */
  printer?: { host: string; port?: number };
}

/** The on-disk shape. */
export interface StationFile {
  station_id?: string;
  mode?: string;
  till_host?: string;
  lan_psk?: string;
  lan_bind?: string;
  printer?: { host?: string; port?: number };
}

/** Thrown by writeStation when station.json already exists — never overwrite
 *  a file that may hold the venue's PSK or printer address. */
export class StationExistsError extends Error {
  constructor(file: string) {
    super(`station.json already exists at ${file}`);
    this.name = 'StationExistsError';
  }
}

const DEV_DEFAULTS = { stationId: 'TILL1', mode: 'till' as StationMode };

let cached: StationConfig | null = null;

export function stationFilePath(): string {
  return path.join(app.getPath('userData'), 'station.json');
}

/**
 * Read station.json once per process.
 *
 * Two distinct failure shapes, because they need opposite handling:
 *  - MISSING file → `configured: false`. First run: the renderer shows the
 *    station setup screen, and `electron .` on a clean dev machine still boots
 *    (as TILL1/till) so nothing here blocks development.
 *  - PRESENT but unreadable → `configured: true` + `configError`. A broken
 *    install, not a fresh one: defaults keep the process alive, the renderer
 *    shows the error, and nothing is allowed to overwrite the file.
 */
export function loadStation(): StationConfig {
  if (cached) return cached;
  const file = stationFilePath();
  const appVersion = app.getVersion();
  if (!fs.existsSync(file)) {
    console.warn(`[station] ${file} missing — first run, station unconfigured (dev defaults TILL1/till)`);
    cached = { ...DEV_DEFAULTS, configured: false, appVersion };
    return cached;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as StationFile;
    // TODO: zod-validate via @touch/core schemas instead of this hand check.
    const mode: StationMode = raw.mode === 'desk' || raw.mode === 'kds' ? raw.mode : 'till';
    cached = {
      stationId: raw.station_id ?? DEV_DEFAULTS.stationId,
      mode,
      tillHost: raw.till_host,
      lanPsk: raw.lan_psk,
      lanBind: raw.lan_bind,
      printer:
        raw.printer && typeof raw.printer.host === 'string'
          ? { host: raw.printer.host, port: raw.printer.port }
          : undefined,
      configured: true,
      appVersion,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[station] ${file} is unreadable — using dev defaults (TILL1/till):`, message);
    cached = { ...DEV_DEFAULTS, configured: true, configError: message, appVersion };
  }
  return cached;
}

/**
 * The one write path. Refuses to replace an existing file; writes a sibling
 * .tmp then renames so a crash mid-write never leaves a half file that would
 * read as "broken install" on the next boot. Resets the cache so a caller that
 * does NOT relaunch still sees the new values.
 */
export function writeStation(config: StationFile): void {
  const file = stationFilePath();
  if (fs.existsSync(file)) throw new StationExistsError(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, file);
  resetStationCache();
}

export function resetStationCache(): void {
  cached = null;
}
