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

/**
 * The identity a machine gets when it HAS NONE — SEC-32.
 *
 * It used to be `TILL1`, which is a perfectly good station id, and that was the
 * bug: a machine with no identity was handed a real one. `station_id` is not
 * decoration. It prefixes every idempotency key (`lib/idem.ts`), it is the
 * `p_device_id` that keys the manager-PIN rate limiter, and it is the device on
 * every audit row. Two misconfigured machines both calling themselves TILL1
 * share an idempotency namespace and a PIN lockout bucket, and the audit trail
 * names a till that did not take the sale.
 *
 * `UNCONFIGURED` is deliberately not a plausible station id. If it ever reaches
 * a row, the row is legibly wrong rather than quietly attributed to somebody
 * else's till — and `canTrade()` below is what stops it getting that far.
 */
export const UNCONFIGURED_STATION_ID = 'UNCONFIGURED';

const DEV_DEFAULTS = { stationId: UNCONFIGURED_STATION_ID, mode: 'till' as StationMode };

/** Modes a station.json may declare. Anything else is a broken install. */
const MODES: readonly StationMode[] = ['till', 'desk', 'kds'];

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
    //
    // SEC-32: a PRESENT file that does not say who this machine is, or says a
    // mode this build does not know, is a BROKEN INSTALL — not an invitation to
    // pick something. Both used to fall back silently: a station.json missing
    // `station_id` came back `configured: true` as TILL1 with no error at all,
    // so a mistyped file traded happily under another till's identity; and a
    // mode of "KDS" (wrong case) turned a kitchen screen into a kiosked till.
    // Neither is visible to anyone until the day's takings do not reconcile.
    const stationId = typeof raw.station_id === 'string' ? raw.station_id.trim() : '';
    if (!stationId) throw new Error('station.json has no station_id');
    if (typeof raw.mode !== 'string' || !MODES.includes(raw.mode as StationMode)) {
      throw new Error(`station.json has an unknown mode: ${JSON.stringify(raw.mode)}`);
    }
    cached = {
      stationId,
      mode: raw.mode as StationMode,
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

/**
 * May this machine act as a station — take a sale, print, serve the LAN?
 *
 * SEC-32, "a station with no station.json should refuse to trade, not guess".
 * The renderer already refuses: `__root.tsx` shows the setup screen when
 * `!configured` and the broken-install screen when `configError` is set. This
 * is the same rule for the MAIN process, which had no equivalent check — it
 * would have served the LAN and printed under whatever identity `loadStation`
 * returned.
 *
 * Deliberately NOT a hard refusal to boot. The process must still come up: the
 * setup screen that fixes the problem is rendered by this very window, and a
 * shell that exits on a bad config is a venue PC nobody can repair without a
 * developer. Boot, show the problem, refuse the WORK.
 */
export function canTrade(station: StationConfig = loadStation()): boolean {
  return station.configured && !station.configError && station.stationId !== UNCONFIGURED_STATION_ID;
}
